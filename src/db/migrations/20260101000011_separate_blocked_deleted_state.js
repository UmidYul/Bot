// БАГ: status одновременно кодировал и жизненный цикл оплаты (new/pending/paid), и бан
// (blocked) — блокировка затирала статус оплаты, а разблокировка всегда сбрасывала в
// 'new', теряя paid. Разносим бан и мягкое удаление в отдельные поля (blocked_at/deleted_at),
// status остаётся только про оплату. Так делают все нормальные системы — бан не должен
// разрушать бизнес-состояние.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('blocked_at', { useTz: true });
    table.timestamp('deleted_at', { useTz: true });
  });

  // Восстанавливаем реальный статус для уже заблокированных юзеров: если среди их платежей
  // есть успешная покупка (не пополнение баланса) — они были paid, иначе new.
  await knex.raw(`
    UPDATE users
    SET blocked_at = COALESCE(blocked_at, updated_at, now()),
        status = CASE
          WHEN EXISTS (
            SELECT 1 FROM payments
            WHERE payments.user_id = users.id
              AND payments.purpose = 'purchase'
              AND payments.status = 'paid'
          ) THEN 'paid'
          ELSE 'new'
        END
    WHERE status = 'blocked'
  `);

  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_status_check');
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status in ('new','pending','paid'))");

  await knex.schema.alterTable('users', (table) => {
    table.index('blocked_at');
    table.index('deleted_at');
  });

  // 'admin' — доступ выдан вручную из админки (без реального платежа), для аудита отдельно
  // от бесплатных промокодов.
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','uzumbank','paynet','balance','admin','promo'))"
  );
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT payments_provider_check');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider in ('click','payme','uzumbank','paynet','balance','promo'))"
  );

  await knex.raw(`UPDATE users SET status = 'blocked' WHERE blocked_at IS NOT NULL`);
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_status_check');
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status in ('new','pending','paid','blocked'))");

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('blocked_at');
    table.dropColumn('deleted_at');
  });
};
