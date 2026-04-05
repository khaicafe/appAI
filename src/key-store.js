const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');

const KEY_NAMES = ['openrouterApiKey', 'geminiApiKey', 'telegramBotToken'];

let sqlPromise;
let databasePromise;

function getHomeDir() {
  return process.env.USERPROFILE || os.homedir();
}

function getKeyStorePath() {
  const baseDir = process.env.APPDATA || path.join(getHomeDir(), 'AppData', 'Roaming');
  return path.join(baseDir, 'openclaw-controller', 'keys.sqlite');
}

function getEmptyKeyRecord() {
  return {
    openrouterApiKey: null,
    geminiApiKey: null,
    telegramBotToken: null,
  };
}

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
  }

  return sqlPromise;
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const SQL = await getSql();
      const storePath = getKeyStorePath();
      const db = fs.existsSync(storePath)
        ? new SQL.Database(fs.readFileSync(storePath))
        : new SQL.Database();

      db.run(`
        CREATE TABLE IF NOT EXISTS app_keys (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      return db;
    })();
  }

  return databasePromise;
}

async function persistDatabase(db) {
  const storePath = getKeyStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, Buffer.from(db.export()));
}

async function getSavedKeys() {
  const db = await getDatabase();
  const savedKeys = getEmptyKeyRecord();
  const result = db.exec('SELECT key, value FROM app_keys');

  if (result.length === 0) {
    return savedKeys;
  }

  const [table] = result;
  for (const [key, value] of table.values) {
    if (KEY_NAMES.includes(key)) {
      savedKeys[key] = typeof value === 'string' && value.trim() ? value.trim() : null;
    }
  }

  return savedKeys;
}

async function saveKeys(partialKeys = {}) {
  const db = await getDatabase();
  const statement = db.prepare(`
    INSERT INTO app_keys (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  let changed = false;
  const timestamp = new Date().toISOString();

  try {
    for (const keyName of KEY_NAMES) {
      const value = partialKeys[keyName];
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }

      statement.run([keyName, value.trim(), timestamp]);
      changed = true;
    }
  } finally {
    statement.free();
  }

  if (changed) {
    await persistDatabase(db);
  }

  return getSavedKeys();
}

module.exports = {
  getKeyStorePath,
  getSavedKeys,
  saveKeys,
};