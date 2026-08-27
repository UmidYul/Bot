const { Telegraf, session } = require('telegraf');
const config = require('../config');
const { PostgresSessionStore } = require('./sessionStore');
const ensureUser = require('./middleware/ensureUser');
const { t, allVariants } = require('./i18n');
const { html } = require('./reply');

const { handleStart, openPaymentScreen } = require('./handlers/start');
const { handleContact } = require('./handlers/contact');
const { handleProfile } = require('./handlers/profile');
const {
  handleEnterPromo,
  handlePromoCancel,
  handlePayStart,
  handlePayBack,
  handlePayCancel,
  handlePromoCodeText,
  handlePayMethod,
} = require('./handlers/payment');
const { handleChatJoinRequest } = require('./handlers/joinRequest');
const accessService = require('../services/accessService');
const receiptService = require('../services/receiptService');
const adminNotifyService = require('../services/adminNotifyService');
const broadcastService = require('../services/broadcastService');

const bot = new Telegraf(config.botToken || 'invalid-token-placeholder');
accessService.setBot(bot);
receiptService.setBot(bot);
adminNotifyService.setBot(bot);
broadcastService.setBot(bot);

bot.telegram
  .setMyCommands([
    { command: 'start', description: 'Начать / главное меню' },
    { command: 'profile', description: 'Профиль и код для оплаты' },
    { command: 'help', description: 'Связаться с администратором' },
  ])
  .catch((err) => console.error('Не удалось установить команды бота:', err.message));

bot.use(
  session({
    store: new PostgresSessionStore(),
    defaultSession: () => ({
      awaitingPromo: false,
      promoCodeId: null,
      finalAmount: config.channelPrice,
      promoInvalidAttempts: 0,
      promoLockedUntil: null,
      screenMessageId: null,
    }),
  })
);
bot.use(ensureUser);

bot.start(handleStart);
bot.command('profile', handleProfile);
bot.command('help', (ctx) => {
  const lang = ctx.state.user ? ctx.state.user.language : 'uz';
  return ctx.reply(t(lang, 'admin_text', config.adminUsername), html());
});

bot.action('promo:enter', handleEnterPromo);
bot.action('promo:cancel', handlePromoCancel);
bot.action('pay:start', handlePayStart);
bot.action('pay:back', handlePayBack);
bot.action('pay:cancel', handlePayCancel);
bot.action(/^pay:method:(payme)$/, handlePayMethod);

bot.on('contact', handleContact);

// Кнопки постоянного меню (reply-keyboard) — работают независимо от текущего языка юзера
// и, что важно, ИМЕЮТ ПРИОРИТЕТ над вводом промокода: если юзер завис в состоянии
// "ожидаю промокод" и нажал кнопку меню, это не должно быть принято за текст промокода.
bot.hears(allVariants('menu_profile'), handleProfile);
bot.hears(allVariants('menu_more'), (ctx) => {
  const lang = ctx.state.user ? ctx.state.user.language : 'uz';
  return ctx.reply(t(lang, 'more_text', config.otherChannelUrl), html());
});
bot.hears(allVariants('menu_admin'), (ctx) => {
  const lang = ctx.state.user ? ctx.state.user.language : 'uz';
  return ctx.reply(t(lang, 'admin_text', config.adminUsername), html());
});
bot.hears(allVariants('menu_pay'), async (ctx) => {
  const user = ctx.state.user;
  if (!user) return handleStart(ctx);
  ctx.session.awaitingPromo = false;
  await openPaymentScreen(ctx, user);
});
bot.hears(allVariants('enter_promo_button'), handleEnterPromo);

bot.on('text', async (ctx, next) => {
  const text = (ctx.message.text || '').trim();
  // Слэш-команды никогда не считаем промокодом, даже если юзер завис в ожидании ввода.
  if (ctx.session.awaitingPromo && !text.startsWith('/')) {
    return handlePromoCodeText(ctx);
  }
  return next();
});

// Финальный "поймал всё" для текста, который не подошёл ни одному хендлеру выше —
// вместо тишины даём юзеру понятную подсказку вместо ощущения, что бот завис.
bot.on('text', (ctx) => {
  const lang = ctx.state.user ? ctx.state.user.language : 'uz';
  return ctx.reply(t(lang, 'unrecognized_message'));
});

bot.on('chat_join_request', handleChatJoinRequest);

bot.catch((err, ctx) => {
  console.error(`Ошибка в обработчике бота (update ${ctx.update.update_id}):`, err);
  const lang = ctx.state && ctx.state.user ? ctx.state.user.language : 'uz';
  ctx.reply(t(lang, 'generic_error')).catch(() => {});
  adminNotifyService.notifyBotError(ctx.update.update_id, err).catch(() => {});
});

module.exports = { bot };
