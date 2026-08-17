exports.up = function up(knex) {
  return knex.schema.createTable('admin_logs', (table) => {
    table.increments('id').primary();
    table
      .integer('admin_id')
      .references('id')
      .inTable('admins')
      .onDelete('SET NULL');
    table.text('action').notNullable();
    table
      .integer('target_user_id')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table.jsonb('meta');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('admin_id');
    table.index('target_user_id');
    table.index('action');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('admin_logs');
};
