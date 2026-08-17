exports.up = function up(knex) {
  return knex.schema.createTable('payments', (table) => {
    table.increments('id').primary();
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    // 'promo' — бесплатный доступ по 100%-промокоду, без реального провайдера
    table.text('provider').notNullable();
    table.decimal('amount', 12, 2).notNullable();
    table.text('currency').notNullable().defaultTo('UZS');
    table
      .integer('promo_code_id')
      .references('id')
      .inTable('promo_codes')
      .onDelete('SET NULL');
    table.text('status').notNullable().defaultTo('pending');
    table.text('provider_trans_id');
    table.text('merchant_trans_id').notNullable().unique();
    table.jsonb('raw_payload');
    table.timestamp('paid_at', { useTz: true });
    table.timestamps(true, true);

    table.check("provider in ('click','payme','promo')", [], 'payments_provider_check');
    table.check("status in ('pending','paid','canceled','failed')", [], 'payments_status_check');

    table.index('user_id');
    table.index('promo_code_id');
    table.index('status');
    table.index('provider_trans_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('payments');
};
