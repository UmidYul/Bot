# Telegram-бот подписки на закрытый канал + админ-панель
## Тех.спека и пошаговые промпты для реализации

**Стек:**
- Бот: Node.js + Telegraf
- Сайт/админка: Node.js + Express + EJS
- БД: PostgreSQL (локальная, на хостинге)
- Миграции/запросы: Knex.js (предположение — легко меняется на pg/Prisma, если не подходит)
- Архитектура: **один Node-процесс**, один Express-сервер на публичном домене с несколькими роутами:
  - `/telegram/webhook` — апдейты от Telegram (в т.ч. `chat_join_request`)
  - `/payments/click` — вебхук Click (Prepare/Complete)
  - `/payments/payme` — вебхук Payme (JSON-RPC)
  - `/admin/*` — админ-панель на EJS
  Так один и тот же Postgres-пул и один HTTPS-домен обслуживают всё — не нужно поднимать два сервиса.

---

## Как пользоваться этим файлом

Промпты скармливаются **по одному, по порядку**, ИИ-агенту с доступом к терминалу и файловой системе (Claude Code и т.п.) в контексте одного и того же репозитория. После каждого шага — проверить, что код собирается/запускается, закоммитить, и только потом переходить к следующему промпту. Не скармливать несколько промптов сразу одним сообщением — агент хуже держит контекст всей схемы.

---

## Схема БД (итоговая, для справки — не нужно копировать отдельно, она есть в Промпте 2)

- **users** — telegram_id, username, phone, language, `code` (уникальный 6-значный ID), status, created_at
- **payments** — user_id, provider, amount, promo_code_id, status, provider_trans_id, merchant_trans_id, raw_payload, paid_at
- **promo_codes** — code, type (percent/fixed/free), value, max_uses, used_count, expires_at, is_active
- **admins** — login, password_hash
- **admin_logs** — admin_id, action, target_user_id, meta, created_at

**Про уникальный ID (`code`):** 6 символов, A–Z (без O, I, L — чтобы не путать с 0/1) + цифры 2–9 (без 0, 1). Это и есть "лицевой счёт" — его же прописываем в Click/Payme как поле, по которому платёж находит юзера, если он платит вручную через приложение, а не по ссылке из бота.

---

## Промпт 1 — Инициализация проекта

```
Создай Node.js проект для Telegram-бота с оплатой и админ-панелью. Стек: Telegraf (бот), Express + EJS (админка), PostgreSQL через Knex.js (миграции + query builder). Всё работает в одном Node-процессе на одном Express-сервере.

Структура проекта:
- src/bot/ — логика Telegraf-бота (handlers, scenes/wizards, i18n)
- src/web/ — Express-роуты и EJS-вьюхи админки
- src/db/ — knexfile, migrations/, seeds/, репозитории для работы с таблицами
- src/payments/ — сервисы интеграции Click и Payme (заглушки пока)
- src/services/ — общая бизнес-логика (генерация кода, доступ в канал, промокоды)
- src/config.js — чтение переменных окружения
- src/app.js — сборка Express-приложения (webhook Telegram, вебхуки платежей, /admin)
- src/index.js — точка входа, запуск сервера

Настрой:
- package.json со скриптами: dev (nodemon), start, migrate, migrate:make, seed
- .env.example со всеми переменными: BOT_TOKEN, WEB_BASE_URL, PORT, DATABASE_URL, SESSION_SECRET, CHANNEL_ID, CHANNEL_INVITE_LINK, CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_MERCHANT_USER_ID, CLICK_SECRET_KEY, PAYME_MERCHANT_ID, PAYME_SECRET_KEY, PAYME_TEST_KEY, ADMIN_SEED_LOGIN, ADMIN_SEED_PASSWORD
- Подключение Telegraf в режиме webhook (не polling), Express должен принимать апдейты на /telegram/webhook и передавать их в bot.handleUpdate
- Базовая настройка express-session для будущей авторизации в админке
- README.md с инструкцией по запуску локально и деплою

Пока не пиши бизнес-логику бота/платежей/админки — только каркас, который запускается без ошибок (health-check роут GET /health возвращает "ok").
```

---

## Промпт 2 — Миграции и модели БД

```
Создай Knex-миграции для следующих таблиц (используй snake_case, добавь индексы на все внешние ключи и на поля, по которым будет поиск):

users:
  id serial pk
  telegram_id bigint unique not null
  username text
  phone text
  language text check in ('ru','uz') default 'ru'
  code char(6) unique not null   -- уникальный ID пользователя
  status text check in ('new','pending','paid','blocked') default 'new'
  created_at, updated_at timestamps

payments:
  id serial pk
  user_id fk -> users, on delete cascade
  provider text check in ('click','payme')
  amount numeric(12,2) not null
  currency text default 'UZS'
  promo_code_id fk -> promo_codes, nullable
  status text check in ('pending','paid','canceled','failed') default 'pending'
  provider_trans_id text        -- id транзакции на стороне Click/Payme
  merchant_trans_id text unique not null  -- наш внутренний id транзакции
  raw_payload jsonb             -- сырые данные последнего вебхука, для отладки
  paid_at timestamptz
  created_at, updated_at timestamps

promo_codes:
  id serial pk
  code text unique not null
  type text check in ('percent','fixed','free')
  value numeric(12,2) default 0   -- % для percent, сумма для fixed, игнорируется для free
  max_uses integer nullable
  used_count integer default 0
  expires_at timestamptz nullable
  is_active boolean default true
  created_at timestamp

admins:
  id serial pk
  login text unique not null
  password_hash text not null
  created_at timestamp

admin_logs:
  id serial pk
  admin_id fk -> admins
  action text not null
  target_user_id fk -> users, nullable
  meta jsonb
  created_at timestamp

Также создай:
- src/db/repositories/users.js — createUser, findByTelegramId, findByCode, updateStatus, blockUser, unblockUser, listUsers(filters, pagination)
- src/db/repositories/payments.js — createPayment, findByMerchantTransId, findByProviderTransId, markPaid, markFailed
- src/db/repositories/promoCodes.js — CRUD + findActiveByCode + incrementUsage
- src/db/repositories/admins.js — findByLogin
- src/services/codeGenerator.js — генерация уникального 6-символьного кода из алфавита "23456789ABCDEFGHJKMNPQRSTUVWXYZ" (без 0,1,O,I,L), с проверкой уникальности в БД и повтором при коллизии

Добавь seed-файл, создающий одного admin-пользователя из ADMIN_SEED_LOGIN/ADMIN_SEED_PASSWORD (пароль хешировать через bcrypt).
```

---

## Промпт 3 — Бот: старт, язык, номер телефона

```
Реализуй в src/bot/ базовый флоу Telegraf-бота с использованием сцен (telegraf/scenes) или простого state-машины на session middleware (используй telegraf-session-local или свою реализацию сессий на Postgres — на твой выбор, но session должна переживать перезапуск процесса).

Флоу:
1. /start — если юзера с таким telegram_id нет в БД, создать (сгенерировать уникальный code через codeGenerator, status='new'). Показать inline-клавиатуру выбора языка: 🇷🇺 Русский / 🇺🇿 O'zbekcha.
2. После выбора языка — сохранить language в БД, показать приветственное сообщение (используй i18n-словари, см. ниже) и кнопку "Поделиться номером" (reply keyboard с contact request).
3. После получения контакта — сохранить phone в БД, привязать именно к отправителю (проверить contact.user_id === ctx.from.id, чтобы юзер не мог прислать чужой контакт).
4. Дальше показать экран оплаты: цена канала (взять из конфига CHANNEL_PRICE), кнопка "Ввести промокод" и кнопка "Оплатить".

i18n: сделай src/bot/i18n/ru.js и src/bot/i18n/uz.js с объектом текстов (ключ -> строка), и хелпер t(lang, key) для подстановки. Все тексты бота должны идти через этот хелпер, никаких хардкод-строк в handlers.

Обработай кейсы:
- Юзер уже status='paid' — при /start сразу показывать "у вас уже есть доступ" + напоминание invite-ссылки, не гонять заново по анкете.
- Юзер status='blocked' — показывать сообщение о блокировке, дальше не пускать.
```

---

## Промпт 4 — Промокоды и создание платежа

```
Добавь в бота логику промокода и создания платежа перед интеграцией самих Click/Payme.

1. По кнопке "Ввести промокод" — запросить текст кода, найти в promo_codes (findActiveByCode: is_active=true, не истёк expires_at, used_count < max_uses или max_uses is null). Если невалиден — сообщение об ошибке, вернуть на экран оплаты без промокода.
2. Пересчитать финальную сумму:
   - type='percent' -> amount = price * (1 - value/100)
   - type='fixed' -> amount = max(price - value, 0)
   - type='free' -> amount = 0
3. Если amount === 0 (промокод на 100% бесплатный доступ):
   - создать payment со status='paid', provider='promo', amount=0, paid_at=now(), promo_code_id
   - увеличить used_count промокода
   - сразу вызвать сервис выдачи доступа (grantAccess, см. Промпт 7 — на этом шаге можно оставить как TODO-заглушку с комментарием, реализуем в промпте 7)
   - status юзера -> 'paid'
4. Если amount > 0 — показать выбор способа оплаты: Click / Payme (inline-кнопки).
5. После выбора способа — создать запись payments со status='pending', provider, amount, merchant_trans_id = сгенерированный уникальный uuid или `${user.code}-${Date.now()}` (главное — уникальность и разумная длина, т.к. Click/Payme ограничивают длину поля).
6. Пока нет реальной интеграции — на этом шаге просто выведи юзеру merchant_trans_id и сумму текстом ("здесь будет ссылка на оплату") — заменим на реальную ссылку в следующих промптах.

Также добавь src/services/promoService.js с функциями validatePromoCode(code) и calculateFinalAmount(price, promoCode) — покрой их простыми unit-тестами (можно на node:test), чтобы логика скидок была явно проверена.
```

---

## Промпт 5 — Интеграция Click (Prepare/Complete)

```
Реализуй интеграцию с платёжной системой Click по протоколу Shop API (Prepare/Complete).

Контекст протокола (сверься дополнительно с официальной документацией https://docs.click.uz/en/click-api-request/ перед финальным деплоем — там могут быть нюансы по конкретному service_id):
- Click присылает POST на наш вебхук с form-urlencoded или JSON телом, полями: click_trans_id, service_id, click_paydoc_id, merchant_trans_id, amount, action (0 = Prepare, 1 = Complete), error, error_note, sign_time, sign_string, merchant_prepare_id (только в Complete)
- sign_string — MD5-хэш для проверки подлинности запроса. Стандартная формула по документации Click Shop API:
  - Prepare: MD5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
  - Complete: MD5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
  ВАЖНО: перед продакшеном свериться с актуальной документацией/личным кабинетом Click — порядок конкатенации должен точно совпасть, иначе все запросы будут отклоняться.
- На Prepare нужно вернуть JSON: { click_trans_id, merchant_trans_id, merchant_prepare_id, error: 0, error_note: "Success" } (или error с кодом, если проверка не прошла)
- На Complete — аналогично, но уже финализировать оплату

Реализуй:
1. src/payments/click.js:
   - verifySignature(payload) — пересчитывает sign_string и сравнивает
   - handlePrepare(payload) — проверяет: 1) существует ли payment с таким merchant_trans_id и status='pending', 2) совпадает ли amount (с учётом округления/копеек), 3) сумма ещё не оплачена дважды. Возвращает merchant_prepare_id (можно = payments.id)
   - handleComplete(payload) — если error !== 0 от Click, помечает payment как failed. Если ок — помечает payment как paid, paid_at=now(), обновляет status юзера на 'paid', вызывает grantAccess(user) (заглушка, реализуем в промпте 7)
2. Роут POST /payments/click в src/web (или отдельно /payments/click/prepare и /payments/click/complete, если удобнее различать по action) — принимает и form-urlencoded, и JSON
3. Обработку идемпотентности: повторный Complete с тем же click_trans_id не должен повторно начислять доступ дважды
4. Логирование каждого входящего запроса в payments.raw_payload (append, не перезаписывать полностью — храни массив событий или JSONB с последним + добавь отдельную таблицу payment_events, если хочешь полную историю)

Также добавь src/payments/click.linkBuilder.js — функцию buildClickPayUrl(payment, user), формирующую ссылку на оплату для показа юзеру в боте. Точный формат query-параметров (service_id, merchant_id, amount, transaction_param и т.д.) уточни в личном кабинете Click при получении реальных мерчант-данных — оставь функцию с явно помеченными TODO-параметрами, которые легко поправить.
```

---

## Промпт 6 — Интеграция Payme (Merchant API, JSON-RPC)

```
Реализуй интеграцию с Payme по протоколу Merchant API (JSON-RPC 2.0), см. https://developer.help.paycom.uz/protokol-merchant-api/ и https://developer.help.paycom.uz/metody-merchant-api/ — свериться перед деплоем в продакшен.

Общее:
- Один POST-эндпоинт /payments/payme принимает JSON-RPC запросы: { method, params, id }
- Авторизация: заголовок Authorization: Basic <base64> — сверить с PAYME_SECRET_KEY (в песочнице — PAYME_TEST_KEY). Если не совпадает — вернуть JSON-RPC ошибку -32504 (Недостаточно привилегий)
- Идентификация заказа идёт через params.account — настрой в личном кабинете Payme, чтобы полем аккаунта было наше merchant_trans_id (или code пользователя — обсуди оба варианта в комментарии к коду, т.к. это настраивается в кабинете Payme, а не в коде)

Реализуй методы в src/payments/payme.js:
1. CheckPerformTransaction({amount, account}) — найти payment по account, проверить: существует, status='pending', сумма совпадает (Payme передаёт amount в тийинах — 1 сум = 100 тийин, не перепутать с суммой в БД, которая, видимо, в сумах). Вернуть { allow: true } либо ошибку с нужным кодом (-31050 — неверный аккаунт, -31001 — неверная сумма и т.д., см. документацию)
2. CreateTransaction({id, time, amount, account}) — идемпотентно создать/найти транзакцию Payme по id, привязать к payment (provider_trans_id = id), перевести payment.status='pending' (уже pending) с фиксацией времени создания транзакции на стороне Payme
3. PerformTransaction({id}) — подтвердить транзакцию: payment.status='paid', paid_at=now(), user.status='paid', вызвать grantAccess(user) (заглушка до промпта 7). При повторном вызове с тем же id — вернуть тот же результат, не начислять повторно
4. CancelTransaction({id, reason}) — отменить транзакцию: payment.status='canceled' (если ещё не был perform) или зафиксировать отмену уже оплаченной (реши, нужно ли откатывать доступ — для разовой оплаты можно просто залогировать и оставить на ручное решение админа)
5. CheckTransaction({id}) — вернуть текущее состояние транзакции в формате, который ожидает Payme (create_time, perform_time, cancel_time, transaction, state, reason)

Централизуй роутинг методов в одном файле (switch/case по method), с общей обработкой ошибок в формате JSON-RPC ({ error: { code, message } }).

Также добавь src/payments/payme.linkBuilder.js — функцию buildPaymeCheckoutUrl(payment, user), формирующую ссылку на чекаут Payme (обычно это base64-строка параметров после https://checkout.paycom.uz/). Точный формат уточни в личном кабинете Payme Business при получении реальных merchant-данных.
```

---

## Промпт 7 — Выдача доступа в канал (join request)

```
Реализуй сервис выдачи доступа в закрытый Telegram-канал.

Контекст: канал должен быть настроен в режиме "Join Requests" (заявки на вступление с подтверждением админа) — это делается вручную в настройках канала в Telegram, не через API. Один раз через бота или вручную создаётся постоянная invite-ссылка с параметром creates_join_request: true (используй bot.telegram.createChatInviteLink(CHANNEL_ID, { creates_join_request: true, name: 'main' })) — сохрани эту ссылку в конфиге/БД (таблица settings key-value или просто .env CHANNEL_INVITE_LINK).

Реализуй:
1. src/services/accessService.js:
   - grantAccess(user) — вызывается после успешной оплаты (из click.js, payme.js, и из бесплатного промокода). Отправляет юзеру сообщение в боте с CHANNEL_INVITE_LINK и текстом "нажмите Подать заявку, я приму автоматически"
   - revokeAccess(user) — используется при блокировке: если юзер уже в канале — banChatMember(CHANNEL_ID, user.telegram_id), затем сразу unbanChatMember (чтобы не банить навсегда, а просто кикнуть — если нужна именно перманентная блокировка, оставь banChatMember без unban и укажи это явно в комментарии)
2. Обработчик апдейта chat_join_request в src/bot/handlers/joinRequest.js:
   - bot.on('chat_join_request', async ctx => {...})
   - найти юзера по ctx.chatJoinRequest.from.id (telegram_id)
   - если юзер не найден — declineChatJoinRequest (это не наш платящий юзер)
   - если найден, status==='paid', не blocked — approveChatJoinRequest, отправить приветственное сообщение "Добро пожаловать!"
   - если найден, но status !== 'paid' (не оплатил) — declineChatJoinRequest + сообщение в боте "сначала оплатите доступ"
   - если blocked — declineChatJoinRequest без объяснений в канале (можно тихо залогировать)
   - Всё логировать (кто, когда, approve/decline и почему) — можно в тот же admin_logs с action='join_request_auto', target_user_id, meta

Убедись, что бот добавлен в канал админом с правами: приглашать пользователей по ссылке, добавлять/банить участников, одобрять заявки на вступление (Add Members, Ban Users, Invite via Link, Manage Chat минимум).

Подключи вызовы grantAccess(user) на места TODO, оставленные в Промптах 4-6.
```

---

## Промпт 8 — Админ-панель: авторизация и список пользователей

```
Реализуй в src/web/ админ-панель на Express + EJS.

1. Авторизация:
   - GET/POST /admin/login — форма логин/пароль, проверка через admins-репозиторий (bcrypt.compare)
   - Сессия на express-session (используй connect-pg-simple для хранения сессий в том же Postgres — не in-memory, т.к. сервер может рестартовать)
   - Middleware requireAuth — редиректит на /admin/login, если нет активной сессии. Применить ко всем /admin/* кроме /admin/login
   - GET /admin/logout

2. Список пользователей — GET /admin/users:
   - Таблица: code, telegram username, phone, язык, статус (с цветным бейджем), сумма последнего платежа, дата последнего платежа, способ оплаты, промокод (если был)
   - Поиск по code/телефону/username (querystring ?q=)
   - Фильтр по статусу (?status=paid|pending|blocked|new)
   - Пагинация (?page=)
   - Ссылка на карточку пользователя /admin/users/:id

3. Карточка пользователя — GET /admin/users/:id:
   - Полная инфа + история всех его payments (таблица: дата, provider, сумма, статус, промокод)
   - Кнопка "Изменить статус оплаты" (форма/select: pending/paid/failed для конкретного payment) — POST /admin/payments/:id/status, с записью в admin_logs
   - Кнопка "Заблокировать" / "Разблокировать" — POST /admin/users/:id/block и /unblock — вызывает revokeAccess(user) при блокировке, пишет в admin_logs

Оформление EJS — минималистичное, но опрятное: общий layout (layout.ejs) с шапкой и меню (Пользователи / Промокоды / Логи), таблицы с адекватными отступами. Можно подключить один CSS-файл без фреймворков или Bootstrap через CDN — на твой выбор, главное чтобы было читаемо.
```

---

## Промпт 9 — Админ-панель: промокоды и логи

```
Добавь в админку:

1. GET /admin/promo-codes — список промокодов (код, тип, значение, использовано/лимит, срок действия, активен ли), сортировка по created_at
2. GET/POST /admin/promo-codes/new — форма создания (code можно генерировать автоматически кнопкой "случайный" или вводить вручную; type: percent/fixed/free; value; max_uses — опционально; expires_at — опционально)
3. GET/POST /admin/promo-codes/:id/edit — редактирование (в т.ч. деактивация is_active=false вместо удаления, чтобы не ломать историю уже применённых платежей)
4. Валидация на сервере: code уникален, value в разумных пределах (percent 1-100), expires_at не в прошлом при создании

5. GET /admin/logs — таблица admin_logs (кто, что, над кем, когда), с фильтром по admin_id и по действию, пагинация

Всё через тот же layout.ejs, добавь пункты меню.
```

---

## Промпт 10 — Финальный проход, деплой, чек-лист

```
Подготовь проект к деплою на VPS-хостинг с локальным PostgreSQL:

1. Проверь и допиши .env.example — все переменные, использованные в коде, должны там быть с комментариями
2. Добавь npm-скрипт migrate:latest (запуск всех непрокатанных миграций) — используется при деплое
3. Настрой graceful shutdown (SIGTERM закрывает Postgres-пул и HTTP-сервер корректно)
4. Добавь простой health-check /health, не требующий авторизации, для мониторинга
5. Опиши в README.md:
   - Как поднять Postgres локально и создать БД
   - Как прописать webhook Telegram (bot.telegram.setWebhook(`${WEB_BASE_URL}/telegram/webhook`))
   - Как запускать процесс через PM2 (pm2 start src/index.js --name tg-sub-bot) с автозапуском на реболут
   - Чек-лист перед продакшеном:
     [ ] Настроить канал в режиме Join Requests, добавить бота админом с нужными правами
     [ ] Создать постоянную invite-ссылку через createChatInviteLink и прописать в конфиге
     [ ] Получить реальные merchant-данные Click (service_id, merchant_id, merchant_user_id, secret_key) и Payme (merchant_id, secret_key, test_key), свериться с актуальной документацией по sign_string / Authorization
     [ ] Прогнать оба провайдера в тестовом/sandbox режиме (у Payme есть официальная песочница — https://developer.help.paycom.uz/pesochnitsa/) прежде чем переключать на боевые ключи
     [ ] Проверить сценарий: оплата -> chat_join_request -> auto-approve — вручную, с реального Telegram-аккаунта
     [ ] Проверить сценарий блокировки: заблокированный юзер не может ни зайти по join request, ни остаться в канале, если уже был внутри
     [ ] Настроить HTTPS (обязательно и для Telegram webhook, и для Click/Payme вебхуков)
```

---

## Что стоит держать в голове по ходу разработки

- **Click и Payme передают суммы по-разному** — уточнить у каждого провайдера единицы измерения (сумы vs тийины) и не перепутать при сверке в CheckPerformTransaction/Prepare.
- **Идемпотентность** — оба провайдера могут слать повторные запросы (retry), везде должна быть защита от повторного начисления доступа.
- **Реальные merchant-данные** (service_id, merchant_id, secret_key) появятся только после регистрации мерчант-аккаунтов — до этого момента промпты 5 и 6 можно тестировать в sandbox/тестовом режиме каждого провайдера.
