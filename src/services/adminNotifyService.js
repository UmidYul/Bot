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

function notifyUnderpayment(user, payment, remaining) {
  const providerLabel = { click: 'Click', payme: 'Payme' }[payment.provider] || payment.provider;
  return notifyAdmins(
    `⚠️ <b>Неполная оплата</b>\n` +
      `Юзер: <code>${user.code}</code>${user.username ? ` (@${user.username})` : ''}\n` +
      `Оплачено: <b>${Number(payment.amount).toLocaleString('ru-RU')} ${payment.currency || 'UZS'}</b>, ` +
      `не хватает: <b>${Number(remaining).toLocaleString('ru-RU')} ${payment.currency || 'UZS'}</b>\n` +
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

/** Юзер несколько раз подряд оплатил меньше нужной суммы — сами недоплаты по-прежнему
 * зачисляются на баланс, троттлится только поток уведомлений (см. usersRepo.registerUnderpaymentNotice). */
function notifyUnderpaymentLockout(user) {
  return notifyAdmins(
    `⚠️ <b>Подозрительная активность</b>\n` +
      `Юзер <code>${user.code}</code>${user.username ? ` (@${user.username})` : ''} несколько раз подряд оплатил меньше нужной ` +
      `суммы и временно не будет получать уведомления о недоплате (сама недоплата на баланс зачисляется как обычно).`
  );
}

/** Несколько неверных паролей подряд для одного логина в веб-админке — похоже на подбор
 * пароля, аккаунт временно заблокирован (см. adminsRepo.recordFailedLogin). */
function notifyAdminLoginLockout(login, ip) {
  return notifyAdmins(
    `⚠️ <b>Подозрительная активность в админке</b>\n` +
      `Несколько неверных паролей подряд для логина <code>${login}</code>` +
      `${ip ? ` (IP: <code>${ip}</code>)` : ''} — аккаунт временно заблокирован для входа.`
  );
}

function notifyBotError(updateId, err) {
  return notifyAdmins(`🐞 <b>Ошибка в боте</b>\nUpdate #${updateId}\n<code>${String(err && err.message ? err.message : err)}</code>`);
}

/**
 * Деньги по платежу уже приняты (markPaid закоммичен), но что-то после этого упало —
 * начисление баланса/выдача доступа/уведомление могли не выполниться до конца. Парный случай
 * к notifyBotError: там ошибка в обработке апдейта бота, здесь — уже после реального списания.
 */
function notifyPostPaymentFailure(provider, paymentId, err) {
  return notifyAdmins(
    `🐞 <b>Сбой после оплаты (${provider})</b>\n` +
      `Платёж: <code>${paymentId}</code>\n` +
      `<code>${String(err && err.message ? err.message : err)}</code>\n` +
      `Деньги уже приняты — проверьте вручную баланс/доступ этого платежа.`
  );
}

module.exports = {
  setBot,
  notifyAdmins,
  notifyNewPayment,
  notifyUnderpayment,
  notifyPromoLockout,
  notifyUnderpaymentLockout,
  notifyAdminLoginLockout,
  notifyBotError,
  notifyPostPaymentFailure,
};
