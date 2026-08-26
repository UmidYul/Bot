const fs = require('fs');
const path = require('path');

/**
 * Пишет диагностику вебхуков в файл на диске, а не только в stdout — на этом хостинге
 * (cPanel Node.js Selector / Passenger) stdout процесса нигде не сохраняется постоянно:
 * UI показывает вывод только в момент рестарта/остановки, а сам процесс Passenger может
 * простаивать и перезапускаться между запросами, из-за чего живые логи реальной оплаты
 * можно было упустить безвозвратно. Файл переживает рестарт процесса и cPanel/Passenger.
 * Секреты (secretKey/sign_string) сюда никогда не передаются вызывающим кодом.
 */
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'webhooks.log');

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  console.error('webhookLogger: не удалось создать директорию логов:', err.message);
}

function logToFile(tag, event, data) {
  const line = `${new Date().toISOString()} [${tag}] ${event} ${JSON.stringify(data)}`;
  console.log(line);
  fs.appendFile(LOG_FILE, line + '\n', (err) => {
    if (err) console.error('webhookLogger: не удалось записать в файл лога:', err.message);
  });
}

module.exports = { logToFile, LOG_FILE };
