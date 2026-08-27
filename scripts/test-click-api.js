#!/usr/bin/env node
/**
 * Ручная проверка вебхука Click (/payments/click) — шлёт реальный prepare-запрос
 * с корректно посчитанной подписью, как это делает сам Click.
 *
 * Использование: node scripts/test-click-api.js
 */
const crypto = require('crypto');
const config = require('../src/config');

const URL_ENDPOINT = `${config.webBaseUrl}/payments/click`;
const SERVICE_ID = config.click.serviceId;
const SECRET_KEY = config.click.secretKey;

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function buildPrepareSign({ click_trans_id, service_id, merchant_trans_id, amount, action, sign_time }) {
  return md5([click_trans_id, service_id, SECRET_KEY, merchant_trans_id, amount, action, sign_time].join(''));
}

async function send(label, payload) {
  const res = await fetch(URL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  console.log(`\n--- ${label} ---`);
  console.log('HTTP status:', res.status);
  if (json) {
    console.log('Response (JSON):', json);
  } else {
    console.log('Response НЕ является JSON (первые 300 символов):');
    console.log(raw.slice(0, 300));
  }
}

(async () => {
  console.log('Endpoint:', URL_ENDPOINT);
  console.log('Service ID:', SERVICE_ID);

  const now = new Date();
  const sign_time = now.toISOString().slice(0, 19).replace('T', ' ');
  const click_trans_id = String(Date.now());
  const merchant_trans_id = 'TEST_' + Date.now();
  const amount = config.channelPrice || 1000;
  const action = 0; // PREPARE

  // 1) Заведомо неверная подпись — ожидаем error=-1 (SIGN CHECK FAILED)
  await send('1) Неверная подпись', {
    click_trans_id,
    service_id: SERVICE_ID,
    merchant_trans_id,
    amount,
    action,
    sign_time,
    sign_string: 'deadbeef',
  });

  // 2) Верная подпись, но такого юзера/кода нет в БД — ожидаем error=-5 (Order/USER not found)
  const validSign = buildPrepareSign({ click_trans_id, service_id: SERVICE_ID, merchant_trans_id, amount, action, sign_time });
  await send('2) Верная подпись, несуществующий merchant_trans_id', {
    click_trans_id,
    service_id: SERVICE_ID,
    merchant_trans_id,
    amount,
    action,
    sign_time,
    sign_string: validSign,
  });

  console.log(`
Как читать результат:
- Тест 1 должен вернуть error: -1 (SIGN CHECK FAILED) — значит эндпоинт вообще отвечает и проверяет подпись.
- Тест 2 должен вернуть error: -5 (USER_NOT_FOUND / Order not found) — значит подпись посчиталась ВЕРНО
  (дошли до бизнес-логики), просто такого кода пользователя реально нет в БД — это нормально для теста.
- Если тест 2 вернул -1 — секретный ключ (CLICK_SECRET_KEY) или service_id в .env не совпадают с тем,
  что в кабинете Click, либо формат sign_time/порядок полей отличается от документации Click.
- Если ответ вообще не JSON (HTML-страница) — запрос не дошёл до Express-приложения, что-то перед
  сервером (WAF/antibot/reverse-proxy) блокирует его раньше.
- Чтобы проверить happy-path целиком (реальный prepare+complete), нужно взять merchant_trans_id
  существующего пользователя с status='pending' (его код) и config.channelPrice как amount.
`);
})();
