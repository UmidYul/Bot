# Telegram-бот подписки на закрытый канал + админ-панель

Один Node-процесс: Telegraf-бот (RU/UZ) + Express-админка на EJS + вебхуки Click/Payme,
все на одном HTTP-сервере и одном Postgres-пуле.

## Стек

- **Бот:** Telegraf
- **Сервер/админка:** Express + EJS
- **БД:** PostgreSQL, миграции и запросы — Knex.js
- **Сессии** (и бота, и админки) — хранятся в Postgres, переживают рестарт процесса

## Структура проекта

```
src/
  bot/          — Telegraf: хендлеры, i18n (ru/uz), клавиатуры, Postgres-сессии
  web/          — Express: роуты /admin/*, EJS-вьюхи, статика
  db/           — knexfile, migrations/, seeds/, repositories/
  payments/     — интеграции Click (Prepare/Complete) и Payme (JSON-RPC)
  services/     — codeGenerator, promoService, accessService (выдача/отзыв доступа)
  config.js     — чтение .env
  app.js        — сборка Express-приложения
  index.js      — точка входа, graceful shutdown
```

## Локальный запуск (Windows/PostgreSQL)

1. Установи зависимости:
   ```
   npm install
   ```

2. Убедись, что PostgreSQL запущен (служба `postgresql-x64-<версия>` в Windows) и слушает
   порт по умолчанию (5432). Создай базу:
   ```
   createdb -U postgres tg_sub_bot
   ```
   (пароль пользователя `postgres` должен совпадать с `DATABASE_URL` в `.env`).

3. Скопируй `.env.example` в `.env` (уже сделано в этом репозитории) и заполни как минимум:
   - `BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)
   - `DATABASE_URL` — например `postgres://postgres:admin@localhost:5432/tg_sub_bot`
   - `CHANNEL_ID` и `CHANNEL_INVITE_LINK` — см. раздел «Настройка канала» ниже

4. Прогони миграции и сид (создаст первого admin-пользователя из
   `ADMIN_SEED_LOGIN`/`ADMIN_SEED_PASSWORD`):
   ```
   npm run migrate
   npm run seed
   ```

5. Запусти в dev-режиме:
   ```
   npm run dev
   ```
   Health-check: http://localhost:3000/health
   Админка: http://localhost:3000/admin/login

### Важно про режим бота (webhook vs polling)

Telegram принимает вебхуки только на публичный HTTPS-адрес — `localhost` снаружи недостижим.
Поэтому в `src/config.js` реализовано автоопределение: если `WEB_BASE_URL` указывает на
`localhost`/`127.0.0.1`, бот сам запускается через `bot.launch()` (long-polling) — ничего
дополнительно поднимать (ngrok и т.п.) не нужно, бот сразу отвечает в Telegram.
Как только `WEB_BASE_URL` станет реальным HTTPS-доменом (продакшен), бот автоматически
переключится на `setWebhook` + приём апдейтов на `POST /telegram/webhook`.

## Настройка канала

1. В настройках канала в Telegram включи **Join Requests** (заявки на вступление с
   подтверждением) — только через приложение Telegram, не через API.
2. Добавь бота в канал администратором с правами: **Invite via Link, Add/Ban Users,
   Manage Chat** (минимум).
3. Один раз создай постоянную invite-ссылку с подтверждением заявок и пропиши её в
   `.env` как `CHANNEL_INVITE_LINK`:
   ```js
   await bot.telegram.createChatInviteLink(CHANNEL_ID, {
     creates_join_request: true,
     name: 'main',
   });
   ```
   Это можно выполнить одноразовым скриптом через `node -e "..."` с реальным `BOT_TOKEN`
   и `CHANNEL_ID`, скопировав `bot` из `src/bot`.

## Деплой на VPS

1. Клонируй репозиторий, `npm install --omit=dev`, настрой `.env` (реальные `BOT_TOKEN`,
   HTTPS `WEB_BASE_URL`, продовые ключи Click/Payme).
2. Подними Postgres на сервере, создай БД, прогони миграции:
   ```
   npm run migrate:latest
   npm run seed
   ```
3. Пропиши Telegram webhook (делается автоматически при старте процесса, если
   `WEB_BASE_URL` не localhost — см. `src/index.js`). Вручную это выглядит так:
   ```js
   bot.telegram.setWebhook(`${WEB_BASE_URL}/telegram/webhook`);
   ```
4. Запусти через PM2 с автозапуском при перезагрузке сервера:
   ```
   pm2 start src/index.js --name tg-sub-bot
   pm2 save
   pm2 startup
   ```
5. Настрой HTTPS (обязательно — и для Telegram webhook, и для вебхуков Click/Payme),
   например через Nginx + Let's Encrypt как reverse proxy перед портом из `PORT`.
6. Процесс поддерживает graceful shutdown — `pm2 restart`/`pm2 stop` корректно закрывают
   HTTP-сервер и пул Postgres перед завершением.

## Чек-лист перед продакшеном

- [ ] Канал переведён в режим Join Requests, бот добавлен админом с нужными правами
- [ ] Создана постоянная invite-ссылка через `createChatInviteLink`, прописана в `.env`
- [ ] Получены реальные merchant-данные Click (`service_id`, `merchant_id`,
      `merchant_user_id`, `secret_key`) и Payme (`merchant_id`, `secret_key`, `test_key`);
      формула `sign_string` (Click) и формат `account.*` (Payme) сверены с актуальной
      документацией и личным кабинетом провайдера
- [ ] Оба провайдера прогнаны в тестовом/sandbox режиме (у Payme есть официальная
      песочница — https://developer.help.paycom.uz/pesochnitsa/) до переключения на
      боевые ключи
- [ ] Проверен сценарий целиком: оплата → `chat_join_request` → авто-approve — вручную,
      с реального Telegram-аккаунта
- [ ] Проверен сценарий блокировки: заблокированный юзер не проходит по join request и
      кикается, если уже был в канале
- [ ] Настроен HTTPS (обязателен и для Telegram webhook, и для Click/Payme)
- [ ] `SESSION_SECRET` и `ADMIN_SEED_PASSWORD` заменены на боевые значения (не дефолтные
      dev-заглушки из `.env.example`)

## Что стоит держать в голове

- **Единицы измерения суммы различаются**: Click и наша БД оперируют сумами (UZS), Payme —
  тийинами (1 сум = 100 тийин). Пересчёт учтён в `src/payments/payme.js` (`amountsMatch`).
- **Идемпотентность**: оба провайдера могут слать повторные вебхуки — все обработчики
  (`click.js`, `payme.js`) написаны так, чтобы повторный запрос не начислял доступ дважды.
- **Реальных merchant-данных ещё нет** — `src/payments/*.linkBuilder.js` содержат рабочую
  схему ссылки с явными `TODO`, которые нужно сверить в личных кабинетах Click/Payme перед
  боевым запуском. Пока эти переменные пустые, бот вместо ссылки на оплату показывает
  номер платежа текстом (см. `src/bot/handlers/payment.js`).

## Тесты

```
npm test
```

Покрыта чистая логика скидок промокодов (`src/services/promoService.js`).
