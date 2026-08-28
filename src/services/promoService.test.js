const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalAmount, resolveTargetPrice } = require('./promoService');
const promoCodesRepo = require('../db/repositories/promoCodes');

test('без промокода возвращает исходную цену', () => {
  assert.equal(calculateFinalAmount(100000, null), 100000);
});

test('percent-промокод уменьшает сумму на процент', () => {
  assert.equal(calculateFinalAmount(100000, { type: 'percent', value: 20 }), 80000);
});

test('fixed-промокод вычитает фиксированную сумму', () => {
  assert.equal(calculateFinalAmount(100000, { type: 'fixed', value: 30000 }), 70000);
});

test('fixed-промокод не уходит в минус', () => {
  assert.equal(calculateFinalAmount(50000, { type: 'fixed', value: 90000 }), 0);
});

test('free-промокод даёт нулевую сумму', () => {
  assert.equal(calculateFinalAmount(100000, { type: 'free', value: 0 }), 0);
});

test('округляет до 2 знаков после запятой', () => {
  assert.equal(calculateFinalAmount(99999, { type: 'percent', value: 33 }), 66999.33);
});

test('resolveTargetPrice без promoCodeId возвращает полную цену канала', async () => {
  const price = await resolveTargetPrice(100000, null);
  assert.equal(price, 100000);
});

test('resolveTargetPrice с promoCodeId возвращает цену со скидкой промокода', async (t) => {
  t.mock.method(promoCodesRepo, 'findById', async () => ({ type: 'percent', value: 20 }));
  const price = await resolveTargetPrice(100000, 42);
  assert.equal(price, 80000);
});
