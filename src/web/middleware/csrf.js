const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Простая synchronizer-token защита от CSRF — без внешней библиотеки (csurf официально не
 * поддерживается уже несколько лет). Токен живёт в сессии; каждая POST-форма в админке несёт
 * его в скрытом поле _csrf (см. res.locals.csrfToken, доступен во всех view автоматически, как
 * и res.locals.t из adminLocale). Без него любой авторизованный админ, открыв вредоносную
 * страницу, мог бы неосознанно выполнить произвольное действие в панели — куки уходят
 * автоматически, а сессия живёт до ADMIN_SESSION_MAX_AGE_HOURS часов (см. app.js).
 */
module.exports = function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const submitted = req.body && req.body._csrf;
  const valid =
    typeof submitted === 'string' &&
    submitted.length === req.session.csrfToken.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(req.session.csrfToken));

  if (!valid) {
    // Форма промокодов (promoCodes/list.ejs) шлёт этот же POST через fetch() и ждёт JSON —
    // обычный res.send() текстом сломал бы её res.json()-парсинг, уводя в общий "ошибка сети".
    if (req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(403).json({ ok: false, error: 'Invalid CSRF token — обновите страницу и попробуйте снова.' });
    }
    return res.status(403).send('Invalid CSRF token — обновите страницу и попробуйте снова.');
  }

  return next();
};
