const bcrypt = require('bcryptjs');
const config = require('../../config');

exports.seed = async function seed(knex) {
  const existing = await knex('admins').where({ login: config.adminSeed.login }).first();
  if (existing) {
    console.log(`Сид admin: пользователь "${config.adminSeed.login}" уже существует, пропускаю.`);
    return;
  }

  const passwordHash = await bcrypt.hash(config.adminSeed.password, 10);
  await knex('admins').insert({
    login: config.adminSeed.login,
    password_hash: passwordHash,
  });

  console.log(`Сид admin: создан пользователь "${config.adminSeed.login}".`);
};
