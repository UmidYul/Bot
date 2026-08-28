// Анти-спам для уведомлений о недоплате (см. usersRepo.registerUnderpaymentNotice) — по
// аналогии с промо-анти-спамом (config.promoAntiSpam), но хранится в БД, а не в bot-сессии:
// решение "слать ли уведомление" принимается из вебхука Click/Payme, где сессии бота нет.
// Сама недоплата (зачисление на баланс) throttle'у не подчиняется — блокируется только поток
// сообщений юзеру/админу при частых мелких недоплатах подряд.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.integer('underpayment_notice_count').notNullable().defaultTo(0);
    table.timestamp('underpayment_locked_until', { useTz: true });
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('underpayment_notice_count');
    table.dropColumn('underpayment_locked_until');
  });
};
