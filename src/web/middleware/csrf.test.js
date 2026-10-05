const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const csrf = require('./csrf');

const TOKEN = crypto.randomBytes(32).toString('hex');

function makeReqRes({ method = 'POST', body = {}, session = {}, path = '/users/1/block', headers = {} } = {}) {
  const req = {
    method,
    body,
    session,
    path,
    originalUrl: `/admin${path}`,
    ip: '127.0.0.1',
    headers,
    get(name) {
      return headers[name.toLowerCase()] || headers[name];
    },
  };

  const res = {
    locals: { t: (key) => `t:${key}` },
    statusCode: 200,
    sent: null,
    json_: null,
    rendered: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    },
    json(payload) {
      this.json_ = payload;
      return this;
    },
    render(view, locals) {
      this.rendered = { view, locals };
      return this;
    },
  };

  return { req, res };
}

test('GET выдаёт токен в сессию и в res.locals и пропускает запрос', () => {
  const { req, res } = makeReqRes({ method: 'GET', path: '/login', session: {} });
  let nextCalled = false;

  csrf(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(typeof req.session.csrfToken, 'string');
  assert.equal(res.locals.csrfToken, req.session.csrfToken);
});

test('POST с совпадающим токеном проходит дальше', () => {
  const { req, res } = makeReqRes({ body: { _csrf: TOKEN }, session: { csrfToken: TOKEN } });
  let nextCalled = false;

  csrf(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(res.statusCode, 200);
});

test('POST без токена отклоняется с 403', () => {
  const { req, res } = makeReqRes({ body: {}, session: { csrfToken: TOKEN } });
  let nextCalled = false;

  csrf(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.sent, 't:csrf_error');
});

test('POST с токеном чужой длины отклоняется, а не роняет timingSafeEqual', () => {
  const { req, res } = makeReqRes({ body: { _csrf: 'abc' }, session: { csrfToken: TOKEN } });

  csrf(req, res, () => {
    throw new Error('не должно вызываться');
  });

  assert.equal(res.statusCode, 403);
});

test('fetch-запрос (XMLHttpRequest) получает JSON, а не текст', () => {
  const { req, res } = makeReqRes({
    body: {},
    session: { csrfToken: TOKEN },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  csrf(req, res, () => {
    throw new Error('не должно вызываться');
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json_, { ok: false, error: 't:csrf_error' });
});

test('на экране входа вместо голого 403 показывается форма логина с новым токеном', () => {
  // Потерянная сессия: токена в ней нет — ровно то, что видел админ при входе.
  const session = {};
  const { req, res } = makeReqRes({ path: '/login', body: { _csrf: TOKEN }, session });

  csrf(req, res, () => {
    throw new Error('не должно вызываться');
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'login');
  assert.equal(res.rendered.locals.error, 't:csrf_error');
  // Новый токен уже лежит в сессии и уедет в форму — повторная попытка входа сработает.
  assert.equal(res.locals.csrfToken, session.csrfToken);
});
