const { Markup } = require('telegraf');
const { t } = require('./i18n');
const config = require('../config');

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🇷🇺 Русский', 'lang:ru'), Markup.button.callback("🇺🇿 O'zbekcha", 'lang:uz')],
  ]);
}

/**
 * Кнопка смены языка на экране приветствия — до того, как показан постоянный меню-набор
 * (он появляется только после сохранения телефона), это единственный видимый способ
 * поправить язык, если юзер ошибся при первом выборе.
 */
function changeLanguageInlineKeyboard(lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'menu_language'), 'lang:menu')]]);
}

function sharePhoneKeyboard(lang) {
  return Markup.keyboard([Markup.button.contactRequest(t(lang, 'share_phone_button'))])
    .resize()
    .oneTime();
}

/** Постоянное меню внизу экрана — доступно в любой момент после того, как юзер поделился номером. */
function mainMenuKeyboard(lang) {
  return Markup.keyboard([
    [t(lang, 'menu_profile'), t(lang, 'menu_pay')],
    [t(lang, 'menu_language'), t(lang, 'menu_help')],
  ]).resize();
}

function paymentScreenKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'enter_promo_button'), 'promo:enter')],
    [Markup.button.callback(t(lang, 'pay_button'), 'pay:start')],
  ]);
}

function promoEntryKeyboard(lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'cancel_button'), 'promo:cancel')]]);
}

/** Показывает только реально включённые провайдеры (см. config.enabledPaymentProviders). */
function paymentMethodKeyboard(lang) {
  const buttons = config.enabledPaymentProviders.map((provider) =>
    Markup.button.callback(t(lang, `pay_${provider}`), `pay:method:${provider}`)
  );

  return Markup.inlineKeyboard([buttons, [Markup.button.callback(t(lang, 'back_button'), 'pay:back')]]);
}

module.exports = {
  languageKeyboard,
  changeLanguageInlineKeyboard,
  sharePhoneKeyboard,
  mainMenuKeyboard,
  paymentScreenKeyboard,
  promoEntryKeyboard,
  paymentMethodKeyboard,
};
