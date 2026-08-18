// Модель баланса: оплата через провайдера ВНУТРИ бота (кнопка Click/Payme на экране
// выбора способа) — прямая покупка, доступ выдаётся сразу. Оплата через ТЕ ЖЕ провайдеры,
// но напрямую в их приложении по коду юзера, минуя бота ("как за коммуналку") — пополнение
// баланса произвольной суммой; доступ выдаётся только явным списанием через "Мой счёт".
// purpose различает эти два смысла одной и той же таблицы payments.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.decimal('balance', 12, 2).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable('payments', (table) => {
    table.text('purpose').notNullable().defaultTo('purchase');
  });

  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','uzumbank','paynet','balance','promo'))"
  );
  await knex.raw("ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose in ('purchase','topup'))");
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_purpose_check');
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw("ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','promo'))");

  await knex.schema.alterTable('payments', (table) => {
    table.dropColumn('purpose');
  });
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('balance');
  });
};
