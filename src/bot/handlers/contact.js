const usersRepo = require('../../db/repositories/users');
const { t } = require('../i18n');
const { Markup } = require('telegraf');
const { showPaymentScreen } = require('./start');

async function handleContact(ctx) {
  const user = ctx.state.user;
  const contact = ctx.message.contact;

  if (!user) return;

  // Юзер не может прислать чужой контакт — привязываем номер только к отправителю.
  if (!contact || contact.user_id !== ctx.from.id) {
    await ctx.reply(t(user.language, 'phone_invalid'));
    return;
  }

  await usersRepo.updatePhone(user.id, contact.phone_number);
  ctx.state.user.phone = contact.phone_number;

  await ctx.reply(t(user.language, 'phone_saved'), Markup.removeKeyboard());
  await showPaymentScreen(ctx, ctx.state.user);
}

module.exports = { handleContact };
