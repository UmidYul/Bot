const express = require('express');
const bcrypt = require('bcryptjs');

const requireAuth = require('../middleware/requireAuth');
const adminLocale = require('../middleware/adminLocale');
const asyncHandler = require('../middleware/asyncHandler');
const adminsRepo = require('../../db/repositories/admins');
const usersRepo = require('../../db/repositories/users');
const paymentsRepo = require('../../db/repositories/payments');
const promoCodesRepo = require('../../db/repositories/promoCodes');
const adminLogsRepo = require('../../db/repositories/adminLogs');
const settingsService = require('../../services/settingsService');
const { revokeAccess } = require('../../services/accessService');

const router = express.Router();

router.use(adminLocale);

// --- Язык интерфейса админки ---

router.get('/lang/:lang', (req, res) => {
  if (adminLocale.SUPPORTED.includes(req.params.lang)) {
    req.session.adminLang = req.params.lang;
  }
  res.redirect(req.get('Referer') || '/admin/users');
});

// --- Авторизация ---

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/users');
  res.render('login', { title: res.locals.t('login_title'), error: null });
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { login, password } = req.body;
    const admin = login ? await adminsRepo.findByLogin(login) : null;

    const ok = admin && (await bcrypt.compare(password || '', admin.password_hash));
    if (!ok) {
      return res.render('login', { title: res.locals.t('login_title'), error: res.locals.t('login_error') });
    }

    req.session.adminId = admin.id;
    req.session.adminLogin = admin.login;
    res.redirect('/admin/users');
  })
);

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

function flashUrl(base, key) {
  return `${base}?flash=${encodeURIComponent(key)}`;
}

// --- Пользователи ---

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const filters = { q: req.query.q || '', status: req.query.status || '' };
    const page = parseInt(req.query.page, 10) || 1;

    const { rows, pageCount } = await usersRepo.listUsers(filters, { page, pageSize: 20 });

    res.render('users/list', {
      title: res.locals.t('users_title'),
      active: 'users',
      users: rows,
      filters,
      page,
      pageCount,
      flash: req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
    });
  })
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    const payments = await paymentsRepo.listByUserId(user.id);

    res.render('users/detail', {
      title: res.locals.t('user_detail_title', user.code),
      active: 'users',
      user,
      payments,
      flash: req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
    });
  })
);

router.post(
  '/payments/:id/status',
  asyncHandler(async (req, res) => {
    const payment = await paymentsRepo.findById(req.params.id);
    if (!payment) return res.status(404).send(res.locals.t('error_payment_not_found'));

    const { status } = req.body;
    if (!['pending', 'paid', 'failed'].includes(status)) {
      return res.status(400).send(res.locals.t('error_invalid_status'));
    }

    if (status === 'paid') await paymentsRepo.markPaid(payment.id);
    else if (status === 'failed') await paymentsRepo.markFailed(payment.id);
    else await paymentsRepo.setStatus(payment.id, 'pending');

    await logAdminAction(req, {
      action: 'payment_status_change',
      targetUserId: payment.user_id,
      meta: { paymentId: payment.id, from: payment.status, to: status },
    });

    res.redirect(flashUrl(`/admin/users/${payment.user_id}`, 'payment_status_updated'));
  })
);

router.post(
  '/users/:id/block',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    await usersRepo.blockUser(user.id);
    await revokeAccess(user);
    await logAdminAction(req, { action: 'user_block', targetUserId: user.id });

    res.redirect(flashUrl(`/admin/users/${user.id}`, 'user_blocked'));
  })
);

router.post(
  '/users/:id/unblock',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    await usersRepo.unblockUser(user.id);
    await logAdminAction(req, { action: 'user_unblock', targetUserId: user.id });

    res.redirect(flashUrl(`/admin/users/${user.id}`, 'user_unblocked'));
  })
);

// --- Промокоды ---

router.get(
  '/promo-codes',
  asyncHandler(async (req, res) => {
    const promoCodes = await promoCodesRepo.listAll();
    res.render('promoCodes/list', {
      title: res.locals.t('promo_title'),
      active: 'promo-codes',
      promoCodes,
      flash: req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
    });
  })
);

router.get('/promo-codes/new', (req, res) => {
  res.render('promoCodes/form', {
    title: res.locals.t('promo_form_title_new'),
    active: 'promo-codes',
    promoCode: null,
    values: { type: 'percent', value: 0 },
    error: null,
  });
});

function validatePromoInput(body, t) {
  const errors = [];
  const code = (body.code || '').trim().toUpperCase();
  const type = body.type;
  const value = parseFloat(body.value || '0');
  const maxUses = body.max_uses ? parseInt(body.max_uses, 10) : null;
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

  if (!code) errors.push(t('error_code_required'));
  if (!['percent', 'fixed', 'free'].includes(type)) errors.push(t('error_invalid_type'));
  if (type === 'percent' && (value < 1 || value > 100)) errors.push(t('error_percent_range'));
  if (type === 'fixed' && value < 0) errors.push(t('error_negative_amount'));
  if (expiresAt && expiresAt.getTime() < Date.now() && !body._editing) {
    errors.push(t('error_expires_in_past'));
  }

  return { errors, code, type, value, maxUses, expiresAt };
}

router.post(
  '/promo-codes/new',
  asyncHandler(async (req, res) => {
    const { errors, code, type, value, maxUses, expiresAt } = validatePromoInput(req.body, res.locals.t);

    const existing = code ? await promoCodesRepo.findByCode(code) : null;
    if (existing) errors.push(res.locals.t('error_code_taken'));

    if (errors.length) {
      return res.render('promoCodes/form', {
        title: res.locals.t('promo_form_title_new'),
        active: 'promo-codes',
        promoCode: null,
        values: req.body,
        error: errors.join('; '),
      });
    }

    const promo = await promoCodesRepo.create({ code, type, value, maxUses, expiresAt, isActive: true });
    await logAdminAction(req, { action: 'promo_code_create', meta: { promoCodeId: promo.id, code } });

    res.redirect(flashUrl('/admin/promo-codes', 'promo_created'));
  })
);

router.get(
  '/promo-codes/:id/edit',
  asyncHandler(async (req, res) => {
    const promoCode = await promoCodesRepo.findById(req.params.id);
    if (!promoCode) return res.status(404).send(res.locals.t('error_promo_not_found'));

    res.render('promoCodes/form', {
      title: res.locals.t('promo_form_title_edit'),
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
  })
);

router.post(
  '/promo-codes/:id/edit',
  asyncHandler(async (req, res) => {
    const promoCode = await promoCodesRepo.findById(req.params.id);
    if (!promoCode) return res.status(404).send(res.locals.t('error_promo_not_found'));

    const { errors, code, type, value, maxUses, expiresAt } = validatePromoInput({ ...req.body, _editing: true }, res.locals.t);

    const existing = code ? await promoCodesRepo.findByCode(code) : null;
    if (existing && existing.id !== promoCode.id) errors.push(res.locals.t('error_code_taken'));

    if (errors.length) {
      return res.render('promoCodes/form', {
        title: res.locals.t('promo_form_title_edit'),
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

    res.redirect(flashUrl('/admin/promo-codes', 'promo_updated'));
  })
);

// --- Логи ---

const LOG_ACTIONS = [
  'payment_status_change',
  'user_block',
  'user_unblock',
  'promo_code_create',
  'promo_code_update',
  'join_request_auto',
  'settings_update',
];

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
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
      title: res.locals.t('logs_title'),
      active: 'logs',
      logs: rows,
      actions: LOG_ACTIONS,
      admins,
      filters: { action, admin_id: adminId },
      page,
      pageCount,
    });
  })
);

// --- Настройки ---

router.get('/settings', (req, res) => {
  res.render('settings', {
    title: res.locals.t('settings_title'),
    active: 'settings',
    values: settingsService.getCurrent(),
    error: null,
    flash: req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
  });
});

router.post(
  '/settings',
  asyncHandler(async (req, res) => {
    try {
      const applied = await settingsService.updateFromForm(req.body);
      await logAdminAction(req, { action: 'settings_update', meta: applied });
      res.redirect(flashUrl('/admin/settings', 'settings_saved'));
    } catch (err) {
      res.render('settings', {
        title: res.locals.t('settings_title'),
        active: 'settings',
        values: { ...settingsService.getCurrent(), ...req.body },
        error: err.message,
        flash: null,
      });
    }
  })
);

module.exports = router;
