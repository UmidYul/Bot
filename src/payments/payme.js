const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');
const { grantAccess } = require('../services/accessService');

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
 * Ищет наш payment по account, присланному Payme. Поле account.* настраивается в личном
 * кабинете Payme Business — здесь ожидаем account.merchant_trans_id (см. payme.linkBuilder.js).
 */
async function findPaymentByAccount(account) {
  const merchantTransId = account && (account.merchant_trans_id || account.code);
  if (!merchantTransId) return null;
  return paymentsRepo.findByMerchantTransId(merchantTransId);
}

function amountsMatch(paymentAmountUzs, paymeAmountTiyin) {
  // Payme передаёт сумму в тийинах (1 сум = 100 тийин), у нас в payments.amount — сумы.
  const expectedTiyin = Math.round(Number(paymentAmountUzs) * 100);
  return expectedTiyin === Number(paymeAmountTiyin);
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
  const payment = await findPaymentByAccount(params.account);
  if (!payment) throw rpcError(ERROR.INVALID_ACCOUNT, 'Order not found', { account: ['merchant_trans_id'] });

  await logEvent(payment.id, 'CheckPerformTransaction', params);

  if (payment.status !== 'pending') {
    throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
  }
  if (!amountsMatch(payment.amount, params.amount)) {
    throw rpcError(ERROR.INVALID_AMOUNT, 'Incorrect amount');
  }

  return { allow: true };
}

async function createTransaction(params) {
  let payment = await paymentsRepo.findByProviderTransId(params.id);

  if (!payment) {
    payment = await findPaymentByAccount(params.account);
    if (!payment) throw rpcError(ERROR.INVALID_ACCOUNT, 'Order not found', { account: ['merchant_trans_id'] });

    await logEvent(payment.id, 'CreateTransaction', params);

    if (payment.status !== 'pending') {
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
    }
    if (!amountsMatch(payment.amount, params.amount)) {
      throw rpcError(ERROR.INVALID_AMOUNT, 'Incorrect amount');
    }
    if (payment.provider_trans_id && payment.provider_trans_id !== params.id) {
      // На этот payment уже заведена другая транзакция Payme.
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Transaction already exists for this order');
    }

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
  const updated = await paymentsRepo.markPaid(payment.id, { paidAt });
  const user = await usersRepo.updateStatus(payment.user_id, 'paid');
  await grantAccess(user);

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

const METHODS = {
  CheckPerformTransaction: checkPerformTransaction,
  CreateTransaction: createTransaction,
  PerformTransaction: performTransaction,
  CancelTransaction: cancelTransaction,
  CheckTransaction: checkTransaction,
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
  checkPerformTransaction,
  createTransaction,
  performTransaction,
  cancelTransaction,
  checkTransaction,
};
