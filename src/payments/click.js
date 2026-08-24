const crypto = require('crypto');
const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');
const promoCodesRepo = require('../db/repositories/promoCodes');
const { grantAccess } = require('../services/accessService');
const { sendReceipt } = require('../services/receiptService');
const { notifyNewPayment } = require('../services/adminNotifyService');

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
  if (existing) return existing;

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
 * @param {object} payload тело запроса Click (action=0)
 * @returns {Promise<{error: number, error_note: string, merchant_prepare_id?: number}>}
 */
async function handlePrepare(payload) {
  if (!verifySignature(payload)) {
    return { error: ERROR.SIGN_CHECK_FAILED, error_note: 'SIGN CHECK FAILED' };
  }

  const payment = await resolveOrCreatePayment(payload.merchant_trans_id);
  if (!payment) {
    await logEvent(null, 'prepare', payload);
    return { error: ERROR.USER_NOT_FOUND, error_note: 'Order not found' };
  }

  await paymentsRepo.setRawPayload(payment.id, payload);
  await logEvent(payment.id, 'prepare', payload);

  if (payment.status === 'paid') {
    return { error: ERROR.ALREADY_PAID, error_note: 'Already paid', merchant_prepare_id: payment.id };
  }
  if (payment.status !== 'pending') {
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }
  if (!amountsMatch(payment.amount, payload.amount)) {
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
  }

  await paymentsRepo.setProviderTransId(payment.id, String(payload.click_trans_id));

  return { error: ERROR.SUCCESS, error_note: 'Success', merchant_prepare_id: payment.id };
}

/**
 * @param {object} payload тело запроса Click (action=1)
 * @returns {Promise<{error: number, error_note: string, merchant_confirm_id?: number}>}
 */
async function handleComplete(payload) {
  if (!verifySignature(payload)) {
    return { error: ERROR.SIGN_CHECK_FAILED, error_note: 'SIGN CHECK FAILED' };
  }

  const payment = await paymentsRepo.findByMerchantTransId(payload.merchant_trans_id);
  if (!payment) {
    await logEvent(null, 'complete', payload);
    return { error: ERROR.USER_NOT_FOUND, error_note: 'Order not found' };
  }

  await paymentsRepo.setRawPayload(payment.id, payload);
  await logEvent(payment.id, 'complete', payload);

  // Идемпотентность: повторный Complete с уже оплаченным заказом не должен начислять доступ дважды.
  if (payment.status === 'paid') {
    return { error: ERROR.SUCCESS, error_note: 'Success', merchant_confirm_id: payment.id };
  }

  if (Number(payload.error) < 0) {
    await paymentsRepo.markFailed(payment.id);
    return { error: ERROR.SUCCESS, error_note: 'Success' };
  }

  if (!amountsMatch(payment.amount, payload.amount)) {
    return { error: ERROR.INVALID_AMOUNT, error_note: 'Incorrect amount' };
  }
  if (payment.status !== 'pending') {
    return { error: ERROR.TRANSACTION_CANCELLED, error_note: 'Order is not payable' };
  }

  const paid = await paymentsRepo.markPaid(payment.id);

  if (payment.promo_code_id) await promoCodesRepo.incrementUsage(payment.promo_code_id);
  const updatedUser = await usersRepo.updateStatus(payment.user_id, 'paid');
  await grantAccess(updatedUser);
  await sendReceipt(updatedUser, paid);
  await notifyNewPayment(updatedUser, paid);

  return { error: ERROR.SUCCESS, error_note: 'Success', merchant_confirm_id: payment.id };
}

module.exports = { verifySignature, buildSignString, handlePrepare, handleComplete, resolveOrCreatePayment, ERROR, ACTION };
