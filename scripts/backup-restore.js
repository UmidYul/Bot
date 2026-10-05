#!/usr/bin/env node
/**
 * Скрипт для бэкапа БД и восстановления из файла
 * 
 * Использование:
 *   npm run backup:restore                    # Берёт бэкап текущей БД
 *   npm run backup:restore -- restore-file.dump  # Восстанавливает из файла
 *   npm run backup:restore -- list            # Показывает список всех бэкапов
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

function runCommand(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { 
      env: { ...process.env, ...env },
      stdio: ['pipe', 'inherit', 'inherit']
    });

    child.on('error', (err) => {
      reject(new Error(`Ошибка при запуске ${cmd}: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} завершился с кодом ${code}`));
      }
    });
  });
}

function getDbParams() {
  const url = new URL(config.databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

async function createBackup() {
  const dir = path.isAbsolute(config.backup.dir) 
    ? config.backup.dir 
    : path.join(__dirname, '..', config.backup.dir);
  
  fs.mkdirSync(dir, { recursive: true });

  const outFile = path.join(dir, `tg_sub_bot_${timestamp()}.dump`);
  const db = getDbParams();
  const env = db.password ? { PGPASSWORD: db.password } : {};

  const args = [
    '--host', db.host,
    '--port', db.port,
    '--username', db.username,
    '--format', 'custom',
    '--file', outFile,
    db.database,
  ];

  console.log(`📦 Создаём бэкап БД "${db.database}" -> ${outFile}`);
  
  try {
    await runCommand(config.backup.pgDumpPath, args, env);
    const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`✅ Бэкап создан: ${sizeKb} KB`);
    return outFile;
  } catch (err) {
    console.error(`❌ Ошибка при создании бэкапа: ${err.message}`);
    throw err;
  }
}

async function restoreBackup(backupFile) {
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Файл бэкапа не найден: ${backupFile}`);
  }

  const db = getDbParams();
  const env = db.password ? { PGPASSWORD: db.password } : {};

  const args = [
    '--host', db.host,
    '--port', db.port,
    '--username', db.username,
    '--clean',
    '--if-exists',
    '--no-acl',
    '--no-owner',
    '--dbname', db.database,
    backupFile,
  ];

  console.log(`🔄 Восстанавливаем БД "${db.database}" из ${path.basename(backupFile)}`);
  console.log(`⚠️  ВНИМАНИЕ: Все данные в текущей БД будут удалены!`);
  console.log('Продолжить? (введите "да" для подтверждения)');

  // Ждём подтверждения от пользователя
  return new Promise((resolve, reject) => {
    process.stdin.once('data', async (answer) => {
      if (answer.toString().trim().toLowerCase() !== 'да') {
        console.log('❌ Восстановление отменено');
        reject(new Error('Восстановление отменено пользователем'));
        return;
      }

      try {
        await runCommand('pg_restore', args, env);
        console.log(`✅ БД успешно восстановлена из ${path.basename(backupFile)}`);
        resolve();
      } catch (err) {
        console.error(`❌ Ошибка при восстановлении: ${err.message}`);
        reject(err);
      }
    });
  });
}

function listBackups() {
  const dir = path.isAbsolute(config.backup.dir) 
    ? config.backup.dir 
    : path.join(__dirname, '..', config.backup.dir);

  if (!fs.existsSync(dir)) {
    console.log('📁 Папка с бэкапами не найдена');
    return;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.dump'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f,
        size: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
        mtime: new Date(stat.mtimeMs).toLocaleString('ru-RU'),
        path: filePath,
      };
    })
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

  if (files.length === 0) {
    console.log('📭 Бэкапов не найдено');
    return;
  }

  console.log('📦 Доступные бэкапы:\n');
  files.forEach((f, i) => {
    console.log(`${i + 1}. ${f.name}`);
    console.log(`   Размер: ${f.size}, Дата: ${f.mtime}`);
  });

  console.log('\n📌 Путь для восстановления:');
  console.log(`   npm run backup:restore -- "${files[0].path}"`);
}

async function main() {
  const action = process.argv[2] || 'backup';

  try {
    if (action === 'backup') {
      await createBackup();
    } else if (action === 'list') {
      listBackups();
    } else if (action === 'restore') {
      const backupFile = process.argv[3];
      if (!backupFile) {
        console.error('❌ Укажите файл бэкапа для восстановления');
        console.log('Например: npm run backup:restore -- restore-file.dump');
        process.exit(1);
      }
      await restoreBackup(backupFile);
    } else {
      console.error(`❌ Неизвестное действие: ${action}`);
      console.log('Допустимые действия: backup, restore, list');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
}

main();