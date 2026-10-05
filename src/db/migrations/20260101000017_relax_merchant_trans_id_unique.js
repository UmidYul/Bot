// Снимаем глобальный UNIQUE с payments.merchant_trans_id (миграция ...0003) — он делал
// невозможной оплату "как за коммуналку" в двух провайдерах по одному коду: merchant_trans_id
// там равен users.code, и первая же строка (например, Click) навсегда занимала этот код,
// после чего Payme получал -31050 "Order not found", а Click — -5. Теперь строк с одним
// merchant_trans_id может быть несколько (по одной на провайдера, плюс история попыток),
// а инвариант "живой заказ по коду у провайдера ровно один" держит частичный уникальный
// индекс по (provider, merchant_trans_id) среди строк в статусе 'pending'. Он же защищает
// от гонки двух почти одновременных вебхуков одного провайдера (см.
// paymentsRepo.createOrGetPendingPayment) и не мешает заводить новый заказ после того,
// как предыдущий оплачен или отменён.
exports.up = async function up(knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.dropUnique('merchant_trans_id');
  });
  // Обычный (неуникальный) индекс вместо снятого — поиск по merchant_trans_id остаётся
  // горячим путём обоих вебхуков.
  await knex.schema.alterTable('payments', (table) => {
    table.index('merchant_trans_id');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX payments_pending_provider_trans_unique
       ON payments (provider, merchant_trans_id)
       WHERE status = 'pending'`
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS payments_pending_provider_trans_unique');
  await knex.schema.alterTable('payments', (table) => {
    table.dropIndex('merchant_trans_id');
  });
  // Откат возможен, только если к этому моменту дубликатов merchant_trans_id уже нет
  // (иначе Postgres сам не даст построить уникальный индекс — это ожидаемо).
  await knex.schema.alterTable('payments', (table) => {
    table.unique('merchant_trans_id');
  });
};
