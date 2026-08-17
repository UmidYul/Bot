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

module.exports = { validatePromoCode, calculateFinalAmount };
