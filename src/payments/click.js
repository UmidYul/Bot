const crypto = require('crypto');
const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');
const promoCodesRepo = require('../db/repositories/promoCodes');
const { grantAccess } = require('../services/accessService');
const { sendReceipt } = require('../services/receiptService');
const { sendUnderpaymentNotice } = require('../services/underpaymentNotice');
const {
  notifyNewPayment,
  notifyUnderpayment,
  notifyUnderpaymentLockout,
  notifyPostPaymentFailure,
} = require('../services/adminNotifyService');
const { resolvePaymentOutcome } = require('../services/balanceService');
const { resolveTargetPrice } = require('../services/promoService');
const { logToFile } = require('../utils/webhookLogger');

// Стандартные коды ошибок Click Shop API (docs.click.uz/en/click-api-request/).
const ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INVALID_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5, // payment (заказ) не найден
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  REQUEST_ERROR: -8,
  TRANSACTION_CANCELLED: -9,
};

const ACTION = { PREPARE: 0, COMPLETE: 1 };

// Поля, обязательные в любом запросе Prepare/Complete по докам Click — их отсутствие
// должно диагностироваться отдельно (-8), а не проваливаться на проверке подписи (-1),
// иначе по логам не отличить "битый запрос" от "неверный секретный ключ".
const REQUIRED_FIELDS = [
  'click_trans_id',
  'service_id',
  'merchant_trans_id',
  'amount',
  'action',
  'sign_time',
  'sign_string',
];

/**
 * Временное подробное логирование вебхука Click — включено, пока не диагностирована
 * причина "деньги списаны, но payment/user не переходят в paid" в проде. Пишет только
 * нечувствительные поля (никогда не логирует secretKey/sign_string) — и в stdout, и в файл
 * logs/webhooks.log (см. src/utils/webhookLogger.js), поскольку на этом хостинге (cPanel
 * Node.js Selector / Passenger) stdout процесса нигде постоянно не сохраняется. Можно
 * убрать/приглушить, когда причина найдена и подтверждена фиксом.
 */
function log(event, data) {
  logToFile('click', event, data);
}

/**
 * MD5-подпись Click Shop API.
 * Prepare:  MD5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
 * Complete: MD5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
 * ВАЖНО: конкатенируются сырые строковые значения из тела запроса, в точности как их
 * прислал Click (в частности amount — как есть, без округления/toFixed) — любое повторное
 * форматирование числа перед хэшированием даёт другую подпись и ложный -1.
 */
function buildSignString(payload) {
  const { click_trans_id, service_id, merchant_trans_id, merchant_prepare_id, amount, action, sign_time } = payload;

  const parts =
    Number(action) === ACTION.COMPLETE
      ? [click_trans_id, service_id, config.click.secretKey, merchant_trans_id, merchant_prepare_id, amount, action, sign_time]
      : [click_trans_id, service_id, config.click.secretKey, merchant_trans_id, amount, action, sign_time];

  return crypto.createHash('md5').update(parts.join('')).digest('hex');
}

function verifySignature(payload) {
  const expected = buildSignString(payload);
  return expected === String(payload.sign_string || '').toLowerCase();
}

async function logEvent(paymentId, event, payload) {
  if (!paymentId) return;
  await paymentsRepo.addEvent({ paymentId, provider: 'click', event, payload });
}

/**
 * Находит платёж по merchant_trans_id, а если такого ещё нет — пробует найти юзера по
 * этому же значению как по коду и завести платёж на лету. Это сценарий "оплата как за
 * коммуналку": юзер открывает приложение Click напрямую, минуя бота, вводит свой код —
 * никакого платежа в БД на этот момент ещё не существует. Сумма платежа — то, что реально
 * прислал Click в payload.amount (пользователь мог ввести в приложении любую сумму, в т.ч.
 * меньше цены канала — недоплата зачисляется на внутренний счёт, см. balanceService.js и
 * handleComplete ниже); реальный контроль не в отклонении "неправильной" суммы, а в том, что
 * доступ выдаётся только когда накопленный счёт + этот платёж достигают config.channelPrice.
 */
async function resolveOrCreatePayment(merchantTransId, amount) {
  // Ищем именно живой (pending) платёж ПРОВАЙДЕРА click: один и тот же код юзера служит
  // лицевым счётом и в Click, и в Payme, поэтому строк с таким merchant_trans_id может быть
  // несколько. Раньше бралась первая попавшаяся, и строка, заведённая Payme, навсегда
  // занимала код для Click (вечный -5 "Order not found").
  const existing = await paymentsRepo.findPendingByProviderAndMerchantTransId('click', merchantTransId);
  if (existing) return existing;

  const user = await usersRepo.findByCode(merchantTransId);
  if (user) {
    if (user.deleted_at || user.blocked_at || user.status === 'paid') return null;
    // createOrGetPendingPayment, а не createPayment: два почти одновременных Prepare по
    // одному коду не должны падать на уникальном индексе — второй подхватит строку первого.
    return paymentsRepo.createOrGetPendingPayment({
      userId: user.id,
      provider: 'click',
      amount,
      merchantTransId,
    });
  }

  // merchant_trans_id — не код юзера, а конкретный заказ из бота ("<code>-<ts>"), живого
  // платежа по нему нет: он уже оплачен или отменён. Возвращаем последнюю строку, чтобы
  // handlePrepare ответил -4/-9 (как и раньше), а не -5 "Order not found".
  return paymentsRepo.findLatestByProviderAndMerchantTransId('click', merchantTransId);
}

/**
 * Защита от повторной реальной оплаты: юзер мог оставить эту оплату "висеть" (не закрыл
 * приложение Click), а доступ уже получить другим способом (Payme, промокод, второй
 * платёж) — или его успели заблокировать/удалить, пока платёж был в pending. Проверяем на этапе
 * Prepare (до того, как Click спишет деньги) — на Complete эту проверку намеренно не
 * дублируем: к этому моменту Click уже мог реально провести списание, и отказ здесь
 * означал бы повисшие деньги без доступа и без подтверждения провайдеру.
 */
async function assertUserStillPayable(userId) {
  const user = await usersRepo.findById(userId);
  return Boolean(user) && !user.deleted_at && !user.blocked_at && user.status !== 'paid';
}

/**
 * @param {object} payload тело запроса Click (action=0)
 * @returns {Promise<{error: number, error_note: string, merchant_prepare_id?: number}>}
 */
async function handlePrepare(payload) {
  log('PREPARE received', {
    click_trans_id: payload.click_trans_id,
    merchant_trans_id: payload.merchant_trans_id,
    amount: payload.amount,
    action: payload.action,
    sign_time: payload.sign_time,
  });

  const signOk = verifySignature(payload);
  log('PREPARE signature check', { ok: signOk });
  if (!signOk) {
    return { error: ERROR.SIGN_CHECK_FAILED, error_note: 'SIGN CHECK FAILED' };
  }

  // Точное совпадение суммы больше не требуется (см. handleComplete ниже), но сумма всё ещё
  // должна быть реальными деньгами — ноль/отрицательное сюда дойти не должно, а на лету
  // заводить новый заказ на такую "сумму" тем более не стоит (для on-the-fly платежа это
  // означало бы навсегда занять merchant_trans_id этого кода нулевой транзакцией).
  if (!(Number(payload.amount) > 0)) {
    log('PREPARE rejected: non-positive amount', { merchant_trans_id: payload.merchant_trans_id, amount: payload.amount });
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
  }

  const payment = await resolveOrCreatePayment(payload.merchant_trans_id, payload.amount);
  log('PREPARE resolveOrCreatePayment', {
    merchant_trans_id: payload.merchant_trans_id,
    found: Boolean(payment),
    payment_id: payment ? payment.id : null,
    payment_status: payment ? payment.status : null,
  });
  if (!payment) {
    await logEvent(null, 'prepare', payload);
    return { error: ERROR.USER_NOT_FOUND, error_note: 'Order not found' };
  }

  await paymentsRepo.setRawPayload(payment.id, payload);
  await logEvent(payment.id, 'prepare', payload);

  if (payment.status === 'paid') {
    log('PREPARE already paid', { payment_id: payment.id });
    return { error: ERROR.ALREADY_PAID, error_note: 'Already paid', merchant_prepare_id: payment.id };
  }
  if (payment.status !== 'pending') {
    log('PREPARE rejected: payment status is not pending', { payment_id: payment.id, status: payment.status });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }
  if (payment.provider_trans_id && payment.provider_trans_id !== String(payload.click_trans_id)) {
    // На этот payment уже заведена другая транзакция Click.
    log('PREPARE rejected: another click_trans_id already bound to this order', {
      payment_id: payment.id,
      existing_provider_trans_id: payment.provider_trans_id,
      received_click_trans_id: payload.click_trans_id,
    });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Transaction already exists for this order' };
  }
  if (!(await assertUserStillPayable(payment.user_id))) {
    log('PREPARE rejected: user not payable (blocked or already paid)', { payment_id: payment.id, user_id: payment.user_id });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }

  await paymentsRepo.setProviderTransId(payment.id, String(payload.click_trans_id));

  log('PREPARE success', { payment_id: payment.id, click_trans_id: payload.click_trans_id });
  return { error: ERROR.SUCCESS, error_note: 'Success', merchant_prepare_id: payment.id };
}

/**
 * @param {object} payload тело запроса Click (action=1)
 * @returns {Promise<{error: number, error_note: string, merchant_confirm_id?: number}>}
 */
async function handleComplete(payload) {
  log('COMPLETE received', {
    click_trans_id: payload.click_trans_id,
    merchant_trans_id: payload.merchant_trans_id,
    merchant_prepare_id: payload.merchant_prepare_id,
    amount: payload.amount,
    action: payload.action,
    error: payload.error,
    sign_time: payload.sign_time,
  });

  const signOk = verifySignature(payload);
  log('COMPLETE signature check', { ok: signOk });
  if (!signOk) {
    return { error: ERROR.SIGN_CHECK_FAILED, error_note: 'SIGN CHECK FAILED' };
  }

  // Prepare уже привязал click_trans_id к конкретной строке — ищем сначала по нему: с тех
  // пор как merchant_trans_id (код юзера при оплате "как за коммуналку") может встречаться
  // в нескольких строках, поиск только по нему неоднозначен. Фолбэк по merchant_trans_id
  // оставлен для Complete без предшествующего Prepare — его отсечёт проверка ниже (-6).
  const boundToTransId = await paymentsRepo.findByProviderTransId(String(payload.click_trans_id));
  const payment =
    boundToTransId && boundToTransId.provider === 'click'
      ? boundToTransId
      : await paymentsRepo.findLatestByProviderAndMerchantTransId('click', payload.merchant_trans_id);
  log('COMPLETE payment lookup', {
    merchant_trans_id: payload.merchant_trans_id,
    found: Boolean(payment),
    payment_id: payment ? payment.id : null,
    payment_provider: payment ? payment.provider : null,
    payment_status: payment ? payment.status : null,
  });
  if (!payment || payment.provider !== 'click') {
    await logEvent(null, 'complete', payload);
    return { error: ERROR.USER_NOT_FOUND, error_note: 'Order not found' };
  }

  await paymentsRepo.setRawPayload(payment.id, payload);
  await logEvent(payment.id, 'complete', payload);

  // Complete без предшествующего успешного Prepare (нет забронированного click_trans_id
  // на этом заказе, либо merchant_prepare_id не совпадает с ним) — по докам Click это -6.
  if (!payment.provider_trans_id || String(payload.merchant_prepare_id) !== String(payment.id)) {
    log('COMPLETE rejected: no matching Prepare for this order', {
      payment_id: payment.id,
      provider_trans_id: payment.provider_trans_id,
      received_merchant_prepare_id: payload.merchant_prepare_id,
    });
    return { error: ERROR.TRANSACTION_NOT_FOUND, error_note: 'Transaction does not exist' };
  }

  // Идемпотентность: повторный Complete по уже оплаченному заказу — по докам Click
  // ответ обязан быть -4 ("Already paid"), а не повторный 0 — это единственные два
  // допустимых "неуспешных" ответа на Complete после реального списания денег.
  if (payment.status === 'paid') {
    log('COMPLETE already paid (idempotent replay)', { payment_id: payment.id });
    return { error: ERROR.ALREADY_PAID, error_note: 'Already paid', merchant_confirm_id: payment.id };
  }
  // Аналогично для уже отменённого заказа — повторное подтверждение отклонённого платежа.
  if (payment.status === 'canceled') {
    log('COMPLETE rejected: order already cancelled', { payment_id: payment.id });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Transaction cancelled' };
  }

  if (Number(payload.error) < 0) {
    log('COMPLETE reports provider-side failure, marking failed', { payment_id: payment.id, error: payload.error });
    await paymentsRepo.markFailed(payment.id);
    return { error: ERROR.SUCCESS, error_note: 'Success' };
  }

  if (payment.status !== 'pending') {
    log('COMPLETE rejected: payment status is not pending', { payment_id: payment.id, status: payment.status });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }
  if (!(Number(payload.amount) > 0)) {
    log('COMPLETE rejected: non-positive amount', { payment_id: payment.id, amount: payload.amount });
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
  }

  // Сумма больше не сверяется с "ожидаемой" — пользователь мог заплатить меньше цены канала
  // напрямую в приложении Click; markPaid ниже перезаписывает amount на то, что реально
  // пришло, чтобы payments оставалась достоверным журналом. status='paid' здесь означает
  // "эта транзакция закрыта провайдером", а не "пользователю выдан доступ" — см. комментарий
  // в paymentsRepo.markPaid.
  const paid = await paymentsRepo.markPaid(payment.id, { amount: Number(payload.amount) });
  log('COMPLETE markPaid done', { payment_id: paid.id, status: paid.status, paid_at: paid.paid_at });

  // С этой точки деньги уже списаны и payment.status='paid' уже закоммичен в Postgres — что бы
  // ни случилось ниже (сбой промо-инкремента, ошибка Telegram API и т.п.), Click должен
  // получить error:0. Иначе он посчитает Complete неуспешным и либо повторит запрос (что
  // безопасно — выше есть идемпотентная ветка), либо оставит транзакцию в подвешенном
  // состоянии на своей стороне, хотя деньги уже наши и заказ уже оплачен.
  try {
    // Инкремент баланса — атомарная SQL-операция (balance = balance + ?), а не read-modify-
    // write: два платежа, завершающихся почти одновременно (например, доплата через Click и
    // Payme сразу после недоплаты), не должны оба прочитать баланс ДО увеличения друг другом
    // и оба решить "не хватает", хотя суммарно уже достаточно. Порог проверяется по уже
    // обновлённому значению, которое Postgres гарантирует консистентным под конкурентностью.
    const updatedUser = await usersRepo.incrementBalance(payment.user_id, Number(payload.amount));
    const targetPrice = await resolveTargetPrice(config.channelPrice, payment.promo_code_id);
    const outcome = resolvePaymentOutcome(updatedUser.balance, 0, targetPrice);
    log('COMPLETE balance outcome', { payment_id: paid.id, user_id: updatedUser.id, balance_after: updatedUser.balance, ...outcome });

    if (outcome.grantsAccess) {
      if (payment.promo_code_id) await promoCodesRepo.incrementUsage(payment.promo_code_id);
      await usersRepo.setBalance(updatedUser.id, 0);
      const paidUser = await usersRepo.updateStatus(payment.user_id, 'paid');
      log('COMPLETE user status updated', { user_id: paidUser.id, status: paidUser.status });
      await grantAccess(paidUser);
      await sendReceipt(paidUser, paid);
      await notifyNewPayment(paidUser, paid);
    } else if (updatedUser.status !== 'paid') {
      // status уже 'paid' означает, что доступ выдал другой почти одновременный платёж (см.
      // комментарий выше) — этот платёж просто лёг остатком на счёт, дублировать "не хватает"
      // юзеру, у которого уже есть доступ, не нужно.
      // Анти-спам: много мелких недоплат подряд по одному коду не должны заваливать юзера
      // и админ-чат уведомлениями — сама недоплата на баланс зачисляется в любом случае.
      const throttle = await usersRepo.registerUnderpaymentNotice(
        updatedUser.id,
        config.underpaymentAntiSpam.maxAttempts,
        config.underpaymentAntiSpam.lockoutMinutes
      );
      if (throttle.shouldNotify) {
        await sendUnderpaymentNotice(updatedUser, { paidNow: payload.amount, remaining: outcome.remaining });
        await notifyUnderpayment(updatedUser, paid, outcome.remaining);
        if (throttle.justLocked) await notifyUnderpaymentLockout(updatedUser);
      }
    }
  } catch (err) {
    console.error('[click] COMPLETE post-payment step failed (payment is already marked paid in DB):', err);
    await notifyPostPaymentFailure('Click', payment.id, err);
  }

  return { error: ERROR.SUCCESS, error_note: 'Success', merchant_confirm_id: payment.id };
}

/**
 * Единая точка входа для POST /payments/click — валидирует то, что общее для Prepare и
 * Complete (обязательные поля, допустимый action), прежде чем передать управление
 * конкретному обработчику. Вынесено сюда, а не в Express-роут, чтобы -8/-3 тоже покрывались
 * тестами наравне с остальными кодами ошибок Click.
 * @param {object} payload
 */
async function handle(payload) {
  if (!REQUIRED_FIELDS.every((key) => payload && payload[key] !== undefined && payload[key] !== null && payload[key] !== '')) {
    log('REQUEST rejected: missing required fields', { received_keys: payload ? Object.keys(payload) : [] });
    return { error: ERROR.REQUEST_ERROR, error_note: 'Error in request from click' };
  }

  const action = Number(payload.action);
  if (action !== ACTION.PREPARE && action !== ACTION.COMPLETE) {
    log('REQUEST rejected: unknown action', { action: payload.action });
    return { error: ERROR.ACTION_NOT_FOUND, error_note: 'Action not found' };
  }

  return action === ACTION.COMPLETE ? handleComplete(payload) : handlePrepare(payload);
}

module.exports = {
  handle,
  verifySignature,
  buildSignString,
  handlePrepare,
  handleComplete,
  resolveOrCreatePayment,
  ERROR,
  ACTION,
};
