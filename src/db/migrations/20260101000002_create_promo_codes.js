exports.up = function up(knex) {
  return knex.schema.createTable('promo_codes', (table) => {
    table.increments('id').primary();
    table.text('code').notNullable().unique();
    table.text('type').notNullable();
    table.decimal('value', 12, 2).notNullable().defaultTo(0);
    table.integer('max_uses');
    table.integer('used_count').notNullable().defaultTo(0);
    table.timestamp('expires_at', { useTz: true });
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("type in ('percent','fixed','free')", [], 'promo_codes_type_check');

    table.index('is_active');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('promo_codes');
};
