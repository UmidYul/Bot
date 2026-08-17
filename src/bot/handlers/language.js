const usersRepo = require('../../db/repositories/users');
const { t } = require('../i18n');
const { sharePhoneKeyboard } = require('../keyboards');

async function handleLanguageChoice(ctx) {
  const lang = ctx.match[1]; // 'ru' | 'uz'
  const user = ctx.state.user;

  if (!user) {
    await ctx.answerCbQuery();
    return;
  }

  await usersRepo.updateLanguage(user.id, lang);
  ctx.state.user.language = lang;

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply(t(lang, 'welcome'));
  await ctx.reply(t(lang, 'share_phone_button'), sharePhoneKeyboard(lang));
}

module.exports = { handleLanguageChoice };
