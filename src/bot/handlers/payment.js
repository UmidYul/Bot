const config = require('../../config');
const usersRepo = require('../../db/repositories/users');
const paymentsRepo = require('../../db/repositories/payments');
const promoCodesRepo = require('../../db/repositories/promoCodes');
const promoService = require('../../services/promoService');
const { grantAccess } = require('../../services/accessService');
const { buildClickPayUrl } = require('../../payments/click.linkBuilder');
const { buildPaymeCheckoutUrl } = require('../../payments/payme.linkBuilder');
const { t } = require('../i18n');
const { paymentScreenKeyboard, paymentMethodKeyboard } = require('../keyboards');
const { showPaymentScreen } = require('./start');

function resetPaymentSession(ctx) {
  ctx.session.awaitingPromo = false;
  ctx.session.promoCodeId = null;
  ctx.session.finalAmount = config.channelPrice;
}

async function showPaymentMethodScreen(ctx, lang, amount) {
  await ctx.reply(t(lang, 'choose_payment_method'), paymentMethodKeyboard(lang));
}

async function handleEnterPromo(ctx) {
  const user = ctx.state.user;
  if (!user) return;

  ctx.session.awaitingPromo = true;
  await ctx.answerCbQuery();
  await ctx.reply(t(user.language, 'enter_promo_prompt'));
}

async function handlePayStart(ctx) {
  const user = ctx.state.user;
  if (!user) return;

  ctx.session.promoCodeId = null;
  ctx.session.finalAmount = config.channelPrice;

  await ctx.answerCbQuery();
  await showPaymentMethodScreen(ctx, user.language, ctx.session.finalAmount);
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
  const code = (ctx.message.text || '').trim();
  ctx.session.awaitingPromo = false;

  const promo = await promoService.validatePromoCode(code);
  if (!promo) {
    await ctx.reply(t(user.language, 'promo_invalid'));
    await showPaymentScreen(ctx, user);
    return;
  }

  const finalAmount = promoService.calculateFinalAmount(config.channelPrice, promo);
  ctx.session.promoCodeId = promo.id;
  ctx.session.finalAmount = finalAmount;

  if (finalAmount <= 0) {
    await grantFreeAccess(ctx, user, promo);
    return;
  }

  await ctx.reply(t(user.language, 'promo_applied', finalAmount));
  await showPaymentMethodScreen(ctx, user.language, finalAmount);
}

async function grantFreeAccess(ctx, user, promo) {
  const merchantTransId = `${user.code}-${Date.now()}`;
  const payment = await paymentsRepo.createPayment({
    userId: user.id,
    provider: 'promo',
    amount: 0,
    promoCodeId: promo.id,
    merchantTransId,
    status: 'paid',
  });
  await paymentsRepo.markPaid(payment.id);
  await promoCodesRepo.incrementUsage(promo.id);

  const updatedUser = await usersRepo.updateStatus(user.id, 'paid');
  ctx.state.user = updatedUser;

  await ctx.reply(t(user.language, 'promo_free_access'));
  await grantAccess(updatedUser);
}

async function handlePayMethod(ctx) {
  const user = ctx.state.user;
  if (!user) return;

  const provider = ctx.match[1]; // 'click' | 'payme'
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
  await ctx.answerCbQuery();

  const hasRealCreds =
    provider === 'click' ? Boolean(config.click.serviceId && config.click.merchantId) : Boolean(config.payme.merchantId);

  if (!hasRealCreds) {
    // Реальных merchant-данных провайдера ещё нет (см. .env.example) — показываем номер
    // платежа текстом, чтобы можно было протестировать всё до касс Click/Payme.
    await ctx.reply(t(user.language, 'payment_created', amount, payment.merchant_trans_id));
    return;
  }

  const url = provider === 'click' ? buildClickPayUrl(payment, user) : buildPaymeCheckoutUrl(payment, user);
  await ctx.reply(t(user.language, 'payment_link', url));
}

module.exports = {
  handleEnterPromo,
  handlePayStart,
  handlePayBack,
  handlePromoCodeText,
  handlePayMethod,
  resetPaymentSession,
};
