const usersRepo = require('../../db/repositories/users');
const config = require('../../config');
const { t } = require('../i18n');
const { html } = require('../reply');
const {
  languageKeyboard,
  changeLanguageInlineKeyboard,
  sharePhoneKeyboard,
  mainMenuKeyboard,
  paymentScreenKeyboard,
} = require('../keyboards');

async function showPaymentScreen(ctx, user) {
  await ctx.reply(t(user.language, 'payment_screen', config.channelPrice), html(paymentScreenKeyboard(user.language)));
}

async function promptForPhone(ctx, user) {
  // Кнопка смены языка тут — единственный способ поправить язык до того, как появится
  // постоянное меню (оно показывается только после сохранения телефона).
  await ctx.reply(t(user.language, 'welcome'), html(changeLanguageInlineKeyboard(user.language)));
  await ctx.reply(t(user.language, 'share_phone_button'), sharePhoneKeyboard(user.language));
}

/**
 * Общая логика "что показать" для уже существующего в БД юзера — переиспользуется
 * из /start, из смены языка и из пунктов меню, чтобы поведение везде было одинаковым.
 */
async function routeExistingUser(ctx, user) {
  if (user.status === 'blocked') {
    await ctx.reply(t(user.language, 'blocked'), html());
    return;
  }

  if (user.status === 'paid') {
    const extra = config.channelInviteLink
      ? html({ reply_markup: { inline_keyboard: [[{ text: t(user.language, 'open_channel_button'), url: config.channelInviteLink }]] } })
      : html();
    await ctx.reply(t(user.language, 'already_paid'), extra);
    return;
  }

  if (!user.phone) {
    await promptForPhone(ctx, user);
    return;
  }

  await ctx.reply(t(user.language, 'menu_prompt'), mainMenuKeyboard(user.language));
  await showPaymentScreen(ctx, user);
}

async function handleStart(ctx) {
  let user = ctx.state.user;

  // /start всегда даёт чистый старт — сбрасываем зависшее состояние "ждём промокод"
  // (иначе следующее сообщение юзера могло по ошибке уйти в обработчик промокода).
  if (ctx.session) {
    ctx.session.awaitingPromo = false;
  }

  if (!user) {
    user = await usersRepo.createUser({ telegramId: ctx.from.id, username: ctx.from.username });
    ctx.state.user = user;
    await ctx.reply(t('ru', 'choose_language'), languageKeyboard());
    return;
  }

  await routeExistingUser(ctx, user);
}

module.exports = { handleStart, showPaymentScreen, promptForPhone, routeExistingUser };
