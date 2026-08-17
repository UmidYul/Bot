exports.up = function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.bigInteger('telegram_id').notNullable().unique();
    table.text('username');
    table.text('phone');
    table.text('language').notNullable().defaultTo('ru');
    table.specificType('code', 'char(6)').notNullable().unique();
    table.text('status').notNullable().defaultTo('new');
    table.timestamps(true, true);

    table.check("language in ('ru','uz')", [], 'users_language_check');
    table.check("status in ('new','pending','paid','blocked')", [], 'users_status_check');

    table.index('status');
    table.index('phone');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
