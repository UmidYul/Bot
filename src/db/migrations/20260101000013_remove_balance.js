// Функция "баланс/счёт" убрана целиком: оплата разовая, второй раз тот же юзер оплатить
// не может (см. resolveOrCreatePayment в click.js / resolveAccount в payme.js — платёж
// уже оплатившему юзеру не заводится). Оплата напрямую через приложение провайдера по коду
// (минуя бота) теперь сразу выдаёт доступ, а не копится на balance — значит purpose
// ('purchase' vs 'topup') тоже больше не нужен, все платежи по смыслу — purchase.
// На момент миграции в БД нет ни одного юзера с balance > 0 и ни одного платежа с
// provider='balance' или purpose='topup' — можно дропать без потери данных.
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_purpose_check');
  await knex.schema.alterTable('payments', (table) => {
    table.dropColumn('purpose');
  });

  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','uzumbank','paynet','admin','promo'))"
  );

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('balance');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.decimal('balance', 12, 2).notNullable().defaultTo(0);
  });

  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','uzumbank','paynet','balance','admin','promo'))"
  );

  await knex.schema.alterTable('payments', (table) => {
    table.text('purpose').notNullable().defaultTo('purchase');
  });
  await knex.raw("ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose in ('purchase','topup'))");
};
