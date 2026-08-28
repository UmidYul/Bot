const usersRepo = require('../../db/repositories/users');
const adminLogsRepo = require('../../db/repositories/adminLogs');
const { t } = require('../i18n');

async function handleChatJoinRequest(ctx) {
  const request = ctx.chatJoinRequest;
  const telegramId = request.from.id;

  const user = await usersRepo.findByTelegramId(telegramId);

  if (!user) {
    await ctx.declineChatJoinRequest(telegramId).catch(() => {});
    await adminLogsRepo.log({
      adminId: null,
      action: 'join_request_auto',
      targetUserId: null,
      meta: { telegramId, decision: 'decline', reason: 'unknown_user' },
    });
    return;
  }

  if (user.deleted_at) {
    await ctx.declineChatJoinRequest(telegramId).catch(() => {});
    await adminLogsRepo.log({
      adminId: null,
      action: 'join_request_auto',
      targetUserId: user.id,
      meta: { telegramId, decision: 'decline', reason: 'deleted' },
    });
    return;
  }

  if (user.blocked_at) {
    await ctx.declineChatJoinRequest(telegramId).catch(() => {});
    await adminLogsRepo.log({
      adminId: null,
      action: 'join_request_auto',
      targetUserId: user.id,
      meta: { telegramId, decision: 'decline', reason: 'blocked' },
    });
    return;
  }

  if (user.status !== 'paid') {
    await ctx.declineChatJoinRequest(telegramId).catch(() => {});
    await ctx.telegram.sendMessage(telegramId, t(user.language, 'join_need_payment')).catch(() => {});
    await adminLogsRepo.log({
      adminId: null,
      action: 'join_request_auto',
      targetUserId: user.id,
      meta: { telegramId, decision: 'decline', reason: 'not_paid' },
    });
    return;
  }

  await ctx.approveChatJoinRequest(telegramId);
  await ctx.telegram.sendMessage(telegramId, t(user.language, 'join_welcome')).catch(() => {});
  await adminLogsRepo.log({
    adminId: null,
    action: 'join_request_auto',
    targetUserId: user.id,
    meta: { telegramId, decision: 'approve' },
  });
}

module.exports = { handleChatJoinRequest };
