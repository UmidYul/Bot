const config = require('./config');
const knex = require('./db');
const buildApp = require('./app');
const { bot } = require('./bot');

async function main() {
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
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
