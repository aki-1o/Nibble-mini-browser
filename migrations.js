// migrations.js — schema migrations for nibble.db.
//
// MAIN PROCESS ONLY; called by db.js the first time a connection is opened.
//
// Why a migration list and not one CREATE TABLE in db.js: the database file
// lives in userData and survives upgrades, so an installed copy can be older
// than the code. The applied version is recorded in SQLite's own `user_version`
// pragma (an integer in the file header — no bookkeeping table needed), and
// every step is idempotent, so running this on a fresh file, a half-migrated
// file, or an already-current file all end the same way.
//
// To add a schema change: append an entry with the next version number. Never
// edit or renumber an existing one — a database that already recorded that
// version will not run it again.

'use strict';

const {
  SDK_BUNDLES, PARAMS, PARAM_VALUES, TENANTS, THEME_ONLY_ORG_IDS,
} = require('./tenant-seed');

// First-run contents of aa_mapping: the list that used to be hardcoded in
// api-panel.js, so a fresh install behaves exactly like the old build.
// Name -> accountAggregatorId, and nothing else: that pair is all the app uses.
const AA_SEED = [
  ['SAAFE',             'saafe'],
  ['SAAFE (preprod)',   'dashboard-aa-preprod'],
  ['CAMS',              'AA00022277'],
  ['ONEMONEY',          'onemoney'],
  ['NADL',              'AA00023404'],
  ['Anumati',           'Anumati'],
  ['CookieJar (Finvu)', 'cookiejaraalive@finvu'],
];

const MIGRATIONS = [
  {
    version: 1,
    name: 'create aa_mapping',
    up(db) {
      // `id` is a surrogate key rather than aa_id being the primary key, so an
      // edit can change the accountAggregatorId without the row losing its
      // identity. COLLATE NOCASE UNIQUE stops "FINVU" and "finvu" both being
      // inserted.
      db.exec(`
        CREATE TABLE IF NOT EXISTS aa_mapping (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          aa_name    TEXT NOT NULL COLLATE NOCASE UNIQUE,
          aa_id      TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Seed only an empty table, so a user who deliberately deleted rows does
      // not get them back, and a database that predates this file is left alone.
      const { n } = db.get('SELECT COUNT(*) AS n FROM aa_mapping');
      if (!n) {
        for (const [name, id] of AA_SEED) {
          db.run('INSERT INTO aa_mapping (aa_name, aa_id) VALUES (?, ?)', [name, id]);
        }
      }
    },
  },
  {
    version: 2,
    name: 'drop config/env',
    up(db) {
      // An earlier build carried `config` and `env` — the two arguments of
      // `yarn start <config> <env>` — to print an SDK dev-server hint that no
      // longer exists. Version 1 above now creates the table without them, but a
      // database created by that earlier build already recorded version 1, so
      // its table keeps the dead columns unless they are dropped here. Left in
      // place they would show up in the Database panel as fields nothing writes.
      const cols = db.all('PRAGMA table_info(aa_mapping)').map((c) => c.name);
      for (const dead of ['config', 'env']) {
        // DROP COLUMN is SQLite 3.35+; node-sqlite3-wasm ships newer than that.
        // Safe here because neither column is indexed or part of a constraint.
        if (cols.includes(dead)) db.exec(`ALTER TABLE aa_mapping DROP COLUMN ${dead}`);
      }
    },
  },
  {
    version: 3,
    name: 'create tenant tables',
    up(db) {
      // Tenant is a URL-shape concern: the AA is baked into an SDK deployment at
      // build time, while the tenant is picked at runtime from redirect-URL params.
      // So this is modelled separately from aa_mapping rather than beside it.
      //
      // ONE ROW PER VALUE is what lets a param have any number of possible values
      // without a schema change — the thing a document store is usually reached for.
      // tenant_param is that child table; `operator` records HOW the SDK compares,
      // because the routing uses contains and negation as well as equality.
      db.exec(`
        CREATE TABLE IF NOT EXISTS sdk_bundle (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          name  TEXT NOT NULL COLLATE NOCASE UNIQUE,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS param (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
          type        TEXT NOT NULL DEFAULT 'string',
          description TEXT
        );

        -- Values known for a param regardless of tenant, for the value dropdown.
        CREATE TABLE IF NOT EXISTS param_value (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          param_id INTEGER NOT NULL REFERENCES param(id) ON DELETE CASCADE,
          value    TEXT NOT NULL,
          UNIQUE (param_id, value)
        );

        CREATE TABLE IF NOT EXISTS tenant (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          sdk_bundle_id  INTEGER NOT NULL REFERENCES sdk_bundle(id) ON DELETE CASCADE,
          name           TEXT NOT NULL,
          component_path TEXT,
          priority       INTEGER NOT NULL DEFAULT 999,
          notes          TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (sdk_bundle_id, name)
        );

        -- The many-values-per-key table. operator: EQUALS | NOT_EQUALS |
        -- CONTAINS_CI | ABSENT | PRESENT.
        CREATE TABLE IF NOT EXISTS tenant_param (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
          param_id  INTEGER NOT NULL REFERENCES param(id) ON DELETE CASCADE,
          operator  TEXT NOT NULL DEFAULT 'EQUALS',
          value     TEXT NOT NULL DEFAULT '',
          UNIQUE (tenant_id, param_id, operator, value)
        );

        -- orgIds that only carry a theme and fall through to a fallback tenant.
        CREATE TABLE IF NOT EXISTS theme_only_org (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id    TEXT NOT NULL COLLATE NOCASE UNIQUE,
          tenant_id INTEGER REFERENCES tenant(id) ON DELETE SET NULL
        );

        -- Looking up "which tenants use this param" is the panel's hot path.
        CREATE INDEX IF NOT EXISTS ix_tenant_param_tenant ON tenant_param(tenant_id);
        CREATE INDEX IF NOT EXISTS ix_tenant_param_param  ON tenant_param(param_id);
        CREATE INDEX IF NOT EXISTS ix_tenant_bundle       ON tenant(sdk_bundle_id);
      `);

      // Seed only an empty table, so a deliberately pruned list stays pruned.
      const { n } = db.get('SELECT COUNT(*) AS n FROM tenant');
      if (n) return;

      const bundleId = new Map();
      for (const [name, notes] of SDK_BUNDLES) {
        db.run('INSERT OR IGNORE INTO sdk_bundle (name, notes) VALUES (?, ?)', [name, notes]);
        bundleId.set(name, db.get('SELECT id FROM sdk_bundle WHERE name = ?', [name]).id);
      }

      const paramId = new Map();
      for (const [name, type, description] of PARAMS) {
        db.run('INSERT OR IGNORE INTO param (name, type, description) VALUES (?, ?, ?)', [name, type, description]);
        paramId.set(name, db.get('SELECT id FROM param WHERE name = ?', [name]).id);
      }

      for (const [name, values] of Object.entries(PARAM_VALUES)) {
        const pid = paramId.get(name);
        if (!pid) continue;
        for (const v of values) {
          db.run('INSERT OR IGNORE INTO param_value (param_id, value) VALUES (?, ?)', [pid, v]);
        }
      }

      const fallbackId = {};
      for (const [priority, bundle, name, component, rules, notes] of TENANTS) {
        db.run(
          `INSERT INTO tenant (sdk_bundle_id, name, component_path, priority, notes)
           VALUES (?, ?, ?, ?, ?)`,
          [bundleId.get(bundle), name, component, priority, notes || null],
        );
        const tid = db.get('SELECT last_insert_rowid() AS id').id;
        if (bundle === 'common-sdk' && (name === 'Common' || name === 'AltCommonTenant')) {
          fallbackId[name] = tid;
        }

        for (const [param, spec] of Object.entries(rules)) {
          const pid = paramId.get(param);
          if (!pid) continue;
          // A bare array is the EQUALS case; an object spells the operator out.
          const byOp = Array.isArray(spec) ? { EQUALS: spec } : spec;
          for (const [operator, values] of Object.entries(byOp)) {
            // An empty list means "this param is read but has no fixed value"
            // (primaryFipId), which is still worth recording as PRESENT.
            const list = values.length ? values : [''];
            for (const value of list) {
              db.run(
                `INSERT OR IGNORE INTO tenant_param (tenant_id, param_id, operator, value)
                 VALUES (?, ?, ?, ?)`,
                [tid, pid, values.length ? operator : 'PRESENT', value],
              );
            }
          }
        }
      }

      for (const org of THEME_ONLY_ORG_IDS) {
        db.run('INSERT OR IGNORE INTO theme_only_org (org_id, tenant_id) VALUES (?, ?)',
          [org, fallbackId.Common || null]);
      }
    },
  },
  {
    version: 4,
    name: 'correct AA registry',
    up(db) {
      // The first seed's accountAggregatorIds were wrong. The authoritative list is
      // AccountAggregatorIds.java / AAFolderMappings.java in the monitoring service,
      // and a mismatch is not cosmetic: the SDK build's AA has to match the
      // accountAggregatorId used at init or decodeParam fails outright.
      //
      // Also records what the API id alone cannot express: REACT_APP_AACLASS (the
      // build-time strategy the SDK imports) and the AAServices folder, which is why
      // one deployed SDK serves exactly one AA.
      const cols = db.all('PRAGMA table_info(aa_mapping)').map((c) => c.name);
      if (!cols.includes('aa_code')) db.exec("ALTER TABLE aa_mapping ADD COLUMN aa_code TEXT");
      if (!cols.includes('aaclass')) db.exec("ALTER TABLE aa_mapping ADD COLUMN aaclass TEXT");
      if (!cols.includes('sdk_folder')) db.exec("ALTER TABLE aa_mapping ADD COLUMN sdk_folder TEXT");
      if (!cols.includes('env')) db.exec("ALTER TABLE aa_mapping ADD COLUMN env TEXT");

      // [code, aaclass, folder, correct id, the wrong id this build seeded]
      // The old id is matched explicitly so a value you edited yourself is left
      // alone — a migration must not overwrite a deliberate change.
      const FIX = [
        ['ANUMATI',  'ANUMATI',  'AAServices/ANUMATI',  'Anumati',               'Anumati-UAT'],
        ['FINVU',    'FINVU',    'AAServices/FINVU',    'cookiejaraalive@finvu', 'cookiejar-aa@finvu.in'],
        ['ONEMONEY', 'ONEMONEY', 'AAServices/ONEMONEY', 'onemoney',              'onemoney-aa'],
        ['SAAFE',    'SAAFE',    'AAServices/SAAFE',    'saafe',                 'dashboard-aa-preprod'],
        ['NADL',     'NADL',     'AAServices/NADL',     'AA00023404',            'AA00023403'],
        ['CAMS',     'CAMS',     'AAServices/CAMS',     'AA00022277',            'AA00022222'],
      ];

      for (const [code, aaclass, folder, correct, wrong] of FIX) {
        // Step 1: correct a wrong id, but only when the right one is not already
        // present — aa_id is UNIQUE, and on a fresh database the correct value was
        // seeded directly so there is nothing to rename.
        const wrongRow = db.get('SELECT id FROM aa_mapping WHERE aa_id = ? COLLATE NOCASE', [wrong]);
        const correctRow = db.get('SELECT id FROM aa_mapping WHERE aa_id = ? COLLATE NOCASE', [correct]);
        if (wrongRow && !correctRow) {
          db.run('UPDATE aa_mapping SET aa_id = ? WHERE id = ?', [correct, wrongRow.id]);
        }

        // Step 2: tag whichever row now holds the correct id. Kept separate from the
        // rename so both paths — corrected and already-right — end up tagged. Only
        // untagged rows are touched, so a value you set yourself is left alone.
        db.run(
          `UPDATE aa_mapping SET aa_code = ?, aaclass = ?, sdk_folder = ?, env = ?
            WHERE aa_id = ? COLLATE NOCASE AND aa_code IS NULL`,
          [code, aaclass, folder, 'prod', correct],
        );
      }

      // dashboard-aa-preprod is a real Saafe preprod handle, seen in payloads as
      // vuaId "0000000000@dashboard-aa-preprod". It was the wrong value to call
      // "SAAFE", but it is the right value for preprod, so keep it as its own row
      // rather than losing it — accountAggregatorId is per-env, not global.
      const preprod = db.get(
        "SELECT id FROM aa_mapping WHERE aa_id = 'dashboard-aa-preprod' COLLATE NOCASE",
      );
      if (preprod) {
        // Stamped unconditionally: step 2 above may have tagged it as prod while
        // chasing the SAAFE correction, and preprod is what it actually is.
        db.run(
          `UPDATE aa_mapping SET aa_code = 'SAAFE', aaclass = 'SAAFE',
                  sdk_folder = 'AAServices/SAAFE', env = 'preprod'
            WHERE id = ?`,
          [preprod.id],
        );
      } else if (!db.get("SELECT id FROM aa_mapping WHERE aa_name = 'SAAFE (preprod)' COLLATE NOCASE")) {
        db.run(
          `INSERT INTO aa_mapping (aa_name, aa_id, aa_code, aaclass, sdk_folder, env)
           VALUES ('SAAFE (preprod)', 'dashboard-aa-preprod', 'SAAFE', 'SAAFE', 'AAServices/SAAFE', 'preprod')`,
        );
      }
    },
  },
  {
    version: 5,
    name: 'tenant fallback and active flags',
    up(db) {
      // is_fallback: reached by falling through the chain rather than by matching a
      // param, so the console can say "this is the default" instead of "no rules".
      // is_active: components that exist in the repo but are not referenced by
      // routing at all. Listing them as selectable would imply journeys that cannot
      // actually be reached.
      const cols = db.all('PRAGMA table_info(tenant)').map((c) => c.name);
      if (!cols.includes('is_fallback')) {
        db.exec('ALTER TABLE tenant ADD COLUMN is_fallback INTEGER NOT NULL DEFAULT 0');
      }
      if (!cols.includes('is_active')) {
        db.exec('ALTER TABLE tenant ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      }

      // Scoped by bundle: "GrowwNBT" exists in BOTH common-sdk (a real orgId-matched
      // tenant at priority 19) and groww-nbt-sdk (that bundle's fallback). Matching
      // on name alone would wrongly flag the common-sdk one.
      for (const [bundle, name] of [
        ['common-sdk', 'Common'],
        ['common-sdk', 'AltCommonTenant'],
        ['pb-sdk', 'PaisaBazaar'],
        ['indmoney-sdk', 'Indmoney'],
        ['groww-nbt-sdk', 'GrowwNBT'],
        ['dezerv-sdk', 'Dezerv'],
      ]) {
        db.run(
          `UPDATE tenant SET is_fallback = 1
            WHERE name = ?
              AND sdk_bundle_id = (SELECT id FROM sdk_bundle WHERE name = ?)`,
          [name, bundle],
        );
      }

      // Exists in the repo, never rendered: Fisdom (FisdomV2 is used), YesBank and
      // IndiaShelter (folders not referenced by renderRootComponent).
      const bundle = db.get("SELECT id FROM sdk_bundle WHERE name = 'common-sdk'");
      if (bundle) {
        for (const [name, component, note] of [
          ['Fisdom (legacy)', 'src/Tenants/Fisdom', 'Lazy-imported but never rendered; FisdomV2 is the live one.'],
          ['YesBank (legacy)', 'src/Tenants/YesBank', 'Folder exists, not referenced by routing.'],
          ['IndiaShelter (legacy)', 'src/Tenants/IndiaShelter', 'Folder exists, not referenced by routing.'],
        ]) {
          db.run(
            `INSERT OR IGNORE INTO tenant (sdk_bundle_id, name, component_path, priority, notes, is_active)
             VALUES (?, ?, ?, 999, ?, 0)`,
            [bundle.id, name, component, note],
          );
        }
      }
    },
  },
  {
    version: 6,
    name: 'tenant labels and param help',
    up(db) {
      // Slice is reachable twice — priority 1 via altFlow=SLICE_PFM and priority 36
      // via orgId — so the two rows need distinguishing, or they read as a duplicate.
      // The UI already prefixes the priority, so the label only carries the reason.
      const common = db.get("SELECT id FROM sdk_bundle WHERE name = 'common-sdk'");
      if (common) {
        db.run(
          `UPDATE tenant SET name = 'Slice (altFlow)'
            WHERE sdk_bundle_id = ? AND name = 'Slice' AND priority = 1`,
          [common.id],
        );
        db.run(
          `UPDATE tenant SET name = 'Slice (orgId)'
            WHERE sdk_bundle_id = ? AND name IN ('Slice', 'Slice (orgId)') AND priority = 36`,
          [common.id],
        );
      }

      // groww-nbt routes to three distinct components, not two: the desktop
      // userAgent picks the WebView variant, which is its own screen set.
      const groww = db.get("SELECT id FROM sdk_bundle WHERE name = 'groww-nbt-sdk'");
      if (groww) {
        db.run(
          `UPDATE tenant SET name = 'GrowwNBTEquities',
                  notes = 'version=v2. A desktop userAgent renders the WebView variant instead.'
            WHERE sdk_bundle_id = ? AND name = 'GrowwNBTEquities / WebView'`,
          [groww.id],
        );
        db.run(
          `INSERT OR IGNORE INTO tenant (sdk_bundle_id, name, component_path, priority, notes)
           VALUES (?, 'GrowwNBTEquitiesWebView', 'groww-nbt-sdk/src/Tenants', 1,
                   'Same rules as GrowwNBTEquities, chosen when the userAgent is desktop.')`,
          [groww.id],
        );
        // Give the new row the same routing rules as the variant it mirrors.
        const src = db.get(
          "SELECT id FROM tenant WHERE sdk_bundle_id = ? AND name = 'GrowwNBTEquities'",
          [groww.id],
        );
        const dst = db.get(
          "SELECT id FROM tenant WHERE sdk_bundle_id = ? AND name = 'GrowwNBTEquitiesWebView'",
          [groww.id],
        );
        if (src && dst) {
          db.run(
            `INSERT OR IGNORE INTO tenant_param (tenant_id, param_id, operator, value)
             SELECT ?, param_id, operator, value FROM tenant_param WHERE tenant_id = ?`,
            [dst.id, src.id],
          );
        }
      }

      // A param's own quirk belongs on the param, not repeated under every tenant
      // that happens to read it.
      db.run(
        `UPDATE param
            SET description = 'Secondary discriminator. Any value containing "DMI" is '
                           || 'normalised to DMI before matching, so DMI_ANYTHING routes to DMI.'
          WHERE name = 'altFlow'`,
      );
      db.run(
        `UPDATE tenant SET notes = NULL
          WHERE notes = 'Any altFlow containing DMI is normalised to DMI.'`,
      );
    },
  },
  {
    version: 7,
    name: 'backfill all accepted params',
    up(db) {
      // The tenant tab could only ever offer params that some tenant routed on, plus
      // the handful of non-routing ones already seeded. Every other query param the
      // SDK accepts (showDenyButton, noOTP, isMultiFip, fipId …) had no row, so it
      // could not be suggested. Insert the full accepted-param list and its known
      // values here so the console can offer them all. Idempotent: existing rows are
      // left untouched, so a description edited by hand survives. Routing is not
      // touched — no tenant_param rows are added.
      for (const [name, type, description] of PARAMS) {
        db.run('INSERT OR IGNORE INTO param (name, type, description) VALUES (?, ?, ?)',
          [name, type, description]);
      }
      for (const [name, values] of Object.entries(PARAM_VALUES)) {
        const p = db.get('SELECT id FROM param WHERE name = ? COLLATE NOCASE', [name]);
        if (!p) continue;
        for (const v of values) {
          db.run('INSERT OR IGNORE INTO param_value (param_id, value) VALUES (?, ?)', [p.id, v]);
        }
      }
    },
  },
];

const LATEST = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

function currentVersion(db) {
  const row = db.get('PRAGMA user_version');
  // node-sqlite3-wasm returns the pragma under its own name.
  return Number((row && (row.user_version ?? Object.values(row)[0])) || 0);
}

// Runs every migration newer than the recorded version, each in its own
// transaction so a failure leaves the file at the last good version rather than
// half-applied.
function migrate(db) {
  const from = currentVersion(db);
  const applied = [];

  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      // PRAGMA takes no bound parameters; the value is our own integer literal.
      db.exec(`PRAGMA user_version = ${Number(m.version)}`);
      db.exec('COMMIT');
      applied.push(m.name);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
    }
  }

  return { from, to: currentVersion(db), applied };
}

module.exports = { migrate, MIGRATIONS, LATEST, AA_SEED };
