const { Telegraf, session } = require('telegraf');
const config = require('../config');
const { PostgresSessionStore } = require('./sessionStore');
const ensureUser = require('./middleware/ensureUser');
const { t } = require('./i18n');

const { handleStart } = require('./handlers/start');
const { handleLanguageChoice } = require('./handlers/language');
const { handleContact } = require('./handlers/contact');
const {
  handleEnterPromo,
  handlePayStart,
  handlePayBack,
  handlePromoCodeText,
  handlePayMethod,
} = require('./handlers/payment');
const { handleChatJoinRequest } = require('./handlers/joinRequest');
const accessService = require('../services/accessService');

const bot = new Telegraf(config.botToken || 'invalid-token-placeholder');
accessService.setBot(bot);

bot.use(
  session({
    store: new PostgresSessionStore(),
    defaultSession: () => ({ awaitingPromo: false, promoCodeId: null, finalAmount: config.channelPrice }),
  })
);
bot.use(ensureUser);

bot.start(handleStart);

bot.action(/^lang:(ru|uz)$/, handleLanguageChoice);
bot.action('promo:enter', handleEnterPromo);
bot.action('pay:start', handlePayStart);
bot.action('pay:back', handlePayBack);
bot.action(/^pay:method:(click|payme)$/, handlePayMethod);

bot.on('contact', handleContact);

bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingPromo) {
    return handlePromoCodeText(ctx);
  }
  return next();
});

bot.on('chat_join_request', handleChatJoinRequest);

bot.catch((err, ctx) => {
  console.error(`Ошибка в обработчике бота (update ${ctx.update.update_id}):`, err);
  const lang = ctx.state && ctx.state.user ? ctx.state.user.language : 'ru';
  ctx.reply(t(lang, 'generic_error')).catch(() => {});
});

module.exports = { bot };
