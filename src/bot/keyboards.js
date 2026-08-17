const { Markup } = require('telegraf');
const { t } = require('./i18n');

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🇷🇺 Русский', 'lang:ru'), Markup.button.callback("🇺🇿 O'zbekcha", 'lang:uz')],
  ]);
}

function sharePhoneKeyboard(lang) {
  return Markup.keyboard([Markup.button.contactRequest(t(lang, 'share_phone_button'))])
    .resize()
    .oneTime();
}

function paymentScreenKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'enter_promo_button'), 'promo:enter')],
    [Markup.button.callback(t(lang, 'pay_button'), 'pay:start')],
  ]);
}

function paymentMethodKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'pay_click'), 'pay:method:click'),
      Markup.button.callback(t(lang, 'pay_payme'), 'pay:method:payme'),
    ],
    [Markup.button.callback(t(lang, 'back_button'), 'pay:back')],
  ]);
}

module.exports = {
  languageKeyboard,
  sharePhoneKeyboard,
  paymentScreenKeyboard,
  paymentMethodKeyboard,
};
