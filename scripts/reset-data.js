#!/usr/bin/env node
/**
 * Полная очистка пользователей и платежей перед сдачей проекта — например, вычищает
 * тестовых юзеров/оплаты, накопленные во время разработки, перед передачей заказчику.
 *
 * Удаляет только users. payments и payment_events исчезают сами — в схеме на них стоит
 * FK ON DELETE CASCADE от users (см. migrations/20260101000003, 20260101000006). Промокоды,
 * настройки (settings), сами админ-аккаунты (admins) и лог действий администратора
 * (admin_logs) НЕ трогает — у admin_logs ссылки на удалённых юзеров просто станут NULL
 * (ON DELETE SET NULL), сами записи аудита останутся.
 *
 * ОПАСНО И НЕОБРАТИМО. Перед запуском обязательно сделайте бэкап: npm run backup
 * (см. scripts/backup.js — теперь ещё и шлёт дамп вам в Telegram).
 *
 * Запуск (ничего не удаляет без явного флага):
 *   node scripts/reset-data.js            — только покажет, что было бы удалено
 *   node scripts/reset-data.js --yes      — реально удаляет
 *   node scripts/reset-data.js --yes --reset-ids   — плюс сбрасывает счётчики id на 1
 */
const knex = require('../src/db');

async function main() {
  const confirmed = process.argv.includes('--yes');

  const [{ count: usersBefore }] = await knex('users').count({ count: '*' });
  const [{ count: paymentsBefore }] = await knex('payments').count({ count: '*' });
  const [{ count: eventsBefore }] = await knex('payment_events').count({ count: '*' });

  console.log(`Сейчас в БД: пользователей — ${usersBefore}, платежей — ${paymentsBefore}, событий платежей — ${eventsBefore}.`);
  console.log('Промокоды, настройки, админ-аккаунты и лог действий администратора будут сохранены.');

  if (!confirmed) {
    console.log('\nЭто был просмотр (dry-run) — ничего не удалено.');
    console.log('Сначала сделайте бэкап (npm run backup), затем для реального удаления запустите:');
    console.log('  node scripts/reset-data.js --yes');
    return;
  }

  console.log('\nУдаляю пользователей (платежи и события платежей удалятся каскадно)...');
  await knex('users').del();
  console.log('Готово: пользователи и все связанные платежи удалены.');

  if (process.argv.includes('--reset-ids')) {
    await knex.raw('ALTER SEQUENCE users_id_seq RESTART WITH 1');
    await knex.raw('ALTER SEQUENCE payments_id_seq RESTART WITH 1');
    await knex.raw('ALTER SEQUENCE payment_events_id_seq RESTART WITH 1');
    console.log('Счётчики id (users/payments/payment_events) сброшены на 1.');
  }
}

main()
  .catch((err) => {
    console.error('Не удалось очистить данные:', err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
