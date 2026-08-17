const usersRepo = require('../../db/repositories/users');
const { t } = require('../i18n');
const { html } = require('../reply');
const { promptForPhone, routeExistingUser } = require('./start');

async function handleLanguageChoice(ctx) {
  const lang = ctx.match[1]; // 'ru' | 'uz'
  const user = ctx.state.user;

  if (!user) {
    await ctx.answerCbQuery();
    return;
  }

  const isFirstTimeSetup = !user.phone;

  await usersRepo.updateLanguage(user.id, lang);
  ctx.state.user.language = lang;

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (isFirstTimeSetup) {
    await promptForPhone(ctx, ctx.state.user);
    return;
  }

  await ctx.reply(t(lang, 'language_changed'), html());
  await routeExistingUser(ctx, ctx.state.user);
}

module.exports = { handleLanguageChoice };
