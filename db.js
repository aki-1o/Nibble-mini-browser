// db.js — SQLite storage for the AA name -> accountAggregatorId mapping.
//
// MAIN PROCESS ONLY. The shell renderer runs with contextIsolation and no Node
// access, so it cannot open a database itself; it calls the 'aamap:*' / 'db:*'
// IPC handlers in main.js, which call into here. Validation lives in this file
// because renderer input is untrusted.
//
// WHY node-sqlite3-wasm AND NOT better-sqlite3: better-sqlite3 is a native
// binding, so installing it needs a C++ toolchain (it fails outright on a
// Windows box with no Visual Studio Build Tools) and it must be rebuilt
// whenever Electron's ABI changes. This is a WebAssembly build with a VFS over
// Node's fs, so it is still a real file on disk, with no compile step and
// nothing to rebuild after an Electron bump.
//
// THE CAVEAT of that choice: the library is not garbage collected. The database
// must be closed by hand (main.js does it on 'will-quit') and any prepared
// statement must be finalized, or it leaks. We therefore only use the
// db.run/get/all convenience methods, which finalize internally.

'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { Database } = require('node-sqlite3-wasm');
const { migrate } = require('./migrations');

const FILE_NAME = 'nibble.db';
const MAX_LEN = 200;
const PREVIEW_ROWS = 200;   // the Database panel previews, it is not a spreadsheet

let db = null;

// userData, never the app directory — that is read-only once installed, and a
// file there would be wiped by the next upgrade.
function filePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

// Opened lazily on first use, not at require() time, so a database problem
// cannot stop the window from appearing. Schema creation lives in migrations.js:
// the table is created only if it is missing, and the applied version is
// recorded in the file, so an existing database is never re-created.
function conn() {
  if (db && db.isOpen) return db;

  db = new Database(filePath());
  try {
    migrate(db);
  } catch (err) {
    // Leave no half-open handle behind if the schema could not be prepared.
    try { db.close(); } catch { /* ignore */ }
    db = null;
    throw err;
  }
  return db;
}

function close() {
  if (db && db.isOpen) db.close();
  db = null;
}

/* ---------------------------- validation ---------------------------- */
// The renderer is untrusted input, so nothing reaches SQL unchecked.

function required(value, label) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`${label} is required.`);
  if (s.length > MAX_LEN) throw new Error(`${label} must be ${MAX_LEN} characters or fewer.`);
  return s;
}

// A field that may be blank: stored as NULL rather than '' so "not set" is one
// value in the database instead of two.
function optional(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s.slice(0, MAX_LEN) : null;
}

function rowId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Bad row id.');
  return n;
}

// SQLite3Error carries no error code, so the constraint is identified by its
// message. Worth keeping specific: "name already exists" and "id already
// mapped" need different fixes from the user.
function friendly(err) {
  const m = String((err && err.message) || '');
  if (/UNIQUE constraint failed: aa_mapping\.aa_name/i.test(m)) return 'An AA with that name already exists.';
  if (/UNIQUE constraint failed: aa_mapping\.aa_id/i.test(m)) return 'That accountAggregatorId is already mapped.';
  return m || 'Database error.';
}

/* ---------------------------- aa_mapping ---------------------------- */

function all() {
  return conn().all(
    `SELECT id, aa_name AS name, aa_id AS aaId,
            aa_code AS code, aaclass, sdk_folder AS sdkFolder, env
       FROM aa_mapping
      ORDER BY aa_name COLLATE NOCASE`,
  );
}

// Every call answers with the full list, so the UI never needs a second round
// trip to redraw, and with { ok: false } instead of a thrown error, because an
// exception crossing IPC reaches the renderer as an unreadable wrapped string.
const ok = () => ({ ok: true, rows: all() });
const bad = (err) => ({ ok: false, error: friendly(err) });

function list() {
  try {
    return ok();
  } catch (err) {
    return bad(err);
  }
}

function add(row = {}) {
  try {
    conn().run('INSERT INTO aa_mapping (aa_name, aa_id) VALUES (@name, @aaId)', {
      '@name': required(row.name, 'AA name'),
      '@aaId': required(row.aaId, 'accountAggregatorId'),
    });
    return ok();
  } catch (err) {
    return bad(err);
  }
}

function update(row = {}) {
  try {
    const info = conn().run(
      'UPDATE aa_mapping SET aa_name = @name, aa_id = @aaId WHERE id = @id',
      {
        '@id': rowId(row.id),
        '@name': required(row.name, 'AA name'),
        '@aaId': required(row.aaId, 'accountAggregatorId'),
      },
    );
    // changes === 0 means the WHERE matched nothing, not that SQL failed.
    if (!info.changes) throw new Error('That row no longer exists.');
    return ok();
  } catch (err) {
    return bad(err);
  }
}

function remove(id) {
  try {
    const info = conn().run('DELETE FROM aa_mapping WHERE id = @id', { '@id': rowId(id) });
    if (!info.changes) throw new Error('That row no longer exists.');
    return ok();
  } catch (err) {
    return bad(err);
  }
}

/* ---------------------------- introspection ---------------------------- */
// Feeds the Database panel. Everything here is read from SQLite's own pragmas
// rather than from a hardcoded description of the schema, so the panel cannot
// drift out of date when a migration is added — it shows what is actually in
// the file, including columns the app no longer uses.

// Identifiers cannot be bound as parameters, and a pragma that takes one has to
// be interpolated. Only names SQLite itself just handed us are ever passed here,
// but quoting is still done properly: doubled quotes inside a quoted identifier.
const quoteId = (name) => `"${String(name).replace(/"/g, '""')}"`;

function tableShape(d, name) {
  const columns = d.all(`PRAGMA table_info(${quoteId(name)})`);
  const fks = d.all(`PRAGMA foreign_key_list(${quoteId(name)})`);

  // index_list reports every index; the ones SQLite created for UNIQUE
  // constraints have origin 'u' and are worth marking on the column itself.
  const indexes = d.all(`PRAGMA index_list(${quoteId(name)})`).map((ix) => ({
    name: ix.name,
    unique: Boolean(ix.unique),
    origin: ix.origin,                            // 'c' CREATE INDEX, 'u' UNIQUE, 'pk'
    columns: d.all(`PRAGMA index_info(${quoteId(ix.name)})`)
      .map((c) => c.name)
      .filter((c) => c !== null),
  }));

  const uniqueCols = new Set(
    indexes.filter((ix) => ix.unique && ix.columns.length === 1).map((ix) => ix.columns[0]),
  );

  return {
    name,
    sql: (d.get(
      'SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = @n',
      { '@n': name },
    ) || {}).sql || '',
    rowCount: d.get(`SELECT COUNT(*) AS n FROM ${quoteId(name)}`).n,
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type || '',
      notNull: Boolean(c.notnull),
      pk: Boolean(c.pk),
      unique: uniqueCols.has(c.name),
      default: c.dflt_value === null ? null : String(c.dflt_value),
      // Which table.column this one points at, if any — what makes the panel a
      // diagram rather than a list.
      references: (() => {
        const fk = fks.find((f) => f.from === c.name);
        return fk ? { table: fk.table, column: fk.to || 'rowid' } : null;
      })(),
    })),
    foreignKeys: fks.map((f) => ({
      from: f.from, table: f.table, to: f.to || 'rowid', onDelete: f.on_delete, onUpdate: f.on_update,
    })),
    indexes,
    // Column order from table_info, so the preview lines up with the header.
    rows: d.all(`SELECT * FROM ${quoteId(name)} LIMIT ${PREVIEW_ROWS}`),
  };
}

function schema() {
  try {
    const d = conn();
    const names = d.all(
      // sqlite_% is SQLite's own bookkeeping (sqlite_sequence for AUTOINCREMENT);
      // it is not part of this app's schema and only adds noise.
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    ).map((r) => r.name);

    let bytes = 0;
    try { bytes = fs.statSync(filePath()).size; } catch { /* not written yet */ }

    return {
      ok: true,
      file: filePath(),
      bytes,
      userVersion: Number(Object.values(d.get('PRAGMA user_version'))[0] || 0),
      previewLimit: PREVIEW_ROWS,
      tables: names.map((n) => tableShape(d, n)),
    };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}

/* ---------------------------- tenants ---------------------------- */
// Tenant is a URL-shape concern: these rows answer "which params do I append",
// which is a different question from aa_mapping's "what goes in the body".
//
// Every read answers with the full shape the panel needs, and every write answers
// with it too, so the UI never needs a second round trip — the same contract
// aa_mapping uses.

const OPERATORS = ['EQUALS', 'NOT_EQUALS', 'CONTAINS_CI', 'PRESENT', 'ABSENT'];

function operator(value) {
  const op = String(value || 'EQUALS').toUpperCase();
  if (!OPERATORS.includes(op)) throw new Error(`Unknown operator "${value}".`);
  return op;
}

function tenantTree() {
  const d = conn();

  const bundles = d.all('SELECT id, name, notes FROM sdk_bundle ORDER BY name');
  const tenants = d.all(
    `SELECT t.id, t.sdk_bundle_id AS bundleId, t.name, t.component_path AS component,
            t.priority, t.notes, t.is_fallback AS isFallback, t.is_active AS isActive
       FROM tenant t
      ORDER BY t.is_active DESC, t.priority, t.name COLLATE NOCASE`,
  );
  const rows = d.all(
    `SELECT tp.id, tp.tenant_id AS tenantId, tp.operator, tp.value,
            p.id AS paramId, p.name AS param, p.type, p.description
       FROM tenant_param tp
       JOIN param p ON p.id = tp.param_id
      ORDER BY p.name COLLATE NOCASE, tp.operator, tp.value COLLATE NOCASE`,
  );

  // Grouped by tenant, then by param, because that is exactly how it is drawn:
  // one block per param with all of its possible values.
  const byTenant = new Map(tenants.map((t) => [t.id, { ...t, params: [] }]));
  const seen = new Map();
  for (const r of rows) {
    const t = byTenant.get(r.tenantId);
    if (!t) continue;
    const key = `${r.tenantId}:${r.paramId}`;
    let group = seen.get(key);
    if (!group) {
      group = { paramId: r.paramId, param: r.param, type: r.type, description: r.description, values: [] };
      seen.set(key, group);
      t.params.push(group);
    }
    group.values.push({ id: r.id, operator: r.operator, value: r.value });
  }

  return {
    bundles: bundles.map((b) => ({
      ...b,
      tenants: tenants.filter((t) => t.bundleId === b.id).map((t) => byTenant.get(t.id)),
    })),
    params: d.all('SELECT id, name, type, description FROM param ORDER BY name COLLATE NOCASE'),
    paramValues: d.all(
      `SELECT pv.param_id AS paramId, p.name AS param, pv.value
         FROM param_value pv JOIN param p ON p.id = pv.param_id
        ORDER BY p.name COLLATE NOCASE, pv.value COLLATE NOCASE`,
    ),
    themeOnlyOrgs: d.all('SELECT org_id AS orgId FROM theme_only_org ORDER BY org_id').map((r) => r.orgId),
    operators: OPERATORS,
  };
}

const tOk = () => ({ ok: true, ...tenantTree() });

function tenantList() {
  try {
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

function tenantAdd(row = {}) {
  try {
    const d = conn();
    const bundle = required(row.bundle, 'SDK bundle');
    d.run('INSERT OR IGNORE INTO sdk_bundle (name) VALUES (@b)', { '@b': bundle });
    const bundleId = d.get('SELECT id FROM sdk_bundle WHERE name = @b', { '@b': bundle }).id;
    d.run(
      `INSERT INTO tenant (sdk_bundle_id, name, component_path, priority, notes)
       VALUES (@bundleId, @name, @component, @priority, @notes)`,
      {
        '@bundleId': bundleId,
        '@name': required(row.name, 'Tenant name'),
        '@component': optional(row.component),
        '@priority': Number.isFinite(Number(row.priority)) ? Number(row.priority) : 999,
        '@notes': optional(row.notes),
      },
    );
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

function tenantUpdate(row = {}) {
  try {
    const info = conn().run(
      `UPDATE tenant SET name = @name, component_path = @component,
              priority = @priority, notes = @notes
        WHERE id = @id`,
      {
        '@id': rowId(row.id),
        '@name': required(row.name, 'Tenant name'),
        '@component': optional(row.component),
        '@priority': Number.isFinite(Number(row.priority)) ? Number(row.priority) : 999,
        '@notes': optional(row.notes),
      },
    );
    if (!info.changes) throw new Error('That tenant no longer exists.');
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

function tenantRemove(id) {
  try {
    // ON DELETE CASCADE needs foreign keys switched on; it is off by default in
    // SQLite, so enable it for this connection rather than trusting the schema.
    const d = conn();
    d.exec('PRAGMA foreign_keys = ON');
    const info = d.run('DELETE FROM tenant WHERE id = @id', { '@id': rowId(id) });
    if (!info.changes) throw new Error('That tenant no longer exists.');
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

// Add one possible value for one param of one tenant. This is the operation that
// makes a key hold many values: it appends a row rather than editing a list.
function tenantParamAdd(row = {}) {
  try {
    const d = conn();
    const name = required(row.param, 'Parameter name');
    d.run('INSERT OR IGNORE INTO param (name) VALUES (@n)', { '@n': name });
    const paramId = d.get('SELECT id FROM param WHERE name = @n', { '@n': name }).id;
    const op = operator(row.operator);
    // PRESENT/ABSENT are about the param existing at all, so they carry no value.
    const value = (op === 'PRESENT' || op === 'ABSENT') ? '' : optional(row.value) || '';

    d.run(
      `INSERT OR IGNORE INTO tenant_param (tenant_id, param_id, operator, value)
       VALUES (@t, @p, @op, @v)`,
      { '@t': rowId(row.tenantId), '@p': paramId, '@op': op, '@v': value },
    );
    // Remember the value in the catalogue too, so it is offered next time.
    if (value) {
      d.run('INSERT OR IGNORE INTO param_value (param_id, value) VALUES (@p, @v)',
        { '@p': paramId, '@v': value });
    }
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

function tenantParamRemove(id) {
  try {
    const info = conn().run('DELETE FROM tenant_param WHERE id = @id', { '@id': rowId(id) });
    if (!info.changes) throw new Error('That value no longer exists.');
    return tOk();
  } catch (err) {
    return bad(err);
  }
}

// Regenerates tenant-seed.js from what is in the database now.
//
// This is deliberately NOT the migration file rewriting itself: a migration has to
// stay fixed once its version is recorded, or replaying it elsewhere produces a
// different database and the whole versioning guarantee is void. This is an export
// you ask for, which you can commit over tenant-seed.js to make today's data the
// new first-run baseline.
function tenantSeedSource() {
  const tree = tenantTree();
  const q = (s) => JSON.stringify(s == null ? '' : String(s));

  const bundles = tree.bundles.map((b) => `  [${q(b.name)}, ${q(b.notes)}],`).join('\n');
  const params = tree.params.map((p) => `  [${q(p.name)}, ${q(p.type)}, ${q(p.description)}],`).join('\n');

  const valuesByParam = new Map();
  for (const v of tree.paramValues) {
    if (!valuesByParam.has(v.param)) valuesByParam.set(v.param, []);
    valuesByParam.get(v.param).push(v.value);
  }
  const paramValues = [...valuesByParam.entries()]
    .map(([name, vals]) => `  ${JSON.stringify(name)}: [${vals.map(q).join(', ')}],`).join('\n');

  const tenantRows = [];
  for (const b of tree.bundles) {
    for (const t of b.tenants) {
      const rules = {};
      for (const g of t.params) {
        for (const v of g.values) {
          rules[g.param] = rules[g.param] || {};
          rules[g.param][v.operator] = rules[g.param][v.operator] || [];
          if (v.value) rules[g.param][v.operator].push(v.value);
        }
      }
      // Collapse the common case back to a bare array, the way it is written by hand.
      const compact = {};
      for (const [param, byOp] of Object.entries(rules)) {
        const ops = Object.keys(byOp);
        compact[param] = (ops.length === 1 && ops[0] === 'EQUALS') ? byOp.EQUALS : byOp;
      }
      tenantRows.push(
        `  [${t.priority}, ${q(b.name)}, ${q(t.name)}, ${q(t.component)}, `
        + `${JSON.stringify(compact)}, ${q(t.notes)}],`,
      );
    }
  }

  return `// tenant-seed.js — GENERATED from nibble.db on ${new Date().toISOString()}.
//
// Exported from the Tenant tab. Commit this over tenant-seed.js to make the current
// contents of the database the first-run baseline for everyone else. migrations.js
// reads it when the tenant tables are empty.

'use strict';

const SDK_BUNDLES = [
${bundles}
];

const PARAMS = [
${params}
];

const PARAM_VALUES = {
${paramValues}
};

// [priority, bundle, tenant, component, rules, notes]
const TENANTS = [
${tenantRows.join('\n')}
];

const THEME_ONLY_ORG_IDS = ${JSON.stringify(tree.themeOnlyOrgs, null, 2)};

module.exports = { SDK_BUNDLES, PARAMS, PARAM_VALUES, TENANTS, THEME_ONLY_ORG_IDS };
`;
}

/* ---------------------------- export ---------------------------- */

// Copies the database file somewhere else. The handle is closed first: the
// rollback journal is only folded back into the file on close, so copying while
// open can capture a file whose last write is still in the journal. conn()
// reopens on the next call, so closing here is invisible to the caller.
function exportTo(destPath) {
  const src = filePath();
  if (!fs.existsSync(src)) conn();   // never exported before anything opened it
  close();
  fs.copyFileSync(src, destPath);
  return fs.statSync(destPath).size;
}

module.exports = {
  list, add, update, remove,
  tenantList, tenantAdd, tenantUpdate, tenantRemove,
  tenantParamAdd, tenantParamRemove, tenantSeedSource,
  schema, exportTo, filePath, close,
};
