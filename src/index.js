const config = require('./config');
const knex = require('./db');
const buildApp = require('./app');
const { bot } = require('./bot');
const settingsService = require('./services/settingsService');

async function main() {
  // Настройки, отредактированные из админки (цена канала, инвайт-ссылка и т.д.),
  // хранятся в БД и переопределяют дефолты из .env — применяем их до старта сервера.
  await settingsService.loadIntoConfig();

  const app = buildApp();
  const server = app.listen(config.port, () => {
    console.log(`HTTP-сервер запущен на порту ${config.port} (env: ${config.nodeEnv})`);
  });

  if (config.usePolling) {
    console.log('WEB_BASE_URL указывает на localhost — бот запущен в режиме long-polling (для локальной разработки).');
    await bot.launch();
  } else if (config.botToken) {
    const webhookUrl = `${config.webBaseUrl}/telegram/webhook`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook установлен: ${webhookUrl}`);
  } else {
    console.warn('BOT_TOKEN не задан — бот не запущен. Заполните .env, чтобы включить бота.');
  }

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Получен ${signal}, начинаю graceful shutdown...`);

    if (config.usePolling) bot.stop(signal);

    server.close(async (err) => {
      if (err) console.error('Ошибка при закрытии HTTP-сервера:', err);
      try {
        await knex.destroy();
        console.log('Postgres-пул закрыт. Завершение процесса.');
      } catch (dbErr) {
        console.error('Ошибка при закрытии Postgres-пула:', dbErr);
      } finally {
        process.exit(err ? 1 : 0);
      }
    });

    // Не даём процессу зависнуть, если что-то не закрылось вовремя.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // Защита от полного падения процесса: все Express-роуты и бот-хендлеры уже сами
  // ловят свои ошибки (asyncHandler, bot.catch), но это последний рубеж на случай
  // необработанного отклонённого промиса где-то ещё — без него Node с 15-й версии
  // молча убивает весь процесс на любой такой ошибке (именно так уронило сервер запросом
  // с багом в SQL-запросе до этого фикса). Логируем и продолжаем жить, а не падаем.
  process.on('unhandledRejection', (reason) => {
    console.error('Необработанный отклонённый промис (процесс продолжает работу):', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Необработанное исключение (процесс продолжает работу):', err);
  });
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
