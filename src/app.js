const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const config = require('./config');
const knex = require('./db');
const { bot } = require('./bot');
const { logToFile } = require('./utils/webhookLogger');

function buildApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'web', 'views'));
  app.set('layout', 'layout');
  app.use(expressLayouts);

  // Логируем факт прихода запроса ДО парсинга тела — это единственный способ отличить
  // "вебхук вообще не дошёл до Node" (ничего не появится в logs/webhooks.log) от
  // "дошёл, но что-то пошло не так дальше" (см. диагностику реальной оплаты Click,
  // которая по логам от click.js не была видна вообще — деньги списались, а сервер
  // "не увидел" запрос). Отдельная секция ниже логирует /payments/* ещё подробнее.
  app.use((req, res, next) => {
    logToFile('http', `${req.method} ${req.originalUrl} — получен`, {
      ip: req.ip,
      content_type: req.headers['content-type'] || null,
      content_length: req.headers['content-length'] || null,
    });
    next();
  });

  // verify сохраняет сырое тело запроса ДО попытки его распарсить — если Click/Payme
  // пришлют что-то, что не распознается как валидный JSON/urlencoded (или наши проверки
  // ниже отклонят запрос), в логе всё равно будет видно, что реально пришло по проводам.
  function captureRawBody(req, res, buf) {
    req.rawBody = buf.toString('utf8');
  }

  app.use(express.json({ verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
  app.use(express.static(path.join(__dirname, 'web', 'public')));

  // Ещё один слой логирования — специально для платёжных вебхуков, уже после парсинга
  // тела: показывает точно то же самое, что увидит обработчик в req.body, плюс сырую
  // строку тела (req.rawBody) на случай расхождения (неверный Content-Type у отправителя,
  // "пустой" распарсенный body при непустом сыром и т.п.).
  app.use('/payments', (req, res, next) => {
    logToFile('http', `${req.method} ${req.originalUrl} — тело запроса`, {
      ip: req.ip,
      content_type: req.headers['content-type'] || null,
      raw_body: req.rawBody || null,
      parsed_body: req.body,
    });
    next();
  });

  // Сессии для админки — храним в том же Postgres, чтобы переживали рестарт процесса.
  const pgSession = require('connect-pg-simple')(session);
  app.use(
    session({
      store: new pgSession({
        knex,
        tableName: 'session',
        createTableIfMissing: true,
      }),
      name: 'sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      // rolling: true — maxAge отсчитывается заново при каждом запросе, то есть это таймаут
      // БЕЗДЕЙСТВИЯ (ADMIN_SESSION_MAX_AGE_HOURS, по умолчанию 24ч), а не жёсткий разлогин
      // через 24ч даже у активно работающего админа.
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * config.adminSessionMaxAgeHours,
      },
    })
  );

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Telegram webhook. В режиме long-polling (см. src/config.js) апдейты приходят
  // не сюда, а через bot.launch() — роут всё равно остаётся рабочим для прод-режима.
  app.post('/telegram/webhook', (req, res) => {
    bot.handleUpdate(req.body, res).catch((err) => {
      console.error('Ошибка обработки Telegram-апдейта:', err);
      if (!res.headersSent) res.sendStatus(500);
    });
  });

  app.use('/payments', require('./web/routes/payments'));
  app.use('/admin', require('./web/routes/admin'));

  app.use((req, res) => {
    // Часто именно так выглядит "деньги списались, а сервер не увидел" — Click стучится
    // не туда (опечатка/лишний слэш в Prepare/Complete URL в кабинете merchant.click.uz,
    // не тот метод и т.п.) — без этого лога такой запрос был бы не виден нигде.
    logToFile('http', `${req.method} ${req.originalUrl} — 404 Not found`, { ip: req.ip });
    res.status(404).send('Not found');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Необработанная ошибка Express:', err);
    logToFile('http', `${req.method} ${req.originalUrl} — необработанная ошибка Express`, {
      ip: req.ip,
      message: err.message,
      raw_body: req.rawBody || null,
    });
    res.status(500).send('Internal server error');
  });

  return app;
}

module.exports = buildApp;
