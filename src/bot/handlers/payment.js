const config = require('../../config');
const usersRepo = require('../../db/repositories/users');
const paymentsRepo = require('../../db/repositories/payments');
const promoCodesRepo = require('../../db/repositories/promoCodes');
const promoService = require('../../services/promoService');
const { grantAccess } = require('../../services/accessService');
const { sendReceipt } = require('../../services/receiptService');
const { notifyNewPayment, notifyPromoLockout } = require('../../services/adminNotifyService');
const { buildClickPayUrl } = require('../../payments/click.linkBuilder');
const { buildPaymeCheckoutUrl } = require('../../payments/payme.linkBuilder');
const telegramPayments = require('../../payments/telegramPayments');
const { t } = require('../i18n');
const { html } = require('../reply');
const { paymentScreenKeyboard, paymentMethodKeyboard, promoEntryKeyboard } = require('../keyboards');
const { showPaymentScreen, routeExistingUser } = require('./start');

function resetPaymentSession(ctx) {
  ctx.session.awaitingPromo = false;
  ctx.session.promoCodeId = null;
  ctx.session.finalAmount = config.channelPrice;
}

/**
 * Юзер может нажать старую inline-кнопку из истории чата уже после того, как его
 * статус изменился (оплатил в другом месте, заблокирован админом и т.п.), либо ввести
 * текст-промокод в том же положении — не даём в этом случае запускать оплату/промокод
 * заново, а просто показываем актуальный экран. ctx.answerCbQuery() вызывается, только
 * если апдейт реально callback_query — иначе telegraf бросает синхронную ошибку.
 */
async function guardActionable(ctx, user) {
  if (!user) return false;
  if (user.status === 'blocked' || user.status === 'paid') {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await routeExistingUser(ctx, user);
    return false;
  }
  if (!user.phone) {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(t(user.language, 'need_phone_first'));
    return false;
  }
  return true;
}

async function showPaymentMethodScreen(ctx, lang) {
  await ctx.reply(t(lang, 'choose_payment_method'), html(paymentMethodKeyboard(lang)));
}

async function handleEnterPromo(ctx) {
  const user = ctx.state.user;
  if (!(await guardActionable(ctx, user))) return;

  ctx.session.awaitingPromo = true;
  await ctx.answerCbQuery();
  await ctx.reply(t(user.language, 'enter_promo_prompt'), html(promoEntryKeyboard(user.language)));
}

async function handlePromoCancel(ctx) {
  const user = ctx.state.user;
  if (!user) return;

  ctx.session.awaitingPromo = false;
  await ctx.answerCbQuery();
  await ctx.reply(t(user.language, 'promo_cancelled'));
  await showPaymentScreen(ctx, user);
}

async function handlePayStart(ctx) {
  const user = ctx.state.user;
  if (!(await guardActionable(ctx, user))) return;

  ctx.session.awaitingPromo = false;
  ctx.session.promoCodeId = null;
  ctx.session.finalAmount = config.channelPrice;

  await ctx.answerCbQuery();

  // Если подключён только один способ оплаты — не заставляем юзера выбирать из одного
  // варианта, сразу переходим к оплате.
  if (config.enabledPaymentProviders.length === 1) {
    await initiatePayment(ctx, user, config.enabledPaymentProviders[0]);
    return;
  }

  await showPaymentMethodScreen(ctx, user.language);
}

async function handlePayBack(ctx) {
  const user = ctx.state.user;
  if (!user) return;

  resetPaymentSession(ctx);
  await ctx.answerCbQuery();
  await showPaymentScreen(ctx, user);
}

/** Текстовый ввод промокода — вызывается из общего text-хендлера, если ctx.session.awaitingPromo. */
async function handlePromoCodeText(ctx) {
  const user = ctx.state.user;
  ctx.session.awaitingPromo = false;
  if (!(await guardActionable(ctx, user))) return;

  // Антиспам: после N подряд неверных попыток временно блокируем ввод промокода —
  // защита от перебора кодов.
  if (ctx.session.promoLockedUntil && Date.now() < ctx.session.promoLockedUntil) {
    const minutesLeft = Math.ceil((ctx.session.promoLockedUntil - Date.now()) / 60000);
    await ctx.reply(t(user.language, 'promo_locked', minutesLeft));
    await showPaymentScreen(ctx, user);
    return;
  }

  const code = (ctx.message.text || '').trim();
  const promo = await promoService.validatePromoCode(code);
  if (!promo) {
    ctx.session.promoInvalidAttempts = (ctx.session.promoInvalidAttempts || 0) + 1;

    if (ctx.session.promoInvalidAttempts >= config.promoAntiSpam.maxAttempts) {
      ctx.session.promoLockedUntil = Date.now() + config.promoAntiSpam.lockoutMinutes * 60 * 1000;
      ctx.session.promoInvalidAttempts = 0;
      await ctx.reply(t(user.language, 'promo_locked', config.promoAntiSpam.lockoutMinutes));
      await showPaymentScreen(ctx, user);
      await notifyPromoLockout(user, code);
      return;
    }

    await ctx.reply(t(user.language, 'promo_invalid'));
    await showPaymentScreen(ctx, user);
    return;
  }

  ctx.session.promoInvalidAttempts = 0;

  const finalAmount = promoService.calculateFinalAmount(config.channelPrice, promo);
  ctx.session.promoCodeId = promo.id;
  ctx.session.finalAmount = finalAmount;

  if (finalAmount <= 0) {
    await grantFreeAccess(ctx, user, promo);
    return;
  }

  await ctx.reply(t(user.language, 'promo_applied', finalAmount), html());

  if (config.enabledPaymentProviders.length === 1) {
    await initiatePayment(ctx, user, config.enabledPaymentProviders[0]);
    return;
  }

  await showPaymentMethodScreen(ctx, user.language);
}

async function grantFreeAccess(ctx, user, promo) {
  // Занимаем "слот" использования атомарно ДО выдачи доступа — если два юзера одновременно
  // подставили последний доступный free-промокод, только один из них реально его получит.
  const claimed = await promoCodesRepo.incrementUsage(promo.id);
  if (!claimed) {
    await ctx.reply(t(user.language, 'promo_invalid'));
    await showPaymentScreen(ctx, user);
    return;
  }

  const merchantTransId = `${user.code}-${Date.now()}`;
  const payment = await paymentsRepo.createPayment({
    userId: user.id,
    provider: 'promo',
    amount: 0,
    promoCodeId: promo.id,
    merchantTransId,
    status: 'paid',
  });
  const paid = await paymentsRepo.markPaid(payment.id);

  const updatedUser = await usersRepo.updateStatus(user.id, 'paid');
  ctx.state.user = updatedUser;

  await ctx.reply(t(user.language, 'promo_free_access'));
  await grantAccess(updatedUser);
  await sendReceipt(updatedUser, paid);
  await notifyNewPayment(updatedUser, paid);
}

async function handlePayMethod(ctx) {
  const user = ctx.state.user;
  if (!(await guardActionable(ctx, user))) return;

  const provider = ctx.match[1]; // 'click' | 'payme'

  if (provider === 'payme' && !config.payme.enabled) {
    await ctx.answerCbQuery();
    await ctx.reply(t(user.language, 'payme_disabled'));
    return;
  }

  await ctx.answerCbQuery();
  await initiatePayment(ctx, user, provider);
}

async function initiatePayment(ctx, user, provider) {
  const amount = ctx.session.finalAmount || config.channelPrice;
  const merchantTransId = `${user.code}-${Date.now()}`;

  const payment = await paymentsRepo.createPayment({
    userId: user.id,
    provider,
    amount,
    promoCodeId: ctx.session.promoCodeId || null,
    merchantTransId,
    status: 'pending',
  });

  await usersRepo.updateStatus(user.id, 'pending');

  // Click подключён как провайдер Telegram Payments (provider_token из BotFather) —
  // юзер оплачивает прямо во встроенном чек-ауте Telegram, без перехода по ссылке.
  if (provider === 'click' && telegramPayments.isConfigured()) {
    await telegramPayments.sendInvoice(ctx, payment, user);
    return;
  }

  const hasRealCreds =
    provider === 'click' ? Boolean(config.click.serviceId && config.click.merchantId) : Boolean(config.payme.merchantId);

  if (!hasRealCreds) {
    // Реальных merchant-данных провайдера ещё нет (см. .env.example) — показываем номер
    // платежа текстом, чтобы можно было протестировать всё до касс Click/Payme.
    await ctx.reply(t(user.language, 'payment_created', amount, payment.merchant_trans_id), html());
    return;
  }

  const url = provider === 'click' ? buildClickPayUrl(payment, user) : buildPaymeCheckoutUrl(payment, user);
  await ctx.reply(t(user.language, 'payment_link', url));
}

module.exports = {
  handleEnterPromo,
  handlePromoCancel,
  handlePayStart,
  handlePayBack,
  handlePromoCodeText,
  handlePayMethod,
  resetPaymentSession,
};
