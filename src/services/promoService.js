const promoCodesRepo = require('../db/repositories/promoCodes');

/**
 * Ищет активный, не истёкший, с запасом использований промокод по коду.
 * @param {string} code
 * @returns {Promise<object|undefined>}
 */
function validatePromoCode(code) {
  if (!code || typeof code !== 'string') return Promise.resolve(undefined);
  return promoCodesRepo.findActiveByCode(code.trim());
}

/**
 * Считает итоговую сумму с учётом промокода. Возвращает число, округлённое до 2 знаков.
 * @param {number} price
 * @param {{type: 'percent'|'fixed'|'free', value: number}|null|undefined} promoCode
 */
function calculateFinalAmount(price, promoCode) {
  const base = Number(price);
  if (!promoCode) return round2(base);

  const value = Number(promoCode.value);
  switch (promoCode.type) {
    case 'percent':
      return round2(base * (1 - value / 100));
    case 'fixed':
      return round2(Math.max(base - value, 0));
    case 'free':
      return 0;
    default:
      return round2(base);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Целевая цена конкретного платежа для порога недоплаты (см. balanceService.js) — с учётом
 * промокода, если он был применён (payments.promo_code_id). Без промокода — полная цена
 * канала; так оплата напрямую через приложение (минуя бота, без промокода) по-прежнему
 * сверяется с config.channelPrice, а оплата по промокоду — со скидочной ценой, как и было
 * до введения внутреннего счёта.
 * @param {number} channelPrice
 * @param {number|null} promoCodeId
 */
async function resolveTargetPrice(channelPrice, promoCodeId) {
  if (!promoCodeId) return channelPrice;
  const promo = await promoCodesRepo.findById(promoCodeId);
  return calculateFinalAmount(channelPrice, promo);
}

module.exports = { validatePromoCode, calculateFinalAmount, resolveTargetPrice };
