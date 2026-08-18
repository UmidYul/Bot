const usersRepo = require('../../db/repositories/users');
const { t } = require('../i18n');
const { html } = require('../reply');
const { mainMenuKeyboard } = require('../keyboards');
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

  // Свежий верхнеуровневый заход — см. такой же сброс в routeExistingUser (start.js).
  if (ctx.session) ctx.session.screenMessageId = null;

  await ctx.reply(t(user.language, 'phone_saved'), mainMenuKeyboard(user.language));
  await showPaymentScreen(ctx, ctx.state.user);
}

module.exports = { handleContact };
