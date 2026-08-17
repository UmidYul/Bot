const path = require('path');
const config = require('../config');

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: path.join(__dirname, 'seeds'),
  },
};
