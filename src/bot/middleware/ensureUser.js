const usersRepo = require('../../db/repositories/users');

/**
 * Подгружает пользователя из БД в ctx.state.user (или null, если это ещё не наш юзер —
 * например, апдейт chat_join_request на этапе, когда юзер уже отфильтрован отдельно).
 */
module.exports = async function ensureUser(ctx, next) {
  if (ctx.from) {
    ctx.state.user = await usersRepo.findByTelegramId(ctx.from.id);
  }
  return next();
};
