ANSWER ONLY IN RUSSIAN
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

One Node process serving three things off a single Express app + single Postgres pool:
a Telegraf bot (RU/UZ) that sells paid access to a private Telegram channel, an Express+EJS
admin panel (`/admin/*`), and raw payment-provider webhooks (`/payments/*`). The admin panel
and API live at the public domain, but end users never see that domain — they only ever
interact through the bot; payment links point back to `t.me/<bot>`, not the site.

## Commands

```
npm run dev              # nodemon src/index.js — local dev, long-polling (see below)
npm start                # node src/index.js — prod, PM2-managed on the VPS
npm run migrate          # knex migrate:latest (alias: migrate:latest)
npm run migrate:make     # create a new migration file
npm run migrate:rollback
npm run seed             # seeds first admin user from ADMIN_SEED_LOGIN/ADMIN_SEED_PASSWORD
npm run backup           # pg_dump + rotate old dumps, see scripts/backup.js
npm test                 # node --test src/**/*.test.js
node --test src/services/promoService.test.js   # run a single test file
```

Local setup needs Postgres running and `.env` filled in (copy `.env.example`). Migrations use
an explicit `path.join(__dirname, '..', '.env')` in `src/config.js` because knex CLI changes
`process.cwd()` before running — don't rely on dotenv's default cwd-relative lookup elsewhere.

Bot mode is auto-detected in `src/config.js`: if `WEB_BASE_URL` points at `localhost`/`127.0.0.1`,
the bot runs via `bot.launch()` (long-polling, no ngrok needed for local dev); any real HTTPS
domain switches it to `setWebhook` + `POST /telegram/webhook` (done in `src/index.js` at startup).

Deploy is manual: `git pull` on the VPS, `pm2 restart tg-sub-bot`. There is no CI/CD and no
deploy hook from this repo — changes committed here do not take effect in production until
someone pulls and restarts on the server.

## Architecture

```
src/
  bot/          Telegraf: handlers/ (start, profile, language, payment, contact, joinRequest),
                i18n (ru/uz), keyboards, sessionStore (Postgres-backed), screen.js
  web/          Express admin: routes/admin.js, routes/payments.js, EJS views, i18n
  db/           knexfile, migrations/, seeds/, repositories/ (all DB access goes through these)
  payments/     click.js + click.linkBuilder.js, payme.js + payme.linkBuilder.js
  services/     codeGenerator, promoService, accessService, receiptService,
                adminNotifyService, broadcastService, settingsService
  config.js     reads .env into one singleton config object
  app.js        builds the Express app (mounts /telegram/webhook, /payments, /admin)
  index.js      entrypoint: loads DB-backed settings over config, starts HTTP server +
                bot (webhook or polling), graceful shutdown, unhandledRejection/uncaughtException
                safety net (a past bug in one SQL query used to kill the whole process)
scripts/
  backup.js         npm run backup
  test-click-api.js manual script for exercising the Click webhook locally
```

### Config is a mutable singleton, not just env

`config.js` builds one object from `process.env`. `settingsService.js` defines a table of
admin-editable settings (channel price, invite link, provider on/off toggles, promo anti-spam
limits, admin notify chat ids) that live in the `settings` table and get loaded **on top of**
the `.env` defaults at startup (`loadIntoConfig()`), then mutated live from the admin panel
(`updateFromForm()`) — every module reads `config.foo` at call time, so a change from `/admin`
takes effect immediately, no restart. Secrets (bot token, provider keys) stay `.env`-only and
are never in `settings`. `config.enabledPaymentProviders` is a getter (not a static array) for
the same reason — it always reflects the current toggle state.

### Payment providers: two independent webhook protocols, one shared user-identification pattern

- **Click** (`src/payments/click.js`): raw Click Shop API, MD5-signed Prepare/Complete callbacks
  at `POST /payments/click`. The pay link itself (`click.linkBuilder.js`) is built client-side
  with `service_id`/`merchant_id`/`merchant_user_id`/`amount`/`transaction_param` and opens
  `my.click.uz/services/pay` — no Telegram-native checkout involved. **Click's merchant cabinet
  must have Prepare/Complete URLs configured to `<WEB_BASE_URL>/payments/click`**, or the
  webhook is never called at all (this is external config, not fixable from code).
- **Payme** (`src/payments/payme.js`): JSON-RPC 2.0 over `POST /payments/payme`, Basic-auth
  checked against `PAYME_SECRET_KEY` (prod) or `PAYME_TEST_KEY` (sandbox) — only against
  **non-empty** keys, split on the **first** colon (Payme keys may contain colons), compared
  with `crypto.timingSafeEqual`. Currently gated behind `PAYME_ENABLED` (button hidden,
  webhook stays live) — see `settingsService`. The route always answers HTTP 200 with a valid
  JSON-RPC body: Payme reads any other status, any invalid body, and any `-32xxx` (including
  `-32504` auth failures) as "провайдер работает некорректно", so auth outcome, method and
  final response are logged to `logs/webhooks.log` (never the key itself — only scheme, login
  and length).
- Both webhooks handle a **"pay like a utility bill" cold-start path**: a user can open the
  Click/Payme app directly, skip the bot entirely, and enter their `users.code` (shown in
  `/profile`) as the account/transaction id. `resolveOrCreatePayment` (Click) /
  `resolveAccount`+`createTransaction` (Payme) look up a **`pending` payment of their own
  provider** by `merchant_trans_id` first, and if none exists, look up the user by `code` and
  create the payment on the fly. The lookup must stay provider-scoped: the same `users.code`
  is the account number for every provider, so a global "first row wins" lookup let whichever
  provider created the row first own that code forever (`-31050` for Payme, `-5` for Click).
  For the same reason `payments.merchant_trans_id` is no longer globally `UNIQUE` (migration
  `...0017`) — the invariant is now a partial unique index on
  `(provider, merchant_trans_id) WHERE status = 'pending'`, and
  `paymentsRepo.createOrGetPendingPayment` turns a lost race on it (SQLSTATE 23505) into
  "return the row the other request just created".
- Amounts: Click and the `payments` table are in UZS (sums); Payme is in tiyin (×100) — see
  `amountsMatch` in `payme.js`.
- Idempotency: both webhooks are written so a duplicate Prepare/Complete/Perform (retries are
  normal for both providers) never grants access twice and never double-increments a promo
  code's `used_count` (that increment is a conditional atomic `UPDATE`, safe under concurrency).
- A pre-charge safety check (`assertUserStillPayable`) runs before money moves (Click's Prepare,
  Payme's CheckPerformTransaction/CreateTransaction) but is deliberately **not** re-checked at
  the post-charge step (Complete/PerformTransaction) — by then the provider may have already
  taken the money, and refusing there would strand it with no access granted.
- Real merchant credentials/sign formats have open `TODO`s in the `linkBuilder` files — verify
  against each provider's dashboard/docs before relying on them in production.

### Bot conversation model

- `ctx.state.user` is loaded once per update by `bot/middleware/ensureUser.js` (null if unknown).
- Sessions persist in Postgres (`bot_sessions` table via `sessionStore.js`), so the bot survives
  restarts mid-conversation.
- `bot/screen.js`'s `showScreen`/`closeScreen` implement a single reusable "screen" message per
  chat (payment method choice, promo entry, etc.) — steps edit that one message in place instead
  of spamming new messages. When the update is a callback query, it edits *the message the button
  lives on* (not the remembered `screenMessageId`), because some screens (e.g. buttons shown from
  `/profile`) never registered a `screenMessageId` at all.
- Reply-keyboard menu buttons (`bot.hears(allVariants(...))`) take priority over "awaiting promo
  code" text-input state — pressing a menu button while mid-promo-entry must not be swallowed as
  a promo code guess.
- `guardActionable` in `handlers/payment.js` re-checks the user's live status before honoring a
  stale inline button click (e.g. from chat history) — blocked or already-paid users get routed
  back to their current screen instead of re-running payment/promo flows.

### User lifecycle

`users.status` (`new` → `pending` → `paid`) is the payment lifecycle only. Ban (`blocked_at`)
and soft-delete (`deleted_at`) are independent timestamp columns, not status values — blocking a
paid user and later unblocking them must restore `paid`, not reset to `new` (this was a real
past bug). Channel access is enforced at `chat_join_request` time
(`bot/handlers/joinRequest.js`): the channel must be in Join-Requests mode, and the bot
auto-approves only if the user exists, isn't blocked, and `status === 'paid'`.

### Cross-cutting

- `services/accessService.js` sends the invite link post-payment and revokes channel access on
  block (kick, not permanent ban — `unbanChatMember` is called right after so they aren't locked
  out of rejoining later).
- Admin-facing mutations (block/unblock/delete/promo changes/settings/broadcast) are recorded to
  `admin_logs` via `db/repositories/adminLogs.js` — check there before assuming "no audit trail."
- UzumBank/Paynet have `enabled` toggles in config/settings already but **no webhook
  implementation** — enabling them intentionally does not add a bot button
  (`enabledPaymentProviders` ignores them) until they're actually built.

