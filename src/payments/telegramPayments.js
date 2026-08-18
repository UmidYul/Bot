const config = require('../config');
const paymentsRepo = require('../db/repositories/payments');
const promoCodesRepo = require('../db/repositories/promoCodes');
const usersRepo = require('../db/repositories/users');
const { grantAccess } = require('../services/accessService');
const { sendReceipt } = require('../services/receiptService');
const { notifyNewPayment } = require('../services/adminNotifyService');
const { t } = require('../bot/i18n');
const { closeScreen } = require('../bot/screen');

/**
 * Telegram Payments (провайдер подключается через BotFather -> /mybots -> Payments) —
 * платёж проходит целиком внутри Telegram: sendInvoice -> pre_checkout_query ->
 * successful_payment. Никакого отдельного HTTP-вебхука не нужно, Telegram сам зовёт бота.
 *
 * provider_token из BotFather вида "123456:TEST:xxxxx" — это НЕ то же самое, что
 * CLICK_SECRET_KEY для сырого Click Shop API (см. src/payments/click.js), который
 * используется для другого сценария — ручной оплаты через приложение Click по коду юзера.
 */

// У UZS, как и у большинства валют в Bot API Payments, exp=2 — сумма передаётся
// в минимальных единицах (аналогично тийинам у Payme).
function toTelegramAmount(amountUzs) {
  return Math.round(Number(amountUzs) * 100);
}

function isConfigured() {
  return Boolean(config.click.providerToken);
}

/**
 * Отправляет юзеру нативный счёт Telegram на оплату через Click.
 * @param {import('telegraf').Context} ctx
 * @param {{merchant_trans_id: string, amount: number}} payment
 * @param {{language: string}} user
 */
async function sendInvoice(ctx, payment, user) {
  await ctx.replyWithInvoice({
    title: t(user.language, 'invoice_title'),
    description: t(user.language, 'invoice_description'),
    payload: payment.merchant_trans_id,
    provider_token: config.click.providerToken,
    currency: 'UZS',
    prices: [{ label: t(user.language, 'invoice_price_label'), amount: toTelegramAmount(payment.amount) }],
  });
}

/**
 * Telegram шлёт pre_checkout_query перед списанием денег — ответить нужно в течение 10 сек.
 */
async function handlePreCheckoutQuery(ctx) {
  const query = ctx.preCheckoutQuery;
  const payment = await paymentsRepo.findByMerchantTransId(query.invoice_payload);
  const lang = ctx.state.user ? ctx.state.user.language : 'ru';

  if (!payment || payment.status !== 'pending') {
    await ctx.answerPreCheckoutQuery(false, t(lang, 'pre_checkout_order_not_found'));
    return;
  }

  await paymentsRepo.addEvent({
    paymentId: payment.id,
    provider: 'click',
    event: 'telegram_pre_checkout_query',
    payload: query,
  });

  if (toTelegramAmount(payment.amount) !== query.total_amount) {
    await ctx.answerPreCheckoutQuery(false, t(lang, 'pre_checkout_amount_mismatch'));
    return;
  }

  await ctx.answerPreCheckoutQuery(true);
}

/**
 * Финальное подтверждение — деньги списаны. Идемпотентно: повторный апдейт с уже
 * оплаченным payment не начисляет доступ повторно.
 */
async function handleSuccessfulPayment(ctx) {
  const sp = ctx.message.successful_payment;
  const payment = await paymentsRepo.findByMerchantTransId(sp.invoice_payload);
  if (!payment) return;

  await paymentsRepo.addEvent({
    paymentId: payment.id,
    provider: 'click',
    event: 'telegram_successful_payment',
    payload: sp,
  });

  if (payment.status === 'paid') return;

  await paymentsRepo.setProviderTransId(payment.id, sp.provider_payment_charge_id);
  const paid = await paymentsRepo.markPaid(payment.id);
  if (payment.promo_code_id) await promoCodesRepo.incrementUsage(payment.promo_code_id);

  const user = await usersRepo.updateStatus(payment.user_id, 'paid');
  ctx.state.user = user;

  await closeScreen(ctx);
  await ctx.reply(t(user.language, 'payment_success'));
  await grantAccess(user);
  await sendReceipt(user, paid);
  await notifyNewPayment(user, paid);
}

module.exports = { isConfigured, sendInvoice, handlePreCheckoutQuery, handleSuccessfulPayment, toTelegramAmount };
