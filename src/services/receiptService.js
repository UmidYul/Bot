const promoCodesRepo = require('../db/repositories/promoCodes');
const { t } = require('../bot/i18n');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

const PROVIDER_LABEL_KEY = { click: 'provider_click', payme: 'provider_payme', promo: 'provider_promo' };

/**
 * Отправляет юзеру чек сразу после успешной оплаты — вызывается из всех путей
 * подтверждения платежа (Click Shop API, Payme, Telegram Payments, бесплатный промокод).
 * @param {{telegram_id: number, language: string}} user
 * @param {{amount: number, currency?: string, provider: string, merchant_trans_id: string, paid_at?: Date, promo_code_id?: number}} payment
 */
async function sendReceipt(user, payment) {
  if (!botRef) return;

  const lang = user.language;
  let promoCode = null;
  if (payment.promo_code_id) {
    const promo = await promoCodesRepo.findById(payment.promo_code_id);
    promoCode = promo ? promo.code : null;
  }

  const lines = [
    t(lang, 'receipt_title'),
    '',
    `${t(lang, 'receipt_amount_label')}: <b>${Number(payment.amount).toLocaleString('ru-RU')} ${payment.currency || 'UZS'}</b>`,
    `${t(lang, 'receipt_provider_label')}: ${t(lang, PROVIDER_LABEL_KEY[payment.provider] || 'provider_click')}`,
    `${t(lang, 'receipt_id_label')}: <code>${payment.merchant_trans_id}</code>`,
    `${t(lang, 'receipt_date_label')}: ${new Date(payment.paid_at || Date.now()).toLocaleString('ru-RU')}`,
  ];
  if (promoCode) lines.push(`${t(lang, 'receipt_promo_label')}: ${promoCode}`);

  try {
    await botRef.telegram.sendMessage(user.telegram_id, lines.join('\n'), { parse_mode: 'HTML' });
  } catch (err) {
    console.error(`sendReceipt: не удалось отправить чек юзеру ${user.telegram_id}:`, err.message);
  }
}

module.exports = { setBot, sendReceipt };
