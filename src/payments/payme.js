const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');
const promoCodesRepo = require('../db/repositories/promoCodes');
const { grantAccess } = require('../services/accessService');
const { sendReceipt } = require('../services/receiptService');
const { sendUnderpaymentNotice } = require('../services/underpaymentNotice');
const { notifyNewPayment, notifyUnderpayment } = require('../services/adminNotifyService');
const { resolvePaymentOutcome } = require('../services/balanceService');

// Стандартные коды ошибок Payme Merchant API.
const ERROR = {
  INSUFFICIENT_PRIVILEGE: -32504,
  INVALID_ACCOUNT: -31050,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  UNABLE_TO_PERFORM: -31008,
  UNABLE_TO_CANCEL: -31007,
  ALREADY_DONE: -31060,
};

const STATE = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED_AFTER_CREATE: -1,
  CANCELLED_AFTER_PERFORM: -2,
};

function rpcError(code, message, data) {
  const err = new Error(message);
  err.rpc = { code, message: { ru: message, uz: message, en: message }, data };
  return err;
}

/**
 * Проверка Basic-авторизации Payme. Логин игнорируется, сверяется только пароль/ключ
 * (в проде — PAYME_SECRET_KEY, в песочнице Payme используется PAYME_TEST_KEY).
 */
function checkAuth(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return false;

  const decoded = Buffer.from(authorizationHeader.slice('Basic '.length), 'base64').toString('utf8');
  const [, password] = decoded.split(':');

  return password === config.payme.secretKey || password === config.payme.testKey;
}

/**
 * Разбирает account, присланный Payme. Поле account.* настраивается в личном кабинете
 * Payme Business — здесь ожидаем account.merchant_trans_id (см. payme.linkBuilder.js).
 *
 * Если платежа с таким merchant_trans_id ещё нет в БД — это может быть "оплата как за
 * коммуналку": юзер открыл приложение Payme напрямую, минуя бота, и ввёл свой код
 * лицевого счёта. В этом случае merchant_trans_id прилетает как есть (сам код), и мы
 * пробуем найти по нему юзера, чтобы завести платёж на лету — суммой, которую реально
 * прислал Payme (может быть меньше цены канала, см. createTransaction/balanceService.js).
 * @returns {Promise<{merchantTransId: string, payment: object|null, user: object|null}|null>}
 */
async function resolveAccount(account) {
  const merchantTransId = account && (account.merchant_trans_id || account.code);
  if (!merchantTransId) return null;

  const payment = await paymentsRepo.findByMerchantTransId(merchantTransId);
  if (payment) {
    // merchant_trans_id мог по крайне маловероятному совпадению принадлежать платежу,
    // заведённому под другого провайдера (Click/промокод) — не отдаём его чужому вебхуку.
    if (payment.provider !== 'payme') return null;
    return { merchantTransId, payment, user: null };
  }

  const user = await usersRepo.findByCode(merchantTransId);
  if (!user || user.blocked_at || user.status === 'paid') return null;

  return { merchantTransId, payment: null, user };
}

/**
 * Защита от повторной реальной оплаты: юзер мог оставить эту оплату "висеть" (не закрыл
 * страницу Payme), а доступ уже получить другим способом (Click, промокод, второй платёж) —
 * или его успели заблокировать, пока платёж был в pending. Проверяем ДО списания денег
 * (CheckPerformTransaction/CreateTransaction), чтобы не доводить до реального списания —
 * в PerformTransaction эту проверку намеренно не дублируем: к этому моменту Payme уже мог
 * списать/захолдировать средства, и отказ здесь означал бы повисшие деньги без доступа.
 */
async function assertUserStillPayable(userId) {
  const user = await usersRepo.findById(userId);
  if (!user || user.blocked_at || user.status === 'paid') {
    throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
  }
}

// Payme передаёт сумму в тийинах (1 сум = 100 тийин), у нас в payments.amount/users.balance — сумы.
function tiyinToUzs(tiyin) {
  return Number(tiyin) / 100;
}

function toRpcState(payment) {
  if (payment.status === 'paid') return STATE.PERFORMED;
  if (payment.status === 'canceled') {
    return payment.paid_at ? STATE.CANCELLED_AFTER_PERFORM : STATE.CANCELLED_AFTER_CREATE;
  }
  return STATE.CREATED;
}

function toMs(date) {
  return date ? new Date(date).getTime() : 0;
}

async function logEvent(paymentId, event, payload) {
  if (!paymentId) return;
  await paymentsRepo.addEvent({ paymentId, provider: 'payme', event, payload });
}

async function checkPerformTransaction(params) {
  const resolved = await resolveAccount(params.account);
  if (!resolved) throw rpcError(ERROR.INVALID_ACCOUNT, 'Order not found', { account: ['merchant_trans_id'] });

  await logEvent(resolved.payment ? resolved.payment.id : null, 'CheckPerformTransaction', params);

  // Сумма больше не сверяется здесь: пользователь мог платить меньше цены канала напрямую
  // через приложение — недоплата зачисляется на внутренний счёт (см. balanceService.js),
  // доступ выдаётся, когда накопленный счёт + платёж достигают config.channelPrice.
  if (resolved.payment) {
    if (resolved.payment.status !== 'pending') {
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
    }
    await assertUserStillPayable(resolved.payment.user_id);
  }

  return { allow: true };
}

async function createTransaction(params) {
  let payment = await paymentsRepo.findByProviderTransId(params.id);

  if (!payment) {
    const resolved = await resolveAccount(params.account);
    if (!resolved) throw rpcError(ERROR.INVALID_ACCOUNT, 'Order not found', { account: ['merchant_trans_id'] });

    // Платёж по коду ещё не заведён в БД — юзер платит вручную через приложение Payme,
    // минуя бота. Заводим его на лету суммой, которую реально прислал Payme (может быть
    // меньше цены канала — недоплата зачисляется на внутренний счёт, см. balanceService.js).
    payment =
      resolved.payment ||
      (await paymentsRepo.createPayment({
        userId: resolved.user.id,
        provider: 'payme',
        amount: tiyinToUzs(params.amount),
        merchantTransId: resolved.merchantTransId,
        status: 'pending',
      }));

    await logEvent(payment.id, 'CreateTransaction', params);

    if (payment.status !== 'pending') {
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
    }
    if (payment.provider_trans_id && payment.provider_trans_id !== params.id) {
      // На этот payment уже заведена другая транзакция Payme.
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Transaction already exists for this order');
    }
    await assertUserStillPayable(payment.user_id);

    payment = await paymentsRepo.setProviderTransId(payment.id, params.id);
    payment = await paymentsRepo.setPaymeCreateTime(payment.id, params.time);
  } else {
    await logEvent(payment.id, 'CreateTransaction', params);
    // Идемпотентный повторный CreateTransaction с тем же id — возвращаем то же состояние.
    if (payment.status === 'canceled') {
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Transaction is cancelled');
    }
  }

  return {
    create_time: Number(payment.payme_create_time) || Number(params.time),
    transaction: String(payment.id),
    state: toRpcState(payment),
  };
}

async function performTransaction(params) {
  const payment = await paymentsRepo.findByProviderTransId(params.id);
  if (!payment) throw rpcError(ERROR.TRANSACTION_NOT_FOUND, 'Transaction not found');

  await logEvent(payment.id, 'PerformTransaction', params);

  // Идемпотентность: повторный PerformTransaction с тем же id не начисляет доступ повторно.
  if (payment.status === 'paid') {
    return {
      transaction: String(payment.id),
      perform_time: toMs(payment.paid_at),
      state: STATE.PERFORMED,
    };
  }

  if (payment.status !== 'pending') {
    throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
  }

  const paidAt = new Date();
  const paidAmount = tiyinToUzs(params.amount);
  // status='paid' здесь означает "транзакция закрыта провайдером", а не "пользователю выдан
  // доступ" — см. комментарий в paymentsRepo.markPaid и resolvePaymentOutcome ниже.
  const updated = await paymentsRepo.markPaid(payment.id, { paidAt, amount: paidAmount });

  const user = await usersRepo.findById(payment.user_id);
  const outcome = resolvePaymentOutcome(user.balance, paidAmount, config.channelPrice);

  if (outcome.grantsAccess) {
    if (updated.promo_code_id) await promoCodesRepo.incrementUsage(updated.promo_code_id);
    await usersRepo.setBalance(user.id, 0);
    const updatedUser = await usersRepo.updateStatus(payment.user_id, 'paid');
    await grantAccess(updatedUser);
    await sendReceipt(updatedUser, updated);
    await notifyNewPayment(updatedUser, updated);
  } else {
    const updatedUser = await usersRepo.incrementBalance(user.id, paidAmount);
    await sendUnderpaymentNotice(updatedUser, { paidNow: paidAmount, remaining: outcome.remaining });
    await notifyUnderpayment(updatedUser, updated, outcome.remaining);
  }

  return {
    transaction: String(updated.id),
    perform_time: toMs(updated.paid_at),
    state: STATE.PERFORMED,
  };
}

async function cancelTransaction(params) {
  const payment = await paymentsRepo.findByProviderTransId(params.id);
  if (!payment) throw rpcError(ERROR.TRANSACTION_NOT_FOUND, 'Transaction not found');

  await logEvent(payment.id, 'CancelTransaction', params);

  // Уже отменена — вернуть то же состояние (идемпотентность).
  if (payment.status === 'canceled') {
    return {
      transaction: String(payment.id),
      cancel_time: toMs(payment.canceled_at),
      state: toRpcState(payment),
    };
  }

  // Разовая оплата: если доступ уже был выдан (status='paid'), доступ не отзываем
  // автоматически — фиксируем отмену и оставляем на ручное решение админа.
  const updated = await paymentsRepo.markCanceled(payment.id, { reason: params.reason, canceledAt: new Date() });

  return {
    transaction: String(updated.id),
    cancel_time: toMs(updated.canceled_at),
    state: toRpcState(updated),
  };
}

async function checkTransaction(params) {
  const payment = await paymentsRepo.findByProviderTransId(params.id);
  if (!payment) throw rpcError(ERROR.TRANSACTION_NOT_FOUND, 'Transaction not found');

  return {
    create_time: Number(payment.payme_create_time) || 0,
    perform_time: toMs(payment.paid_at),
    cancel_time: toMs(payment.canceled_at),
    transaction: String(payment.id),
    state: toRpcState(payment),
    reason: payment.cancel_reason || null,
  };
}

/** Payme дёргает GetStatement за период [from; to] (мс) для сверки/выписки — возвращает
 * все транзакции, у которых к этому моменту уже был вызван CreateTransaction. */
async function getStatement(params) {
  const from = Number(params.from);
  const to = Number(params.to);

  const payments = await paymentsRepo.findPaymeStatementRange(from, to);

  return {
    transactions: payments.map((payment) => ({
      id: payment.provider_trans_id,
      time: Number(payment.payme_create_time),
      amount: Math.round(Number(payment.amount) * 100),
      account: { merchant_trans_id: payment.merchant_trans_id },
      create_time: Number(payment.payme_create_time),
      perform_time: toMs(payment.paid_at),
      cancel_time: toMs(payment.canceled_at),
      transaction: String(payment.id),
      state: toRpcState(payment),
      reason: payment.cancel_reason || null,
    })),
  };
}

const METHODS = {
  CheckPerformTransaction: checkPerformTransaction,
  CreateTransaction: createTransaction,
  PerformTransaction: performTransaction,
  CancelTransaction: cancelTransaction,
  CheckTransaction: checkTransaction,
  GetStatement: getStatement,
};

/**
 * Единая точка входа для JSON-RPC запросов Payme: { method, params, id }.
 * @param {string} authorizationHeader
 * @param {{method: string, params: object, id: number|string}} body
 */
async function handleRpc(authorizationHeader, body) {
  const { method, params, id } = body || {};

  if (!checkAuth(authorizationHeader)) {
    return { jsonrpc: '2.0', id, error: { code: ERROR.INSUFFICIENT_PRIVILEGE, message: 'Insufficient privilege' } };
  }

  const handler = METHODS[method];
  if (!handler) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }

  try {
    const result = await handler(params || {});
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    if (err.rpc) {
      return { jsonrpc: '2.0', id, error: { code: err.rpc.code, message: err.rpc.message, data: err.rpc.data } };
    }
    console.error('Payme RPC внутренняя ошибка:', err);
    return { jsonrpc: '2.0', id, error: { code: -32400, message: 'Internal error' } };
  }
}

module.exports = {
  handleRpc,
  checkAuth,
  ERROR,
  STATE,
  // экспортируем для тестов
  resolveAccount,
  checkPerformTransaction,
  createTransaction,
  performTransaction,
  cancelTransaction,
  checkTransaction,
  getStatement,
};
