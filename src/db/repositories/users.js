const db = require('../index');
const { generateUniqueUserCode } = require('../../services/codeGenerator');

/**
 * onConflict/ignore — вместо простого insert: два почти одновременных апдейта от одного и
 * того же нового юзера (двойной тап по /start, повторная доставка апдейта телеграмом) оба
 * проходят ensureUser с telegram_id, которого ещё нет в БД, и оба вызывают createUser —
 * без onConflict второй insert падает с 23505 (users_telegram_id_unique) и роняет обработчик.
 */
async function createUser({ telegramId, username }) {
  const code = await generateUniqueUserCode(db);
  const [user] = await db('users')
    .insert({
      telegram_id: telegramId,
      username: username || null,
      code,
      status: 'new',
      language: 'uz',
    })
    .onConflict('telegram_id')
    .ignore()
    .returning('*');
  return user || findByTelegramId(telegramId);
}

function findByTelegramId(telegramId) {
  return db('users').where({ telegram_id: telegramId }).first();
}

function findById(id) {
  return db('users').where({ id }).first();
}

function findByCode(code) {
  return db('users').where({ code: code.toUpperCase() }).first();
}

async function updateStatus(id, status) {
  const [user] = await db('users')
    .where({ id })
    .update({ status, updated_at: db.fn.now() })
    .returning('*');
  return user;
}

function updateLanguage(id, language) {
  return db('users').where({ id }).update({ language, updated_at: db.fn.now() });
}

function updatePhone(id, phone) {
  return db('users').where({ id }).update({ phone, updated_at: db.fn.now() });
}

function updateUsername(id, username) {
  return db('users').where({ id }).update({ username, updated_at: db.fn.now() });
}

/**
 * Бан — отдельное поле, а не значение status. Блокировка/разблокировка НЕ трогает
 * жизненный цикл оплаты (new/pending/paid): заблокировали paid-юзера — после разблокировки
 * он снова paid, а не 'new' (это и была причина бага "статус new после разблокировки").
 */
async function blockUser(id) {
  const [user] = await db('users')
    .where({ id })
    .update({ blocked_at: db.fn.now(), updated_at: db.fn.now() })
    .returning('*');
  return user;
}

async function unblockUser(id) {
  const [user] = await db('users')
    .where({ id })
    .update({ blocked_at: null, updated_at: db.fn.now() })
    .returning('*');
  return user;
}

/**
 * Атомарный инкремент внутреннего счёта (недоплата через Click/Payme, см.
 * src/services/balanceService.js) — через SQL-выражение, а не read-modify-write, чтобы два
 * почти одновременных недоплаченных платежа не затёрли начисление друг друга.
 */
async function incrementBalance(id, delta) {
  const [user] = await db('users')
    .where({ id })
    .update({ balance: db.raw('balance + ?', [delta]), updated_at: db.fn.now() })
    .returning('*');
  return user;
}

async function setBalance(id, balance) {
  const [user] = await db('users').where({ id }).update({ balance, updated_at: db.fn.now() }).returning('*');
  return user;
}

/**
 * Анти-спам для уведомлений о недоплате (см. config.underpaymentAntiSpam), по аналогии с
 * промо-анти-спамом, но хранится в БД — решение принимается из вебхука Click/Payme, где
 * bot-сессии нет. Троттлит только сами уведомления юзеру/админу, не зачисление на баланс.
 * Не строго атомарно под конкурентностью (read-then-write) — это осознанный компромисс:
 * ошибиться на пару "лишних" уведомлений не страшно, в отличие от денежного баланса.
 * @returns {Promise<{shouldNotify: boolean, justLocked: boolean}>} justLocked — именно этот
 *   вызов довёл счётчик до лимита и включил блокировку (админу стоит уведомить один раз,
 *   а не на каждую последующую подавленную попытку).
 */
async function registerUnderpaymentNotice(id, maxAttempts, lockoutMinutes) {
  const user = await db('users').where({ id }).first();
  const now = new Date();

  if (user.underpayment_locked_until && new Date(user.underpayment_locked_until) > now) {
    return { shouldNotify: false, justLocked: false };
  }

  // Если блокировка уже истекла — начинаем счёт заново, а не продолжаем со старого значения.
  const wasLocked = Boolean(user.underpayment_locked_until);
  const count = (wasLocked ? 0 : user.underpayment_notice_count) + 1;
  const justLocked = count >= maxAttempts;

  if (justLocked) {
    await db('users')
      .where({ id })
      .update({
        underpayment_notice_count: 0,
        underpayment_locked_until: new Date(now.getTime() + lockoutMinutes * 60 * 1000),
        updated_at: db.fn.now(),
      });
  } else {
    await db('users')
      .where({ id })
      .update({ underpayment_notice_count: count, underpayment_locked_until: null, updated_at: db.fn.now() });
  }

  // Уведомление, которым счёт как раз добрался до лимита, всё ещё отправляем — молчаливая
  // блокировка без единого объяснения выглядела бы для юзера как "бот сломался".
  return { shouldNotify: true, justLocked };
}

/** Мягкое удаление — платежи и логи не трогаются (нужны для отчётности), юзер просто
 * пропадает из активного списка. */
async function deleteUser(id) {
  const [user] = await db('users')
    .where({ id })
    .update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })
    .returning('*');
  return user;
}

async function restoreUser(id) {
  const [user] = await db('users')
    .where({ id })
    .update({ deleted_at: null, updated_at: db.fn.now() })
    .returning('*');
  return user;
}

/**
 * @param {{q?: string, status?: string, deleted?: boolean}} filters status: 'new'|'pending'|
 *   'paid' фильтрует по жизненному циклу оплаты как есть; 'blocked' — отдельно, по
 *   blocked_at (бан теперь не значение status, а независимый флаг). deleted=true — показать
 *   только мягко удалённых (по умолчанию они исключены из списка).
 * @param {{page?: number, pageSize?: number}} pagination
 */
async function listUsers(filters = {}, pagination = {}) {
  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const pageSize = pagination.pageSize || 20;

  // Колонки квалифицированы через users.* намеренно: в rows-запросе ниже добавляется
  // LATERAL JOIN на payments (у неё тоже есть status), без префикса Postgres не может
  // понять, чей это столбец, и падает с "неоднозначная ссылка на столбец".
  const base = db('users');
  if (filters.q) {
    const q = `%${filters.q.trim()}%`;
    base.where((builder) => {
      builder.whereILike('users.code', q).orWhereILike('users.phone', q).orWhereILike('users.username', q);
    });
  }
  if (filters.status === 'blocked') {
    base.whereNotNull('users.blocked_at');
  } else if (filters.status) {
    base.andWhere({ 'users.status': filters.status });
  }
  if (filters.deleted) {
    base.whereNotNull('users.deleted_at');
  } else {
    base.whereNull('users.deleted_at');
  }

  const countRow = await base.clone().count({ count: '*' }).first();
  const total = parseInt(countRow.count, 10);

  const rows = await base
    .clone()
    .select(
      'users.*',
      'lp.amount as last_payment_amount',
      'lp.created_at as last_payment_date',
      'lp.provider as last_payment_provider',
      'pc.code as last_payment_promo'
    )
    .joinRaw(
      `LEFT JOIN LATERAL (
        SELECT * FROM payments
        WHERE payments.user_id = users.id
        ORDER BY payments.created_at DESC
        LIMIT 1
      ) lp ON true`
    )
    .leftJoin('promo_codes as pc', 'pc.id', 'lp.promo_code_id')
    .orderBy('users.created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Получатели рассылки — не удалённые юзеры (у них всегда есть telegram_id, обязателен при
 * регистрации). excludeBlocked по умолчанию true: юзеров, заблокированных админом, обычно
 * не имеет смысла беспокоить массовыми объявлениями о канале, к которому у них нет доступа.
 */
function broadcastRecipientsQuery({ excludeBlocked = true } = {}) {
  const query = db('users').whereNull('deleted_at');
  if (excludeBlocked) query.whereNull('blocked_at');
  return query;
}

function listForBroadcast(filters = {}) {
  return broadcastRecipientsQuery(filters).select('telegram_id', 'language');
}

async function countForBroadcast(filters = {}) {
  const row = await broadcastRecipientsQuery(filters).count({ count: '*' }).first();
  return parseInt(row.count, 10);
}

module.exports = {
  createUser,
  findByTelegramId,
  findById,
  findByCode,
  updateStatus,
  updateLanguage,
  updatePhone,
  updateUsername,
  incrementBalance,
  setBalance,
  registerUnderpaymentNotice,
  blockUser,
  unblockUser,
  deleteUser,
  restoreUser,
  listUsers,
  listForBroadcast,
  countForBroadcast,
};
