const usersRepo = require('../../db/repositories/users');
const config = require('../../config');
const { t } = require('../i18n');
const { html } = require('../reply');
const { showScreen } = require('../screen');
const { sharePhoneKeyboard, mainMenuKeyboard, paymentScreenKeyboard } = require('../keyboards');

/**
 * prefix — короткая заметка, которую нужно показать вместе с экраном оплаты (например,
 * "промокод не найден"), не отправляя её отдельным сообщением.
 */
async function showPaymentScreen(ctx, user, prefix = '') {
  await showScreen(ctx, prefix + t(user.language, 'payment_screen', config.channelPrice), paymentScreenKeyboard(user.language));
}

async function promptForPhone(ctx, user) {
  await ctx.reply(t(user.language, 'welcome'), html());
  await ctx.reply(t(user.language, 'share_phone_button'), sharePhoneKeyboard(user.language));
}

/**
 * Общая логика "что показать" для уже существующего в БД юзера — переиспользуется
 * из /start, из смены языка и из пунктов меню, чтобы поведение везде было одинаковым.
 */
async function routeExistingUser(ctx, user) {
  // Это всегда "свежий" верхнеуровневый заход (после /start, смены языка, кнопки меню
  // и т.п.), а не продолжение текущего экрана оплаты — забываем прошлый screenMessageId,
  // иначе showPaymentScreen ниже молча отредактирует какое-то старое сообщение выше по
  // истории чата вместо того, чтобы показать экран там, где юзер сейчас находится.
  if (ctx.session) ctx.session.screenMessageId = null;

  // Юзер ищется по telegram_id по всей БД, а не в рамках конкретного бота — если это
  // новый чат с другим ботом (сменили BOT_TOKEN на другого бота), в нём ещё нет ни одного
  // сообщения с reply-клавиатурой, даже если у юзера уже есть телефон/оплата из старого
  // бота. Устанавливаем клавиатуру меню при каждом верхнеуровневом заходе, а не только
  // в ветке "есть телефон, ещё не оплачено" — иначе в новом чате не будет кнопок меню.
  if (user.phone) {
    await ctx.reply(t(user.language, 'menu_prompt'), mainMenuKeyboard(user.language));
  }

  // Бан — независимый флаг, а не значение status: проверяем его первым, чтобы
  // заблокированный paid-юзер видел сообщение о блокировке, а не "уже оплачено".
  if (user.blocked_at) {
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
    // Смена языка временно отключена (см. i18n/index.js) — все новые юзеры сразу на узбекском.
    user = await usersRepo.createUser({ telegramId: ctx.from.id, username: ctx.from.username });
    ctx.state.user = user;
    await promptForPhone(ctx, user);
    return;
  }

  await routeExistingUser(ctx, user);
}

module.exports = { handleStart, showPaymentScreen, promptForPhone, routeExistingUser };
