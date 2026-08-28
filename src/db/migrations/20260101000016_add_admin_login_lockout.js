// Защита от подбора пароля админки — по аналогии с users.blocked_at, но для конкретного
// аккаунта admins, а не глобально: N неверных паролей подряд временно блокируют именно этот
// логин (см. adminsRepo.recordFailedLogin/resetFailedLogins и config.adminLoginAntiSpam).
exports.up = async function up(knex) {
  await knex.schema.alterTable('admins', (table) => {
    table.integer('failed_login_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until', { useTz: true });
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('admins', (table) => {
    table.dropColumn('failed_login_attempts');
    table.dropColumn('locked_until');
  });
};
