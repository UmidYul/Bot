const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePaymentOutcome } = require('./balanceService');

test('платёж ровно на цену без баланса выдаёт доступ', () => {
  assert.deepEqual(resolvePaymentOutcome(0, 100000, 100000), { grantsAccess: true, newBalance: 0 });
});

test('недоплата без баланса копится на счету, доступ не выдаётся', () => {
  assert.deepEqual(resolvePaymentOutcome(0, 60000, 100000), {
    grantsAccess: false,
    newBalance: 60000,
    remaining: 40000,
  });
});

test('баланс + новый платёж вместе переходят порог — доступ выдаётся, баланс обнуляется', () => {
  assert.deepEqual(resolvePaymentOutcome(60000, 40000, 100000), { grantsAccess: true, newBalance: 0 });
});

test('баланс + новый платёж всё ещё не хватает — остаток пересчитывается', () => {
  assert.deepEqual(resolvePaymentOutcome(60000, 10000, 100000), {
    grantsAccess: false,
    newBalance: 70000,
    remaining: 30000,
  });
});

test('переплата выдаёт доступ, излишек не сохраняется', () => {
  assert.deepEqual(resolvePaymentOutcome(0, 150000, 100000), { grantsAccess: true, newBalance: 0 });
});
