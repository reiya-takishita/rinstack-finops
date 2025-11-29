'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_BASE_DIR = path.join(PROJECT_ROOT, 'schema_snapshots');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ts(n) { return String(n).padStart(2, '0'); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}${ts(d.getMonth() + 1)}${ts(d.getDate())}${ts(d.getHours())}${ts(d.getMinutes())}${ts(d.getSeconds())}`;
}

async function query(sequelize, sql, replacements) {
  return sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
}

async function getTables(sequelize) {
  const rows = await query(
    sequelize,
    `SELECT table_name AS table_name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> 'SequelizeMeta'
     ORDER BY table_name`
  );
  return rows.map(r => r.table_name);
}

async function getColumns(sequelize, table) {
  const rows = await query(
    sequelize,
    `SELECT COLUMN_NAME AS column_name, ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, EXTRA AS extra,
            COLUMN_COMMENT AS column_comment, COLUMN_KEY AS column_key
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map(r => ({
    name: r.column_name,
    ordinalPosition: Number(r.ordinal_position),
    type: r.column_type,
    isNullable: String(r.is_nullable).toUpperCase() === 'YES',
    default: r.column_default,
    extra: r.extra,
    comment: r.column_comment,
    columnKey: r.column_key,
  }));
}

async function getIndexes(sequelize, table) {
  const rows = await query(sequelize, `SHOW INDEX FROM \`${table}\``);
  const map = new Map();
  for (const r of rows) {
    const key = r.Key_name;
    if (!map.has(key)) map.set(key, { name: key, unique: r.Non_unique === 0, type: r.Index_type || undefined, columns: [] });
    map.get(key).columns.push({ seq: r.Seq_in_index, col: r.Column_name });
  }
  return Array.from(map.values()).map(ix => ({
    name: ix.name,
    unique: ix.unique,
    type: ix.type,
    columns: ix.columns.sort((a, b) => a.seq - b.seq).map(c => c.col)
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function getShowCreateTable(sequelize, table) {
  const rows = await query(sequelize, `SHOW CREATE TABLE \`${table}\``);
  const row = rows[0];
  const key = Object.keys(row).find(k => /Create Table/i.test(k));
  return row[key];
}

async function getForeignKeys(sequelize) {
  const sql = `
    SELECT
      kcu.TABLE_NAME AS table_name,
      kcu.COLUMN_NAME AS column_name,
      kcu.CONSTRAINT_NAME AS constraint_name,
      kcu.REFERENCED_TABLE_NAME AS referenced_table,
      kcu.REFERENCED_COLUMN_NAME AS referenced_column,
      rc.UPDATE_RULE AS on_update,
      rc.DELETE_RULE AS on_delete
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;
  const rows = await query(sequelize, sql);
  return rows.map(r => ({
    table: r.table_name,
    column: r.column_name,
    constraintName: r.constraint_name,
    referencedTable: r.referenced_table,
    referencedColumn: r.referenced_column,
    onUpdate: r.on_update,
    onDelete: r.on_delete,
  }));
}

async function main() {
  const host = process.env.DB_HOST || 'mysql';
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || 'rinstack_finops_db';
  const username = process.env.DB_USER || 'rinstack_user';
  const password = process.env.DB_PASS || 'rinstack_p@ssw0rd';

  const sequelize = new Sequelize(database, username, password, {
    host, port, dialect: 'mysql', logging: false,
  });

  await sequelize.authenticate();

  const ts = stamp();
  const outDir = path.join(OUT_BASE_DIR, ts);
  const tablesDir = path.join(outDir, 'tables');
  ensureDir(outDir);
  ensureDir(tablesDir);

  const tables = await getTables(sequelize);
  const result = {
    generatedAt: new Date().toISOString(),
    database,
    tables: [],
    foreignKeys: [],
  };

  for (const table of tables) {
    const [cols, idx, createSQL] = await Promise.all([
      getColumns(sequelize, table),
      getIndexes(sequelize, table),
      getShowCreateTable(sequelize, table),
    ]);

    const primary = idx.find(i => i.name === 'PRIMARY');
    const primaryKey = primary ? primary.columns : cols.filter(c => c.columnKey === 'PRI').map(c => c.name);

    // Write each table's CREATE TABLE SQL
    const sqlPath = path.join(tablesDir, `${table}.sql`);
    fs.writeFileSync(sqlPath, `${createSQL};\n`);

    result.tables.push({
      name: table,
      columns: cols,
      primaryKey,
      indexes: idx,
    });
  }

  result.tables.sort((a, b) => a.name.localeCompare(b.name));
  result.foreignKeys = await getForeignKeys(sequelize);

  // Write schema.json
  fs.writeFileSync(path.join(outDir, 'schema.json'), JSON.stringify(result, null, 2));

  // eslint-disable-next-line no-console
  console.log('Schema snapshot written to', path.relative(PROJECT_ROOT, outDir));

  await sequelize.close();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


