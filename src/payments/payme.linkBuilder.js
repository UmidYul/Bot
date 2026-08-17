const config = require('../config');

/**
 * Формирует ссылку на чекаут Payme. Точный набор полей params уточняется в личном
 * кабинете Payme Business — ниже стандартная схема base64(params) для checkout.paycom.uz.
 * Поле account.* настраивается в кабинете Payme (какое имя ключа account ожидает Payme
 * при CheckPerformTransaction) — здесь используем merchant_trans_id как account.
 *
 * @param {{amount: number, merchant_trans_id: string}} payment
 * @param {{code: string}} user
 */
function buildPaymeCheckoutUrl(payment, user) {
  const params = [
    `m=${config.payme.merchantId}`, // TODO: сверить с личным кабинетом Payme
    `ac.merchant_trans_id=${payment.merchant_trans_id}`, // TODO: имя поля account уточняется в кабинете
    `a=${Math.round(Number(payment.amount) * 100)}`, // Payme принимает сумму в тийинах
    `c=${config.webBaseUrl}`,
  ].join(';');

  const encoded = Buffer.from(params).toString('base64');
  return `https://checkout.paycom.uz/${encoded}`;
}

module.exports = { buildPaymeCheckoutUrl };
