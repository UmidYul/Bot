const path = require('path');

// Явный путь до .env в корне проекта — knex CLI меняет process.cwd() перед запуском
// миграций/сидов (на src/db), из-за чего dotenv.config() без path молча не находил файл
// и все переменные окружения падали на дефолты.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name, { allowEmptyInDev = false } = {}) {
  const value = process.env[name];
  if (!value && !allowEmptyInDev) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
    }
  }
  return value || '';
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3000', 10),

  botToken: required('BOT_TOKEN', { allowEmptyInDev: true }),
  webBaseUrl: (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  channelId: process.env.CHANNEL_ID || '',
  channelInviteLink: process.env.CHANNEL_INVITE_LINK || '',
  channelPrice: parseFloat(process.env.CHANNEL_PRICE || '0'),

  databaseUrl: required('DATABASE_URL', { allowEmptyInDev: true }) ||
    'postgres://postgres:admin@localhost:5432/tg_sub_bot',

  sessionSecret: process.env.SESSION_SECRET || 'dev-local-secret-change-in-production',

  click: {
    // Единственный из четырёх реально подключённый провайдер (Telegram Payments +
    // сырой Shop API) — тумблер тем не менее даём, чтобы можно было временно снять
    // кнопку из бота (например, на время проблем у провайдера), не трогая код.
    enabled: process.env.CLICK_ENABLED !== 'false',
    serviceId: process.env.CLICK_SERVICE_ID || '',
    merchantId: process.env.CLICK_MERCHANT_ID || '',
    merchantUserId: process.env.CLICK_MERCHANT_USER_ID || '',
    secretKey: process.env.CLICK_SECRET_KEY || '',
    // provider_token из BotFather (/mybots -> Payments -> Click) для встроенного чек-аута
    // Telegram (sendInvoice/pre_checkout_query/successful_payment) — НЕ то же самое, что
    // secretKey выше (тот — для вебхуков Shop API при оплате напрямую через приложение Click).
    providerToken: process.env.CLICK_PROVIDER_TOKEN || '',
  },

  payme: {
    // Временно отключено по просьбе заказчика — кнопка Payme скрыта из бота, вебхук
    // /payments/payme при этом остаётся рабочим на будущее. Включать через .env,
    // не менять код: PAYME_ENABLED=true.
    enabled: process.env.PAYME_ENABLED === 'true',
    merchantId: process.env.PAYME_MERCHANT_ID || '',
    secretKey: process.env.PAYME_SECRET_KEY || '',
    testKey: process.env.PAYME_TEST_KEY || '',
  },

  // UzumBank и Paynet: интеграция (вебхуки/подписи) ещё не реализована — см. README,
  // раздел "UzumBank и Paynet — в планах". Тумблер уже есть в настройках на будущее,
  // но сейчас включение НЕ добавляет кнопку в бота (enabledPaymentProviders их не учитывает,
  // см. ниже), чтобы не показывать юзерам нерабочий способ оплаты.
  uzumbank: {
    enabled: process.env.UZUMBANK_ENABLED === 'true',
  },
  paynet: {
    enabled: process.env.PAYNET_ENABLED === 'true',
  },

  adminSeed: {
    login: process.env.ADMIN_SEED_LOGIN || 'admin',
    password: process.env.ADMIN_SEED_PASSWORD || 'admin',
  },

  // Telegram user/chat id админов, которым бот шлёт уведомления (новая оплата, всплеск
  // неверных промокодов, необработанные ошибки). Список через запятую, можно узнать свой
  // id через @userinfobot. Пусто — уведомления просто не отправляются.
  adminNotifyChatIds: (process.env.ADMIN_NOTIFY_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  promoAntiSpam: {
    maxAttempts: parseInt(process.env.PROMO_MAX_ATTEMPTS || '5', 10),
    lockoutMinutes: parseInt(process.env.PROMO_LOCKOUT_MINUTES || '15', 10),
  },

  backup: {
    // Путь к pg_dump — на Linux VPS обычно уже в PATH (пакет postgresql-client),
    // на Windows-деве нужно указать явно, см. .env.example.
    pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10),
    dir: process.env.BACKUP_DIR || 'backups',
  },
};

// Геттер, а не статический массив: настройки (см. src/services/settingsService.js) могут
// включать/выключать провайдеров из админки в рантайме без рестарта процесса — здесь
// всегда пересчитывается по актуальным config.*.enabled.
// UzumBank/Paynet сюда намеренно не попадают, даже если их тумблер включён в настройках —
// у них ещё нет реализованных вебхуков (см. README), показывать в боте нерабочую кнопку
// оплаты было бы хуже, чем просто скрыть её до готовности интеграции.
Object.defineProperty(config, 'enabledPaymentProviders', {
  enumerable: true,
  get() {
    return [...(config.click.enabled ? ['click'] : []), ...(config.payme.enabled ? ['payme'] : [])];
  },
});

// Telegram принимает вебхуки только на публичный HTTPS-адрес. Локально (localhost/127.0.0.1)
// его не достать снаружи, поэтому в деве бот сам переключается на long-polling — вручную
// поднимать ngrok/etc не нужно. В проде (реальный https-домен в WEB_BASE_URL) всегда webhook.
config.usePolling = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(config.webBaseUrl);

module.exports = config;
