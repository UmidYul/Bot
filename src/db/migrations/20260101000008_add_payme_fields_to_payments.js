// Payme Merchant API требует отдавать в CheckTransaction точные create_time/cancel_time
// (в мс, по часам самого Payme) и причину отмены — это не то же самое, что наши created_at/paid_at.
exports.up = function up(knex) {
  return knex.schema.alterTable('payments', (table) => {
    table.bigInteger('payme_create_time');
    table.timestamp('canceled_at', { useTz: true });
    table.integer('cancel_reason');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('payments', (table) => {
    table.dropColumn('payme_create_time');
    table.dropColumn('canceled_at');
    table.dropColumn('cancel_reason');
  });
};
