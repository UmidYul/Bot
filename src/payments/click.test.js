const { test } = require('node:test');
const assert = require('node:assert/strict');
const click = require('./click');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');

test('resolveOrCreatePayment отдаёт живой pending-платёж Click', async (t) => {
  const clickPayment = { id: 5, provider: 'click', merchant_trans_id: 'SPCN26', status: 'pending', user_id: 1 };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async (provider) =>
    provider === 'click' ? clickPayment : undefined
  );

  assert.equal(await click.resolveOrCreatePayment('SPCN26', 100000), clickPayment);
});

test('resolveOrCreatePayment: у кода уже есть pending-платёж Payme — Click заводит свой', async (t) => {
  // Зеркало регрессии из payme.test.js: код юзера не должен "залипать" за Payme.
  const user = { id: 1, code: 'SPCN26', status: 'new', blocked_at: null, deleted_at: null };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async (provider) =>
    provider === 'payme' ? { id: 7, provider: 'payme', status: 'pending' } : undefined
  );
  t.mock.method(usersRepo, 'findByCode', async () => user);
  const created = [];
  t.mock.method(paymentsRepo, 'createOrGetPendingPayment', async (data) => {
    created.push(data);
    return { id: 8, provider: 'click', merchant_trans_id: data.merchantTransId, status: 'pending', user_id: user.id };
  });

  const payment = await click.resolveOrCreatePayment('SPCN26', 100000);

  assert.equal(payment.provider, 'click');
  assert.deepEqual(created, [{ userId: 1, provider: 'click', amount: 100000, merchantTransId: 'SPCN26' }]);
});

test('resolveOrCreatePayment отдаёт завершённый заказ Click, если живого нет и это не код юзера', async (t) => {
  // Заказ из бота ("<code>-<ts>"), уже оплаченный: handlePrepare должен ответить -4, а не -5.
  const finished = { id: 9, provider: 'click', merchant_trans_id: 'SPCN26-1700000000000', status: 'paid' };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async () => undefined);
  t.mock.method(usersRepo, 'findByCode', async () => undefined);
  t.mock.method(paymentsRepo, 'findLatestByProviderAndMerchantTransId', async () => finished);

  assert.equal(await click.resolveOrCreatePayment('SPCN26-1700000000000', 100000), finished);
});

test('resolveOrCreatePayment возвращает null для заблокированного юзера', async (t) => {
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async () => undefined);
  t.mock.method(usersRepo, 'findByCode', async () => ({
    id: 2,
    code: 'BLOCK1',
    status: 'new',
    blocked_at: new Date(),
    deleted_at: null,
  }));

  assert.equal(await click.resolveOrCreatePayment('BLOCK1', 100000), null);
});
