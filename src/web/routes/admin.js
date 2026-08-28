const express = require('express');
const bcrypt = require('bcryptjs');

const config = require('../../config');
const requireAuth = require('../middleware/requireAuth');
const adminLocale = require('../middleware/adminLocale');
const csrf = require('../middleware/csrf');
const asyncHandler = require('../middleware/asyncHandler');
const adminsRepo = require('../../db/repositories/admins');
const usersRepo = require('../../db/repositories/users');
const paymentsRepo = require('../../db/repositories/payments');
const promoCodesRepo = require('../../db/repositories/promoCodes');
const adminLogsRepo = require('../../db/repositories/adminLogs');
const settingsService = require('../../services/settingsService');
const { revokeAccess, grantAccess } = require('../../services/accessService');
const broadcastService = require('../../services/broadcastService');
const { notifyAdmins, notifyAdminLoginLockout } = require('../../services/adminNotifyService');

const router = express.Router();

router.use(adminLocale);
router.use(csrf);

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

    // Защита от подбора пароля: аккаунт временно заблокирован после N неверных паролей
    // подряд (см. config.adminLoginAntiSpam) — не проверяем пароль вообще, пока не истечёт
    // блокировка.
    if (admin && admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.render('login', { title: res.locals.t('login_title'), error: res.locals.t('login_locked') });
    }

    const ok = admin && (await bcrypt.compare(password || '', admin.password_hash));
    if (!ok) {
      if (admin) {
        const { locked } = await adminsRepo.recordFailedLogin(
          admin.id,
          config.adminLoginAntiSpam.maxAttempts,
          config.adminLoginAntiSpam.lockoutMinutes
        );
        if (locked) await notifyAdminLoginLockout(admin.login, req.ip);
      }
      return res.render('login', { title: res.locals.t('login_title'), error: res.locals.t('login_error') });
    }

    await adminsRepo.resetFailedLogins(admin.id);

    // Защита от session fixation: до логина сессия уже могла существовать (например, юзер
    // переключил язык на экране логина — /admin/lang/:lang создаёт сессию до всякой
    // аутентификации), и её id мог быть заранее известен атакующему (подсунут жертве через
    // ссылку/куку). regenerate() выдаёт НОВЫЙ session id при успешном логине — старый (если
    // кто-то его знал) больше ни на что не годен. adminLang переносим вручную, иначе выбор
    // языка на экране логина слетел бы после входа.
    const adminLang = req.session.adminLang;
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.adminId = admin.id;
    req.session.adminLogin = admin.login;
    if (adminLang) req.session.adminLang = adminLang;
    res.redirect('/admin/users');
  })
);

// POST, а не GET: логаут меняет состояние (уничтожает сессию) — GET-ссылку можно было бы
// незаметно для админа дёрнуть с чужой страницы (img src, prefetch и т.п.), теперь этот
// запрос требует CSRF-токен, как и остальные мутирующие действия в панели (см. csrf.js).
router.post('/logout', (req, res) => {
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
    const filters = { q: req.query.q || '', status: req.query.status || '', deleted: req.query.deleted === '1' };
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

async function renderUserDetail(req, res, user, { error = null, flash = undefined } = {}) {
  const payments = await paymentsRepo.listByUserId(user.id);
  const { rows: activity } = await adminLogsRepo.list({ targetUserId: user.id, page: 1, pageSize: 20 });

  res.render('users/detail', {
    title: res.locals.t('user_detail_title', user.code),
    active: 'users',
    user,
    payments,
    activity,
    error,
    flash: flash !== undefined ? flash : req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
  });
}

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    await renderUserDetail(req, res, user);
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

router.post(
  '/users/:id/delete',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    await usersRepo.deleteUser(user.id);
    await logAdminAction(req, { action: 'user_delete', targetUserId: user.id });

    res.redirect(flashUrl('/admin/users', 'user_deleted'));
  })
);

router.post(
  '/users/:id/restore',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    await usersRepo.restoreUser(user.id);
    await logAdminAction(req, { action: 'user_restore', targetUserId: user.id });

    res.redirect(flashUrl(`/admin/users/${user.id}`, 'user_restored'));
  })
);

router.post(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const user = await usersRepo.findById(req.params.id);
    if (!user) return res.status(404).send(res.locals.t('error_user_not_found'));

    const newStatus = req.body.status;
    if (!['new', 'pending', 'paid'].includes(newStatus)) {
      return res.status(400).send(res.locals.t('error_invalid_status'));
    }

    const fromStatus = user.status;

    if (newStatus === 'paid' && fromStatus !== 'paid') {
      // Ручная выдача доступа без реального платежа — фиксируем это отдельной записью
      // (provider='admin', amount=0) для аудита, точно так же, как любую другую оплату.
      const merchantTransId = `${user.code}-admin-${Date.now()}`;
      const payment = await paymentsRepo.createPayment({
        userId: user.id,
        provider: 'admin',
        amount: 0,
        merchantTransId,
        status: 'paid',
      });
      await paymentsRepo.markPaid(payment.id);
      // Ручная выдача обходит вебхуки Click/Payme, которые сами обнуляют users.balance при
      // достижении порога (см. balanceService.js) — без этого "зависший" баланс от прежней
      // недоплаты остался бы висеть на юзере, которому только что выдали доступ вручную.
      await usersRepo.setBalance(user.id, 0);
    }

    const updated = await usersRepo.updateStatus(user.id, newStatus);
    await logAdminAction(req, {
      action: 'user_status_override',
      targetUserId: user.id,
      meta: { from: fromStatus, to: newStatus },
    });

    if (newStatus === 'paid' && fromStatus !== 'paid') {
      await grantAccess(updated);
    }

    res.redirect(flashUrl(`/admin/users/${user.id}`, 'user_status_updated'));
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

function isAjax(req) {
  return req.get('X-Requested-With') === 'XMLHttpRequest';
}

router.post(
  '/promo-codes/new',
  asyncHandler(async (req, res) => {
    const { errors, code, type, value, maxUses, expiresAt } = validatePromoInput(req.body, res.locals.t);

    const existing = code ? await promoCodesRepo.findByCode(code) : null;
    if (existing) errors.push(res.locals.t('error_code_taken'));

    if (errors.length) {
      const error = errors.join('; ');
      if (isAjax(req)) return res.status(400).json({ ok: false, error });
      return res.render('promoCodes/form', {
        title: res.locals.t('promo_form_title_new'),
        active: 'promo-codes',
        promoCode: null,
        values: req.body,
        error,
      });
    }

    const promo = await promoCodesRepo.create({ code, type, value, maxUses, expiresAt, isActive: true });
    await logAdminAction(req, { action: 'promo_code_create', meta: { promoCodeId: promo.id, code } });

    const redirect = flashUrl('/admin/promo-codes', 'promo_created');
    if (isAjax(req)) return res.json({ ok: true, redirect });
    res.redirect(redirect);
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
      const error = errors.join('; ');
      if (isAjax(req)) return res.status(400).json({ ok: false, error });
      return res.render('promoCodes/form', {
        title: res.locals.t('promo_form_title_edit'),
        active: 'promo-codes',
        promoCode,
        values: req.body,
        error,
      });
    }

    const isActive = req.body.is_active === '1';
    await promoCodesRepo.update(promoCode.id, { code, type, value, maxUses, expiresAt, isActive });
    await logAdminAction(req, {
      action: 'promo_code_update',
      meta: { promoCodeId: promoCode.id, code, isActive },
    });

    const redirect = flashUrl('/admin/promo-codes', 'promo_updated');
    if (isAjax(req)) return res.json({ ok: true, redirect });
    res.redirect(redirect);
  })
);

router.post(
  '/promo-codes/:id/toggle',
  asyncHandler(async (req, res) => {
    const promoCode = await promoCodesRepo.findById(req.params.id);
    if (!promoCode) return res.status(404).send(res.locals.t('error_promo_not_found'));

    const updated = await promoCodesRepo.update(promoCode.id, { isActive: !promoCode.is_active });
    await logAdminAction(req, {
      action: 'promo_code_toggle',
      meta: { promoCodeId: promoCode.id, code: promoCode.code, isActive: updated.is_active },
    });

    res.redirect(flashUrl('/admin/promo-codes', updated.is_active ? 'promo_activated' : 'promo_deactivated'));
  })
);

// --- Логи ---

const LOG_ACTIONS = [
  'payment_status_change',
  'user_block',
  'user_unblock',
  'user_delete',
  'user_restore',
  'user_status_override',
  'promo_code_create',
  'promo_code_update',
  'promo_code_toggle',
  'join_request_auto',
  'settings_update',
  'broadcast_sent',
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

// --- Рассылка ---

async function renderBroadcastForm(req, res, { error = null, values = {} } = {}) {
  const [totalActive, totalAll] = await Promise.all([
    usersRepo.countForBroadcast({ excludeBlocked: true }),
    usersRepo.countForBroadcast({ excludeBlocked: false }),
  ]);

  res.render('broadcast', {
    title: res.locals.t('broadcast_title'),
    active: 'broadcast',
    totalActive,
    totalAll,
    values,
    error,
    flash: req.query.flash ? res.locals.t(`flash_${req.query.flash}`) : null,
  });
}

router.get(
  '/broadcast',
  asyncHandler(async (req, res) => {
    await renderBroadcastForm(req, res);
  })
);

router.post(
  '/broadcast',
  asyncHandler(async (req, res) => {
    const textRu = (req.body.text_ru || '').trim();
    const textUz = (req.body.text_uz || '').trim();
    const excludeBlocked = req.body.exclude_blocked === 'on';

    if (!textRu || !textUz) {
      return renderBroadcastForm(req, res, {
        error: res.locals.t('error_broadcast_text_required'),
        values: { text_ru: textRu, text_uz: textUz, exclude_blocked: excludeBlocked },
      });
    }

    const recipientCount = await usersRepo.countForBroadcast({ excludeBlocked });
    await logAdminAction(req, {
      action: 'broadcast_sent',
      meta: { excludeBlocked, recipientCount, textRuLength: textRu.length, textUzLength: textUz.length },
    });

    // Не ждём завершения рассылки внутри HTTP-запроса — при большой базе и троттлинге
    // ~20 сообщений/с это может занять минуты, а админка должна остаться отзывчивой.
    // Итог придёт админам отдельным сообщением в боте (см. ADMIN_NOTIFY_CHAT_IDS).
    broadcastService
      .broadcastMessage({ ru: textRu, uz: textUz }, { excludeBlocked })
      .then((summary) => {
        console.log(`Рассылка завершена: ${summary.sent}/${summary.total} доставлено, ${summary.failed} ошибок`);
        return notifyAdmins(
          `📣 <b>Рассылка завершена</b>\nДоставлено: ${summary.sent}/${summary.total}` +
            (summary.failed ? `\nОшибок: ${summary.failed}` : '')
        );
      })
      .catch((err) => console.error('broadcast: непредвиденная ошибка рассылки:', err));

    res.redirect(flashUrl('/admin/broadcast', 'broadcast_started'));
  })
);

// --- Настройки ---

router.get('/settings', (req, res) => {
  res.render('settings', {
    title: res.locals.t('settings_title'),
    active: 'settings',
    values: settingsService.getCurrent(),
    accountValues: { login: res.locals.admin.login },
    error: null,
    accountError: null,
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
        accountValues: { login: res.locals.admin.login },
        error: err.message,
        accountError: null,
        flash: null,
      });
    }
  })
);

// --- Мой аккаунт (логин/пароль самого админа) ---

router.post(
  '/account',
  asyncHandler(async (req, res) => {
    const admin = await adminsRepo.findById(req.session.adminId);
    const { current_password, login, password, password_confirm } = req.body;
    const newLogin = (login || '').trim();

    const renderError = (accountError) =>
      res.render('settings', {
        title: res.locals.t('settings_title'),
        active: 'settings',
        values: settingsService.getCurrent(),
        accountValues: { login: newLogin || admin.login },
        error: null,
        accountError,
        flash: null,
      });

    // Смена логина/пароля требует текущий пароль — иначе угнанная сессия админа (например,
    // оставленный открытым браузер) позволила бы захватить аккаунт навсегда, просто сменив
    // логин/пароль без дополнительного подтверждения.
    if (!(await bcrypt.compare(current_password || '', admin.password_hash))) {
      return renderError(res.locals.t('account_error_wrong_password'));
    }
    if (!newLogin) {
      return renderError(res.locals.t('account_error_login_empty'));
    }
    if (newLogin !== admin.login) {
      const existing = await adminsRepo.findByLogin(newLogin);
      if (existing) return renderError(res.locals.t('account_error_login_taken'));
    }

    let passwordHash;
    if (password) {
      if (password.length < 8) return renderError(res.locals.t('account_error_password_short'));
      if (password !== password_confirm) return renderError(res.locals.t('account_error_password_mismatch'));
      passwordHash = await bcrypt.hash(password, 10);
    }

    await adminsRepo.updateCredentials(admin.id, { login: newLogin, passwordHash });
    await logAdminAction(req, {
      action: 'admin_credentials_change',
      meta: { from_login: admin.login, to_login: newLogin, password_changed: Boolean(passwordHash) },
    });

    // Логин в сессии обновляем сразу — иначе шапка/аудит-лог показывали бы старый логин до
    // следующего входа, хотя в БД он уже сменился.
    req.session.adminLogin = newLogin;
    res.redirect(flashUrl('/admin/settings', 'account_updated'));
  })
);

module.exports = router;
