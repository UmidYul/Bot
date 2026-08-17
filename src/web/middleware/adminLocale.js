const { t } = require('../i18n');

const SUPPORTED = ['ru', 'uz'];

/** Определяет язык админки из сессии и кладёт t()/lang в res.locals для всех EJS-вьюх. */
module.exports = function adminLocale(req, res, next) {
  const lang = SUPPORTED.includes(req.session.adminLang) ? req.session.adminLang : 'ru';
  req.adminLang = lang;
  res.locals.lang = lang;
  res.locals.t = (key, ...args) => t(lang, key, ...args);
  next();
};

module.exports.SUPPORTED = SUPPORTED;
