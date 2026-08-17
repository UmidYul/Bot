exports.up = function up(knex) {
  return knex.schema.createTable('admins', (table) => {
    table.increments('id').primary();
    table.text('login').notNullable().unique();
    table.text('password_hash').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('admins');
};
