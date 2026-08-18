const usersRepo = require('../db/repositories/users');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

// Telegram Bot API ограничивает общий поток широковещательных сообщений — держим
// заметный запас от официального потолка (~30/с), чтобы не словить 429 и не растянуть
// сами лимиты на другие апдейты бота (платежи, join-запросы и т.д.).
const RATE_LIMIT_PER_SECOND = 20;
const DELAY_MS = Math.ceil(1000 / RATE_LIMIT_PER_SECOND);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Рассылает сообщение всем не удалённым юзерам бота, каждому на его языке интерфейса.
 * @param {{ru: string, uz: string}} messages текст без HTML-разметки (админ вводит его как
 *   есть — сырой текст безопаснее parse_mode, который может упасть на случайных `<`/`&`).
 * @param {{excludeBlocked?: boolean}} options
 * @returns {Promise<{total: number, sent: number, failed: number}>}
 */
async function broadcastMessage(messages, { excludeBlocked = true } = {}) {
  if (!botRef) throw new Error('Бот не инициализирован — рассылка недоступна');

  const recipients = await usersRepo.listForBroadcast({ excludeBlocked });

  let sent = 0;
  let failed = 0;

  for (const user of recipients) {
    const text = messages[user.language] || messages.ru;
    try {
      await botRef.telegram.sendMessage(user.telegram_id, text);
      sent += 1;
    } catch (err) {
      // Юзер заблокировал бота, удалил аккаунт и т.п. — пропускаем и едем дальше,
      // одна неудачная отправка не должна прерывать всю рассылку.
      failed += 1;
      console.error(`broadcastMessage: не удалось отправить юзеру ${user.telegram_id}:`, err.message);
    }
    await sleep(DELAY_MS);
  }

  return { total: recipients.length, sent, failed };
}

module.exports = { setBot, broadcastMessage };
