const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalAmount } = require('./promoService');

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
