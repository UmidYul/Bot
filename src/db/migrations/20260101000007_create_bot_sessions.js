// Хранилище сессий Telegraf в Postgres — чтобы диалог с юзером (выбор языка, ожидание
// промокода и т.д.) переживал рестарт процесса, а не терялся как при in-memory сессии.
exports.up = function up(knex) {
  return knex.schema.createTable('bot_sessions', (table) => {
    table.text('key').primary();
    table.jsonb('data').notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('bot_sessions');
};
