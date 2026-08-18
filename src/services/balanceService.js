const usersRepo = require('../db/repositories/users');
const { t } = require('../bot/i18n');
const { notifyAdmins } = require('./adminNotifyService');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

const PROVIDER_LABEL = { click: 'Click', payme: 'Payme', uzumbank: 'UzumBank', paynet: 'Paynet' };

/**
 * Зачисляет пополнение на баланс юзера и уведомляет его в боте — вызывается, когда провайдер
 * подтвердил платёж, заведённый "холодным стартом" (юзер платил напрямую в приложении
 * провайдера по своему коду, минуя бота). Доступ этим НЕ выдаётся — только у явного
 * списания через "Мой счёт" (см. src/bot/handlers/payment.js, handlePayBalance).
 * @param {{id: number, telegram_id: number, language: string, code: string}} user
 * @param {number} amount сумма пополнения в UZS
 * @param {string} provider 'click' | 'payme' | ...
 */
async function creditBalance(user, amount, provider) {
  const updated = await usersRepo.incrementBalance(user.id, amount);

  if (botRef) {
    try {
      await botRef.telegram.sendMessage(
        user.telegram_id,
        t(user.language, 'balance_topped_up', amount, updated.balance),
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error(`creditBalance: не удалось уведомить юзера ${user.telegram_id}:`, err.message);
    }
  }

  await notifyAdmins(
    `💰 <b>Пополнение баланса</b>\n` +
      `Юзер: <code>${user.code}</code>${user.username ? ` (@${user.username})` : ''}\n` +
      `Сумма: <b>${Number(amount).toLocaleString('ru-RU')} UZS</b>\n` +
      `Способ: ${PROVIDER_LABEL[provider] || provider}\n` +
      `Баланс теперь: <b>${Number(updated.balance).toLocaleString('ru-RU')} UZS</b>`
  );

  return updated;
}

/**
 * Уведомляет юзера о ручной корректировке баланса из админки (см. POST
 * /admin/users/:id/balance/adjust). amount может быть отрицательным (списание).
 * @param {{telegram_id: number, language: string, balance: number}} user уже обновлённый
 * @param {number} amount дельта (+ пополнение, - списание)
 * @param {string} reason причина, указанная админом
 */
async function notifyBalanceAdjusted(user, amount, reason) {
  if (!botRef) return;

  try {
    await botRef.telegram.sendMessage(
      user.telegram_id,
      t(user.language, 'balance_adjusted_by_admin', amount, user.balance, reason),
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error(`notifyBalanceAdjusted: не удалось уведомить юзера ${user.telegram_id}:`, err.message);
  }
}

module.exports = { setBot, creditBalance, notifyBalanceAdjusted };
