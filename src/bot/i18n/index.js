const ru = require('./ru');
const uz = require('./uz');

const dictionaries = { ru, uz };
const DEFAULT_LANG = 'ru';

/**
 * @param {string} lang 'ru' | 'uz'
 * @param {string} key ключ словаря
 * @param  {...any} args аргументы, если значение — функция (например, подстановка суммы)
 */
function t(lang, key, ...args) {
  const dict = dictionaries[lang] || dictionaries[DEFAULT_LANG];
  const entry = dict[key] !== undefined ? dict[key] : dictionaries[DEFAULT_LANG][key];

  if (entry === undefined) {
    return `[[missing:${key}]]`;
  }
  return typeof entry === 'function' ? entry(...args) : entry;
}

/**
 * Значение ключа сразу на всех языках — для bot.hears() по кнопкам меню, чтобы кнопка
 * срабатывала независимо от того, на каком языке она была показана юзеру.
 * @param {string} key
 * @returns {string[]}
 */
function allVariants(key) {
  return Object.values(dictionaries).map((dict) => dict[key]);
}

module.exports = { t, dictionaries, DEFAULT_LANG, allVariants };
