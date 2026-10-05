const crypto = require('crypto');

const { logToFile } = require('../../utils/webhookLogger');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Простая synchronizer-token защита от CSRF — без внешней библиотеки (csurf официально не
 * поддерживается уже несколько лет). Токен живёт в сессии; каждая POST-форма в админке несёт
 * его в скрытом поле _csrf (см. res.locals.csrfToken, доступен во всех view автоматически, как
 * и res.locals.t из adminLocale). Без него любой авторизованный админ, открыв вредоносную
 * страницу, мог бы неосознанно выполнить произвольное действие в панели — куки уходят
 * автоматически, а сессия живёт до ADMIN_SESSION_MAX_AGE_HOURS часов (см. app.js).
 *
 * Важно: этот механизм целиком держится на том, что сессия ПЕРЕЖИВАЕТ переход между
 * запросами (кука `sid` дошла до браузера и вернулась, запись в таблице `session` есть).
 * Если сессия теряется, токен из формы всегда сравнивается с токеном уже другой, свежей
 * сессии — и админ видит "Invalid CSRF token" на самом первом POST, то есть при входе.
 * Поэтому каждая неудачная проверка пишется в лог с признаками, по которым видно причину
 * (пришла ли вообще кука сессии, был ли токен в форме) — см. logs/webhooks.log.
 */
module.exports = function csrf(req, res, next) {
  // Токена в сессии нет → сессия только что создана (или потеряна вместе с кукой). Для
  // GET это норма (первый заход на /admin/login), для POST — прямой признак того, что
  // сессия не пережила переход между запросами.
  const sessionWasEmpty = !req.session.csrfToken;
  if (sessionWasEmpty) {
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
    logToFile('csrf', `${req.method} ${req.originalUrl} — отклонён: неверный CSRF-токен`, {
      ip: req.ip,
      // Токены целиком в лог не пишем — по факту наличия/длины и так видно, что произошло.
      token_submitted: typeof submitted === 'string' ? `len=${submitted.length}` : null,
      // Кука сессии не пришла вовсе → браузер её не получил или не хранит: почти всегда это
      // secure-кука за прокси без trust proxy (см. config.trustProxy), а не реальная атака.
      session_cookie_sent: Boolean(req.headers.cookie && /(?:^|;\s*)sid=/.test(req.headers.cookie)),
      // Сессия пришла без токена → та, что выдала токен формы, не сохранилась в
      // хранилище или потерялась вместе с кукой.
      session_without_token: sessionWasEmpty,
    });

    // Форма промокодов (promoCodes/list.ejs) шлёт этот же POST через fetch() и ждёт JSON —
    // обычный res.send() текстом сломал бы её res.json()-парсинг, уводя в общий "ошибка сети".
    if (req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(403).json({ ok: false, error: res.locals.t('csrf_error') });
    }

    // На экране входа голый текст 403 выглядел как поломка сайта: админ упирался в белую
    // страницу и не мог даже повторить попытку. Отдаём ту же форму логина с новым токеном —
    // достаточно ввести логин/пароль ещё раз.
    if (req.path === '/login') {
      return res.status(403).render('login', {
        title: res.locals.t('login_title'),
        error: res.locals.t('csrf_error'),
      });
    }

    return res.status(403).send(res.locals.t('csrf_error'));
  }

  return next();
};
