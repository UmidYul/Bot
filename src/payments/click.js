const crypto = require('crypto');
const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');
const promoCodesRepo = require('../db/repositories/promoCodes');
const { grantAccess } = require('../services/accessService');
const { sendReceipt } = require('../services/receiptService');
const { notifyNewPayment } = require('../services/adminNotifyService');
const { logToFile } = require('../utils/webhookLogger');

// Стандартные коды ошибок Click Shop API.
const ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INVALID_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5, // payment (заказ) не найден
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  TRANSACTION_CANCELLED: -9,
};

const ACTION = { PREPARE: 0, COMPLETE: 1 };

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
 * ВАЖНО: перед продакшеном свериться с актуальной документацией/личным кабинетом Click —
 * порядок конкатенации должен точно совпасть, иначе все запросы будут отклоняться.
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
  return expected === String(payload.sign_string || '').toLowerCase() || expected === payload.sign_string;
}

function amountsMatch(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

async function logEvent(paymentId, event, payload) {
  if (!paymentId) return;
  await paymentsRepo.addEvent({ paymentId, provider: 'click', event, payload });
}

/**
 * Находит платёж по merchant_trans_id, а если такого ещё нет — пробует найти юзера по
 * этому же значению как по коду и завести платёж на лету. Это сценарий "оплата как за
 * коммуналку": юзер открывает приложение Click напрямую, минуя бота, вводит свой код —
 * никакого платежа в БД на этот момент ещё не существует. Сумма всегда фиксированная
 * (config.channelPrice), а не то, что прислал Click в payload.amount — иначе можно было бы
 * получить доступ, оплатив через приложение любую произвольную (например, 1) сумму;
 * реальная сверка суммы происходит чуть ниже через amountsMatch(payment.amount, payload.amount).
 */
async function resolveOrCreatePayment(merchantTransId) {
  const existing = await paymentsRepo.findByMerchantTransId(merchantTransId);
  if (existing) {
    // merchant_trans_id мог по крайне маловероятному совпадению принадлежать платежу,
    // заведённому под другого провайдера (Payme/промокод) — не отдаём его чужому вебхуку.
    return existing.provider === 'click' ? existing : null;
  }

  const user = await usersRepo.findByCode(merchantTransId);
  if (!user || user.blocked_at || user.status === 'paid') return null;

  return paymentsRepo.createPayment({
    userId: user.id,
    provider: 'click',
    amount: config.channelPrice,
    merchantTransId,
    status: 'pending',
  });
}

/**
 * Защита от повторной реальной оплаты: юзер мог оставить эту оплату "висеть" (не закрыл
 * приложение Click), а доступ уже получить другим способом (Payme, промокод, второй
 * платёж) — или его успели заблокировать, пока платёж был в pending. Проверяем на этапе
 * Prepare (до того, как Click спишет деньги) — на Complete эту проверку намеренно не
 * дублируем: к этому моменту Click уже мог реально провести списание, и отказ здесь
 * означал бы повисшие деньги без доступа и без подтверждения провайдеру.
 */
async function assertUserStillPayable(userId) {
  const user = await usersRepo.findById(userId);
  return Boolean(user) && !user.blocked_at && user.status !== 'paid';
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

  const payment = await resolveOrCreatePayment(payload.merchant_trans_id);
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
  if (!amountsMatch(payment.amount, payload.amount)) {
    log('PREPARE rejected: amount mismatch', { payment_id: payment.id, expected: payment.amount, received: payload.amount });
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
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

  const payment = await paymentsRepo.findByMerchantTransId(payload.merchant_trans_id);
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

  // Идемпотентность: повторный Complete с уже оплаченным заказом не должен начислять доступ дважды.
  if (payment.status === 'paid') {
    log('COMPLETE already paid (idempotent replay)', { payment_id: payment.id });
    return { error: ERROR.SUCCESS, error_note: 'Success', merchant_confirm_id: payment.id };
  }

  if (Number(payload.error) < 0) {
    log('COMPLETE reports provider-side failure, marking failed', { payment_id: payment.id, error: payload.error });
    await paymentsRepo.markFailed(payment.id);
    return { error: ERROR.SUCCESS, error_note: 'Success' };
  }

  if (!amountsMatch(payment.amount, payload.amount)) {
    log('COMPLETE rejected: amount mismatch', { payment_id: payment.id, expected: payment.amount, received: payload.amount });
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
  }
  if (payment.status !== 'pending') {
    log('COMPLETE rejected: payment status is not pending', { payment_id: payment.id, status: payment.status });
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }

  const paid = await paymentsRepo.markPaid(payment.id);
  log('COMPLETE markPaid done', { payment_id: paid.id, status: paid.status, paid_at: paid.paid_at });

  // С этой точки деньги уже списаны и payment.status='paid' уже закоммичен в Postgres — что бы
  // ни случилось ниже (сбой промо-инкремента, ошибка Telegram API и т.п.), Click должен
  // получить error:0. Иначе он посчитает Complete неуспешным и либо повторит запрос (что
  // безопасно — выше есть идемпотентная ветка), либо оставит транзакцию в подвешенном
  // состоянии на своей стороне, хотя деньги уже наши и заказ уже оплачен.
  try {
    if (payment.promo_code_id) await promoCodesRepo.incrementUsage(payment.promo_code_id);
    const updatedUser = await usersRepo.updateStatus(payment.user_id, 'paid');
    log('COMPLETE user status updated', { user_id: updatedUser.id, status: updatedUser.status });
    await grantAccess(updatedUser);
    await sendReceipt(updatedUser, paid);
    await notifyNewPayment(updatedUser, paid);
  } catch (err) {
    console.error('[click] COMPLETE post-payment step failed (payment is already marked paid in DB):', err);
  }

  return { error: ERROR.SUCCESS, error_note: 'Success', merchant_confirm_id: payment.id };
}

module.exports = { verifySignature, buildSignString, handlePrepare, handleComplete, resolveOrCreatePayment, ERROR, ACTION };
