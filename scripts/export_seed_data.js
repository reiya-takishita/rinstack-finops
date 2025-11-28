'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function loadDbConfig(envName) {
  const configPath = path.resolve(__dirname, '../config/config.json');
  const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const env = json[envName];
  if (!env) throw new Error(`DB config for env ${envName} not found in config.json`);
  return { host: env.host, user: env.username, password: env.password, database: env.database };
}

async function listTables(conn, dbName) {
  const [rows] = await conn.execute(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = ? AND table_type='BASE TABLE' ORDER BY TABLE_NAME",
    [dbName]
  );
  return rows.map(r => r.name);
}

async function listPrimaryKeys(conn, dbName, table) {
  const [rows] = await conn.execute(
    "SELECT COLUMN_NAME AS column_name FROM information_schema.KEY_COLUMN_USAGE WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY' ORDER BY ORDINAL_POSITION",
    [dbName, table]
  );
  return rows.map(r => r.column_name);
}

async function listColumnsAlpha(conn, dbName, table) {
  const [rows] = await conn.execute(
    "SELECT COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY COLUMN_NAME",
    [dbName, table]
  );
  return rows.map(r => r.column_name);
}

function toStablePrimitive(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Date) return value.toISOString();
  // Keep numbers/strings/booleans as-is; mysql2 tends to return strings for DECIMAL
  return value;
}

function projectRowWithOrder(row, columnsOrder) {
  const projected = {};
  for (const col of columnsOrder) projected[col] = toStablePrimitive(row[col]);
  return projected;
}

function buildOrderByClause(columns) {
  if (!columns.length) return '';
  const parts = columns.map(c => `\`${c}\``).join(', ');
  return ` ORDER BY ${parts}`;
}

async function dumpOneTable(conn, dbName, table) {
  const primaryKeys = await listPrimaryKeys(conn, dbName, table);
  const fallbackCols = await listColumnsAlpha(conn, dbName, table);
  const orderCols = primaryKeys.length ? primaryKeys : fallbackCols;
  const orderBy = buildOrderByClause(orderCols);

  const [rows] = await conn.execute(`SELECT * FROM \`${table}\`${orderBy}`);
  if (!rows || rows.length === 0) return 0;

  // 固定キー順で整形（アルファベット順）
  const columnsForOutput = fallbackCols.length ? fallbackCols : Object.keys(rows[0]).sort();

  // テーブル見出し（diffしやすいように簡潔に）
  // eslint-disable-next-line no-console
  console.log(`## table: ${table} rows=${rows.length}`);
  for (const r of rows) {
    const obj = projectRowWithOrder(r, columnsForOutput);
    // JSON Lines（キー順は挿入順で安定）
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(obj));
  }
  // テーブル間の区切り
  // eslint-disable-next-line no-console
  console.log('');
  return rows.length;
}

async function main() {
  const envArgIdx = process.argv.indexOf('--env');
  const envName = envArgIdx !== -1 ? process.argv[envArgIdx + 1] : (process.env.NODE_ENV || 'development');
  const cfg = await loadDbConfig(envName);
  const conn = await mysql.createConnection({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    timezone: 'Z',
    rowsAsArray: false,
  });
  try {
    const tables = await listTables(conn, cfg.database);
    let total = 0;
    for (const t of tables) {
      total += await dumpOneTable(conn, cfg.database, t);
    }
    // 何も出力しない条件：全テーブルで行が0の場合（ヘッダも出さない）
    // 現実装はテーブルごとに行がある場合のみ出力しているため、ここで何もする必要はない
    if (total === 0) {
      // 何も出力しない
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}


