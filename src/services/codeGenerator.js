const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // без 0,1,O,I,L — не спутать
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 20;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Генерирует уникальный 6-символьный код пользователя ("лицевой счёт"),
 * проверяя коллизии в БД и повторяя попытку при совпадении.
 * @param {import('knex').Knex} db
 * @returns {Promise<string>}
 */
async function generateUniqueUserCode(db) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    const existing = await db('users').where({ code }).first('id');
    if (!existing) return code;
  }
  throw new Error('Не удалось сгенерировать уникальный код пользователя за разумное число попыток');
}

module.exports = { generateUniqueUserCode, randomCode, ALPHABET, CODE_LENGTH };
