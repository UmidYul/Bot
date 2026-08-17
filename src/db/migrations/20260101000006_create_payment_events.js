// Полная история входящих вебхуков от Click/Payme — для отладки и разбора спорных платежей.
// payments.raw_payload хранит только последний, здесь — вся последовательность событий.
exports.up = function up(knex) {
  return knex.schema.createTable('payment_events', (table) => {
    table.increments('id').primary();
    table
      .integer('payment_id')
      .references('id')
      .inTable('payments')
      .onDelete('CASCADE');
    table.text('provider').notNullable();
    table.text('event').notNullable(); // prepare / complete / CheckPerformTransaction / CreateTransaction / ...
    table.jsonb('payload').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('payment_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('payment_events');
};
