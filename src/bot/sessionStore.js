const db = require('../db');

/**
 * AsyncSessionStore для telegraf, хранит сессии в Postgres (таблица bot_sessions),
 * чтобы диалог с пользователем переживал рестарт процесса.
 */
class PostgresSessionStore {
  async get(key) {
    const row = await db('bot_sessions').where({ key }).first();
    return row ? row.data : undefined;
  }

  async set(key, value) {
    await db('bot_sessions')
      .insert({ key, data: JSON.stringify(value), updated_at: db.fn.now() })
      .onConflict('key')
      .merge({ data: JSON.stringify(value), updated_at: db.fn.now() });
  }

  async delete(key) {
    await db('bot_sessions').where({ key }).del();
  }
}

module.exports = { PostgresSessionStore };
