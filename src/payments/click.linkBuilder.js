const config = require('../config');

/**
 * Формирует ссылку на оплату Click для показа юзеру в боте — стандартная схема
 * Checkout-ссылки Click (см. docs.click.uz, "Платёжная ссылка"): my.click.uz/services/pay
 * с service_id/merchant_id/merchant_user_id из личного кабинета. transaction_param — то же
 * значение, которое Click потом вернёт как merchant_trans_id в вебхуках Prepare/Complete
 * (см. src/payments/click.js).
 *
 * @param {{id: number, amount: number, merchant_trans_id: string}} payment
 * @param {{code: string}} user
 *
 * Намеренно без return_url — после оплаты юзер просто остаётся в Click, никакого редиректа
 * обратно (ни на сайт, ни в бота) не нужно.
 */
function buildClickPayUrl(payment, user) {
  const params = new URLSearchParams({
    service_id: config.click.serviceId,
    merchant_id: config.click.merchantId,
    merchant_user_id: config.click.merchantUserId,
    amount: String(payment.amount),
    transaction_param: payment.merchant_trans_id,
  });

  return `https://my.click.uz/services/pay?${params.toString()}`;
}

module.exports = { buildClickPayUrl };
