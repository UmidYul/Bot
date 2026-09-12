const db = require('../index');

async function createPayment({
  userId,
  provider,
  amount,
  currency = 'UZS',
  promoCodeId = null,
  merchantTransId,
  status = 'pending',
}) {
  const [payment] = await db('payments')
    .insert({
      user_id: userId,
      provider,
      amount,
      currency,
      promo_code_id: promoCodeId,
      merchant_trans_id: merchantTransId,
      status,
    })
    .returning('*');
  return payment;
}

/**
 * Создаёт pending-платёж, а при гонке возвращает тот, который успел создать конкурент.
 * Провайдеры ретраят запросы (и Click, и Payme могут прислать два почти одновременных
 * Prepare/CheckPerformTransaction по одному коду) — вторая вставка проиграет на частичном
 * уникальном индексе (provider, merchant_trans_id) WHERE status='pending' с SQLSTATE 23505,
 * и это не ошибка: нужный платёж уже есть в БД, просто создали его не мы.
 */
async function createOrGetPendingPayment(data) {
  try {
    return await createPayment({ ...data, status: 'pending' });
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await findPendingByProviderAndMerchantTransId(data.provider, data.merchantTransId);
      if (existing) return existing;
    }
    throw err;
  }
}

function findById(id) {
  return db('payments').where({ id }).first();
}

function findByMerchantTransId(merchantTransId) {
  return db('payments').where({ merchant_trans_id: merchantTransId }).first();
}

/**
 * "Живой" (ещё не оплаченный и не отменённый) платёж конкретного провайдера по
 * merchant_trans_id. Нужен из-за оплаты "как за коммуналку": там merchant_trans_id — это
 * код юзера (users.code), один и тот же и для Click, и для Payme, поэтому строк с таким
 * merchant_trans_id может быть несколько (по одной на провайдера/попытку). Брать первую
 * попавшуюся нельзя — вебхук Payme не должен получить платёж, заведённый Click, иначе код
 * навсегда "залипает" за тем провайдером, который создал строку первым.
 * Частичный уникальный индекс (provider, merchant_trans_id) WHERE status='pending'
 * (миграция 20260101000017) гарантирует, что такая строка не более одной.
 */
function findPendingByProviderAndMerchantTransId(provider, merchantTransId) {
  return db('payments').where({ provider, merchant_trans_id: merchantTransId, status: 'pending' }).first();
}

/** Последний по времени платёж этого провайдера с таким merchant_trans_id — в любом статусе.
 * Используется, когда живого платежа нет: по нему вебхук отвечает "заказ уже оплачен/отменён"
 * (-4/-9 у Click, -31008 у Payme), а не вводящим в заблуждение "заказ не найден". */
function findLatestByProviderAndMerchantTransId(provider, merchantTransId) {
  return db('payments')
    .where({ provider, merchant_trans_id: merchantTransId })
    .orderBy('id', 'desc')
    .first();
}

function findByProviderTransId(providerTransId) {
  return db('payments').where({ provider_trans_id: providerTransId }).first();
}

/**
 * status='paid' здесь означает "провайдер подтвердил перевод по этой транзакции", а не
 * "пользователю выдан доступ" — при недоплате (см. src/services/balanceService.js) деньги уже
 * реально пришли, но доступ выдаётся только когда баланс пользователя в сумме с этим платежом
 * достигает цены канала. Именно поэтому повторный Complete/Perform по недоплаченной строке
 * идемпотентен: попадает в ветку "уже paid" и не начисляет баланс дважды.
 * amount — если передан, перезаписывает сумму строки на реально пришедшую от провайдера
 * (при создании on-the-fly платежа сумма могла быть только заявленной).
 */
async function markPaid(id, { paidAt = new Date(), amount } = {}) {
  const update = { status: 'paid', paid_at: paidAt, updated_at: db.fn.now() };
  if (amount !== undefined) update.amount = amount;

  const [payment] = await db('payments').where({ id }).update(update).returning('*');
  return payment;
}

async function setStatus(id, status) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ status, updated_at: db.fn.now() })
    .returning('*');
  return payment;
}

async function markFailed(id) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ status: 'failed', updated_at: db.fn.now() })
    .returning('*');
  return payment;
}

async function markCanceled(id, { reason = null, canceledAt = new Date() } = {}) {
  const [payment] = await db('payments')
    .where({ id })
    .update({
      status: 'canceled',
      cancel_reason: reason,
      canceled_at: canceledAt,
      updated_at: db.fn.now(),
    })
    .returning('*');
  return payment;
}

async function setProviderTransId(id, providerTransId) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ provider_trans_id: providerTransId, updated_at: db.fn.now() })
    .returning('*');
  return payment;
}

async function setPaymeCreateTime(id, paymeCreateTime) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ payme_create_time: paymeCreateTime, updated_at: db.fn.now() })
    .returning('*');
  return payment;
}

async function setRawPayload(id, payload) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ raw_payload: JSON.stringify(payload), updated_at: db.fn.now() })
    .returning('*');
  return payment;
}

/** Payme GetStatement: платежи, по которым Payme реально заводил транзакцию (payme_create_time
 * проставляется в createTransaction), созданные в диапазоне [from; to] мс. */
function findPaymeStatementRange(from, to) {
  return db('payments')
    .where({ provider: 'payme' })
    .whereNotNull('payme_create_time')
    .whereBetween('payme_create_time', [from, to])
    .orderBy('payme_create_time', 'asc');
}

function listByUserId(userId) {
  return db('payments as p')
    .leftJoin('promo_codes as pc', 'pc.id', 'p.promo_code_id')
    .where('p.user_id', userId)
    .select('p.*', 'pc.code as promo_code')
    .orderBy('p.created_at', 'desc');
}

function findLastPaidByUserId(userId) {
  return db('payments').where({ user_id: userId, status: 'paid' }).orderBy('paid_at', 'desc').first();
}

async function addEvent({ paymentId, provider, event, payload }) {
  await db('payment_events').insert({
    payment_id: paymentId,
    provider,
    event,
    payload: JSON.stringify(payload),
  });
}

module.exports = {
  createPayment,
  createOrGetPendingPayment,
  findById,
  findByMerchantTransId,
  findPendingByProviderAndMerchantTransId,
  findLatestByProviderAndMerchantTransId,
  findByProviderTransId,
  setStatus,
  markPaid,
  markFailed,
  markCanceled,
  setProviderTransId,
  setPaymeCreateTime,
  setRawPayload,
  listByUserId,
  findPaymeStatementRange,
  findLastPaidByUserId,
  addEvent,
};
