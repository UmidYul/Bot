const { Markup } = require('telegraf');
const { t } = require('./i18n');
const config = require('../config');

function sharePhoneKeyboard(lang) {
  return Markup.keyboard([Markup.button.contactRequest(t(lang, 'share_phone_button'))])
    .resize()
    .oneTime();
}

/** Постоянное меню внизу экрана — доступно в любой момент после того, как юзер поделился номером.
 * Кнопка языка временно скрыта — смена языка сейчас не поддерживается (см. i18n/index.js). */
function mainMenuKeyboard(lang) {
  return Markup.keyboard([
    [t(lang, 'menu_profile'), t(lang, 'menu_pay')],
    [t(lang, 'menu_more'), t(lang, 'menu_admin')],
    [t(lang, 'enter_promo_button')],
  ]).resize();
}

function paymentScreenKeyboard(lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'pay_button'), 'pay:start')]]);
}

function promoEntryKeyboard(lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'cancel_button'), 'promo:cancel')]]);
}

/**
 * Показывает реально включённые внешние провайдеры (см. config.enabledPaymentProviders) —
 * прямая покупка, доступ выдаётся сразу по завершении.
 */
function paymentMethodKeyboard(lang) {
  const buttons = config.enabledPaymentProviders.map((provider) =>
    Markup.button.callback(t(lang, `pay_${provider}`), `pay:method:${provider}`)
  );

  // Все внешние провайдеры можно выключить из настроек (например, на время
  // проблем) — пустой ряд кнопок Telegram API отклоняет как невалидную клавиатуру,
  // поэтому добавляем ряд только если в нём реально что-то есть.
  const rows = [];
  if (buttons.length) rows.push(buttons);
  // Просто открывает чат с админом (url-кнопка, без callback в бота) — юзер оплачивает и
  // договаривается вручную, админ сам активирует доступ через веб-панель.
  rows.push([Markup.button.url(t(lang, 'pay_admin'), `https://t.me/${config.adminUsername}`)]);
  rows.push([Markup.button.callback(t(lang, 'back_button'), 'pay:back')]);

  return Markup.inlineKeyboard(rows);
}

function cancelPaymentKeyboard(lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'cancel_button'), 'pay:cancel')]]);
}

/** Ссылка на чекаут провайдера (Payme) — кнопкой, а не голым текстом в сообщении. */
function paymentLinkKeyboard(lang, url) {
  return Markup.inlineKeyboard([
    [Markup.button.url(t(lang, 'pay_open_button'), url)],
    [Markup.button.callback(t(lang, 'cancel_button'), 'pay:cancel')],
  ]);
}

module.exports = {
  sharePhoneKeyboard,
  mainMenuKeyboard,
  paymentScreenKeyboard,
  promoEntryKeyboard,
  paymentMethodKeyboard,
  cancelPaymentKeyboard,
  paymentLinkKeyboard,
};
