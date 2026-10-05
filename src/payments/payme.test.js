const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const payme = require('./payme');
const paymentsRepo = require('../db/repositories/payments');
const usersRepo = require('../db/repositories/users');

/** Basic-заголовок в том виде, в котором его шлёт Payme: логин всегда "Paycom". */
function basicHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`;
}

/** config — мутабельный синглтон (см. src/config.js), поэтому подменяем ключи на время теста. */
function withPaymeKeys({ secretKey = '', testKey = '' }, fn) {
  const saved = { secretKey: config.payme.secretKey, testKey: config.payme.testKey };
  config.payme.secretKey = secretKey;
  config.payme.testKey = testKey;
  try {
    fn();
  } finally {
    config.payme.secretKey = saved.secretKey;
    config.payme.testKey = saved.testKey;
  }
}

test('checkAuth принимает ключ со спецсимволами и двоеточием внутри', () => {
  // Ключи Payme — произвольная строка, двоеточие в ней встречается; резать надо по первому.
  const key = 'aB3$#@!:xY7&*%-key';
  withPaymeKeys({ secretKey: key }, () => {
    assert.equal(payme.checkAuth(basicHeader('Paycom', key)), true);
  });
});

test('checkAuth отклоняет пустой пароль, когда тестовый ключ не задан', () => {
  // Раньше PAYME_TEST_KEY='' совпадал с пустым паролем — вебхук авторизовал кого угодно.
  withPaymeKeys({ secretKey: 'real-secret-key', testKey: '' }, () => {
    assert.equal(payme.checkAuth(basicHeader('Paycom', '')), false);
  });
});

test('checkAuth принимает тестовый ключ, когда он задан', () => {
  withPaymeKeys({ secretKey: 'real-secret-key', testKey: 'sandbox-key' }, () => {
    assert.equal(payme.checkAuth(basicHeader('Paycom', 'sandbox-key')), true);
  });
});

test('checkAuth отклоняет неверный ключ, в том числе префикс верного', () => {
  withPaymeKeys({ secretKey: 'real-secret-key' }, () => {
    assert.equal(payme.checkAuth(basicHeader('Paycom', 'real-secret')), false);
    assert.equal(payme.checkAuth(basicHeader('Paycom', 'real-secret-key-and-more')), false);
  });
});

test('checkAuth отклоняет отсутствующий и не-Basic заголовок', () => {
  withPaymeKeys({ secretKey: 'real-secret-key' }, () => {
    assert.equal(payme.checkAuth(undefined), false);
    assert.equal(payme.checkAuth(''), false);
    assert.equal(payme.checkAuth('Bearer real-secret-key'), false);
    // base64 без двоеточия — не пара login:password.
    assert.equal(payme.checkAuth(`Basic ${Buffer.from('real-secret-key').toString('base64')}`), false);
  });
});

test('describeAuthHeader не раскрывает ключ', () => {
  const described = payme.describeAuthHeader(basicHeader('Paycom', 'real-secret-key'));
  assert.deepEqual(described, {
    present: true,
    scheme: 'Basic',
    login: 'Paycom',
    password_set: true,
    password_length: 'real-secret-key'.length,
  });
  assert.ok(!JSON.stringify(described).includes('real-secret-key'));
});

test('resolveAccount отдаёт живой pending-платёж Payme', async (t) => {
  const paymePayment = { id: 7, provider: 'payme', merchant_trans_id: 'SPCN26', status: 'pending', user_id: 1 };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async (provider) =>
    provider === 'payme' ? paymePayment : undefined
  );

  const resolved = await payme.resolveAccount({ merchant_trans_id: 'SPCN26' });

  assert.deepEqual(resolved, { merchantTransId: 'SPCN26', payment: paymePayment, user: null });
});

test('resolveAccount: у кода уже есть pending-платёж Click — Payme всё равно находит юзера', async (t) => {
  // Регрессия: строка Click с merchant_trans_id = кодом юзера навсегда занимала этот код,
  // и Payme получал -31050 при любой попытке оплатить тем же кодом.
  const user = { id: 1, code: 'SPCN26', status: 'new', blocked_at: null, deleted_at: null };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async (provider, merchantTransId) =>
    provider === 'click' && merchantTransId === 'SPCN26'
      ? { id: 5, provider: 'click', merchant_trans_id: 'SPCN26', status: 'pending', user_id: 1 }
      : undefined
  );
  t.mock.method(usersRepo, 'findByCode', async (code) => (code === 'SPCN26' ? user : undefined));

  const resolved = await payme.resolveAccount({ merchant_trans_id: 'SPCN26' });

  assert.deepEqual(resolved, { merchantTransId: 'SPCN26', payment: null, user });
});

test('resolveAccount отдаёт завершённый заказ Payme, если живого нет и это не код юзера', async (t) => {
  const finished = { id: 9, provider: 'payme', merchant_trans_id: 'SPCN26-1700000000000', status: 'paid' };
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async () => undefined);
  t.mock.method(usersRepo, 'findByCode', async () => undefined);
  t.mock.method(paymentsRepo, 'findLatestByProviderAndMerchantTransId', async () => finished);

  const resolved = await payme.resolveAccount({ merchant_trans_id: 'SPCN26-1700000000000' });

  assert.deepEqual(resolved, { merchantTransId: 'SPCN26-1700000000000', payment: finished, user: null });
});

test('resolveAccount возвращает null для заблокированного юзера и для неизвестного счёта', async (t) => {
  t.mock.method(paymentsRepo, 'findPendingByProviderAndMerchantTransId', async () => undefined);
  t.mock.method(paymentsRepo, 'findLatestByProviderAndMerchantTransId', async () => undefined);
  t.mock.method(usersRepo, 'findByCode', async (code) =>
    code === 'BLOCK1' ? { id: 2, code: 'BLOCK1', status: 'new', blocked_at: new Date(), deleted_at: null } : undefined
  );

  assert.equal(await payme.resolveAccount({ merchant_trans_id: 'BLOCK1' }), null);
  assert.equal(await payme.resolveAccount({ merchant_trans_id: 'NOPE99' }), null);
  assert.equal(await payme.resolveAccount({}), null);
  assert.equal(await payme.resolveAccount(null), null);
});
