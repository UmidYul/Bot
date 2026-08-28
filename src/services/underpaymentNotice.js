const { Markup } = require('telegraf');
const { t } = require('../bot/i18n');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

/**
 * Отправляется вместо чека, когда платёж (Click/Payme) реально прошёл, но суммы (с учётом уже
 * накопленного внутреннего счёта) не хватило на цену канала — см. resolvePaymentOutcome в
 * src/services/balanceService.js. Кнопка ведёт на уже существующий callback 'pay:start' —
 * тот же экран выбора способа оплаты, что и при обычной покупке; сумма к оплате там сама
 * пересчитается с учётом накопленного баланса (см. handlePayStart в bot/handlers/payment.js).
 * @param {{telegram_id: number, language: string}} user
 * @param {{paidNow: number, remaining: number}} amounts
 */
async function sendUnderpaymentNotice(user, { paidNow, remaining }) {
  if (!botRef) return;

  const lang = user.language;
  const text = t(lang, 'underpayment_notice', paidNow, remaining);
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'topup_button'), 'pay:start')]]);

  try {
    await botRef.telegram.sendMessage(user.telegram_id, text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    console.error(`sendUnderpaymentNotice: не удалось отправить сообщение юзеру ${user.telegram_id}:`, err.message);
  }
}

module.exports = { setBot, sendUnderpaymentNotice };
