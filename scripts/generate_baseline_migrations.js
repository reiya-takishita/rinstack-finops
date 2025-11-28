'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'migrations');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ts(n) { return String(n).padStart(2, '0'); }
function stamp(base, plus = 0) {
  const d = new Date(base.getTime() + plus * 1000);
  return `${d.getFullYear()}${ts(d.getMonth() + 1)}${ts(d.getDate())}${ts(d.getHours())}${ts(d.getMinutes())}${ts(d.getSeconds())}`;
}

async function query(sequelize, sql, replacements) {
  return sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
}

function mapType(mysqlTypeRaw) {
  const raw = String(mysqlTypeRaw || '').trim();
  const t = raw.toUpperCase();

  // ENUM('a','b') → Sequelize.ENUM('a','b')（値の大小は元のまま）
  if (/^ENUM\(/i.test(raw)) {
    const m = raw.match(/^enum\((.*)\)$/i);
    const inner = m ? m[1] : '';
    return `Sequelize.ENUM(${inner})`;
  }

  // VARCHAR(n) / CHAR(n)
  let m = raw.match(/^varchar\((\d+)\)$/i);
  if (m) return `Sequelize.STRING(${m[1]})`;
  m = raw.match(/^char\((\d+)\)$/i);
  if (m) return `Sequelize.STRING(${m[1]})`;

  // TEXT 系
  if (/^text$/i.test(raw)) return 'Sequelize.TEXT';
  if (/^tinytext$/i.test(raw)) return `Sequelize.TEXT('tiny')`;
  if (/^mediumtext$/i.test(raw)) return `Sequelize.TEXT('medium')`;
  if (/^longtext$/i.test(raw)) return `Sequelize.TEXT('long')`;

  // INT 系
  if (/^tinyint\(/i.test(raw)) {
    if (/^tinyint\(\s*1\s*\)$/i.test(raw)) return 'Sequelize.BOOLEAN';
    return 'Sequelize.INTEGER';
  }
  if (/^(int|integer|smallint|mediumint)/i.test(raw)) return 'Sequelize.INTEGER';
  if (/^bigint/i.test(raw)) return 'Sequelize.BIGINT';

  // DECIMAL(p,s)
  m = raw.match(/^decimal\((\d+)\s*,\s*(\d+)\)$/i);
  if (m) return `Sequelize.DECIMAL(${m[1]}, ${m[2]})`;
  if (/^decimal$/i.test(raw)) return 'Sequelize.DECIMAL';

  // FLOAT/DOUBLE
  if (/^double/i.test(raw)) return 'Sequelize.DOUBLE';
  if (/^float/i.test(raw)) return 'Sequelize.FLOAT';

  // DATE/DATETIME/TIMESTAMP（精度維持）
  m = raw.match(/^datetime\((\d+)\)$/i);
  if (m) return `Sequelize.DATE(${m[1]})`;
  if (/^datetime$/i.test(raw)) return 'Sequelize.DATE';
  m = raw.match(/^timestamp\((\d+)\)$/i);
  if (m) return `Sequelize.DATE(${m[1]})`;
  if (/^timestamp$/i.test(raw)) return 'Sequelize.DATE';
  if (/^date$/i.test(raw)) return 'Sequelize.DATEONLY';

  // JSON/BLOB
  if (/^json/i.test(raw)) return 'Sequelize.JSON';
  if (/^blob$/i.test(raw)) return 'Sequelize.BLOB';
  if (/^tinyblob$/i.test(raw)) return `Sequelize.BLOB('tiny')`;
  if (/^mediumblob$/i.test(raw)) return `Sequelize.BLOB('medium')`;
  if (/^longblob$/i.test(raw)) return `Sequelize.BLOB('long')`;

  // Fallback
  return 'Sequelize.STRING';
}

function renderDefault(defaultValue, extra, mysqlTypeRaw) {
  if (defaultValue === null || defaultValue === undefined) return null;
  const t = String(mysqlTypeRaw || '').trim().toUpperCase();
  const defStr = String(defaultValue);

  // CURRENT_TIMESTAMP[(fsp)] と ON UPDATE CURRENT_TIMESTAMP[(fsp)] を保持
  const defMatch = defStr.match(/CURRENT_TIMESTAMP(?:\((\d+)\))?/i);
  const updMatch = String(extra || '').match(/ON UPDATE\s+CURRENT_TIMESTAMP(?:\((\d+)\))?/i);
  if (defMatch) {
    const fspDef = defMatch[1] ? `(${defMatch[1]})` : '';
    const fspUpd = updMatch && updMatch[1] ? `(${updMatch[1]})` : (updMatch ? '' : '');
    const literal = `CURRENT_TIMESTAMP${fspDef}` + (updMatch ? ` ON UPDATE CURRENT_TIMESTAMP${fspUpd}` : '');
    return `Sequelize.literal('${literal}')`;
  }

  // 数値型は数値に寄せる
  if (/^(INT|INTEGER|SMALLINT|MEDIUMINT|BIGINT|TINYINT|DECIMAL|DOUBLE|FLOAT)/.test(t)) {
    if (!Number.isNaN(Number(defStr))) return String(Number(defStr));
  }

  // 文字列として扱う
  return JSON.stringify(defaultValue);
}

function renderColumnLine(col) {
  const parts = [];
  parts.push(`type: ${col.type}`);
  if (col.allowNull === false) parts.push('allowNull: false');
  if (col.primaryKey) parts.push('primaryKey: true');
  if (col.autoIncrement) parts.push('autoIncrement: true');
  if (col.defaultValue != null) parts.push(`defaultValue: ${col.defaultValue}`);
  if (col.comment) parts.push(`comment: ${JSON.stringify(col.comment)}`);
  return `      ${col.name}: { ${parts.join(', ')} }`;
}

function renderCreateTableFile(table, columns, indexes) {
  const cols = columns.map(renderColumnLine).join(',\n');

  const idxLines = indexes
    .filter(ix => ix.name !== 'PRIMARY')
    .map(ix => {
      const cols = ix.columns.map(c => `'${c}'`).join(', ');
      const opts = [];
      if (ix.name) opts.push(`name: '${ix.name}'`);
      if (ix.unique) opts.push('unique: true');
      if (ix.type && ix.type !== 'BTREE') opts.push(`type: '${ix.type}'`); // FULLTEXT/SPATIALなど
      return `    await queryInterface.addIndex('${table}', [${cols}], { ${opts.join(', ')} });`;
    })
    .join('\n');

  return `'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('${table}', {
${cols}
    });
${idxLines ? '\n' + idxLines : ''}
  },

  async down (queryInterface) {
    await queryInterface.dropTable('${table}');
  }
};
`;
}

function renderFkFile(fks) {
  const lines = fks.map(fk => {
    const onDelete = (fk.on_delete || 'NO ACTION').toUpperCase();
    const onUpdate = (fk.on_update || 'NO ACTION').toUpperCase();
    return `    await addFk('${fk.table_name}', '${fk.constraint_name}', ['${fk.column_name}'], '${fk.referenced_table}', '${fk.referenced_column}', '${onDelete}', '${onUpdate}');`;
  }).join('\n');

  return `'use strict';

async function constraintExists(qi, table, name) {
  const [rows] = await qi.sequelize.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?',
    { replacements: [table, name] }
  );
  return Number(rows[0].cnt) > 0;
}

async function addFkSafe(qi, table, options) {
  if (await constraintExists(qi, table, options.name)) return;
  await qi.addConstraint(table, options);
}

module.exports = {
  async up (queryInterface) {
    async function addFk(table, name, fields, refTable, refCol, onDelete, onUpdate) {
      await addFkSafe(queryInterface, table, {
        fields,
        type: 'foreign key',
        name,
        references: { table: refTable, field: refCol },
        onDelete,
        onUpdate,
      });
    }

${lines}
  },

  async down () {
    // 必要ならここで removeConstraint を実装
  }
};
`;
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
  // SHOW FULL COLUMNS を使って型・デフォルト・Extra・コメントを取得
  const rows = await query(sequelize, `SHOW FULL COLUMNS FROM \`${table}\``);
  return rows.map(r => {
    const name = r.Field;
    const type = mapType(r.Type);
    const defaultValue = renderDefault(r.Default, r.Extra, r.Type);
    const allowNull = String(r.Null).toUpperCase() === 'YES';
    const primaryKey = String(r.Key).toUpperCase() === 'PRI';
    const autoIncrement = String(r.Extra || '').toLowerCase().includes('auto_increment');
    const comment = r.Comment || '';
    return { name, type, defaultValue, allowNull, primaryKey, autoIncrement, comment };
  });
}

async function getIndexes(sequelize, table) {
  const rows = await query(sequelize, `SHOW INDEX FROM \`${table}\``);
  // グループ化
  const map = new Map();
  for (const r of rows) {
    const key = r.Key_name;
    if (!map.has(key)) map.set(key, { name: key, unique: r.Non_unique === 0, type: r.Index_type || undefined, columns: [] });
    map.get(key).columns.push({ seq: r.Seq_in_index, col: r.Column_name });
  }
  const list = Array.from(map.values()).map(ix => ({
    name: ix.name,
    unique: ix.unique,
    type: ix.type,
    columns: ix.columns.sort((a, b) => a.seq - b.seq).map(c => c.col)
  }));
  return list;
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
    ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
  `;
  return query(sequelize, sql);
}

async function main() {
  ensureDir(OUT_DIR);

  const host = process.env.DB_HOST || 'mysql';
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || 'rinstack_db';
  const username = process.env.DB_USER || 'rinstack_user';
  const password = process.env.DB_PASS || 'rinstack_p@ssw0rd';

  const sequelize = new Sequelize(database, username, password, {
    host, port, dialect: 'mysql', logging: false,
  });

  try {
    await sequelize.authenticate();

    const tables = await getTables(sequelize);
    const base = new Date();
    let i = 0;

    for (const table of tables) {
      const [columns, indexes] = await Promise.all([
        getColumns(sequelize, table),
        getIndexes(sequelize, table)
      ]);

      const fileName = `${stamp(base, i++)}-create-${table}.js`;
      const filePath = path.join(OUT_DIR, fileName);
      const content = renderCreateTableFile(table, columns, indexes);
      fs.writeFileSync(filePath, content);
      // eslint-disable-next-line no-console
      console.log('Generated', path.relative(PROJECT_ROOT, filePath));
    }

    const fks = await getForeignKeys(sequelize);
    const fkFileName = `${stamp(base, i++)}-add-foreign-keys.js`;
    const fkPath = path.join(OUT_DIR, fkFileName);
    fs.writeFileSync(fkPath, renderFkFile(fks));
    // eslint-disable-next-line no-console
    console.log('Generated', path.relative(PROJECT_ROOT, fkPath));
  } finally {
    await sequelize.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


