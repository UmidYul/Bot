const express = require('express');
const click = require('../../payments/click');
const payme = require('../../payments/payme');
const asyncHandler = require('../middleware/asyncHandler');
const { logToFile } = require('../../utils/webhookLogger');

const router = express.Router();

router.post(
  '/click',
  asyncHandler(async (req, res) => {
    try {
      const payload = req.body;
      const action = Number(payload.action);

      // Временно: сырое тело запроса Click (без sign_string) — чтобы при реальной оплате было
      // видно (в logs/webhooks.log), что запрос вообще дошёл до Express, ещё до бизнес-логики.
      logToFile('click', 'POST /payments/click', { ...payload, sign_string: undefined });

      const result = await click.handle(payload);

      const responseBody = {
        click_trans_id: payload.click_trans_id,
        merchant_trans_id: payload.merchant_trans_id,
        ...result,
      };
      logToFile('click', 'response', responseBody);
      res.json(responseBody);
    } catch (err) {
      console.error('Ошибка обработки вебхука Click:', err);
      logToFile('click', 'unhandled error', { message: err.message });
      res.json({ error: -8, error_note: 'Internal error' });
    }
  })
);

router.post(
  '/payme',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const method = body.method || null;
    const id = body.id === undefined ? null : body.id;

    // Payme одинаково показывает юзеру "Сервис поставщика услуг работает некорректно" на
    // любую системную ошибку -32xxx: и на -32504 (не прошла Basic-авторизация), и на -32400
    // (исключение внутри хендлера или невалидный ответ). Различить их по логам раньше было
    // нельзя — ответ роута нигде не писался, в отличие от /payments/click. Логируем:
    // факт/схему/логин авторизации (без ключа и без самого заголовка), список пришедших
    // заголовков (на cPanel/Passenger Apache может не пробросить Authorization вообще —
    // тогда его просто не будет в этом списке) и итоговый ответ.
    logToFile('payme', 'POST /payments/payme', {
      method,
      rpc_id: id,
      auth: payme.describeAuthHeader(req.headers.authorization),
      header_names: Object.keys(req.headers),
    });

    let response;
    try {
      response = await payme.handleRpc(req.headers.authorization, body);
    } catch (err) {
      // handleRpc ловит ошибки хендлеров сам, но сюда может долететь сбой на уровне
      // авторизации/разбора тела — Payme в любом случае обязан получить валидный JSON-RPC,
      // а не HTML-страницу 500 от Express (её он тоже трактует как -32400).
      console.error('Ошибка обработки вебхука Payme:', err);
      logToFile('payme', 'необработанная ошибка роута', { method, rpc_id: id, message: err.message, stack: err.stack });
      response = { jsonrpc: '2.0', id, error: { code: -32400, message: 'Internal error' } };
    }

    logToFile('payme', 'response', response);
    // Статус строго 200: Payme считает ошибкой протокола любой другой HTTP-код.
    res.status(200).json(response);
  })
);

module.exports = router;
