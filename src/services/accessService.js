const config = require('../config');
const { t } = require('../bot/i18n');

let botRef = null;
/** Внедряется из src/bot/index.js, чтобы избежать циклического require. */
function setBot(bot) {
  botRef = bot;
}

/**
 * Вызывается после успешной оплаты (Click/Payme/бесплатный промокод).
 * Присылает юзеру в боте инвайт-ссылку на канал (режим Join Requests).
 */
async function grantAccess(user) {
  if (!botRef) throw new Error('accessService: bot не инициализирован (вызови setBot)');
  if (!config.channelInviteLink) {
    console.warn('grantAccess: CHANNEL_INVITE_LINK не настроен, сообщение не отправлено');
    return;
  }

  try {
    await botRef.telegram.sendMessage(user.telegram_id, t(user.language, 'access_granted', config.channelInviteLink), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error(`grantAccess: не удалось отправить сообщение юзеру ${user.telegram_id}:`, err.message);
  }
}

/**
 * Используется при блокировке пользователя. Кикает из канала, если он там уже состоит.
 * banChatMember + unbanChatMember = просто кик (не перманентный бан). Если нужна именно
 * перманентная блокировка — убери unbanChatMember ниже (тогда юзер не сможет зайти повторно
 * даже по новой invite-ссылке, пока его явно не разбанят).
 */
async function revokeAccess(user) {
  if (!botRef) throw new Error('accessService: bot не инициализирован (вызови setBot)');
  if (!config.channelId) {
    console.warn('revokeAccess: CHANNEL_ID не настроен, доступ не отозван');
    return;
  }

  try {
    await botRef.telegram.banChatMember(config.channelId, user.telegram_id);
    await botRef.telegram.unbanChatMember(config.channelId, user.telegram_id, { only_if_banned: true });
  } catch (err) {
    // Юзера может не быть в канале — это не ошибка сценария блокировки.
    console.warn(`revokeAccess: не удалось кикнуть юзера ${user.telegram_id} из канала:`, err.message);
  }
}

module.exports = { setBot, grantAccess, revokeAccess };
