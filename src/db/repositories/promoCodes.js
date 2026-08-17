const db = require('../index');

function create({ code, type, value = 0, maxUses = null, expiresAt = null, isActive = true }) {
  return db('promo_codes')
    .insert({
      code: code.toUpperCase(),
      type,
      value,
      max_uses: maxUses,
      expires_at: expiresAt,
      is_active: isActive,
    })
    .returning('*')
    .then((rows) => rows[0]);
}

function findById(id) {
  return db('promo_codes').where({ id }).first();
}

function findByCode(code) {
  return db('promo_codes').where({ code: code.toUpperCase() }).first();
}

/**
 * Активный, не истёкший, с запасом использований промокод.
 */
function findActiveByCode(code) {
  return db('promo_codes')
    .where({ code: code.toUpperCase(), is_active: true })
    .andWhere((builder) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
    })
    .andWhere((builder) => {
      builder.whereNull('max_uses').orWhereRaw('used_count < max_uses');
    })
    .first();
}

async function incrementUsage(id) {
  const [promo] = await db('promo_codes')
    .where({ id })
    .update({ used_count: db.raw('used_count + 1') })
    .returning('*');
  return promo;
}

async function update(id, fields) {
  const patch = {};
  if (fields.code !== undefined) patch.code = fields.code.toUpperCase();
  if (fields.type !== undefined) patch.type = fields.type;
  if (fields.value !== undefined) patch.value = fields.value;
  if (fields.maxUses !== undefined) patch.max_uses = fields.maxUses;
  if (fields.expiresAt !== undefined) patch.expires_at = fields.expiresAt;
  if (fields.isActive !== undefined) patch.is_active = fields.isActive;

  const [promo] = await db('promo_codes').where({ id }).update(patch).returning('*');
  return promo;
}

function list({ page = 1, pageSize = 20 } = {}) {
  return db('promo_codes')
    .select('*')
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset((Math.max(1, page) - 1) * pageSize);
}

async function listAll() {
  return db('promo_codes').select('*').orderBy('created_at', 'desc');
}

module.exports = {
  create,
  findById,
  findByCode,
  findActiveByCode,
  incrementUsage,
  update,
  list,
  listAll,
};
