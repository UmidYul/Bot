#!/usr/bin/env node
/**
 * Бэкап Postgres через pg_dump в custom-формате (-Fc — уже сжат, восстанавливается
 * через pg_restore). Плюс ротация: бэкапы старше BACKUP_RETENTION_DAYS удаляются.
 *
 * Использование: npm run backup
 * Крон на VPS:    0 3 * * * cd /path/to/app && /usr/bin/node scripts/backup.js >> backup.log 2>&1
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../src/config');

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runDump(dbUrl, outFile) {
  return new Promise((resolve, reject) => {
    const url = new URL(dbUrl);
    const env = { ...process.env };
    if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

    const args = [
      '--host',
      url.hostname,
      '--port',
      url.port || '5432',
      '--username',
      decodeURIComponent(url.username),
      '--format',
      'custom',
      '--file',
      outFile,
      decodeURIComponent(url.pathname.slice(1)),
    ];

    const child = spawn(config.backup.pgDumpPath, args, { env });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Не удалось запустить pg_dump (${config.backup.pgDumpPath}): ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump завершился с кодом ${code}: ${stderr.trim()}`));
    });
  });
}

// Лимит Telegram Bot API на файлы, загружаемые ботом напрямую (без локального Bot API
// сервера) — 50 МБ. Если дамп больше, просто предупреждаем и не пытаемся отправить —
// сам бэкап на диске от этого никак не страдает.
const TELEGRAM_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Шлёт готовый .dump файлом в Telegram (см. config.backup.telegramChatId) через голый
 * Bot API (fetch/FormData/Blob — все встроены в Node, без node-fetch/telegraf), а не через
 * живой bot-инстанс из src/bot — этот скрипт может запускаться из cron независимо от
 * основного процесса, поднимать полноценный Telegraf с вебхуком здесь ни к чему.
 * Best-effort: падение отправки не должно превращать успешный бэкап в "неудачный" —
 * файл уже благополучно лежит на диске, это просто уведомление.
 */
async function sendToTelegram(filePath, caption) {
  const chatId = config.backup.telegramChatId;
  if (!chatId) return;

  if (!config.botToken) {
    console.warn('BACKUP_TELEGRAM_CHAT_ID задан, но BOT_TOKEN пуст — отправка бэкапа в Telegram пропущена.');
    return;
  }

  const size = fs.statSync(filePath).size;
  if (size > TELEGRAM_MAX_FILE_BYTES) {
    console.warn(
      `Бэкап ${(size / 1024 / 1024).toFixed(1)} МБ превышает лимит Telegram на загрузку ботом (50 МБ) — файл не отправлен, только сохранён локально.`
    );
    return;
  }

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();

    if (!data.ok) {
      throw new Error(`Telegram API: ${data.description || res.status}`);
    }
    console.log(`Бэкап отправлен в Telegram (chat_id=${chatId}).`);
  } catch (err) {
    console.error('Не удалось отправить бэкап в Telegram:', err.message);
  }
}

function cleanupOldBackups(dir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.dump')) continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}

async function main() {
  const dir = path.isAbsolute(config.backup.dir) ? config.backup.dir : path.join(__dirname, '..', config.backup.dir);
  fs.mkdirSync(dir, { recursive: true });

  const outFile = path.join(dir, `tg_sub_bot_${timestamp()}.dump`);

  console.log(`Бэкап БД -> ${outFile}`);
  await runDump(config.databaseUrl, outFile);

  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`Готово, ${sizeKb} KB`);

  await sendToTelegram(outFile, `🗄 Бэкап БД\n${path.basename(outFile)}\n${sizeKb} KB`);

  const removed = cleanupOldBackups(dir, config.backup.retentionDays);
  if (removed.length) {
    console.log(`Удалены старые бэкапы (старше ${config.backup.retentionDays} дн.): ${removed.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Бэкап не удался:', err.message);
  process.exit(1);
});
