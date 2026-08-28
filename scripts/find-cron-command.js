#!/usr/bin/env node
/**
 * Печатает готовую команду для cron-задачи бэкапа (см. scripts/backup.js) — путь к проекту
 * вычисляется от расположения этого файла на диске (всегда точный, гадать не надо), а путь
 * до virtualenv-активации cPanel Node.js Selector (nodevenv/.../bin/activate) ищется:
 *   1) если сам этот скрипт запущен УЖЕ внутри активированного nodevenv — берём из
 *      process.execPath (путь к текущему node-бинарнику лежит в той же папке, что activate);
 *   2) иначе — сканируем ~/nodevenv и печатаем все найденные activate-скрипты на выбор.
 *
 * Запуск на сервере (SSH или "Terminal" в cPanel):  node scripts/find-cron-command.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const logFile = path.join(projectRoot, 'backup.log');
const home = os.homedir();

function findActivateFromCurrentProcess() {
  // Внутри активированного nodevenv process.execPath — это .../nodevenv/<app>/<version>/bin/node,
  // а activate лежит рядом, в той же папке bin/.
  if (!process.execPath.includes('nodevenv')) return null;
  const candidate = path.join(path.dirname(process.execPath), 'activate');
  return fs.existsSync(candidate) ? candidate : null;
}

function scanForActivateScripts(root, maxDepth = 6) {
  const found = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return; // нет доступа/не существует — просто пропускаем
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'activate' && dir.endsWith(`${path.sep}bin`)) {
        found.push(full);
      } else if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }
  if (fs.existsSync(root)) walk(root, 0);
  return found;
}

function buildCommand(activatePath) {
  return `source ${activatePath} && cd ${projectRoot} && node scripts/backup.js >> ${logFile} 2>&1`;
}

console.log(`Папка проекта (для "cd"):\n  ${projectRoot}\n`);

const fromProcess = findActivateFromCurrentProcess();
const nodevenvDir = path.join(home, 'nodevenv');
const scanned = scanForActivateScripts(nodevenvDir);

if (fromProcess) {
  console.log('Скрипт запущен внутри активированного virtualenv — путь найден точно:');
  console.log(`  ${fromProcess}\n`);
  console.log('Готовая команда для поля "Command" в cPanel Cron Jobs:\n');
  console.log(buildCommand(fromProcess));
} else if (scanned.length === 1) {
  console.log(`Найден один virtualenv в ${nodevenvDir}:`);
  console.log(`  ${scanned[0]}\n`);
  console.log('Готовая команда для поля "Command" в cPanel Cron Jobs:\n');
  console.log(buildCommand(scanned[0]));
} else if (scanned.length > 1) {
  console.log(`Найдено несколько virtualenv в ${nodevenvDir} — выберите тот, что относится к этому проекту`);
  console.log('(обычно путь внутри содержит имя папки приложения):\n');
  scanned.forEach((p) => {
    console.log(`  ${p}`);
    console.log(`  Команда: ${buildCommand(p)}\n`);
  });
} else {
  console.log(`Не нашёл ни одного nodevenv в ${nodevenvDir}.`);
  console.log('Это нормально, если вы не на cPanel Node.js Selector (например, обычный VPS с системным Node) —');
  console.log('тогда просто:\n');
  console.log(`  cd ${projectRoot} && node scripts/backup.js >> ${logFile} 2>&1`);
  console.log('\nЕсли это всё же cPanel — проверьте вручную в "Setup Node.js App" → ваше приложение →');
  console.log('строку "To enter to the virtual environment, run the command:" и вставьте её вместо "source ...".');
}

console.log('\nПоля формы cPanel Cron Jobs: Минута=0, Час=3, День=*, Месяц=*, День недели=* (каждый день в 3:00).');
