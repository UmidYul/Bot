const db = require('../index');
const { generateUniqueUserCode } = require('../../services/codeGenerator');

async function createUser({ telegramId, username }) {
  const code = await generateUniqueUserCode(db);
  const [user] = await db('users')
    .insert({
      telegram_id: telegramId,
      username: username || null,
      code,
      status: 'new',
    })
    .returning('*');
  return user;
}

function findByTelegramId(telegramId) {
  return db('users').where({ telegram_id: telegramId }).first();
}

function findById(id) {
  return db('users').where({ id }).first();
}

function findByCode(code) {
  return db('users').where({ code: code.toUpperCase() }).first();
}

async function updateStatus(id, status) {
  const [user] = await db('users')
    .where({ id })
    .update({ status, updated_at: db.fn.now() })
    .returning('*');
  return user;
}

function updateLanguage(id, language) {
  return db('users').where({ id }).update({ language, updated_at: db.fn.now() });
}

function updatePhone(id, phone) {
  return db('users').where({ id }).update({ phone, updated_at: db.fn.now() });
}

function updateUsername(id, username) {
  return db('users').where({ id }).update({ username, updated_at: db.fn.now() });
}

function blockUser(id) {
  return updateStatus(id, 'blocked');
}

function unblockUser(id) {
  return updateStatus(id, 'new');
}

/**
 * @param {{q?: string, status?: string}} filters
 * @param {{page?: number, pageSize?: number}} pagination
 */
async function listUsers(filters = {}, pagination = {}) {
  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const pageSize = pagination.pageSize || 20;

  const base = db('users');
  if (filters.q) {
    const q = `%${filters.q.trim()}%`;
    base.where((builder) => {
      builder.whereILike('code', q).orWhereILike('phone', q).orWhereILike('username', q);
    });
  }
  if (filters.status) {
    base.andWhere({ status: filters.status });
  }

  const countRow = await base.clone().count({ count: '*' }).first();
  const total = parseInt(countRow.count, 10);

  const rows = await base
    .clone()
    .select(
      'users.*',
      'lp.amount as last_payment_amount',
      'lp.created_at as last_payment_date',
      'lp.provider as last_payment_provider',
      'pc.code as last_payment_promo'
    )
    .joinRaw(
      `LEFT JOIN LATERAL (
        SELECT * FROM payments
        WHERE payments.user_id = users.id
        ORDER BY payments.created_at DESC
        LIMIT 1
      ) lp ON true`
    )
    .leftJoin('promo_codes as pc', 'pc.id', 'lp.promo_code_id')
    .orderBy('users.created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = {
  createUser,
  findByTelegramId,
  findById,
  findByCode,
  updateStatus,
  updateLanguage,
  updatePhone,
  updateUsername,
  blockUser,
  unblockUser,
  listUsers,
};
