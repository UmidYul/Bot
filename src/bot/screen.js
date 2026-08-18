const { html } = require('./reply');

function chatIdOf(ctx) {
  return (ctx.chat && ctx.chat.id) || ctx.from.id;
}

/**
 * Показывает "экран" оплаты/промокода как одно и то же переиспользуемое сообщение —
 * навигация между шагами (способ оплаты, ввод промокода, отмена и т.д.) редактирует
 * его на месте вместо того, чтобы на каждый шаг слать новое сообщение и захламлять чат.
 * Если редактирование не удалось (сообщение слишком старое/удалено юзером и т.п.),
 * просто шлём новое и запоминаем его id для следующих переходов.
 *
 * Если апдейт — это нажатие inline-кнопки, редактируем ИМЕННО то сообщение, на котором
 * она висит, а не запомненный ранее screenMessageId: у "Оплатить"/"Ввести промокод" на
 * экране профиля (см. profile.js) он вообще не отслеживался, и слепое редактирование
 * старого id молча правило сообщение где-то в истории чата — юзер жал кнопку и не видел
 * никакого результата, потому что правка происходила не на экране, а выше, вне поля зрения.
 */
async function showScreen(ctx, text, extra = {}) {
  const clickedMessageId = ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;
  const messageId = clickedMessageId || ctx.session.screenMessageId;
  const payload = html(extra);

  if (messageId) {
    try {
      await ctx.telegram.editMessageText(chatIdOf(ctx), messageId, undefined, text, payload);
      ctx.session.screenMessageId = messageId;
      return;
    } catch (err) {
      const description = (err && err.description) || (err && err.message) || '';
      if (description.includes('message is not modified')) {
        ctx.session.screenMessageId = messageId;
        return;
      }
      // иначе — сообщение недоступно для редактирования, падаем в обычную отправку ниже
    }
  }

  const sent = await ctx.reply(text, payload);
  ctx.session.screenMessageId = sent.message_id;
}

/**
 * Убирает inline-клавиатуру у текущего экрана и забывает его — когда флоу оплаты
 * завершён (доступ выдан, инвойс ушёл в Telegram и т.д.), дальше редактировать нечего,
 * а старые кнопки не должны оставаться кликабельными.
 */
async function closeScreen(ctx) {
  const messageId = ctx.session.screenMessageId;
  ctx.session.screenMessageId = null;
  if (!messageId) return;
  try {
    await ctx.telegram.editMessageReplyMarkup(chatIdOf(ctx), messageId, undefined, undefined);
  } catch (err) {
    // не критично, если не получилось — сообщение уже отредактировано/удалено и т.п.
  }
}

module.exports = { showScreen, closeScreen };
