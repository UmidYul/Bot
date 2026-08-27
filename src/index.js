const config = require('./config');
const knex = require('./db');
const buildApp = require('./app');
const { bot } = require('./bot');
const settingsService = require('./services/settingsService');
const { logToFile } = require('./utils/webhookLogger');

async function main() {
  // Настройки, отредактированные из админки (цена канала, инвайт-ссылка и т.д.),
  // хранятся в БД и переопределяют дефолты из .env — применяем их до старта сервера.
  await settingsService.loadIntoConfig();

  const app = buildApp();
  const server = app.listen(config.port, () => {
    console.log(`HTTP-сервер запущен на порту ${config.port} (env: ${config.nodeEnv})`);
    // Не сами значения (секреты никогда не логируем), а факт их наличия — чтобы сразу было
    // видно в pm2 logs после рестарта, что процесс реально подхватил .env с реальными
    // click/payme данными, а не пустышки/устаревший env из старого процесса.
    console.log('[startup] click:', {
      enabled: config.click.enabled,
      service_id: config.click.serviceId || '(empty)',
      merchant_id: config.click.merchantId || '(empty)',
      secret_key_set: Boolean(config.click.secretKey),
    });
    console.log('[startup] payme:', {
      enabled: config.payme.enabled,
      merchant_id: config.payme.merchantId || '(empty)',
      secret_key_set: Boolean(config.payme.secretKey),
    });
    // Явный маркер рестарта в самом файле логов — если после реальной оплаты в
    // logs/webhooks.log нет вообще НИЧЕГО (ни этой строки, ни запроса), значит процесс
    // не перезапускался туда, куда думаем, либо это не тот файл/сервер, который смотрит
    // клиент/логи читаются не там, где реально пишет процесс.
    logToFile('process', 'startup', {
      port: config.port,
      web_base_url: config.webBaseUrl,
      click_enabled: config.click.enabled,
      // service_id/merchant_id — не секреты (видны в самой платёжной ссылке), их можно
      // сверять прямо по этому логу с кабинетом merchant.click.uz, не веря визуальной
      // сверке .env "на глаз". Секретный ключ — только факт непустоты и его длина
      // (чтобы отличить "не задан" от "задан, но не тот"), без самого значения.
      click_service_id: config.click.serviceId || '(пусто)',
      click_merchant_id: config.click.merchantId || '(пусто)',
      click_merchant_user_id: config.click.merchantUserId || '(пусто)',
      click_secret_key_set: Boolean(config.click.secretKey),
      click_secret_key_length: config.click.secretKey ? config.click.secretKey.length : 0,
    });
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
    logToFile('process', 'unhandledRejection', { message: reason && reason.message ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (err) => {
    console.error('Необработанное исключение (процесс продолжает работу):', err);
    logToFile('process', 'uncaughtException', { message: err.message, stack: err.stack });
  });
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
