const usersRepo = require('../../db/repositories/users');
const config = require('../../config');
const { t } = require('../i18n');
const { languageKeyboard, sharePhoneKeyboard, paymentScreenKeyboard } = require('../keyboards');

async function showPaymentScreen(ctx, user) {
  await ctx.reply(t(user.language, 'payment_screen', config.channelPrice), paymentScreenKeyboard(user.language));
}

async function handleStart(ctx) {
  let user = ctx.state.user;

  if (!user) {
    user = await usersRepo.createUser({ telegramId: ctx.from.id, username: ctx.from.username });
    ctx.state.user = user;
    await ctx.reply(t('ru', 'choose_language'), languageKeyboard());
    return;
  }

  if (user.status === 'blocked') {
    await ctx.reply(t(user.language, 'blocked'));
    return;
  }

  if (user.status === 'paid') {
    await ctx.reply(`${t(user.language, 'already_paid')}\n${config.channelInviteLink || ''}`.trim());
    return;
  }

  if (!user.phone) {
    await ctx.reply(t(user.language, 'welcome'));
    await ctx.reply(t(user.language, 'share_phone_button'), sharePhoneKeyboard(user.language));
    return;
  }

  await showPaymentScreen(ctx, user);
}

module.exports = { handleStart, showPaymentScreen };
