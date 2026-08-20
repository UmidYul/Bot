// Смена языка временно отключена в боте (см. src/bot/i18n/index.js) — все новые юзеры
// теперь по умолчанию узбекскоязычные.
exports.up = function up(knex) {
  return knex.raw("ALTER TABLE users ALTER COLUMN language SET DEFAULT 'uz'");
};

exports.down = function down(knex) {
  return knex.raw("ALTER TABLE users ALTER COLUMN language SET DEFAULT 'ru'");
};
