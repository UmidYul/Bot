const knexLib = require('knex');
const knexConfig = require('./knexfile');

const knex = knexLib(knexConfig);

module.exports = knex;
