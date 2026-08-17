const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const config = require('./config');
const knex = require('./db');
const { bot } = require('./bot');

function buildApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'web', 'views'));
  app.set('layout', 'layout');
  app.use(expressLayouts);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'web', 'public')));

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
      cookie: {
        httpOnly: true,
        secure: config.isProduction,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
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
    res.status(404).send('Not found');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Необработанная ошибка Express:', err);
    res.status(500).send('Internal server error');
  });

  return app;
}

module.exports = buildApp;
