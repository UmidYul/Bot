const config = require('../config');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

/**
 * Шлёт сообщение всем ADMIN_NOTIFY_CHAT_IDS. Если список пуст или бот не инициализирован —
 * тихо ничего не делает (уведомления — опциональная фича, не должны ронять основной поток).
 * @param {string} message HTML-текст
 */
async function notifyAdmins(message) {
  if (!botRef || !config.adminNotifyChatIds.length) return;

  await Promise.all(
    config.adminNotifyChatIds.map((chatId) =>
      botRef.telegram
        .sendMessage(chatId, message, { parse_mode: 'HTML' })
        .catch((err) => console.error(`notifyAdmins: не удалось отправить уведомление ${chatId}:`, err.message))
    )
  );
}

function notifyNewPayment(user, payment) {
  const providerLabel = { click: 'Click', payme: 'Payme', promo: 'промокод' }[payment.provider] || payment.provider;
  return notifyAdmins(
    `💰 <b>Новая оплата</b>\n` +
      `Юзер: <code>${user.code}</code>${user.username ? ` (@${user.username})` : ''}\n` +
      `Сумма: <b>${Number(payment.amount).toLocaleString('ru-RU')} ${payment.currency || 'UZS'}</b>\n` +
      `Способ: ${providerLabel}\n` +
      `Платёж: <code>${payment.merchant_trans_id}</code>`
  );
}

function notifyPromoLockout(user, code) {
  return notifyAdmins(
    `⚠️ <b>Подозрительная активность</b>\n` +
      `Юзер <code>${user.code}</code>${user.username ? ` (@${user.username})` : ''} несколько раз подряд ввёл неверный промокод ` +
      `(последний: <code>${code}</code>) и временно заблокирован от дальнейших попыток.`
  );
}

function notifyBotError(updateId, err) {
  return notifyAdmins(`🐞 <b>Ошибка в боте</b>\nUpdate #${updateId}\n<code>${String(err && err.message ? err.message : err)}</code>`);
}

module.exports = { setBot, notifyAdmins, notifyNewPayment, notifyPromoLockout, notifyBotError };
