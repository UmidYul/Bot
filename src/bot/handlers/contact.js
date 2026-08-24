const usersRepo = require('../../db/repositories/users');
const { t } = require('../i18n');
const { html } = require('../reply');
const { mainMenuKeyboard } = require('../keyboards');

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

  // reply-клавиатура пропадает, если сообщение, которым она подставлена, удалить (несмотря
  // на то, что клавиатура вроде бы привязана к чату, а не к сообщению) — поэтому вешаем её
  // на сообщение с кодом, которое остаётся в чате, а не на отдельное "Raqam saqlandi",
  // которое тут же удалялось бы.
  //
  // Экран оплаты после регистрации теперь НЕ показывается автоматически — юзер открывает
  // его сам кнопкой "To'lov" в меню (см. openPaymentScreen в start.js).
  const text = `${t(user.language, 'phone_saved')}\n\n${t(user.language, 'your_code', user.code)}`;
  await ctx.reply(text, html(mainMenuKeyboard(user.language)));
}

module.exports = { handleContact };
