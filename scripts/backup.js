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

  const removed = cleanupOldBackups(dir, config.backup.retentionDays);
  if (removed.length) {
    console.log(`Удалены старые бэкапы (старше ${config.backup.retentionDays} дн.): ${removed.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Бэкап не удался:', err.message);
  process.exit(1);
});
