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
 * Разбирает заголовок Basic-авторизации Payme на схему/логин/пароль.
 * Пароль (это и есть ключ кассы) наружу отдаётся только для сравнения — в логи попадают
 * лишь схема и логин (логин у Payme всегда "Paycom" и секретом не является).
 * @returns {{present: boolean, scheme: string|null, login: string|null, password: string|null}}
 */
function parseAuthHeader(authorizationHeader) {
  const empty = { present: false, scheme: null, login: null, password: null };
  if (typeof authorizationHeader !== 'string' || authorizationHeader.trim() === '') return empty;

  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);
  const credentials = rest.join(' ');
  if (!/^basic$/i.test(scheme)) return { present: true, scheme, login: null, password: null };

  // Невалидный base64 не бросает исключение, а даёт мусор — его отсечёт проверка ниже.
  const decoded = Buffer.from(credentials, 'base64').toString('utf8');

  // Ключи Payme содержат спецсимволы и вполне могут содержать двоеточие — режем строго по
  // ПЕРВОМУ двоеточию (разделитель login:password), иначе split(':') отрезал бы хвост ключа
  // и авторизация всегда падала бы с -32504.
  const separator = decoded.indexOf(':');
  if (separator === -1) return { present: true, scheme, login: null, password: null };

  return {
    present: true,
    scheme,
    login: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

/** Сравнение секретов за постоянное время. timingSafeEqual требует буферы одинаковой длины,
 * поэтому длину проверяем заранее (сам факт несовпадения длины секретом не является). */
function secretsEqual(received, expected) {
  const a = Buffer.from(String(received), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Проверка Basic-авторизации Payme. Логин игнорируется, сверяется только пароль/ключ
 * (в проде — PAYME_SECRET_KEY, в песочнице Payme используется PAYME_TEST_KEY).
 * Незаданные ключи отфильтровываются: пустой PAYME_TEST_KEY ('' из config.js) раньше
 * означал, что запрос с пустым паролем успешно авторизуется — кто угодно мог дёргать
 * PerformTransaction и выдавать себе доступ.
 */
function checkAuth(authorizationHeader) {
  const { password } = parseAuthHeader(authorizationHeader);
  if (typeof password !== 'string' || password === '') return false;

  return [config.payme.secretKey, config.payme.testKey]
    .filter((key) => typeof key === 'string' && key !== '')
    .some((key) => secretsEqual(password, key));
}

/** Безопасная для логов справка о заголовке авторизации: без ключа и без самого заголовка. */
function describeAuthHeader(authorizationHeader) {
  const parsed = parseAuthHeader(authorizationHeader);
  return {
    present: parsed.present,
    scheme: parsed.scheme,
    login: parsed.login,
    password_set: Boolean(parsed.password),
    password_length: parsed.password ? parsed.password.length : 0,
  };
}

/**
 * Разбирает account, присланный Payme. Поле account.* настраивается в личном кабинете
 * Payme Business — здесь ожидаем account.merchant_trans_id (см. payme.linkBuilder.js).
 *
 * Если живого платежа Payme с таким merchant_trans_id ещё нет в БД — это может быть "оплата
 * как за коммуналку": юзер открыл приложение Payme напрямую, минуя бота, и ввёл свой код
 * лицевого счёта. В этом случае merchant_trans_id прилетает как есть (сам код), и мы
 * пробуем найти по нему юзера, чтобы завести платёж на лету — суммой, которую реально
 * прислал Payme (может быть меньше цены канала, см. createTransaction/balanceService.js).
 *
 * ВАЖНО: один и тот же код юзера используется как лицевой счёт и в Click, и в Payme, поэтому
 * ищем именно pending-платёж ПРОВАЙДЕРА payme, а не первую попавшуюся строку с этим
 * merchant_trans_id. Раньше строка, заведённая Click по тому же коду, отдавалась сюда,
 * отбраковывалась проверкой provider !== 'payme' и превращалась в вечный -31050: код
 * навсегда "залипал" за тем провайдером, который создал строку первым.
 * @returns {Promise<{merchantTransId: string, payment: object|null, user: object|null}|null>}
 */
async function resolveAccount(account) {
  const merchantTransId = account && (account.merchant_trans_id || account.code);
  if (!merchantTransId) return null;

  const payment = await paymentsRepo.findPendingByProviderAndMerchantTransId('payme', merchantTransId);
  if (payment) return { merchantTransId, payment, user: null };

  const user = await usersRepo.findByCode(merchantTransId);
  if (user) {
    if (user.deleted_at || user.blocked_at || user.status === 'paid') return null;
    // Живого платежа Payme по этому коду нет (либо его ещё не было, либо предыдущий уже
    // оплачен/отменён) — заводить новый разрешаем, платёж создаётся в createTransaction.
    return { merchantTransId, payment: null, user };
  }

  // merchant_trans_id — не код юзера, а конкретный заказ из бота (формат "<code>-<ts>"),
  // и живого платежа по нему нет: он уже оплачен или отменён. Отдаём последнюю строку,
  // чтобы вызывающий ответил -31008 ("заказ не оплачиваем"), а не -31050 ("счёт не найден").
  const finished = await paymentsRepo.findLatestByProviderAndMerchantTransId('payme', merchantTransId);
  if (finished) return { merchantTransId, payment: finished, user: null };

  return null;
}

/**
 * Защита от повторной реальной оплаты: юзер мог оставить эту оплату "висеть" (не закрыл
 * страницу Payme), а доступ уже получить другим способом (Click, промокод, второй платёж) —
 * или его успели заблокировать/удалить, пока платёж был в pending. Проверяем ДО списания денег
 * (CheckPerformTransaction/CreateTransaction), чтобы не доводить до реального списания —
 * в PerformTransaction эту проверку намеренно не дублируем: к этому моменту Payme уже мог
 * списать/захолдировать средства, и отказ здесь означал бы повисшие деньги без доступа.
 */
async function assertUserStillPayable(userId) {
  const user = await usersRepo.findById(userId);
  if (!user || user.deleted_at || user.blocked_at || user.status === 'paid') {
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

  // Точное совпадение суммы больше не требуется: пользователь мог платить меньше цены канала
  // напрямую через приложение — недоплата зачисляется на внутренний счёт (см.
  // balanceService.js), доступ выдаётся, когда накопленный счёт + платёж достигают
  // config.channelPrice. Но сумма всё ещё должна быть реальными деньгами.
  if (!(Number(params.amount) > 0)) {
    throw rpcError(ERROR.INVALID_AMOUNT, 'Incorrect amount');
  }

  if (resolved.payment) {
    if (resolved.payment.status !== 'pending') {
      throw rpcError(ERROR.UNABLE_TO_PERFORM, 'Order is not payable');
    }
    await assertUserStillPayable(resolved.payment.user_id);
  }

  // Если в кабинете Payme у кассы включены фискальные чеки, этого ответа НЕДОСТАТОЧНО:
  // Payme ждёт ещё detail.receipt_type и detail.items с ИКПУ/package_code/vat_percent на
  // каждую позицию (те же данные потом уходят в PerformTransaction/фискальный модуль).
  // Вслепую не заполняем: ИКПУ и package_code выдаются под конкретную услугу налоговой
  // (soliq.uz), придуманные значения касса отклонит. См. README, раздел про Payme.
  return { allow: true };
}

async function createTransaction(params) {
  let payment = await paymentsRepo.findByProviderTransId(params.id);

  if (!payment) {
    const resolved = await resolveAccount(params.account);
    if (!resolved) throw rpcError(ERROR.INVALID_ACCOUNT, 'Order not found', { account: ['merchant_trans_id'] });
    if (!resolved.payment && !(Number(params.amount) > 0)) {
      // Заводить on-the-fly заказ на ноль/отрицательную "сумму" нельзя — это навсегда занять
      // merchant_trans_id этого кода нулевой транзакцией (см. handlePrepare в click.js).
      throw rpcError(ERROR.INVALID_AMOUNT, 'Incorrect amount');
    }

    // Платёж по коду ещё не заведён в БД — юзер платит вручную через приложение Payme,
    // минуя бота. Заводим его на лету суммой, которую реально прислал Payme (может быть
    // меньше цены канала — недоплата зачисляется на внутренний счёт, см. balanceService.js).
    // createOrGetPendingPayment, а не createPayment: два почти одновременных CreateTransaction
    // по одному коду не должны падать на уникальном индексе — второй просто подхватит строку,
    // созданную первым (дальше его отсечёт проверка provider_trans_id ниже).
    payment =
      resolved.payment ||
      (await paymentsRepo.createOrGetPendingPayment({
        userId: resolved.user.id,
        provider: 'payme',
        amount: tiyinToUzs(params.amount),
        merchantTransId: resolved.merchantTransId,
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
  if (!(Number(params.amount) > 0)) {
    throw rpcError(ERROR.INVALID_AMOUNT, 'Incorrect amount');
  }

  const paidAt = new Date();
  const paidAmount = tiyinToUzs(params.amount);
  // status='paid' здесь означает "транзакция закрыта провайдером", а не "пользователю выдан
  // доступ" — см. комментарий в paymentsRepo.markPaid и resolvePaymentOutcome ниже.
  const updated = await paymentsRepo.markPaid(payment.id, { paidAt, amount: paidAmount });

  // С этой точки деньги уже списаны и payment.status='paid' уже закоммичен в Postgres — что бы
  // ни случилось ниже, Payme должен получить успешный ответ. Иначе он сочтёт PerformTransaction
  // неуспешным и повторит запрос — а повторный вызов сразу попадёт в идемпотентную ветку выше
  // (payment.status === 'paid') и вернёт успех, ни разу не выполнив то, что упало здесь: баланс
  // не зачислится, доступ не выдастся, уведомления не уйдут, и НИКАКОЙ последующий ретрай это
  // уже не исправит. Поэтому, как и в click.js handleComplete, всё это оборачивается в try/catch
  // с логированием, а не даёт исключению всплыть наружу в handleRpc.
  try {
    // Атомарный инкремент вместо read-modify-write — см. аналогичный комментарий в click.js
    // handleComplete: два почти одновременных платежа не должны оба решить "не хватает" по
    // балансу, прочитанному до увеличения друг другом.
    const updatedUser = await usersRepo.incrementBalance(payment.user_id, paidAmount);
    const targetPrice = await resolveTargetPrice(config.channelPrice, updated.promo_code_id);
    const outcome = resolvePaymentOutcome(updatedUser.balance, 0, targetPrice);

    if (outcome.grantsAccess) {
      if (updated.promo_code_id) await promoCodesRepo.incrementUsage(updated.promo_code_id);
      await usersRepo.setBalance(updatedUser.id, 0);
      const paidUser = await usersRepo.updateStatus(payment.user_id, 'paid');
      await grantAccess(paidUser);
      await sendReceipt(paidUser, updated);
      await notifyNewPayment(paidUser, updated);
    } else if (updatedUser.status !== 'paid') {
      // Доступ уже выдан другим почти одновременным платежом — см. комментарий в click.js.
      // Анти-спам недоплат — см. комментарий в click.js handleComplete.
      const throttle = await usersRepo.registerUnderpaymentNotice(
        updatedUser.id,
        config.underpaymentAntiSpam.maxAttempts,
        config.underpaymentAntiSpam.lockoutMinutes
      );
      if (throttle.shouldNotify) {
        await sendUnderpaymentNotice(updatedUser, { paidNow: paidAmount, remaining: outcome.remaining });
        await notifyUnderpayment(updatedUser, updated, outcome.remaining);
        if (throttle.justLocked) await notifyUnderpaymentLockout(updatedUser);
      }
    }
  } catch (err) {
    console.error('[payme] PerformTransaction post-payment step failed (payment is already marked paid in DB):', err);
    await notifyPostPaymentFailure('Payme', payment.id, err);
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

  const authOk = checkAuth(authorizationHeader);
  // Диагностика авторизации: сам заголовок/ключ в лог не попадает — только схема, логин
  // (у Payme это всегда "Paycom") и результат проверки. Без этого -32504 неотличим от
  // исключения внутри хендлера: и то и другое Payme показывает юзеру одинаково
  // ("Сервис поставщика услуг работает некорректно").
  logToFile('payme', 'auth check', { method, ...describeAuthHeader(authorizationHeader), ok: authOk });
  if (!authOk) {
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
    // Дублируем в файл: на этом хостинге (cPanel/Passenger) stdout нигде не сохраняется,
    // см. src/utils/webhookLogger.js — без этого причина -32400 в проде не видна вообще.
    console.error('Payme RPC внутренняя ошибка:', err);
    logToFile('payme', 'внутренняя ошибка хендлера', { method, message: err.message, stack: err.stack });
    return { jsonrpc: '2.0', id, error: { code: -32400, message: 'Internal error' } };
  }
}

module.exports = {
  handleRpc,
  checkAuth,
  describeAuthHeader,
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
