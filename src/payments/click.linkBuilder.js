const config = require('../config');

/**
 * Формирует ссылку на оплату Click для показа юзеру в боте.
 * Точный формат query-параметров подтверждается в личном кабинете Click при получении
 * реальных merchant-данных — ниже стандартная схема Checkout-ссылки Click Shop API,
 * помечена TODO-параметрами, которые могут потребовать корректировки.
 *
 * @param {{id: number, amount: number, merchant_trans_id: string}} payment
 * @param {{code: string}} user
 */
function buildClickPayUrl(payment, user) {
  const params = new URLSearchParams({
    service_id: config.click.serviceId, // TODO: сверить с личным кабинетом Click
    merchant_id: config.click.merchantId, // TODO: сверить с личным кабинетом Click
    amount: String(payment.amount),
    transaction_param: payment.merchant_trans_id, // TODO: поле, по которому Click вернёт merchant_trans_id в Prepare/Complete
    return_url: config.webBaseUrl,
  });

  return `https://my.click.uz/services/pay?${params.toString()}`;
}

module.exports = { buildClickPayUrl };
