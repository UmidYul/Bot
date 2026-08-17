const express = require('express');
const bcrypt = require('bcryptjs');

const requireAuth = require('../middleware/requireAuth');
const adminsRepo = require('../../db/repositories/admins');
const usersRepo = require('../../db/repositories/users');
const paymentsRepo = require('../../db/repositories/payments');
const promoCodesRepo = require('../../db/repositories/promoCodes');
const adminLogsRepo = require('../../db/repositories/adminLogs');
const { revokeAccess } = require('../../services/accessService');

const router = express.Router();

// --- Авторизация ---

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/users');
  res.render('login', { title: 'Вход', error: null });
});

router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  const admin = login ? await adminsRepo.findByLogin(login) : null;

  const ok = admin && (await bcrypt.compare(password || '', admin.password_hash));
  if (!ok) {
    return res.render('login', { title: 'Вход', error: 'Неверный логин или пароль' });
  }

  req.session.adminId = admin.id;
  req.session.adminLogin = admin.login;
  res.redirect('/admin/users');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/', (req, res) => res.redirect('/admin/users'));

router.use(requireAuth);

router.use(async (req, res, next) => {
  res.locals.admin = { id: req.session.adminId, login: req.session.adminLogin };
  next();
});

async function logAdminAction(req, { action, targetUserId = null, meta = null }) {
  await adminLogsRepo.log({ adminId: req.session.adminId, action, targetUserId, meta });
}

// --- Пользователи ---

router.get('/users', async (req, res) => {
  const filters = { q: req.query.q || '', status: req.query.status || '' };
  const page = parseInt(req.query.page, 10) || 1;

  const { rows, pageCount } = await usersRepo.listUsers(filters, { page, pageSize: 20 });

  res.render('users/list', {
    title: 'Пользователи',
    active: 'users',
    users: rows,
    filters,
    page,
    pageCount,
    flash: req.query.flash || null,
  });
});

router.get('/users/:id', async (req, res) => {
  const user = await usersRepo.findById(req.params.id);
  if (!user) return res.status(404).send('Пользователь не найден');

  const payments = await paymentsRepo.listByUserId(user.id);

  res.render('users/detail', {
    title: `Пользователь ${user.code}`,
    active: 'users',
    user,
    payments,
    flash: req.query.flash || null,
  });
});

router.post('/payments/:id/status', async (req, res) => {
  const payment = await paymentsRepo.findById(req.params.id);
  if (!payment) return res.status(404).send('Платёж не найден');

  const { status } = req.body;
  if (!['pending', 'paid', 'failed'].includes(status)) {
    return res.status(400).send('Некорректный статус');
  }

  if (status === 'paid') await paymentsRepo.markPaid(payment.id);
  else if (status === 'failed') await paymentsRepo.markFailed(payment.id);
  else await paymentsRepo.setStatus(payment.id, 'pending');

  await logAdminAction(req, {
    action: 'payment_status_change',
    targetUserId: payment.user_id,
    meta: { paymentId: payment.id, from: payment.status, to: status },
  });

  res.redirect(`/admin/users/${payment.user_id}?flash=${encodeURIComponent('Статус платежа обновлён')}`);
});

router.post('/users/:id/block', async (req, res) => {
  const user = await usersRepo.findById(req.params.id);
  if (!user) return res.status(404).send('Пользователь не найден');

  await usersRepo.blockUser(user.id);
  await revokeAccess(user);
  await logAdminAction(req, { action: 'user_block', targetUserId: user.id });

  res.redirect(`/admin/users/${user.id}?flash=${encodeURIComponent('Пользователь заблокирован')}`);
});

router.post('/users/:id/unblock', async (req, res) => {
  const user = await usersRepo.findById(req.params.id);
  if (!user) return res.status(404).send('Пользователь не найден');

  await usersRepo.unblockUser(user.id);
  await logAdminAction(req, { action: 'user_unblock', targetUserId: user.id });

  res.redirect(`/admin/users/${user.id}?flash=${encodeURIComponent('Пользователь разблокирован')}`);
});

// --- Промокоды ---

router.get('/promo-codes', async (req, res) => {
  const promoCodes = await promoCodesRepo.listAll();
  res.render('promoCodes/list', {
    title: 'Промокоды',
    active: 'promo-codes',
    promoCodes,
    flash: req.query.flash || null,
  });
});

router.get('/promo-codes/new', (req, res) => {
  res.render('promoCodes/form', {
    title: 'Новый промокод',
    active: 'promo-codes',
    promoCode: null,
    values: { type: 'percent', value: 0 },
    error: null,
  });
});

function validatePromoInput(body) {
  const errors = [];
  const code = (body.code || '').trim().toUpperCase();
  const type = body.type;
  const value = parseFloat(body.value || '0');
  const maxUses = body.max_uses ? parseInt(body.max_uses, 10) : null;
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

  if (!code) errors.push('Код обязателен');
  if (!['percent', 'fixed', 'free'].includes(type)) errors.push('Некорректный тип');
  if (type === 'percent' && (value < 1 || value > 100)) errors.push('Процент должен быть от 1 до 100');
  if (type === 'fixed' && value < 0) errors.push('Сумма не может быть отрицательной');
  if (expiresAt && expiresAt.getTime() < Date.now() && !body._editing) {
    errors.push('Дата истечения не может быть в прошлом');
  }

  return { errors, code, type, value, maxUses, expiresAt };
}

router.post('/promo-codes/new', async (req, res) => {
  const { errors, code, type, value, maxUses, expiresAt } = validatePromoInput(req.body);

  const existing = code ? await promoCodesRepo.findByCode(code) : null;
  if (existing) errors.push('Промокод с таким кодом уже существует');

  if (errors.length) {
    return res.render('promoCodes/form', {
      title: 'Новый промокод',
      active: 'promo-codes',
      promoCode: null,
      values: req.body,
      error: errors.join('; '),
    });
  }

  const promo = await promoCodesRepo.create({ code, type, value, maxUses, expiresAt, isActive: true });
  await logAdminAction(req, { action: 'promo_code_create', meta: { promoCodeId: promo.id, code } });

  res.redirect(`/admin/promo-codes?flash=${encodeURIComponent('Промокод создан')}`);
});

router.get('/promo-codes/:id/edit', async (req, res) => {
  const promoCode = await promoCodesRepo.findById(req.params.id);
  if (!promoCode) return res.status(404).send('Промокод не найден');

  res.render('promoCodes/form', {
    title: 'Редактирование промокода',
    active: 'promo-codes',
    promoCode,
    values: {
      code: promoCode.code,
      type: promoCode.type,
      value: promoCode.value,
      max_uses: promoCode.max_uses,
      expires_at: promoCode.expires_at ? new Date(promoCode.expires_at).toISOString().slice(0, 10) : '',
      is_active: promoCode.is_active,
    },
    error: null,
  });
});

router.post('/promo-codes/:id/edit', async (req, res) => {
  const promoCode = await promoCodesRepo.findById(req.params.id);
  if (!promoCode) return res.status(404).send('Промокод не найден');

  const { errors, code, type, value, maxUses, expiresAt } = validatePromoInput({ ...req.body, _editing: true });

  const existing = code ? await promoCodesRepo.findByCode(code) : null;
  if (existing && existing.id !== promoCode.id) errors.push('Промокод с таким кодом уже существует');

  if (errors.length) {
    return res.render('promoCodes/form', {
      title: 'Редактирование промокода',
      active: 'promo-codes',
      promoCode,
      values: req.body,
      error: errors.join('; '),
    });
  }

  const isActive = req.body.is_active === '1';
  await promoCodesRepo.update(promoCode.id, { code, type, value, maxUses, expiresAt, isActive });
  await logAdminAction(req, {
    action: 'promo_code_update',
    meta: { promoCodeId: promoCode.id, code, isActive },
  });

  res.redirect(`/admin/promo-codes?flash=${encodeURIComponent('Промокод сохранён')}`);
});

// --- Логи ---

const LOG_ACTIONS = [
  'payment_status_change',
  'user_block',
  'user_unblock',
  'promo_code_create',
  'promo_code_update',
  'join_request_auto',
];

router.get('/logs', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const action = req.query.action || '';
  const adminId = req.query.admin_id ? parseInt(req.query.admin_id, 10) : '';

  const { rows, pageCount } = await adminLogsRepo.list({
    action: action || undefined,
    adminId: adminId || undefined,
    page,
    pageSize: 30,
  });
  const admins = await adminsRepo.listAll();

  res.render('logs/list', {
    title: 'Логи',
    active: 'logs',
    logs: rows,
    actions: LOG_ACTIONS,
    admins,
    filters: { action, admin_id: adminId },
    page,
    pageCount,
  });
});

module.exports = router;
