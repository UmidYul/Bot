const db = require('../index');

async function getAll() {
  const rows = await db('settings').select('key', 'value');
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

async function set(key, value) {
  await db('settings')
    .insert({ key, value: JSON.stringify(value), updated_at: db.fn.now() })
    .onConflict('key')
    .merge({ value: JSON.stringify(value), updated_at: db.fn.now() });
}

module.exports = { getAll, set };
