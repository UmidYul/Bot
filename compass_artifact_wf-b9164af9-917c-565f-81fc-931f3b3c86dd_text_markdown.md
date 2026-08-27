# Интеграция платёжного API Click (Узбекистан, click.uz) в Telegram-бот через платёжную ссылку: разбор документации, типичные проблемы и техническое задание

## TL;DR
- Для «оплаты по ссылке» без Telegram Mini App используется связка **SHOP-API** (серверные callback-запросы Prepare/Complete от Click к мерчанту) + генерация ссылки вида `https://my.click.uz/services/pay?service_id=...&merchant_id=...&amount=...&transaction_param=...&return_url=...`. Сама ссылка НЕ требует подписи; подпись (MD5) проверяется только на входящих Prepare/Complete запросах.
- Ключевые технические факты из docs.click.uz: сумма `amount` передаётся **в сумах** (поле №5: «amount | float | Payment Amount (in soums)»), формат `1000.00`, НЕ в тийинах; алгоритмы MD5 для Prepare и Complete **различаются** (в Complete добавляется `merchant_prepare_id`); коды ошибок стандартизованы от `0` (успех) до `-9`.
- Click **не публикует IP-адреса** своих webhook-серверов — безопасность строится на проверке MD5-подписи, идемпотентности и HTTPS. IP-фильтрацию можно построить только эмпирически (по REMOTE_ADDR) или запросив адреса у техподдержки Click.

## Key Findings

1. **Правильный метод — SHOP-API + payment link.** Для Telegram-бота с оплатой по ссылке нужно реализовать два серверных обработчика (Prepare и Complete), которые Click вызывает POST-запросами. Оплатная ссылка генерируется на стороне бота простой конкатенацией GET-параметров; в кабинете `merchant.click.uz` указываются URL проверки (Prepare) и URL результата (Complete).
2. **Сумма в сумах, не в тийинах.** Это принципиальное отличие Click от Payme и Uzum (которые работают в тийинах, 1 сум = 100 тийин). Для Click `amount` = `float` «Payment Amount (in soums)», формат `1000.00` (в примере docs.click.uz используется `number_format(1000, 2, '.', '')`).
3. **Подпись MD5 отличается для Prepare и Complete.** Порядок конкатенации строгий, `SECRET_KEY` вставляется третьим элементом; в Complete между `merchant_trans_id` и `amount` добавляется `merchant_prepare_id`.
4. **Готовых production-grade npm-пакетов для Click практически нет.** Официальные библиотеки click-llc существуют только для PHP (click-integration-php), Python/Django и Android (Kotlin). Для Node.js есть только учебные репозитории (samarbadriddin0v/click-uz-integration-nodejs — ровно 85 stars и 4 forks, стек Node.js/Express/MongoDB; umaralimuminjonov/click-integration-example — 12 stars, тоже MongoDB) и малоизвестный TS SDK `@exode-team/click-uz.api`. Большинство разработчиков пишут интеграцию вручную — это ~150 строк кода.
5. **Callback-эндпоинт должен быть публично доступен по HTTPS** с валидным SSL-сертификатом; localhost/HTTP не годятся.

## Details: разбор Click API

### Способы интеграции и какой выбрать
Официальная документация (docs.click.uz) описывает несколько путей:
- **SHOP-API (CLICK-API)** — базовая схема: мерчант реализует Prepare и Complete эндпоинты, после чего его услуги становятся доступны для оплаты через любой интерфейс Click (веб my.click.uz, USSD, Telegram-бот, мобильное приложение). Это то, что нужно для «оплаты по ссылке».
- **Merchant API (`api.click.uz/v2/merchant/`)** — REST API с авторизацией по заголовку `Auth: merchant_user_id:sha1(timestamp+secret_key):timestamp`, включает Invoice (выставление счёта на номер телефона), card_token (оплата токенизированной картой), проверку статусов, реверс платежа.
- **Click Pass** — оплата по QR/OTP на кассе.
- **Telegram Payments (через BotFather)** и **Click Mini App** — исключены по условию задачи.

**Вывод:** для генерации платёжной ссылки нужен **SHOP-API** (Prepare/Complete) плюс endpoint генерации ссылки `my.click.uz/services/pay`. Merchant API (invoice/create) — опциональное дополнение, если нужно выставлять счёт на телефон, но для ссылки в боте он не обязателен.

### Генерация платёжной ссылки
URL-формат (Option 1 — redirect by link):
```
https://my.click.uz/services/pay?service_id={service_id}&merchant_id={merchant_id}&amount={amount}&transaction_param={transaction_param}&return_url={return_url}&card_type={card_type}
```
Параметры:
| Параметр | Обяз. | Описание |
|---|---|---|
| `merchant_id` | да | ID мерчанта |
| `service_id` | да | ID сервиса |
| `transaction_param` | да | ID заказа/логин — соответствует `merchant_trans_id` в SHOP-API |
| `amount` | да | Сумма, формат N.NN (в сумах) |
| `merchant_user_id` | нет | ID пользователя в системе мерчанта |
| `return_url` | нет | URL, куда вернётся пользователь после оплаты |
| `card_type` | нет | `uzcard` или `humo` |

Подпись при генерации ссылки НЕ требуется. `transaction_param` — это тот же идентификатор, который затем придёт обратно как `merchant_trans_id` в Prepare/Complete.

### Жизненный цикл транзакции: Prepare и Complete
Взаимодействие делится на 2 этапа, оба — POST-запросы от Click на URL мерчанта (данные приходят как form-urlencoded, аналог `$_POST`).

**Этап 1. Prepare (action=0)** — проверка возможности оплаты. Click присылает:
| Параметр | Тип | Описание |
|---|---|---|
| `click_trans_id` | bigint | ID транзакции (попытки) в Click |
| `service_id` | int | ID сервиса |
| `click_paydoc_id` | bigint | Номер платежа в Click (показывается клиенту в SMS) |
| `merchant_trans_id` | varchar | ID заказа/логин у мерчанта |
| `amount` | float | Сумма в сумах |
| `action` | int | 0 = Prepare |
| `error` | int | Код статуса (0 = ок) |
| `error_note` | varchar | Описание статуса |
| `sign_time` | varchar | Дата, формат `YYYY-MM-DD HH:mm:ss` |
| `sign_string` | varchar | MD5-подпись |

Мерчант отвечает JSON: `click_trans_id`, `merchant_trans_id`, `merchant_prepare_id` (ID платежа в биллинге мерчанта — обычно ID лог-записи), `error`, `error_note`.

**Этап 2. Complete (action=1)** — завершение платежа. Click присылает те же поля плюс `merchant_prepare_id` (который мерчант вернул на Prepare). Если `error < 0` — деньги не списались, платёж надо отменить. Мерчант отвечает JSON: `click_trans_id`, `merchant_trans_id`, `merchant_confirm_id`, `error`, `error_note`.

Важные замечания из документации (docs.click.uz/en/click-api-request/):
- Если ответ на Prepare был успешным и деньги списаны, ответ на Complete НЕ может быть ошибкой, кроме случаев `error = -4` (уже подтверждён) или `error = -9` (повторная попытка подтвердить ранее отменённый). Дословно: *«the response to the Complete request cannot be an error (unless the payment was previously confirmed error = -4 or a second attempt to confirm the previously canceled payment is done error = -9)»*.
- Если Click получает отрицательный ответ, а деньги уже списаны (например, из-за повторного запроса, когда Click не дождался ответа на предыдущий Complete), он пришлёт Complete с подтверждением платежа. Мерчант ОБЯЗАН ставить защиту от повторной оплаты по одному `click_trans_id`.
- Если ошибка в предоставлении услуги произошла после успешного списания, мерчант отвечает на Complete «успешно» и отдельно вызывает Merchant API `payment/reversal` (отмена платежа).
- При получении отрицательного кода мерчант должен отменить платёж в своём биллинге и вернуть `-9`.

### Алгоритм подписи (sign_string)
`SECRET_KEY` — приватный ключ, выдаётся при регистрации.

**Prepare:**
```
md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
```
**Complete** (добавляется `merchant_prepare_id` после `merchant_trans_id`):
```
md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
```
Все поля конкатенируются как строки без разделителей. `amount` в подписи должен совпадать **точно** со строкой, которую прислал Click (например `1000.00`) — переформатирование/приведение к float (`1000` или `1000.0`) ломает подпись (частая ошибка).

### Коды ошибок (error / error_note)
| error | error_note | Значение |
|---|---|---|
| 0 | Success | Успех |
| -1 | SIGN CHECK FAILED! | Ошибка проверки подписи |
| -2 | Incorrect parameter amount | Неверная сумма |
| -3 | Action not found | Действие не найдено |
| -4 | Already paid | Транзакция уже подтверждена (при попытке повторно подтвердить/отменить подтверждённую) |
| -5 | User does not exist | Пользователь/заказ не найден (проверить `merchant_trans_id`) |
| -6 | Transaction does not exist | Транзакция не найдена (проверить `merchant_prepare_id`) |
| -7 | Failed to update user | Ошибка при изменении данных пользователя (баланс и т.п.) |
| -8 | Error in request from click | Ошибка в запросе от Click (переданы не все параметры) |
| -9 | Transaction cancelled | Транзакция уже отменена |

### HTTP-ответы
Ответ мерчанта — JSON, HTTP-код 200. В официальных PHP-примерах заголовок `Content-Type: text/json; Charset: UTF-8` (на практике `application/json` также принимается). Структура ответа — плоский JSON-объект с полями error/error_note и идентификаторами.

### Статусы и идентификаторы
- `click_trans_id` — ID транзакции (попытки) в Click.
- `click_paydoc_id` — номер платёжного документа, виден клиенту в SMS.
- `merchant_trans_id` — ID заказа у мерчанта (= `transaction_param` из ссылки).
- `merchant_prepare_id` — ID, который мерчант генерирует и возвращает на Prepare; Click присылает его обратно в Complete.
- `merchant_confirm_id` — ID подтверждения на этапе Complete (может быть NULL).
- В Merchant API есть коды `payment_status` и `invoice_status` (например `-99 Deleted`).

### Тестовая среда
Официальный путь: специальное ПО-эмулятор (описано на docs.click.uz/en/click-api-testing/), где заполняются Prepare URL, Complete URL, service_id, merchant_user_id, secret_key, merchant_trans_id; выбирается сценарий из выпадающего меню и нажимается «Start Test». Все сценарии из таблицы «Scripts description» должны быть пройдены (статус «Done»), затем «Generate Report» — это запускает процедуру сверки и отправляет настройки на регистрационный сервер Click. URL должен быть доступен эмулятору. Успешную регистрацию можно проверить через merchant.click.uz.

### IP-фильтрация / whitelisting
Click **не публикует список IP-адресов**, с которых приходят Prepare/Complete. Ни в официальной документации, ни в официальных репозиториях click-llc, ни в сообществе разработчиков нет опубликованного allow-list (в отличие от Stripe, Paymentwall и др.). Мерчант регистрирует callback-URL (не IP). Практика:
- Основной механизм безопасности — проверка MD5-подписи. Ни один из просмотренных обработчиков (включая официальный PHP и эталонный gist uzbekdev1) не делает IP-фильтрацию — только проверку подписи.
- Если IP-фильтрация организационно обязательна — логировать `REMOTE_ADDR` входящих запросов и строить список эмпирически, либо запросить актуальные IP у техподдержки Click (info@click.uz, +998 71 231-08-80 / 71 202-88-80).
- Требуется публично доступный HTTPS-эндпоинт с валидным SSL (HTTP не поддерживается).

### Комиссии, лимиты, подключение
- **Тариф (co.click.uz):** подключение и использование системы — бесплатно; оплата за товары и услуги — **0% от суммы платежа**, исключение — отдельные сервисы с комиссией 1% («Исключение: сервисы с комиссией 1% от суммы платежа»). Реальная комиссия эквайринга фиксируется в договоре; по рыночным оценкам разработчиков она лежит в диапазоне ~0,8–2%. Компания лицензирована (Лицензии МРИТИК РУз АА №0006341, Лицензия ЦБ РУз №1).
- **Подключение:** регистрация на `merchant.click.uz`, загрузка копий документов бизнеса. Нужны юрлицо или ИП с ИНН и расчётным счётом, работающий сайт/сервис с описанием товаров/услуг, публичная оферта, контакты. После одобрения выдаются `merchant_id`, `service_id`, `merchant_user_id`, `secret_key`. Срок рассмотрения по опыту разработчиков — около двух недель (Click часто быстрее конкурентов). В кабинете прописываются URL проверки (Prepare) и результата (Complete).
- **Реверс (возврат):** Merchant API `DELETE /payment/reversal/{service_id}/{payment_id}` с заголовком `Auth`. Условия: платёж должен быть успешно завершён; отменять можно только платежи текущего отчётного месяца (платежи прошлого месяца — только в первый день текущего, при оплате Online-картой); реверс может быть отклонён со стороны UZCARD.

## Найденные типичные проблемы разработчиков и решения

1. **Неверный расчёт sign_string.** Самая частая проблема. Причины: (а) забыли, что для Complete формула другая (с `merchant_prepare_id`); (б) переформатировали `amount` перед хешированием (привели `"1000.00"` к `1000` или `1000.0`) — надо брать сырую строку из запроса; (в) неправильный порядок полей или лишние разделители; (г) неверный `SECRET_KEY`. Решение: конкатенировать строго сырые строковые значения из тела запроса в точном порядке.
2. **amount: сумы vs тийины.** Разработчики, ранее делавшие Payme/Uzum (тийины), ошибочно умножают на 100. В Click — сумы. Ошибка проявляется как `-2 Incorrect parameter amount`.
3. **Complete без Prepare / дублирующиеся запросы.** Click повторяет запросы при отсутствии/таймауте ответа. Нужна идемпотентность: по `click_trans_id` проверять, не обработан ли платёж. При повторном Complete по уже оплаченному — вернуть `-4`; по уже отменённому — `-9`; при отсутствии записи Prepare — `-6`.
4. **Race condition при параллельных запросах.** Дублирующиеся Prepare/Complete могут прийти одновременно. Решение: транзакции БД + `SELECT ... FOR UPDATE` (row lock) или уникальный индекс на `click_trans_id`.
5. **Неполучение callback.** localhost/туннели без стабильного HTTPS не работают. Нужен публичный домен с валидным SSL (в нашем случае `https://geek-shop.uz/payments/click`).
6. **Тип данных amount при сравнении.** Сравнивать сумму заказа с `amount` из запроса нужно с учётом дробной части (`1000.00`), иначе ложный `-2`.
7. **Статус только по callback.** Нельзя завершать заказ по `return_url` (пользователь может закрыть вкладку — деньги списаны, заказа нет). Источник истины — Complete callback.
8. **Отсутствие ежедневной сверки.** Рекомендуется раз в сутки сверять свои транзакции с выгрузкой Click — расхождения будут, вопрос лишь в том, узнаете вы о них через день или через месяц от клиента.

### npm-пакеты и SDK: оценка
- **Официального npm-пакета от Click нет.** Официальные библиотеки click-llc существуют только для PHP (click-integration-php — «This library allows you to integrate payment acceptance using 'CLICK' payment system into PHP web applications... connected to Click Merchant using the Shop API scheme»), Django (Python) и Android (Kotlin).
- **samarbadriddin0v/click-uz-integration-nodejs** (85 stars, 4 forks) — учебный пример на Express + MongoDB, полезен как референс, но не production-библиотека и завязан на MongoDB.
- **umaralimuminjonov/click-integration-example** (12 stars, Express + MongoDB), **bek-shoyatbek/payme-uzum-click-integration-example** (NestJS + Prisma) — примеры сообщества.
- **@exode-team/click-uz.api** — простой TS SDK, но малоизвестен и слабо поддерживается.
- **click-pkg / clickup_fastapi (PyPI)** — Python, не для Node.
- **Вывод:** для стека Node.js/Express/Telegraf/PostgreSQL целесообразнее **написать интеграцию вручную** (~150 строк) — SHOP-API прост, а внешние пакеты либо на других языках, либо учебные/неподдерживаемые. Использовать чужие репозитории как референс (особенно официальный PHP и gist uzbekdev1), но не как зависимость.

---

## ТЕХНИЧЕСКОЕ ЗАДАНИЕ: Оплата Click в Telegram-боте через платёжную ссылку

### 1. Контекст и цель
Telegram-бот подписки на видео-уроки. Стек: Node.js, Express, Telegraf, PostgreSQL. Нужно реализовать приём оплаты через Click по схеме «платёжная ссылка + SHOP-API callbacks». Вебхук-эндпоинт уже определён: `https://geek-shop.uz/payments/click` (регистрируется в кабинете merchant.click.uz как URL проверки и URL результата). Фокус ТЗ — только Click (Payme — отдельно).

### 2. Архитектура
1. Пользователь в боте выбирает тариф подписки → бот создаёт запись заказа в БД (`click_transactions`, статус `pending`), генерирует `merchant_trans_id` и платёжную ссылку.
2. Бот отправляет пользователю кнопку-ссылку (Telegraf `Markup.button.url`) на `https://my.click.uz/services/pay?...`.
3. Пользователь оплачивает на стороне Click.
4. Click шлёт **Prepare** (POST, action=0) на `https://geek-shop.uz/payments/click` → сервер валидирует подпись, находит заказ, резервирует, возвращает `merchant_prepare_id`.
5. Click шлёт **Complete** (POST, action=1) → сервер валидирует подпись и `merchant_prepare_id`, при `error=0` помечает заказ оплаченным и активирует подписку, уведомляет пользователя в боте.
6. `return_url` ведёт на страницу-заглушку/бота, но статус заказа меняется ТОЛЬКО по Complete.

### 3. Спецификация Express-роута `POST /payments/click`
- Принимает `application/x-www-form-urlencoded` (Click шлёт form-data). Подключить `express.urlencoded({ extended: true })`.
- Единый роут различает этап по полю `action`: `0` = Prepare, `1` = Complete.
- Алгоритм:
  1. Проверить наличие всех обязательных полей → иначе `{error:-8, error_note:'Error in request from click'}`.
  2. Проверить подпись (формула зависит от action) → иначе `{error:-1, error_note:'SIGN CHECK FAILED!'}`.
  3. Проверить `action` (0 или 1) → иначе `{error:-3, error_note:'Action not found'}`.
  4. Найти заказ по `merchant_trans_id` → иначе `{error:-5, error_note:'User does not exist'}`.
  5. Сверить сумму → иначе `{error:-2, error_note:'Incorrect parameter amount'}`.
  6. Для Complete: найти запись Prepare по `merchant_prepare_id` → иначе `{error:-6}`; если уже оплачено → `{error:-4}`; если отменено → `{error:-9}`.
  7. Успех Prepare → сохранить, вернуть `{click_trans_id, merchant_trans_id, merchant_prepare_id, error:0, error_note:'Success'}`.
  8. Успех Complete → активировать подписку, вернуть `{click_trans_id, merchant_trans_id, merchant_confirm_id, error:0, error_note:'Success'}`.
- Все ответы: HTTP 200, JSON.

### 4. Схема таблицы PostgreSQL
```sql
CREATE TABLE click_transactions (
  id                  BIGSERIAL PRIMARY KEY,
  merchant_trans_id   VARCHAR(64) UNIQUE NOT NULL,   -- наш ID заказа (= transaction_param)
  telegram_id         BIGINT NOT NULL,               -- Telegram user id
  plan_id             VARCHAR(32) NOT NULL,          -- тариф/подписка
  amount              NUMERIC(14,2) NOT NULL,        -- сумма в сумах
  click_trans_id      BIGINT,                        -- ID транзакции Click
  click_paydoc_id     BIGINT,                        -- номер платёжного документа
  merchant_prepare_id BIGINT,                        -- ID, возвращённый на Prepare
  status              VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|prepared|paid|cancelled
  error               INT,
  error_note          VARCHAR(255),
  sign_time           VARCHAR(32),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  prepared_at         TIMESTAMPTZ,
  confirmed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_click_trans_id
  ON click_transactions(click_trans_id) WHERE click_trans_id IS NOT NULL;

-- Отдельная таблица логов всех входящих webhook-запросов
CREATE TABLE click_webhook_logs (
  id          BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  remote_ip   VARCHAR(64),
  action      VARCHAR(8),
  raw_body    JSONB
);
```

### 5. Идемпотентность и защита от race condition
- Обрабатывать callback внутри транзакции БД с `SELECT ... FOR UPDATE` по строке заказа.
- Уникальный индекс на `click_trans_id` предотвращает двойную вставку.
- Перед завершением Complete проверять текущий `status`: если `paid` → вернуть `-4`; если `cancelled` → `-9`.
- Все входящие запросы логировать в `click_webhook_logs` (сырое тело + REMOTE_ADDR + timestamp) для отладки.

### 6. Отмена/возврат
- Если Complete приходит с `error < 0` — пометить заказ `cancelled`, подписку не выдавать, ответить корректным JSON (вернуть `-9`).
- Программный возврат уже оплаченного — Merchant API `DELETE /payment/reversal/{service_id}/{payment_id}` c заголовком `Auth: merchant_user_id:sha1(timestamp+secret_key):timestamp`.

### 7. Генерация merchant_trans_id
- Формат, гарантирующий уникальность и связь с пользователем/тарифом, например: `{telegram_id}-{planId}-{timestamp}` или UUID, сохранённый в БД. Не использовать «сырой» telegram_id как единственный ключ — нужна уникальность на каждый платёж (иначе повторная оплата перезапишет заказ).

### 8. Безопасность
- Проверка MD5-подписи на каждом callback (обязательно, это основной барьер).
- Только HTTPS с валидным SSL на `geek-shop.uz`.
- Логирование всех webhook-запросов.
- Опционально: firewall allow-list по IP, собранным эмпирически из REMOTE_ADDR или полученным от техподдержки Click (официального списка нет).
- Секреты (`CLICK_SECRET_KEY`) — только в `.env`, не в репозитории.

### 9. Тестовый чек-лист
- [ ] Успешная оплата (Prepare 0 → Complete 0 → подписка активна).
- [ ] Неверная подпись → `-1`.
- [ ] Недостаточная/неверная сумма → `-2`.
- [ ] Неверный action → `-3`.
- [ ] Повторный Complete по оплаченному → `-4`.
- [ ] Заказ не найден → `-5`.
- [ ] Complete без Prepare (нет merchant_prepare_id) → `-6`.
- [ ] Отсутствие обязательных полей → `-8`.
- [ ] Дублирующийся Prepare (идемпотентность, без двойного заказа).
- [ ] Complete с `error<0` → заказ отменён, ответ `-9`.
- [ ] Повторная попытка по отменённому → `-9`.
- [ ] Проверка, что подписка НЕ выдаётся по return_url без Complete.
- [ ] Прогон официального тест-эмулятора Click по всем сценариям.

### 10. Переменные окружения (.env)
```
CLICK_MERCHANT_ID=
CLICK_SERVICE_ID=
CLICK_SECRET_KEY=
CLICK_MERCHANT_USER_ID=
CLICK_CHECKOUT_URL=https://my.click.uz/services/pay
CLICK_RETURN_URL=https://geek-shop.uz/payment-success
CLICK_CALLBACK_PATH=/payments/click
DATABASE_URL=
BOT_TOKEN=
```

### 11. Пример кода (Node.js/Express)

**Генерация ссылки:**
```js
function generatePayLink({ amount, merchantTransId }) {
  const p = new URLSearchParams({
    service_id: process.env.CLICK_SERVICE_ID,
    merchant_id: process.env.CLICK_MERCHANT_ID,
    amount: Number(amount).toFixed(2),      // сумы, формат 1000.00
    transaction_param: merchantTransId,     // = merchant_trans_id
    return_url: process.env.CLICK_RETURN_URL,
  });
  return `${process.env.CLICK_CHECKOUT_URL}?${p.toString()}`;
}
```

**Проверка подписи (MD5, формулы различаются для Prepare/Complete):**
```js
const crypto = require('crypto');
function checkSign(b) {
  const secret = process.env.CLICK_SECRET_KEY;
  let base;
  if (String(b.action) === '0') {
    // Prepare
    base = `${b.click_trans_id}${b.service_id}${secret}${b.merchant_trans_id}${b.amount}${b.action}${b.sign_time}`;
  } else {
    // Complete (с merchant_prepare_id)
    base = `${b.click_trans_id}${b.service_id}${secret}${b.merchant_trans_id}${b.merchant_prepare_id}${b.amount}${b.action}${b.sign_time}`;
  }
  const md5 = crypto.createHash('md5').update(base).digest('hex');
  return md5 === b.sign_string;
}
```

**Обработчик webhook (псевдокод):**
```js
app.post('/payments/click', express.urlencoded({ extended: true }), async (req, res) => {
  const b = req.body;
  await logIncoming(b, req.ip); // click_webhook_logs

  const required = ['click_trans_id','service_id','merchant_trans_id','amount',
                    'action','sign_time','sign_string','click_paydoc_id'];
  if (!required.every(k => b[k] !== undefined))
    return res.json({ error: -8, error_note: 'Error in request from click' });

  if (!checkSign(b))
    return res.json({ error: -1, error_note: 'SIGN CHECK FAILED!' });

  const action = String(b.action);
  if (action !== '0' && action !== '1')
    return res.json({ error: -3, error_note: 'Action not found' });

  // транзакция БД с row lock (SELECT ... FOR UPDATE)
  const order = await getOrderForUpdate(b.merchant_trans_id);
  if (!order)
    return res.json({ error: -5, error_note: 'User does not exist' });

  if (Number(order.amount).toFixed(2) !== Number(b.amount).toFixed(2))
    return res.json({ error: -2, error_note: 'Incorrect parameter amount' });

  if (action === '0') {
    // Prepare
    const prepareId = await savePrepare(order, b); // status='prepared', сохранить click_trans_id
    return res.json({
      click_trans_id: b.click_trans_id,
      merchant_trans_id: b.merchant_trans_id,
      merchant_prepare_id: prepareId,
      error: 0, error_note: 'Success'
    });
  }

  // Complete
  if (!(await findPrepare(b.merchant_prepare_id, order)))
    return res.json({ error: -6, error_note: 'Transaction does not exist' });
  if (order.status === 'paid')
    return res.json({ error: -4, error_note: 'Already paid' });
  if (order.status === 'cancelled')
    return res.json({ error: -9, error_note: 'Transaction cancelled' });

  if (Number(b.error) < 0) {                 // деньги не списаны
    await cancelOrder(order, b);
    return res.json({ error: -9, error_note: 'Transaction cancelled' });
  }

  const confirmId = await markPaidAndActivate(order, b); // подписка + уведомление в бот
  return res.json({
    click_trans_id: b.click_trans_id,
    merchant_trans_id: b.merchant_trans_id,
    merchant_confirm_id: confirmId,
    error: 0, error_note: 'Success'
  });
});
```

## Recommendations
1. **Начать с получения мерчант-доступа** на merchant.click.uz в первый же день (срок ~2 недели по опыту разработчиков) — код пишется параллельно. Заранее подготовить юрлицо/ИП с ИНН и расчётным счётом, работающий сайт с описанием услуг и публичную оферту.
2. **Писать интеграцию вручную** на Node.js (не тянуть чужие npm-пакеты как зависимость) — SHOP-API прост, а поддерживаемого JS-SDK нет; учебные репозитории и официальный PHP-код использовать только как референс.
3. **Реализовать идемпотентность и row locking с самого начала** — это источник багов №1 (дублирующиеся Prepare/Complete, race conditions).
4. **Развернуть публичный HTTPS-эндпоинт с валидным SSL** на geek-shop.uz до тестирования; статус заказа менять только по Complete, никогда по return_url.
5. **Пройти официальный тест-эмулятор Click** по всем сценариям перед продакшеном; первый реальный платёж не должен быть первым платежом вообще.
6. **Настроить ежедневную сверку** транзакций с выгрузкой Click после запуска и мониторинг эндпоинта.
- **Порог смены подхода:** если появится официальный поддерживаемый npm-SDK от Click, или потребуется мультивалютность/сложный биллинг/токенизация карт (оплата без редиректа) — пересмотреть в пользу Merchant API (invoice, card_token) или готовой библиотеки.

## Caveats
- Click не публикует IP webhook-серверов — IP-фильтрацию нельзя настроить из документации, только эмпирически (по REMOTE_ADDR) или через поддержку. Основной барьер безопасности — проверка MD5-подписи.
- Точная комиссия эквайринга определяется договором; публичный тариф «0% от суммы платежа» относится к базовым услугам, реальные ставки индивидуальны, отдельные сервисы — 1%.
- Заголовок `Content-Type` ответа в официальных примерах Click — `text/json`; на практике `application/json` также принимается, но при проблемах стоит проверить.
- Документация docs.click.uz местами неполна и содержит опечатки (например, в примерах `typo=` вместо `type=`); при расхождениях ориентироваться на официальные репозитории click-llc и техподдержку.
- Сроки подключения и поведение модерации могут отличаться; оценка «~2 недели» основана на опыте разработчиков (vc.ru, uzneo.uz), а не на публичном SLA Click.
- Amount в SHOP-API — в сумах (`1000.00`), тогда как Payme и Uzum используют тийины; при мультипровайдерной интеграции держать конвертацию раздельно для каждой системы.