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

module.exports = { findByLogin, findById, create, listAll };
