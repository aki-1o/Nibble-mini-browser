# AGENTS.md — Nibble: AI Session Context

> Machine-readable context for AI agents working on this repo. Read this before
> making changes. It covers architecture, every file, the IPC/storage contracts,
> hard-won gotchas, and how to verify work. User-facing docs are `README.md`;
> in-app docs are `docs.html`. Do not confuse the three.

---

## 1. What this app is

**Nibble** — a tiny Electron desktop "browser" with a built-in **API console**, used
to test **Account Aggregator (AA) consent journeys** (RBI-regulated India AA stack:
consent artefacts, FIU SDK, redirect journeys).

- One **shell window** (tab strip + URL bar + burger menu + one resizable side
  column) built from plain HTML/CSS/JS in `index.html`.
- The actual web page renders in **native `WebContentsView`s** (one per tab),
  painted *above* the shell DOM. The shell never contains the page.
- An **API console** (Postman-style) sends HTTP requests from the main process.
- A **SQLite store** (`nibble.db`) holds the AA mapping and the SDK tenant routing
  table, migrated on open.

> ⚠️ **Security posture (deliberate — do not "fix"):** tabs use
> `webSecurity: false`, `allowRunningInsecureContent: true`,
> `contextIsolation: false`, `nodeIntegrationInSubFrames: true`. This is what lets
> a journey's cross-origin API calls work — the point of the tool. **Local testing
> only**; never open anything the user is signed into. See README "What not to
> open". Do not flip these flags casually.

### Tech stack (confirmed in use)

| Concern | Choice |
|---|---|
| Runtime | Electron **^31** (Chromium ~126), plain JS, no bundler/framework |
| SQLite | **`node-sqlite3-wasm`** (WASM, no native toolchain) — NOT better-sqlite3 |
| Build | **electron-builder ^24** (`--win`, NSIS + portable) |
| Styling | Hand-written CSS in `index.html`, CSS vars, `html[data-theme]` |
| Fingerprint | `@fingerprintjs/fingerprintjs` (UMD, from `node_modules`) |
| Tests | **None.** No test framework, no lint config, no CI. |

No React/Vue/TS/webpack. Every renderer file is a plain `<script>` — many are
IIFEs. Do not introduce a framework or bundler unless explicitly asked.

---

## 2. Commands

```powershell
npm install       # one-time; downloads Electron
npm start         # launch the app (electron .)
npm run pack      # → release/win-unpacked/ (fast build check, no installer)
npm run dist      # → release/Nibble Setup <ver>.exe + Nibble <ver>.exe (~75 MB)
```

**Debugging a running app** (renderer `console.log` → stderr):

```powershell
$p = Start-Process -FilePath 'node_modules\electron\dist\electron.exe' `
     -ArgumentList '.','--enable-logging' -PassThru `
     -RedirectStandardOutput '_o.log' -RedirectStandardError '_e.log'
Start-Sleep -Seconds 15
if (!$p.HasExited) { Stop-Process -Id $p.Id -Force }
Get-Content _e.log | Select-String -Pattern 'PROBE|Uncaught|TypeError'
```

> **This is the primary way to observe runtime behaviour** — there are no tests.
> To inspect state, add a temporary `console.log` probe, run, read the log, then
> **remove the probe**. Always remove probes before finishing.

**Version bump:** edit `package.json` → `version`, then `npm run dist`. Artifacts
land in `release/` (old versions accumulate; prune manually).

---

## 3. Process model

```
MAIN (main.js, Node)
  BrowserWindow "win" = shell (loads index.html)
  tabs[] of WebContentsView — the real pages, one visible
  installCorsBypass() on webRequest (strips CORS headers)
  http:send via Electron `net` (CORS-free requests)
  db.js + migrations.js (SQLite, main only)
  net-capture.js (CDP → HAR)
  Computes pageBounds() from layout pushed by the renderer

PRELOAD
  preload.js      → exposes window.nibble (contextBridge)
  page-preload.js → runs in PAGE frames, captures SDK events

RENDERER (shell UI, no Node)
  renderer.js        top bar, tabs, menu, layout, history, Database panel
  api-panel.js       API console (largest file)
  aa-mapping.js      AA mapping CRUD panel
  tenant-panel.js    Tenant routing tab
  fiuConfig-panel.js fiuConfig URL-param editor
```

**Direction rules:**
- Renderer → main: `window.nibble.*` → `ipcRenderer.invoke(channel)` → `ipcMain.handle`.
- Main → renderer: `webContents.send(channel)` → `window.nibble.on*` callbacks
  (`page-loading`, `page-loaded`, `page-navigated`, `page-error`, `tabs-updated`).
- Renderer ↔ renderer: **globals on `window`** (§6). This is how sibling `<script>`
  files cooperate. Script order matters (§7).

---

## 4. File map (repo root; `files` whitelist in package.json is authoritative)

| File | Lines | Process | Role |
|---|---|---|---|
| `main.js` | ~787 | main | Window/tabs/layout, CORS bypass, `http:send`, all IPC handlers, Chrome UA spoof, HAR export, app lifecycle |
| `preload.js` | 74 | preload | `contextBridge.exposeInMainWorld('nibble', …)` — the ONLY renderer→main API. Carries `version: '3.0.0'` (bridge version, unrelated to package version) |
| `page-preload.js` | 68 | page frames | Listens for SDK `postMessage` → `window.__sdkEvents` / `window.__lastSdkEvent`. Runs in **every** frame with a real `src` |
| `renderer.js` | ~1403 | renderer | Top bar, tab strip, burger drawer, layout engine, theming, history, Database panel, confirm/toast, navigation. Exposes `window.NibbleNav`, `window.NibbleUI` |
| `api-panel.js` | ~1430 | renderer | The API console. Single IIFE. URL tokens, headers/vars/body, AA tab, send flow, response rendering, inject-URL-param |
| `aa-mapping.js` | 182 | renderer | AA mapping CRUD. Calls `window.__nibbleAaReload` / `__nibbleDbReload` |
| `tenant-panel.js` | 674 | renderer | Tenant routing tab (bundles/tenants/params combobox, inject card, CRUD) |
| `fiuConfig-panel.js` | 249 | renderer | Decode/edit/re-encode the `?fiuConfig=` base64 URL param |
| `db.js` | 459 | main | SQLite store. Lazy `conn()`, validation, aa_mapping + tenant CRUD, pragma introspection, `tenantSeedSource()` |
| `migrations.js` | 516 | main | Versioned migrations (SQLite `user_version`), `AA_SEED`, `LATEST` |
| `tenant-seed.js` | 194 | main | **Data** for first-run tenant tables: `SDK_BUNDLES`, `PARAMS`, `PARAM_VALUES`, `TENANTS`, `THEME_ONLY_ORG_IDS` |
| `net-capture.js` | 384 | main | `TabCapture`: per-tab CDP recording → HAR 1.2 export |
| `index.html` | ~1515 | renderer | ALL shell markup + ALL CSS + panel markup. Theming via `html[data-theme]` |
| `docs.html` | 267 | renderer | In-app documentation page (opened as a tab, F1) |
| `README.md` | 366 | — | User-facing docs (build, usage, security). Keep in sync |
| `package.json` | 68 | — | version, scripts, electron-builder `build` config + `files` whitelist |

> **New file?** Add it to `package.json` → `build.files` **or it will be missing
> from packaged builds** (a real past bug — see `release/builder-*`).

---

## 5. Data & contracts

### 5.1 IPC channels (preload.js ↔ main.js)

```
nav:go|back|reload|reloadHard|devtools|currentUrl
tabs:new|close|activate|list        docs:open(theme)
har:export                          file:reveal(path)
layout:set(patch)                   layout:pageHidden(bool)
http:send(spec)
aamap:list|add|update|remove
db:schema|exportDb
tenant:list|add|update|remove|paramAdd|paramRemove|exportSeed
app:iconData
```

**DB response contract (uniform):**
- Success: `{ ok: true, rows: [...] }` (aamap) or `{ ok: true, ...tree }` (tenant —
  the whole tree, so the panel redraws in one round trip).
- Failure: `{ ok: false, error: '<friendly>' }` — **never a thrown error**, because
  an exception crossing IPC arrives as an unreadable wrapped string.
- `main.js` wraps every DB handler in `guardDb(fn)` → `try/catch` → `{ ok:false, error }`.

### 5.2 localStorage keys

**`renderer.js` → `K`:** `nibble.lastUrl`, `nibble.history`, `nibble.theme`,
`nibble.sbSide`, `nibble.sbWidth`, `nibble.panel`, …

**`api-panel.js` → `K` (request state):**
```
nibble.api.method   nibble.api.url      nibble.api.key
nibble.api.headers  nibble.api.vars     nibble.api.body
nibble.api.resHeight nibble.api.journeyUrl nibble.api.aa
nibble.api.version  ← PANEL_VERSION ('3'); mismatch wipes ALL nibble.api.* above
```

**`tenant-panel.js` → `K`:** `nibble.tenant.bundle`, `nibble.tenant.id`

> **`PANEL_VERSION` wipe (api-panel.js ~1889):** on load, if
> `localStorage['nibble.api.version'] !== '3'`, **every** `K.*` key is deleted and
> re-seeded. Intentional ("bump to force a new default") but it also destroys
> **user-entered** values with no default — notably `apiKey` and `headers`. If a
> user reports saved values vanished after an update, this is the first suspect.
> Renderer `K.*` (tab/layout/theme) are untouched.

### 5.3 SQLite — `nibble.db`

- **Location:** `app.getPath('userData')` → Windows `%APPDATA%\Nibble\nibble.db`
  (survives reinstalls; app dir is read-only once installed).
- **Open:** lazy, on first use (`db.js conn()`), which runs `migrate(db)`.
- **Version:** SQLite `user_version` pragma (an integer in the file header).
- **Closed:** manually on `app.on('will-quit')` — `node-sqlite3-wasm` is not GC'd.

**Tables:**
- `aa_mapping(id, aa_name UNIQUE NOCASE, aa_id UNIQUE NOCASE, created_at, aa_code,
  aaclass, sdk_folder, env)` — feeds the console's **AA** dropdown.
- `sdk_bundle`, `param`, `param_value`, `tenant`, `tenant_param`, `theme_only_org`
  — the **Tenant** tab routing model.

**Two seed sources:**
1. `migrations.js` → `AA_SEED` + migrations 1–10 (AA list).
2. `tenant-seed.js` → consumed by migration 3 (tenant tables). Regenerate via the
   Tenant tab's export (`tenant:exportSeed`) and commit over `tenant-seed.js` —
   that makes today's DB the new first-run baseline.

**Seeding rule:** seed **only an empty table** (`if (n) return;`), so a list the
user deliberately emptied stays empty.

**Migrations:** append-only. Never edit or renumber an entry — a DB that already
recorded that version will skip it. Each runs in its own `BEGIN/COMMIT` with
`ROLLBACK` on failure. Current `LATEST` = **10**.

### 5.4 Data flow: AA dropdown (the classic bug area)

```
migrations.js seed → aa_mapping table
        ↓ (first conn() opens + migrates)
renderer startup: buildAaOptions() from hardcoded FALLBACK list   ← immediate paint
        ↓ async
window.__nibbleAaReload() → nb.aaMap.list() → replaces AA_OPTIONS from DB
        ↓
aa-mapping.js apply() also calls __nibbleAaReload() after any CRUD
```
The hardcoded fallback (`AA_OPTIONS` in `api-panel.js`) keeps the dropdown from
being blank while the DB answers, and keeps it working if the DB is unreadable.

---

## 6. Renderer globals (sibling-file cooperation)

Set by one file, consumed by others. **Callers guard with
`typeof x === 'function'`** because load order and optional panels make them
non-guaranteed.

| Global | Set by | Used by |
|---|---|---|
| `window.nibble` | preload.js | every renderer file (the IPC bridge) |
| `window.NibbleNav` | renderer.js | api-panel (journey open), tenant-panel, fiuConfig (`navigate`, `getPageUrl`, `setPageUrl`, `getLiveUrl`, `addHistory`, `setSidebarVisible`) |
| `window.NibbleUI` | renderer.js | api-panel, aa-mapping (`setPageOverlay`, `confirm`, `toast`) |
| `window.__nibbleAaReload` | api-panel.js | aa-mapping.js (after any AA change) |
| `window.__nibbleDbReload` | renderer.js | aa-mapping.js (refresh Database panel) |
| `window.__sdkEvents`, `window.__lastSdkEvent` | page-preload.js | main.js `collectSdkEvents()` → HAR `_sdkEvents` |

**Never assume a global exists** — always `typeof x === 'function'` before calling.

---

## 7. ⚠️ Script load order & the synchronous-startup hazard

From `index.html` (order is significant):

```html
<script src="renderer.js"></script>
<script src="node_modules/@fingerprintjs/fingerprintjs/dist/fp.umd.min.js"></script>
<script src="api-panel.js"></script>
<script src="aa-mapping.js"></script>
<script src="tenant-panel.js"></script>
<script src="fiuConfig-panel.js"></script>
```

**`api-panel.js` is one giant synchronous IIFE.** It runs `getElementById` at the
top, then wires listeners and seeds values top-to-bottom. Two consequences:

1. **A single `null.addEventListener` aborts EVERYTHING below it.** This was a real,
   shipped bug: a since-removed MPIN / Change-MPIN / Mobile-Validation /
   Challenge-Response feature referenced **14 element IDs that did not exist in
   `index.html`** (that markup was never committed). The IIFE crashed at
   `createMpinBtn.addEventListener` and consequently **never built the AA
   dropdown nor called `__nibbleAaReload()`** — so migration-seeded defaults
   never appeared on first load.

   **What was done (do not regress):** the entire MPIN/mobile-validation/
   challenge feature was removed from `api-panel.js` (~570 lines: 14 stubbed
   element refs, `optEl()` helper, 5 helpers like `isRegisterUrl` /
   `updateRegisterActions` / `findAccessToken`, the 4 request functions
   `createMpin` / `changeMpin` / `validateMobile` / `submitChallengeResponse`,
   and the register-token capture inside `send()`). Only generic server-side
   error strings mentioning MPIN/VUA remain in the friendly-error table.

   > **When adding UI:** add the markup to `index.html` in the same change as any
   > new `getElementById`. After any startup change, run the app and grep stderr
   > for `Uncaught`.

2. `aa-mapping.js` and `tenant-panel.js` each fire an async `list()` at their
   bottom; `api-panel.js` defines `__nibbleAaReload` *before* they run (script
   order), so their `apply()` can call it.

**Verification recipe for a panel-startup change:** add a temp probe logging the
dropdown/rows you expect, run with `--enable-logging`, confirm contents, then
**delete the probe**.

---

## 8. Other hard-won gotchas

- **`#apiUrl` is a `contenteditable` div, not an `<input>`.** It uses
  **`.textContent`** (set in `setUrl`) — NOT `.value`. Probing `apiUrlEl.value`
  returns `undefined` and is a false alarm. `renderUrl()` wraps each `{{token}}`
  in a hoverable span.
- **The page is a native view above the DOM.** Anything that must draw *over* the
  page (popovers, confirm dialog, resize drag) must first hide it via
  `window.NibbleUI.setPageOverlay(name, on, hint)` — reference-counted by name so
  overlays can't un-hide each other. Forgetting this makes the element invisible.
- **`getElementById` at IIFE top can be `null`** for optional/late markup → §7.
- **New file?** Add to `package.json` `build.files` (§4).
- **`app.getVersion()` is wrong when unpackaged** (falls back to Electron's
  version) — HAR export reads `require('./package.json').version` instead.
- **Chrome UA spoof** (`CHROME_SPOOF` in main.js): strips the `Electron/x` token,
  pins build to `Chrome/<major>.0.0.0`, keeps `sec-ch-ua` consistent so F5 WAFs
  (NADL) don't reject. Toggle via `CHROME_SPOOF.enabled`.
- **Finvu paths:** Finvu journeys need a `/finvu` prefix or they render blank;
  `renderer.js` shows a fixable notice (`needsFinvuPrefix`/`withFinvuPrefix`).
- **`ON DELETE CASCADE` needs `PRAGMA foreign_keys = ON`** — off by default in
  SQLite; `tenantRemove()` enables it per-connection rather than trusting schema.
- **Never `innerHTML` user data** (AA/tenant names are user input) — use
  `textContent`. The codebase is strict about this.
- **HAR files are sensitive** (bearer tokens, cookies, `ecreq` payloads) — no
  redaction by design. Treat exports as secrets.
- **`node-sqlite3-wasm` leaks** if a prepared statement isn't finalized — only
  `db.run/get/all` (which finalize internally) are used. Keep it that way.
- **The four panel files are separate IIFEs** — a crash in one does NOT stop the
  others; only that panel's own feature set dies with it.

---

## 9. Conventions & style

- **Comments explain *why*, not *what*.** They are unusually detailed and call out
  trade-offs and past bugs. Match this voice; a bare "what" comment is off-style.
- **Section banners:** `/* ---- name ---- */` and `// ---- name ----`. Use them
  liberally to divide a file.
- **IIFEs** for renderer panels: `(function name() { … })();` with a file-header
  comment naming the file and its responsibility.
- **`'use strict';`** at top of main-process modules.
- **Validation lives in `db.js`** (renderer input is untrusted): `required()`,
  `optional()`, `rowId()`, `friendly()` (maps SQL UNIQUE violations to human text).
- **UI state → localStorage; durable/relational data → SQLite.** Never store the
  AA list or tenant table in localStorage.
- **One redraw source of truth:** every DB mutation answers with the full
  list/tree so the UI never reconciles a partial update.
- **Naming:** camelCase; `render*` (draw), `apply*` (commit + redraw), `fill*`
  (populate a select), `set*Visible` (layout). Elements referenced by DOM id.
- **README is user-facing** — change behaviour/shortcuts/build steps → update it.
  `docs.html` is the in-app mirror (F1).

### Keyboard shortcuts (renderer.js ~1287)
```
F12 devtools        F5 / Ctrl+R reload     Ctrl+Shift+R hard reload
Ctrl+B API console  Ctrl+M AA mapping       Ctrl+D Database
Ctrl+H history      Ctrl+T new tab          Ctrl+W close tab
F1 docs             Ctrl+Enter send (in body editor)
```

---

## 10. Task playbooks

**Add a new side panel:**
1. Markup → `index.html` inside `<aside id="sidebar">` as a `.panelBody`.
2. Entry in `PANELS` (`renderer.js` ~682): `{ title, body, item, tick, onShow? }`.
3. Burger menu item + tick span in `index.html` menu; wire click → `openPanel('name')`.
4. Add a `Ctrl+<key>` shortcut in the keydown handler.
5. If it has a JS file → add `<script>` in `index.html` **and** `build.files`.
6. If another panel mutates its data, expose a `window.__…Reload` hook.

**Add a DB migration:**
1. Append `{ version: <LATEST+1>, name, up(db) }` to `MIGRATIONS`. Never edit old ones.
2. Seed only-if-empty inside `up`.
3. Test **both** paths headlessly: fresh file (0→N) **and** an existing older DB
   (open with `node-sqlite3-wasm`, `require('./migrations')`, `migrate(db)`,
   assert rows) — see §11.

**Change request/URL/body behaviour:** `api-panel.js`. Remember the URL is a
`contenteditable` div; `{{tokens}}` resolve via `varMap()`; body supports `//`
and `/* */` comments stripped on send; the **AA tab overrides**
`accountAggregatorId` in the body; `Content-Type: application/json` is added
automatically when a body is present.

**Diagnose "defaults not loading":** follow §5.4, then §7. Almost always one of:
(a) the IIFE crashed, (b) the `PANEL_VERSION` wipe, (c) the migration never ran
because `conn()` wasn't reached.

---

## 11. Validation (there are no unit tests)

Because the project has **no test suite**, validate by running:

1. **Static:** re-read the edited region; check every `getElementById` target
   exists in `index.html` (a missing id is the #1 bug class here).
2. **Migration headless check** (safe, no GUI):
   ```js
   const { Database } = require('node-sqlite3-wasm');
   const { migrate, LATEST } = require('./migrations');
   const db = new Database(tmpPath);            // fresh file
   console.log(migrate(db));                    // expect from:0 to:LATEST
   console.log(db.all('SELECT aa_name, aa_id FROM aa_mapping'));
   // ALSO test upgrading a DB built by the PREVIOUS migrations.js
   ```
3. **Live smoke test:** `npm start` (or the `--enable-logging` recipe in §2) and
   confirm: no `Uncaught` in stderr, AA dropdown populated, Tenant tab populated,
   panel opens (Ctrl+B), a request sends.
4. **Build:** `npm run pack` for a fast packaged-start check; `npm run dist` for
   release artifacts in `release/`.
5. **Clean up:** delete temp probe scripts/logs. `git status` should show only
   intended edits.

### Current git state (when this file was written)
- Branch: **`bug-fixes`** (HEAD `a43d346`), remote `origin/bug-fixes`.
- Uncommitted: `api-panel.js`, `index.html`, `migrations.js`, `package.json`
  (+ untracked `Nibble/` build output — do not commit build artifacts).
- `package.json` version: **2.5.2**. Migrations `LATEST`: **10**.
- Recent work: fixed the startup crash by removing the dead MPIN helpers (§7);
  added migrations 8–10 (AA id fixes + re-seed).

---

## 12. Known gaps / open TODOs

- **MPIN / Change-MPIN / Mobile-Validation / Challenge-Response was removed.**
  The helpers existed in `api-panel.js` but had no markup in `index.html` and
  caused the startup crash; the whole cluster (~570 lines) was deleted.
  Only generic server-side error strings (e.g. `2103`, `VUA already taken`)
  remain in the friendly-error table — those describe API responses, not UI.
- **`release/` accumulates old installers** (1.0.0 → 2.5.2); prune manually.
- **`PANEL_VERSION` wipe destroys user `apiKey`/`headers`** on version bump (§5.2) —
  arguably too broad; revisit if users report lost secrets.
- **No code signing** → Windows SmartScreen warns on first run (README workaround).
- **README build section still shows example version "1.0.0"** — cosmetic.

---

## 13. Deep reference: exact IPC payloads

### 13.1 `layout:set` (renderer → main)

`renderer.js pushLayout()` sends this; `main.js` merges it into its `layout` object
and calls `layoutViews()`. All fields optional:

```js
nb.setLayout({
  top:            number,   // chrome height (chromeEl.offsetHeight); page y-origin
  menuVisible:    boolean,  // burger drawer open?
  menuWidth:      number,   // drawer px (default 250)
  sidebarVisible: boolean,  // panel column on screen?  ← use consoleShown(), NOT raw flag
  sidebarSide:    'left'|'right',
  sidebarWidth:   number,   // panel px (default 460)
});
```

**`main.js pageBounds()` math** (where the native page view is placed):
```
menuW  = menuVisible ? max(0, menuWidth) : 0
maxSidebar = max(MIN_SIDEBAR(300), width - menuW - MIN_PAGE(240))
sw     = sidebarVisible ? clamp(sidebarWidth, 300, maxSidebar) : 0
left   = menuW + (sidebarSide==='left'  ? sw : 0)
right  = sidebarSide==='right' ? sw : 0
x=left, y=top, width = contentWidth - left - right
```
> **Key subtlety:** `sidebarVisible` is driven by **`consoleShown()`**, which is
> `sidebarVisible && !(menuVisible && sidebarSide==='left')` — a left drawer and a
> left panel are never on screen together (they'd fight for the same column), so
> the drawer *sets aside* the left panel. On the right both fit. Sending the raw
> `layoutState.sidebarVisible` instead of `consoleShown()` causes overlapping views.

### 13.2 `http:send` spec (renderer → main) and its response

`api-panel.js send()` builds `spec`; `main.js` runs it through Electron `net`.

```js
spec = { method: 'GET'|'POST'|…, url: string,
         headers: { Name: 'value', … },   // already variable-substituted
         body?: string }                  // JSON string; omitted for GET/HEAD
```

Response **on success** (what `send()` destructures):
```js
{ status: 200, statusText: 'OK', headers: {…},
  bodyText: '…', timeMs: 123, size: 456, url: '…' }
```
Response **on failure** (transport/exception) — **note the different key**:
```js
{ error: 'Could not connect…' }   // send() checks `res.error` FIRST
```
> `send()` branches: `if (res && res.error) {…}` handles network failure, else
> reads `res.status`. Keep both paths when touching this.

### 13.3 Tab / page events (main → renderer)

| Channel | Payload | Meaning |
|---|---|---|
| `page-loading` | none | spinner on |
| `page-loaded` | none | spinner off |
| `page-navigated` | `url: string` | URL bar sync (fires on nav + SPA `did-navigate-in-page`) |
| `page-error` | `info` | load failed → notice bar |
| `tabs-updated` | `state: { tabs:[{id,url,title,loading,active}], activeId }` | tab strip redraw |

Renderer subscribes via `nb.onLoading/onLoaded/onNavigated/onError/onTabs`.

### 13.4 Tab creation (`main.js createTab`)

```js
new WebContentsView({ webPreferences: {
  webSecurity: false, allowRunningInsecureContent: true,
  contextIsolation: false, nodeIntegrationInSubFrames: true,
  preload: page-preload.js,
}})
```
Contrast: the **shell window** uses `contextIsolation: true, nodeIntegration: false,
preload: preload.js`. The *page* is insecure-by-design; the *shell* is locked down —
do not copy one's settings onto the other.
- `closeTab` always keeps ≥1 tab (creates a blank one if the last closes).
- The page view is a **child of `win.contentView`**, layered above the shell DOM.

---

## 14. Deep reference: the `send()` pipeline (api-panel.js)

The single most complex function. Order of operations — preserve it:

1. **Resolve variables:** `map = varMap()` (name → value from var rows); `missing = new Set()`.
2. **URL:** `applyVars()` over the raw URL text → `urlLeftovers`. If any token
   unresolved → render error, **abort** (sending is blocked). Prepend `http://` if
   no scheme. (URL is read from `apiUrlEl.textContent`, not `.value`.)
3. **Flags:** `method = methodSel.value`;
   `isAccountDiscovery` = POST whose pathname ends `/api/v2/accounts/discover`;
   `registerRequest = isRegisterUrl(url)`.
4. **Body** (skipped for GET/HEAD):
   - `cleanBody(rawBody)` strips `//`, `/* */` comments + leftover commas.
   - `applyVars` → `cleaned`; `JSON.parse(cleaned)` → **abort with `bodyErr` on parse failure**.
   - `applyVarsToBodyKeys(parsedBody)` — variables named after **top-level** fields overwrite them.
   - **AA tab wins:** `if (aaId && isPlainObject) parsedBody.accountAggregatorId = aaId`.
   - discovery → `parsedBody.update_secondary_mobile = checkbox.checked`.
   - Re-serialise **only if something changed**; otherwise send `cleaned` verbatim.
5. **Headers:** iterate `readRows(headerRows)` → `headers[k] = applyVars(v)`.
6. **API key:** `keyVal = applyVars(apiKeyInput.value)`. If present →
   `X-API-KEY` for register/discovery requests, else `API_KEY` header.
7. **Register extras:** adds `transaction-id` (uuid) + `Authorization: Bearer …` when a token exists.
8. **Send:** `nb.sendRequest(spec)` → **`res.error` branch first**, then `status`.
9. **Post-response:** render headers/body; for register, extract refreshed
   `accessToken`/`refreshToken` via `findAccessToken`/`findRefreshToken` and
   `upsertVar(...)`; auto-fill `journeyUrl` from `redirectionUrl` in the body; call
   `showFriendlyApiError` (drives `#apiErrorMessage` with the `API_ERROR_MESSAGES` map).

**Body chip system:** `renderBodyChips()`/`renderBodyVars()` surface two chip kinds —
solid `{{token}}` chips (textual substitution) and dashed **field-name** chips
(top-level overwrite). Both open the same `#varPop` card as URL tokens.

---

## 15. Deep reference: theming & layout persistence

**Theme** (`renderer.js`): `THEMES = ['light','dark','system']`; `systemDark =
matchMedia('(prefers-color-scheme: dark)')`. `applyTheme(pref, {persist})` sets
`document.documentElement.dataset.theme` (resolving `system` → light/dark). Stored
in `localStorage[K.theme]`, applied on `DOMContentLoaded`. All colours are CSS vars
scoped under `:root, html[data-theme="light"]` and `html[data-theme="dark"]` in
`index.html` — **the native page render is not themed** (we don't control it).

**Layout restore (DOMContentLoaded ~1375):**
```js
layoutState.sidebarVisible = true;      // EVERY launch opens the API console
layoutState.panel = 'api';              // deliberately NOT restored from storage
sidebarSide = K.sbSide==='right' ? 'right':'left';   // width/side ARE restored
menuVisible = K.menuVisible==='1';
sidebarWidth = clampWidth(saved || 460);
menuWidth    = clampMenuWidth(saved || 250);
applyLayout();
```
> The open/closed state of the console is a **session-only** choice (the console is
> the point of the app), but **width and side** are persistent preferences. Don't
> "fix" this by restoring `sidebarVisible` from storage.

**Panels:** `PANELS` map (`renderer.js ~682`) keys `api|map|db|hist` →
`{ title, body, item, tick, onShow? }`. `openPanel(name)` swaps the visible
`.panelBody`, closes the drawer, sets `aria-pressed`/ticks. `onShow` redraws stale
content (history/db). `togglePanel(name)` = close if already showing, else open.

**Overlays:** `setPageOverlay(name, on, hint)` reference-counts named overlays and
calls `nb.setPageHidden(...)` — required before any element that must appear over
the native page (drag, confirm, popovers) becomes visible.

---

## 16. Deep reference: HAR capture (net-capture.js + main.js)

- **Why CDP, not `webRequest`:** need timings **and** response bodies (a WAF
  returning HTTP 200 + HTML block page was the key evidence in a real bug).
- **Per-tab:** each tab gets a `TabCapture` attached to `webContents.debugger`
  (`attach('1.3')`), fed by `Network.*WillBeSent`/`ResponseReceived`/`LoadingFailed`/`LoadingFinished`.
- **Caps:** `MAX_ENTRIES = 500`, `MAX_BYTES = 50 MB`/tab, `MAX_SINGLE_BODY = 8 MB`
  (bigger bodies stored as a placeholder string). `enforceCaps()` trims oldest-first
  and counts `dropped`.
- **Export (`har:export`):** requires an active tab + running capture; writes
  `Downloads/Nibble HAR/<aaId-host-timestamp>.har`; returns `{ path, entries, sdkEvents }`.
  Creator version read from `package.json` (NOT `app.getVersion()`).
- **SDK events:** `collectSdkEvents(contents)` walks **all frames**
  (`mainFrame.framesInSubtree`) and `executeJavaScript('JSON.stringify(window.__sdkEvents||[])')`
  so nested-iframe journeys are captured. Emitted as custom `log._sdkEvents`.
- **Sensitive:** full `ecreq` payloads, bearer tokens, cookies — **no redaction**.
  Treat exports as secrets.

---

## 17. Deep reference: the AA/tenant domain model

**AA vs Tenant (the app's core distinction — get this wrong and features break):**
- **AA** (Account Aggregator) = the RBI-licensed aggregator the consent APIs live
  on. **Baked into the SDK at build time** (`REACT_APP_AACLASS`). Chosen in the
  **AA tab** → written into the request **body** as `accountAggregatorId`.
  Also drives `aaId` (short code) on the journey URL — a *different* value that
  only picks the S3 config path/branding.
- **Tenant** = the FIU-branded UI the deployment renders, chosen **at runtime**
  from redirect-URL params (`orgId`, `altFlow`, `version`, `journeyType`…).
  Chosen in the **Tenant tab** → emits **query params** (`injectIntoUrl`).
  Orthogonal axes of the same journey.

**Routing operators** (mirror what the SDK actually does — not flattened to `=`):
```
EQUALS       param === value
CONTAINS_CI  param.toLowerCase().includes(value)   (creditsaison, DMI)
NOT_EQUALS   guard clauses (altFlow !== 'YB_ASSIST')
PRESENT      param exists
ABSENT       param absent
```
**`TENANTS` priority = the SDK's if/else order** and is preserved because routing
is ordered (`altFlow=SLICE_PFM` beats `orgId=MOBIKWIK…`). Never sort/dedupe it away.

**Request-form injection (`injectIntoUrl`)** merges params without rebuilding the
URL: only proceeds when `fi`, `reqdate`, `ecreq` are all present and orgId set;
existing keys updated in place, new keys front-inserted after the host.

---

## 18. Master debug decision tree

| Symptom | First checks (in order) |
|---|---|
| Panel/defaults blank on load | §7 IIFE crash (`Uncaught` in stderr); then §5.4 chain; then §5.2 `PANEL_VERSION` wipe |
| AA dropdown wrong/empty | §5.4: is `__nibbleAaReload` defined? does `aaMap.list()` return rows? migration seeded? |
| Element `null` / `addEventListener` error | Missing id in `index.html` (§7) — verify every `getElementById` target |
| Element invisible/under the page | Forgot `setPageOverlay` (§15); native view is above the DOM |
| Page view mispositioned/overlapping | `layout:set` used raw flag instead of `consoleShown()` (§13.1) |
| Request fails but server is up | `res.error` vs `res.status` (§13.2); CORS bypass; UA spoof |
| URL field reads `undefined` | It's `contenteditable` — read `.textContent`, not `.value` (§8) |
| Works locally, missing in `.exe` | File absent from `package.json` `build.files` (§4) |
| Migration didn't apply | Never edited/renumbered an old one; `conn()` not reached; test both paths (§11) |
| Saved key/headers vanished | `PANEL_VERSION` wipe (§5.2) |
| Tenant routing wrong | Operator/priority semantics (§17) — order matters |
| HAR empty | Capture not attached (needs active tab, debugger); caps (§16) |

**Golden rule:** with no test suite, *observe before and after* — add a temp
`console.log` probe, run with `--enable-logging` (§2), diff the output, remove the probe.
