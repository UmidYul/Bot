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
  bot/          — Telegraf: хендлеры (start/profile/language/payment/joinRequest),
                  i18n (ru/uz), клавиатуры, меню, Postgres-сессии
  web/          — Express: роуты /admin/*, EJS-вьюхи, статика
  db/           — knexfile, migrations/, seeds/, repositories/
  payments/     — Click (Shop API webhook), Payme (JSON-RPC), Telegram Payments (sendInvoice)
  services/     — codeGenerator, promoService, accessService, receiptService,
                  adminNotifyService
  config.js     — чтение .env
  app.js        — сборка Express-приложения
  index.js      — точка входа, graceful shutdown
scripts/
  backup.js     — npm run backup — pg_dump + ротация старых бэкапов
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
7. Пропиши `ADMIN_NOTIFY_CHAT_IDS` (см. ниже) и настрой крон для бэкапов БД.

## Бэкапы Postgres

```
npm run backup
```

Делает `pg_dump` в custom-формате (`backups/tg_sub_bot_<дата>.dump`, восстанавливается
через `pg_restore`) и удаляет бэкапы старше `BACKUP_RETENTION_DAYS` (по умолчанию 7 дней).

- На VPS `pg_dump` обычно уже в `PATH` после установки `postgresql-client` — `PG_DUMP_PATH`
  можно оставить как `pg_dump`.
- На Windows-деве укажи полный путь в `.env`, например
  `PG_DUMP_PATH=C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`.

Крон на VPS (каждую ночь в 3:00):
```
0 3 * * * cd /path/to/app && /usr/bin/node scripts/backup.js >> backup.log 2>&1
```

Восстановление из бэкапа:
```
pg_restore --clean --if-exists -d tg_sub_bot backups/tg_sub_bot_20260101_030000.dump
```

## Уведомления админам в Telegram

Укажи в `.env` `ADMIN_NOTIFY_CHAT_IDS` (через запятую, свой id можно узнать у
[@userinfobot](https://t.me/userinfobot)) — и бот будет присылать туда:
- каждую новую успешную оплату (сумма, способ, номер платежа),
- всплеск неверных попыток ввода промокода (см. антиспам ниже),
- необработанные ошибки бота (с номером апдейта и текстом ошибки).

Пусто — уведомления просто не отправляются, остальной функционал не страдает.

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
- [ ] Когда Payme будет готов — `PAYME_ENABLED=true` и реальные `PAYME_MERCHANT_ID`/`SECRET_KEY`
- [ ] `ADMIN_NOTIFY_CHAT_IDS` заполнен (иначе уведомления о новых оплатах/ошибках не придут)
- [ ] Настроен крон для `npm run backup` (см. раздел «Бэкапы Postgres»)

## Что стоит держать в голове

- **Payme временно отключён** (`PAYME_ENABLED=false`) — кнопка скрыта из бота, но вебхук
  `/payments/payme` остаётся рабочим. Включается одной переменной в `.env`, без правок кода.
- **Click оплачивается по ссылке** (`src/payments/click.linkBuilder.js` строит
  `https://my.click.uz/services/pay?...` с уже подставленными `service_id`/`merchant_id`/
  `merchant_user_id`/`amount`/`transaction_param`) — кнопка в боте открывает приложение Click
  (или веб-чекаут, если приложения нет) с готовым платежом, без встроенного чек-аута Telegram.
  Подтверждение приходит через сырой Click Shop API (`src/payments/click.js`, Prepare/Complete)
  — тот же вебхук обслуживает и сценарий, когда юзер платит вручную через приложение Click по
  своему коду (виден в `/profile`), без прохождения через бота вообще. В личном кабинете Click
  для сервиса должны быть настроены Prepare URL и Complete URL на
  `https://<WEB_BASE_URL>/payments/click` — без этого вебхук не будет вызываться вообще.
  - **Единицы измерения суммы различаются**: Click Shop API и наша БД оперируют сумами (UZS),
  Payme — минимальными единицами (тийины, ×100). Пересчёт учтён в `payme.js` (`amountsMatch`).
  - **Идемпотентность**: оба платёжных пути (Click, Payme) написаны так, чтобы повторный
  вебхук не начислял доступ дважды и не удваивал `used_count` промокода — инкремент
  `used_count` атомарный (условный `UPDATE`), поэтому под конкурентной нагрузкой
  лимитированный промокод не может быть использован сверх `max_uses`.
- **Реальных merchant-данных Click/Payme (Shop API) ещё нет** —
  `src/payments/*.linkBuilder.js` содержат рабочую схему ссылки с явными `TODO`, которые
  нужно сверить в личных кабинетах перед боевым запуском.
- **Оплата "как за коммуналку" работает с холодного старта** — юзер может открыть
  приложение Click или Payme напрямую, минуя бота, найти сервис и ввести свой код
  (`/profile`) как номер лицевого счёта. На этот момент в БД ещё нет платежа — `click.js`
  (`resolveOrCreatePayment`) и `payme.js` (`resolveAccount`/`createTransaction`) сначала
  ищут существующий платёж по `merchant_trans_id`/`account`, а если не находят — пробуют
  найти юзера по этому же значению как по коду и заводят платёж на лету по текущей цене
  канала. Единая точка идентификации клиента везде одна — `users.code`, независимо от того,
  через бота пришла оплата или напрямую через приложение провайдера. Тот же паттерн
  закладывается под будущие провайдеры (UzumBank, Paynet — см. ниже).
- **UzumBank и Paynet — в планах, ещё не подключены.** Оба провайдера не поддерживают
  Telegram Payments (только прямую интеграцию по своему протоколу), и в отличие от Click/Payme
  не публикуют открытую документацию — у UzumBank она за JS-порталом, у Paynet доступ только
  через партнёрское соглашение (`marketing@paynet.uz`). Примерная схема (по независимой
  реализации PayTechUz, не официальная): UzumBank — REST, экшены `check/create/confirm/reverse/status`,
  Basic auth + `serviceId`; Paynet — JSON-RPC 2.0, `GetInformation/PerformTransaction/CheckTransaction/
  CancelTransaction/GetStatement`, Basic auth + обязательный IP-whitelisting сервера на их стороне.
  Перед реализацией нужно свериться с реальными доками от аккаунт-менеджера каждого провайдера —
  поля/подписи в открытых источниках не подтверждены официально.
- **Антиспам на промокоды**: после `PROMO_MAX_ATTEMPTS` (по умолчанию 5) неверных попыток
  подряд ввод блокируется на `PROMO_LOCKOUT_MINUTES` (по умолчанию 15) — защита от перебора
  кодов. Админ получает уведомление о блокировке, если настроен `ADMIN_NOTIFY_CHAT_IDS`.
- **Меню и профиль**: постоянное меню (👤 Профиль / 💳 Оплата / 🌐 Язык / ❓ Помощь) внизу
  экрана появляется после того, как юзер поделился телефоном; `/profile` показывает его код
  (моноширинным, тап копирует) — тот же код можно вписать в приложении Click как номер
  лицевого счёта для ручной оплаты.

## Тесты

```
npm test
```

Покрыта чистая логика скидок промокодов (`src/services/promoService.js`).
