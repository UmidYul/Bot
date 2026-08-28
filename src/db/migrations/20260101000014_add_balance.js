// Внутренний счёт пользователя — исключительно побочный эффект недоплаты через Click/Payme
// (оплата напрямую в приложении провайдера по коду, "как за коммуналку", на сумму меньше
// цены канала). Невидим пользователю в UI бота, используется только сервером, чтобы досчитать
// сумму до цены при следующей оплате. См. resolvePaymentOutcome в src/services/balanceService.js.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.decimal('balance', 12, 2).notNullable().defaultTo(0);
  });
  await knex.raw('ALTER TABLE users ADD CONSTRAINT users_balance_nonneg_check CHECK (balance >= 0)');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_balance_nonneg_check');
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('balance');
  });
};
