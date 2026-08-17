// Настройки бота, редактируемые из админки (цена канала, инвайт-ссылка и т.д.) — не
// требуют переменных .env/рестарта процесса. Секреты (токены, ключи провайдеров) сюда
// намеренно не переносятся — остаются в .env, редактировать их через веб-форму небезопасно.
exports.up = function up(knex) {
  return knex.schema.createTable('settings', (table) => {
    table.text('key').primary();
    table.jsonb('value').notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('settings');
};
