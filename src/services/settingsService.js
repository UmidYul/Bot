const config = require('../config');
const settingsRepo = require('../db/repositories/settings');

function parseCheckbox(raw) {
  return raw === true || raw === 'true' || raw === '1' || raw === 'on';
}

/**
 * Настройки, управляемые из админки (не секреты — токены/ключи остаются в .env).
 * Каждая запись: где хранится в settings-таблице, куда пишется в живой config-объект,
 * и как парсить значение из строки формы.
 *
 * config — синглтон (Node кеширует require()), все модули обращаются к его полям как
 * config.channelPrice / config.payme.enabled и т.д. в момент использования, а не один раз
 * при импорте — поэтому мутация полей этого объекта применяется во всём приложении
 * немедленно, без перезапуска процесса.
 */
const DEFINITIONS = {
  channel_price: {
    get: () => config.channelPrice,
    set: (v) => {
      config.channelPrice = v;
    },
    parse: (raw) => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error('Цена должна быть неотрицательным числом');
      return n;
    },
  },
  channel_invite_link: {
    get: () => config.channelInviteLink,
    set: (v) => {
      config.channelInviteLink = v;
    },
    parse: (raw) => String(raw || '').trim(),
  },
  channel_id: {
    get: () => config.channelId,
    set: (v) => {
      config.channelId = v;
    },
    parse: (raw) => String(raw || '').trim(),
  },
  payme_enabled: {
    type: 'checkbox',
    get: () => config.payme.enabled,
    set: (v) => {
      config.payme.enabled = v;
    },
    parse: parseCheckbox,
  },
  uzumbank_enabled: {
    type: 'checkbox',
    get: () => config.uzumbank.enabled,
    set: (v) => {
      config.uzumbank.enabled = v;
    },
    parse: parseCheckbox,
  },
  paynet_enabled: {
    type: 'checkbox',
    get: () => config.paynet.enabled,
    set: (v) => {
      config.paynet.enabled = v;
    },
    parse: parseCheckbox,
  },
  promo_max_attempts: {
    get: () => config.promoAntiSpam.maxAttempts,
    set: (v) => {
      config.promoAntiSpam.maxAttempts = v;
    },
    parse: (raw) => {
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1) throw new Error('Лимит попыток должен быть целым числом от 1');
      return n;
    },
  },
  promo_lockout_minutes: {
    get: () => config.promoAntiSpam.lockoutMinutes,
    set: (v) => {
      config.promoAntiSpam.lockoutMinutes = v;
    },
    parse: (raw) => {
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1) throw new Error('Время блокировки должно быть целым числом минут от 1');
      return n;
    },
  },
  admin_notify_chat_ids: {
    get: () => config.adminNotifyChatIds,
    set: (v) => {
      config.adminNotifyChatIds = v;
    },
    parse: (raw) =>
      String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  },
};

/** Читает settings из БД и применяет поверх дефолтов из .env — вызывается один раз при старте. */
async function loadIntoConfig() {
  const stored = await settingsRepo.getAll();
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    if (stored[key] !== undefined) def.set(stored[key]);
  }
}

/** Текущие значения настроек в виде, удобном для формы админки. */
function getCurrent() {
  const result = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) result[key] = def.get();
  return result;
}

/**
 * Парсит и применяет патч из формы (req.body) — сразу и в БД, и в живой config.
 * @param {Record<string, string>} rawFormValues
 * @returns {Record<string, any>} применённые значения (для лога)
 */
async function updateFromForm(rawFormValues) {
  const applied = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    // Невыставленный чекбокс вообще не приходит в теле формы — это всё равно валидное
    // "выключено", а не "не трогать", поэтому чекбоксы обрабатываем всегда.
    if (!(key in rawFormValues) && def.type !== 'checkbox') continue;
    const value = def.parse(rawFormValues[key]);
    def.set(value);
    await settingsRepo.set(key, value);
    applied[key] = value;
  }
  return applied;
}

module.exports = { loadIntoConfig, getCurrent, updateFromForm, DEFINITIONS };
