const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showScreen, closeScreen } = require('./screen');

function makeCtx({ screenMessageId = null, editShouldFail = null, callbackMessageId = null } = {}) {
  const calls = [];
  let nextMessageId = 100;

  const ctx = {
    session: { screenMessageId },
    chat: { id: 1 },
    from: { id: 1 },
    callbackQuery: callbackMessageId ? { message: { message_id: callbackMessageId } } : undefined,
    telegram: {
      async editMessageText(chatId, messageId, _inlineId, text, extra) {
        calls.push({ type: 'edit', chatId, messageId, text, extra });
        if (editShouldFail) throw editShouldFail;
      },
      async editMessageReplyMarkup(chatId, messageId) {
        calls.push({ type: 'stripMarkup', chatId, messageId });
      },
    },
    async reply(text, extra) {
      const message_id = nextMessageId++;
      calls.push({ type: 'reply', text, extra, message_id });
      return { message_id };
    },
  };

  return { ctx, calls };
}

test('showScreen без сохранённого id шлёт новое сообщение и запоминает его id', async () => {
  const { ctx, calls } = makeCtx();

  await showScreen(ctx, 'Привет', { reply_markup: { inline_keyboard: [] } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'reply');
  assert.equal(ctx.session.screenMessageId, calls[0].message_id);
});

test('showScreen с сохранённым id редактирует существующее сообщение вместо нового', async () => {
  const { ctx, calls } = makeCtx({ screenMessageId: 55 });

  await showScreen(ctx, 'Другой текст', {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'edit');
  assert.equal(calls[0].messageId, 55);
  assert.equal(ctx.session.screenMessageId, 55);
});

test('showScreen падает обратно на reply, если старое сообщение больше не редактируется', async () => {
  const err = new Error('Bad Request: message to edit not found');
  const { ctx, calls } = makeCtx({ screenMessageId: 55, editShouldFail: err });

  await showScreen(ctx, 'Текст', {});

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'edit');
  assert.equal(calls[1].type, 'reply');
  assert.equal(ctx.session.screenMessageId, calls[1].message_id);
});

test('showScreen тихо считает "message is not modified" успехом, без лишней отправки', async () => {
  const err = { description: 'Bad Request: message is not modified: specified new message content...' };
  const { ctx, calls } = makeCtx({ screenMessageId: 55, editShouldFail: err });

  await showScreen(ctx, 'Тот же текст', {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'edit');
  assert.equal(ctx.session.screenMessageId, 55);
});

test('closeScreen убирает клавиатуру у текущего экрана и забывает его id', async () => {
  const { ctx, calls } = makeCtx({ screenMessageId: 55 });

  await closeScreen(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'stripMarkup');
  assert.equal(calls[0].messageId, 55);
  assert.equal(ctx.session.screenMessageId, null);
});

test('closeScreen без сохранённого id ничего не делает', async () => {
  const { ctx, calls } = makeCtx();

  await closeScreen(ctx);

  assert.equal(calls.length, 0);
});

// Регрессия: кнопки на экране профиля (см. profile.js) никогда не регистрировались как
// screenMessageId. Клик по ним раньше редактировал старый несвязанный screenMessageId
// где-то в истории чата — юзер жал кнопку и не видел никакого результата.
test('showScreen с callback-кнопкой редактирует именно кликнутое сообщение, а не старый screenMessageId', async () => {
  const { ctx, calls } = makeCtx({ screenMessageId: 55, callbackMessageId: 200 });

  await showScreen(ctx, 'Экран профиля превращается в выбор способа оплаты', {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'edit');
  assert.equal(calls[0].messageId, 200);
  assert.equal(ctx.session.screenMessageId, 200);
});

test('showScreen без callback-кнопки (например, ввод текста) продолжает использовать сохранённый screenMessageId', async () => {
  const { ctx, calls } = makeCtx({ screenMessageId: 55 });

  await showScreen(ctx, 'Текст', {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'edit');
  assert.equal(calls[0].messageId, 55);
});
