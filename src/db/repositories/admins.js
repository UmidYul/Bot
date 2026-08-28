const db = require('../index');

function findByLogin(login) {
  return db('admins').where({ login }).first();
}

function findById(id) {
  return db('admins').where({ id }).first();
}

function create({ login, passwordHash }) {
  return db('admins')
    .insert({ login, password_hash: passwordHash })
    .returning('*')
    .then((rows) => rows[0]);
}

function listAll() {
  return db('admins').select('id', 'login').orderBy('login');
}

/**
 * Защита от подбора пароля (см. config.adminLoginAntiSpam) — по аналогии с
 * usersRepo.registerUnderpaymentNotice, но блокирует не уведомления, а сам вход в этот
 * конкретный аккаунт. Не строго атомарно под конкурентностью (read-then-write) — приемлемо
 * для анти-брутфорса, в отличие от денежного баланса.
 * @returns {Promise<{locked: boolean}>} locked — этой попыткой аккаунт заблокирован.
 */
async function recordFailedLogin(id, maxAttempts, lockoutMinutes) {
  const admin = await db('admins').where({ id }).first();
  const count = admin.failed_login_attempts + 1;
  const locked = count >= maxAttempts;

  await db('admins')
    .where({ id })
    .update(
      locked
        ? { failed_login_attempts: 0, locked_until: new Date(Date.now() + lockoutMinutes * 60 * 1000) }
        : { failed_login_attempts: count }
    );

  return { locked };
}

function resetFailedLogins(id) {
  return db('admins').where({ id }).update({ failed_login_attempts: 0, locked_until: null });
}

/**
 * Смена логина/пароля самим админом (см. web/routes/admin.js POST /account). passwordHash
 * необязателен — если не передан, пароль не трогаем (юзер оставил поле "новый пароль" пустым).
 */
function updateCredentials(id, { login, passwordHash }) {
  const update = { login };
  if (passwordHash) update.password_hash = passwordHash;
  return db('admins').where({ id }).update(update).returning('*').then((rows) => rows[0]);
}

module.exports = { findByLogin, findById, create, listAll, recordFailedLogin, resetFailedLogins, updateCredentials };
