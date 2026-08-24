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

function findById(id) {
  return db('payments').where({ id }).first();
}

function findByMerchantTransId(merchantTransId) {
  return db('payments').where({ merchant_trans_id: merchantTransId }).first();
}

function findByProviderTransId(providerTransId) {
  return db('payments').where({ provider_trans_id: providerTransId }).first();
}

async function markPaid(id, { paidAt = new Date() } = {}) {
  const [payment] = await db('payments')
    .where({ id })
    .update({ status: 'paid', paid_at: paidAt, updated_at: db.fn.now() })
    .returning('*');
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
  findById,
  findByMerchantTransId,
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
