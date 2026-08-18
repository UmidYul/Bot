const config = require('../../config');
const paymentsRepo = require('../../db/repositories/payments');
const { t } = require('../i18n');
const { html } = require('../reply');
const { paymentScreenKeyboard, sharePhoneKeyboard } = require('../keyboards');

function formatDate(date) {
  return new Date(date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

async function handleProfile(ctx) {
  const user = ctx.state.user;
  if (!user) {
    // /profile до первого /start — не должно случиться при обычном использовании
    // (команда доступна только после регистрации через меню), но подстрахуемся.
    const { handleStart } = require('./start');
    await handleStart(ctx);
    return;
  }

  const lang = user.language;
  const lastPaid = await paymentsRepo.findLastPaidByUserId(user.id);

  const lines = [
    t(lang, 'profile_title'),
    '',
    `${t(lang, 'profile_code_label')}: <code>${user.code}</code>`,
    `${t(lang, 'profile_phone_label')}: ${user.phone || t(lang, 'profile_phone_missing')}`,
    `${t(lang, 'profile_language_label')}: ${lang === 'ru' ? '🇷🇺 Русский' : "🇺🇿 O'zbekcha"}`,
    `${t(lang, 'profile_status_label')}: ${t(lang, `status_${user.status}`)}${user.blocked_at ? ` (${t(lang, 'status_blocked')})` : ''}`,
    `${t(lang, 'profile_registered_label')}: ${formatDate(user.created_at)}`,
    `${t(lang, 'profile_balance_label')}: <b>${Number(user.balance).toLocaleString('ru-RU')} UZS</b>`,
    `${t(lang, 'profile_last_payment_label')}: ${lastPaid ? `${Number(lastPaid.amount).toLocaleString('ru-RU')} UZS (${formatDate(lastPaid.paid_at)})` : t(lang, 'profile_no_payments')}`,
  ];

  let extra = html();
  if (user.status === 'paid' && config.channelInviteLink) {
    extra = html({
      reply_markup: { inline_keyboard: [[{ text: t(lang, 'open_channel_button'), url: config.channelInviteLink }]] },
    });
  } else if (!user.blocked_at && user.phone) {
    extra = html(paymentScreenKeyboard(lang));
  }

  await ctx.reply(lines.join('\n'), extra);

  if (!user.phone) {
    await ctx.reply(t(lang, 'need_phone_first'), sharePhoneKeyboard(lang));
  }
}

module.exports = { handleProfile };
