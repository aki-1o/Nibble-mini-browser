const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  Menu,
  net,
  shell,
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const fsp = require('fs/promises');
const { TabCapture } = require('./net-capture');
const aaStore = require('./db');

const DEFAULT_TOP = 112;     // fallback until the renderer reports its real chrome height
const MIN_SIDEBAR = 300;     // px
const MIN_PAGE = 240;        // never let the page area get narrower than this

// ---- Client fingerprint ----------------------------------------------------
// WHY THIS EXISTS: some WAFs (F5 BIG-IP ASM in front of NADL, for one) reject
// requests whose client fingerprint doesn't look like a real browser. Electron
// gives away three tells by default:
//   1. the UA carries an "Electron/<version>" token,
//   2. it leaks a full build number (real Chrome freezes it to <major>.0.0.0),
//   3. sec-ch-ua lists only Chromium — a genuine Chrome also lists "Google Chrome".
// A UA claiming Chrome while the client hints say otherwise is itself a red flag,
// so the UA and the hints below are kept internally consistent.
//
// The Chrome version is taken from the Chromium that Electron actually runs, so
// the story matches the engine. Override `version` if a WAF demands something
// newer. Set CHROME_SPOOF.enabled = false to turn all of this off.
const CHROME_SPOOF = (() => {
  const version = process.versions.chrome.split('.')[0]; // e.g. "126"
  return {
    enabled: true,
    version,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + `(KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    acceptLanguage: 'en-US,en;q=0.9',
    headers: {
      'sec-ch-ua': `"Not/A)Brand";v="8", "Chromium";v="${version}", "Google Chrome";v="${version}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
})();

let win;                     // the shell BrowserWindow (tab strip + top bar + API console)

// One WebContentsView per tab; only the active one is visible.
const tabs = [];             // { id, view, url, title, loading }
let activeId = null;
let nextTabId = 1;
let pageHidden = false;      // true while a DOM overlay needs the page area

// Live layout state, driven by the renderer via the 'layout:set' IPC.
const layout = {
  top: DEFAULT_TOP,
  menuVisible: false,    // the burger drawer, always pinned to the left edge
  menuWidth: 250,
  sidebarVisible: false,
  sidebarSide: 'left',   // 'left' | 'right'
  sidebarWidth: 460,
};

const getTab = (id) => tabs.find((t) => t.id === id);
const activeTab = () => getTab(activeId);

function pageBounds() {
  const { width, height } = win.getContentBounds();

  // The drawer is a fixed-width panel on the left, so it eats from the left no
  // matter which side the console sits on.
  const menuW = layout.menuVisible ? Math.max(0, layout.menuWidth) : 0;

  let sw = 0;
  if (layout.sidebarVisible) {
    const maxSidebar = Math.max(MIN_SIDEBAR, width - menuW - MIN_PAGE);
    sw = Math.min(Math.max(layout.sidebarWidth, MIN_SIDEBAR), maxSidebar);
  }

  const left = menuW + (layout.sidebarSide === 'left' ? sw : 0);
  const right = layout.sidebarSide === 'right' ? sw : 0;

  return {
    x: left,
    y: layout.top,
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - layout.top),
  };
}

// Bounds go to every view so a tab is correctly sized the moment it is shown;
// visibility is what actually picks the active one.
function layoutViews() {
  if (!win || win.isDestroyed() || !tabs.length) return;
  const b = pageBounds();
  for (const t of tabs) {
    if (t.view.webContents.isDestroyed()) continue;
    t.view.setBounds(b);
    t.view.setVisible(t.id === activeId && !pageHidden);
  }
}

function tabLabel(t) {
  if (t.title) return t.title;
  if (t.url) {
    try {
      return new URL(t.url).host || t.url;
    } catch {
      return t.url;
    }
  }
  return 'New tab';
}

function tabHarState(t) {
  const cap = t.capture;
  const loaded = Boolean(t.url) && t.url !== 'about:blank';
  const count = cap ? cap.count : 0;

  let reason = null;
  if (cap && cap.unavailableReason) reason = cap.unavailableReason;
  else if (!loaded) reason = 'Nothing loaded in this tab yet — open a journey first.';
  else if (count === 0) reason = 'No network requests captured for this page yet.';

  return {
    count,
    available: Boolean(cap && cap.available) && loaded && count > 0,
    reason,
  };
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('tabs-updated', {
    activeId,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: tabLabel(t),
      url: t.url,
      loading: t.loading,
      har: tabHarState(t),
    })),
  });
}

// Requests can arrive in bursts, so coalesce the resulting UI pushes.
let tabsPushTimer = null;
function scheduleSendTabs() {
  if (tabsPushTimer) return;
  tabsPushTimer = setTimeout(() => {
    tabsPushTimer = null;
    sendTabs();
  }, 250);
}

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

function wirePageContextMenu(contents) {
  contents.on('context-menu', (event, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Reload', click: () => contents.reload() },
      { label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() },
      { type: 'separator' },
      {
        label: 'Inspect Element',
        click: () => {
          if (!contents.isDevToolsOpened()) {
            contents.openDevTools({ mode: 'bottom' });
          }
          contents.inspectElement(params.x, params.y);
        },
      },
    ]);
    menu.popup({ window: win });
  });
}

function wireTab(tab) {
  const contents = tab.view.webContents;
  const isActive = () => tab.id === activeId;

  wirePageContextMenu(contents);

  // Network capture starts with the tab — failures often happen in the first
  // second of a load, so there is deliberately no arm/start step.
  tab.capture = new TabCapture(contents, () => scheduleSendTabs());
  tab.capture.attach();

  // DevTools used to force capture to stop here, on the assumption that CDP
  // allows one client per WebContents. It does not: Chromium supports multiple
  // debugger clients per target, and a capture attached before DevTools opens
  // keeps receiving Network events — bodies included — with DevTools attached
  // as well. Verified on Electron 31 / Chromium 126. So nothing is detached on
  // 'devtools-opened' any more; that dance was silently producing empty HARs
  // for anyone who worked with DevTools open.
  //
  // The re-attach below is kept only as a safety net: if some other client ever
  // does displace us, closing DevTools is a natural moment to recover.
  contents.on('devtools-closed', () => {
    tab.capture.attach();
    sendTabs();
  });

  // One export = one page load.
  contents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) tab.capture.startNewPage(url);
  });

  contents.on('did-start-loading', () => {
    tab.loading = true;
    if (isActive()) win.webContents.send('page-loading');
    sendTabs();
  });
  contents.on('did-stop-loading', () => {
    tab.loading = false;
    if (isActive()) win.webContents.send('page-loaded');
    sendTabs();
  });
  contents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED (benign)
    if (isActive()) {
      win.webContents.send('page-error', { errorCode, errorDescription, validatedURL });
    }
  });
  contents.on('page-title-updated', (e, title) => {
    tab.title = title || '';
    sendTabs();
  });

  const onNav = (url) => {
    tab.url = url;
    if (isActive()) win.webContents.send('page-navigated', url);
    sendTabs();
  };
  contents.on('did-navigate', (e, url) => onNav(url));
  // SPA route changes (history.pushState / replaceState) do not fire
  // 'did-navigate', so without this the URL bar drifts out of sync with the page.
  contents.on('did-navigate-in-page', (e, url, isMainFrame) => {
    if (isMainFrame) onNav(url);
  });
}

function createTab(rawUrl = '', { activate = true } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      webSecurity: false,                 // <-- disable same-origin/CORS enforcement
      allowRunningInsecureContent: true,  // allow mixed http/https content
      contextIsolation: false,
      // Ensure the page-preload runs in nested iframes too (not just the top
      // document). The FIU SDK may live in an iframe-in-iframe and post to its
      // immediate parent; without this the listener would only exist in the
      // top frame and miss those events.
      nodeIntegrationInSubFrames: true,
      // Runs in the loaded page BEFORE any page script, so we catch every SDK
      // postMessage event from the start.
      preload: path.join(__dirname, 'page-preload.js'),
    },
  });

  const tab = { id: nextTabId++, view, url: '', title: '', loading: false };
  tabs.push(tab);
  win.contentView.addChildView(view);

  // Belt and braces: also set it on this WebContents so navigator.userAgent in
  // the page reports the spoofed value, not just the outgoing headers.
  if (CHROME_SPOOF.enabled) view.webContents.setUserAgent(CHROME_SPOOF.userAgent);

  wireTab(tab);

  if (activate) activeId = tab.id;
  layoutViews();

  const u = normalizeUrl(rawUrl);
  if (u) {
    tab.url = u;
    view.webContents.loadURL(u);
  }

  sendTabs();
  if (activate) win.webContents.send('page-navigated', tab.url);
  return tab;
}

function activateTab(id) {
  const tab = getTab(id);
  if (!tab || id === activeId) return;
  activeId = id;
  layoutViews();
  sendTabs();
  // Re-sync the shell for the newly shown tab.
  win.webContents.send('page-navigated', tab.url);
  win.webContents.send(tab.loading ? 'page-loading' : 'page-loaded');
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const [tab] = tabs.splice(idx, 1);
  if (tab.capture) tab.capture.detach('Tab closed.');
  try {
    win.contentView.removeChildView(tab.view);
  } catch { /* already detached */ }
  try {
    tab.view.webContents.close();
  } catch { /* already gone */ }

  if (!tabs.length) {
    activeId = null;
    createTab('');            // always keep one tab open
    return;
  }

  if (activeId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activeId = next.id;
    layoutViews();
    sendTabs();
    win.webContents.send('page-navigated', next.url);
    win.webContents.send(next.loading ? 'page-loading' : 'page-loaded');
    return;
  }

  layoutViews();
  sendTabs();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    title: 'Nibble',
    // assets/icon.ico, not favicon.ico: favicon.ico holds only a 16x16 frame, and
    // when Windows cannot find a large enough frame for the taskbar / Alt-Tab
    // slot it falls back to the host executable's icon — Electron's, in
    // development. icon.ico carries 16/32/48/64/128/256 of the same art.
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  createTab('');
  win.on('resize', layoutViews);
}

// Inject permissive CORS headers on ALL responses so calls succeed even when
// the AA server sends no Access-Control-Allow-Origin. The request hook also
// normalises the client-hint headers to match the spoofed Chrome UA — doing it
// here (rather than per navigation) means it covers the document, every
// subresource, XHR/fetch, and the API console's own requests.
function installCorsBypass() {
  const filter = { urls: ['*://*/*'] };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    const requestHeaders = details.requestHeaders || {};

    if (CHROME_SPOOF.enabled) {
      requestHeaders['User-Agent'] = CHROME_SPOOF.userAgent;
      for (const [k, v] of Object.entries(CHROME_SPOOF.headers)) {
        requestHeaders[k] = v;
      }
      // Chromium may have already emitted differently-cased variants; drop them
      // so the spoofed values are the only ones on the wire.
      for (const key of Object.keys(requestHeaders)) {
        const lower = key.toLowerCase();
        const isSpoofed = lower === 'user-agent'
          || Object.keys(CHROME_SPOOF.headers).some((h) => h.toLowerCase() === lower);
        const isCanonical = key === 'User-Agent'
          || Object.prototype.hasOwnProperty.call(CHROME_SPOOF.headers, key);
        if (isSpoofed && !isCanonical) delete requestHeaders[key];
      }
    }

    cb({ requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, cb) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase();
      if (
        k === 'access-control-allow-origin' ||
        k === 'access-control-allow-headers' ||
        k === 'access-control-allow-methods' ||
        k === 'access-control-allow-credentials'
      ) {
        delete headers[key];
      }
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS, PATCH'];
    cb({ responseHeaders: headers });
  });
}

// ---- API console: perform the HTTP request from the main process ----
// Uses Electron's net module, which goes through Chromium networking on the
// default session. That means: no CORS restrictions, localhost works, and
// cookies are shared with the page views (so a session cookie set here carries
// into the consent journey).
const REQUEST_TIMEOUT_MS = 60000;

function sendHttp(spec) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let timer = null;

    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let request;
    try {
      request = net.request({
        method: (spec.method || 'GET').toUpperCase(),
        url: spec.url,
        session: session.defaultSession,
        useSessionCookies: true,
        redirect: 'follow',
      });
    } catch (err) {
      return done({ error: `Invalid request: ${err.message}` });
    }

    for (const [k, v] of Object.entries(spec.headers || {})) {
      if (!k || v == null || v === '') continue;
      try {
        request.setHeader(k, String(v));
      } catch (err) {
        return done({ error: `Bad header "${k}": ${err.message}` });
      }
    }

    const redirects = [];
    // With redirect:'follow' Electron follows automatically; we only record.
    request.on('redirect', (statusCode, method, redirectUrl) => {
      redirects.push(redirectUrl);
    });

    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        done({
          status: response.statusCode,
          statusText: response.statusMessage || '',
          headers: response.headers || {},
          bodyText: buf.toString('utf8'),
          size: buf.length,
          timeMs: Date.now() - started,
          redirects,
        });
      });
      response.on('error', (err) => done({ error: `Response error: ${err.message}` }));
    });

    request.on('error', (err) => done({ error: err.message }));

    timer = setTimeout(() => {
      try { request.abort(); } catch { /* ignore */ }
      done({ error: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` });
    }, REQUEST_TIMEOUT_MS);

    try {
      if (spec.body && spec.body.length) request.write(spec.body, 'utf8');
      request.end();
    } catch (err) {
      done({ error: `Failed to send: ${err.message}` });
    }
  });
}

// ---- IPC from the shell renderer ----
// All navigation acts on the ACTIVE tab.
ipcMain.handle('nav:go', (e, rawUrl) => {
  const u = normalizeUrl(rawUrl);
  const t = activeTab();
  if (u && t) {
    t.url = u;
    t.view.webContents.loadURL(u);
  }
  return u;
});
ipcMain.handle('nav:back', () => {
  const t = activeTab();
  if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack();
});
ipcMain.handle('nav:reload', () => {
  const t = activeTab();
  if (t) t.view.webContents.reload();
});
ipcMain.handle('nav:reloadHard', () => {
  const t = activeTab();
  if (t) t.view.webContents.reloadIgnoringCache();
});
ipcMain.handle('nav:devtools', () => {
  const t = activeTab();
  if (!t) return;
  const c = t.view.webContents;
  if (c.isDevToolsOpened()) c.closeDevTools();
  else c.openDevTools({ mode: 'bottom' });
});

// The page's real URL, which is authoritative — the URL bar text can lag behind
// or be overwritten by the page's own navigations.
ipcMain.handle('nav:currentUrl', () => {
  const t = activeTab();
  return t ? t.view.webContents.getURL() : '';
});

// ---- tabs ----
ipcMain.handle('tabs:new', (e, rawUrl) => {
  const tab = createTab(rawUrl || '');
  // A blank tab: hand OS focus to the shell so the renderer can put the caret in
  // the URL bar. Without this the field would be focused in the DOM while
  // keystrokes still went to whichever page view held focus before.
  // A tab opened with a URL is left alone — the page is the thing to interact
  // with there.
  if (!rawUrl) win.webContents.focus();
  return tab.id;
});

// docs.html opens in a tab like any page, but it cannot go through tabs:new:
// normalizeUrl prefixes anything without a scheme with http://, which would turn
// the local file into a request for a host called "d". The file URL is built here
// and loaded straight into the view.
ipcMain.handle('docs:open', (e, theme) => {
  const file = pathToFileURL(path.join(__dirname, 'docs.html'));
  // The shell's light/dark choice is its own setting — Chromium's nativeTheme is
  // deliberately left alone — so the page cannot read it and is told instead.
  file.searchParams.set('theme', theme === 'dark' ? 'dark' : 'light');
  const url = file.toString();

  const tab = createTab('');
  tab.url = url;
  tab.view.webContents.loadURL(url);
  sendTabs();
  return tab.id;
});
ipcMain.handle('tabs:close', (e, id) => { closeTab(id); });
ipcMain.handle('tabs:activate', (e, id) => { activateTab(id); });
ipcMain.handle('tabs:list', () => ({
  activeId,
  tabs: tabs.map((t) => ({ id: t.id, title: tabLabel(t), url: t.url, loading: t.loading })),
}));

ipcMain.handle('layout:set', (e, patch) => {
  Object.assign(layout, patch || {});
  layoutViews();
  return { ...layout };
});

// The WebContentsView is a native overlay drawn on top of the window's DOM, so
// DOM popovers and dropdowns cannot paint above it and the divider drag loses
// mouse events once the cursor crosses into it. Hiding the view is the only way
// to let our own UI occupy that region; the page keeps running underneath.
ipcMain.handle('layout:pageHidden', (e, hidden) => {
  pageHidden = Boolean(hidden);
  layoutViews();
});

ipcMain.handle('http:send', (e, spec) => sendHttp(spec || {}));

// ---- AA mapping (SQLite) ---------------------------------------------------
// db.js validates its own input and answers { ok, rows } / { ok: false, error }
// rather than throwing, because an exception crossing IPC reaches the renderer
// as an unreadable wrapped string. Opening the database can still fail outright
// (unwritable userData, corrupt file), so that is caught here.
const guardDb = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch (err) {
    return { ok: false, error: `Database unavailable: ${err.message}` };
  }
};

ipcMain.handle('aamap:list',   guardDb(() => aaStore.list()));
ipcMain.handle('aamap:add',    guardDb((e, row) => aaStore.add(row || {})));
ipcMain.handle('aamap:update', guardDb((e, row) => aaStore.update(row || {})));
ipcMain.handle('aamap:remove', guardDb((e, id) => aaStore.remove(id)));

// ---- Database panel + file exports -----------------------------------------
// Exports go to a folder beside the HAR one rather than through a save dialog:
// the dialog would have to be modal over a window whose page view is a native
// overlay, and a fixed folder keeps the flow one click like the HAR pill.
const DB_DIR_NAME = 'Nibble DB';

ipcMain.handle('db:schema', guardDb(() => aaStore.schema()));

// ---- Tenant routing table ---------------------------------------------------
// Same { ok, ... } / { ok: false, error } contract as aamap:*, and every mutation
// answers with the whole tree so the panel redraws from one round trip.
ipcMain.handle('tenant:list',        guardDb(() => aaStore.tenantList()));
ipcMain.handle('tenant:add',         guardDb((e, row) => aaStore.tenantAdd(row || {})));
ipcMain.handle('tenant:update',      guardDb((e, row) => aaStore.tenantUpdate(row || {})));
ipcMain.handle('tenant:remove',      guardDb((e, id) => aaStore.tenantRemove(id)));
ipcMain.handle('tenant:paramAdd',    guardDb((e, row) => aaStore.tenantParamAdd(row || {})));
ipcMain.handle('tenant:paramRemove', guardDb((e, id) => aaStore.tenantParamRemove(id)));

// Writes the current tenant tables back out as a runnable seed file. Not the
// migration rewriting itself — see the comment on tenantSeedSource.
ipcMain.handle('tenant:exportSeed', () => exportInto(
  `tenant-seed-${harTimestamp()}.js`,
  async (file) => {
    const src = aaStore.tenantSeedSource();
    await fsp.writeFile(file, src, 'utf8');
    return Buffer.byteLength(src, 'utf8');
  },
));

// Writes into Downloads/Nibble DB/ and answers the same { path } / { error }
// shape the HAR export uses, so the renderer's toast handles both.
async function exportInto(fileName, write) {
  const dir = path.join(app.getPath('downloads'), DB_DIR_NAME);
  const file = path.join(dir, fileName);
  try {
    await fsp.mkdir(dir, { recursive: true });
    return { path: file, bytes: await write(file) };
  } catch (err) {
    return { error: `Could not write ${fileName}: ${err.message}` };
  }
}

ipcMain.handle('db:exportDb', () => exportInto(
  `nibble-${harTimestamp()}.db`,
  // Synchronous on purpose: exportTo closes the handle, copies, and the next
  // query reopens. Interleaving a query with the copy would defeat that.
  (file) => aaStore.exportTo(file),
));

// The shell samples this to colour the burger-menu lines from the app icon.
// Handed over as a data URL because a file:// image taints a canvas, which would
// block getImageData in the renderer.
let iconDataUrl = null;
ipcMain.handle('app:iconData', async () => {
  if (iconDataUrl !== null) return iconDataUrl;
  try {
    const buf = await fsp.readFile(path.join(__dirname, 'assets', 'favicon.ico'));
    iconDataUrl = `data:image/x-icon;base64,${buf.toString('base64')}`;
  } catch {
    iconDataUrl = '';   // cached as "unavailable"; the CSS fallback applies
  }
  return iconDataUrl;
});

// ---- HAR export ------------------------------------------------------------
// NOTE: the written file is SENSITIVE — it carries full request/response bodies
// including ecreq payloads, tokens and cookies. It stays on disk locally and is
// never uploaded, and there is no redaction yet.
const HAR_DIR_NAME = 'Nibble HAR';

function harTimestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function harFileName(pageUrl) {
  let host = 'page';
  let aaId = '';
  try {
    const u = new URL(pageUrl);
    host = u.host.replace(/[^a-z0-9._-]/gi, '_') || 'page';
    aaId = (u.searchParams.get('aaId') || '').replace(/[^a-z0-9._@-]/gi, '_');
  } catch { /* keep defaults */ }
  const stamp = harTimestamp();
  return aaId ? `${aaId}-${host}-${stamp}.har` : `${host}-${stamp}.har`;
}

// The SDK listener stores events per frame, so gather from every frame rather
// than only the main one (nested-iframe journeys log into the subframe).
async function collectSdkEvents(contents) {
  const events = [];
  let frames = [];
  try {
    frames = contents.mainFrame ? contents.mainFrame.framesInSubtree : [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    try {
      const raw = await frame.executeJavaScript('JSON.stringify(window.__sdkEvents || [])');
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) {
        for (const ev of parsed) events.push({ ...ev, _frameUrl: frame.url });
      }
    } catch { /* frame gone or cross-origin blocked */ }
  }
  return events;
}

ipcMain.handle('har:export', async () => {
  const t = activeTab();
  if (!t) return { error: 'No active tab.' };
  if (!t.capture) return { error: 'Capture is not running for this tab.' };

  const state = tabHarState(t);
  if (!state.available) return { error: state.reason || 'Nothing to export.' };

  const contents = t.view.webContents;
  const pageUrl = contents.getURL() || t.url || '';
  const sdkEvents = await collectSdkEvents(contents);

  const har = t.capture.toHar({
    pageUrl,
    sdkEvents,
    // app.getVersion() falls back to Electron's version when run unpackaged, so
    // read the real app version straight from package.json.
    creatorVersion: require('./package.json').version,
  });

  const dir = path.join(app.getPath('downloads'), HAR_DIR_NAME);
  const file = path.join(dir, harFileName(pageUrl));

  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(har, null, 2), 'utf8');
  } catch (err) {
    return { error: `Could not write the HAR file: ${err.message}` };
  }

  return {
    path: file,
    entries: har.log.entries.length,
    sdkEvents: sdkEvents.length,
  };
});

// Used by the toast's "Open folder" action for every kind of export — HAR,
// database copy, migration file.
ipcMain.handle('file:reveal', (e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

app.whenReady().then(() => {
  // Without an explicit AppUserModelID, Windows attributes the window to the
  // host executable and shows its icon instead of ours.
  if (process.platform === 'win32') app.setAppUserModelId('com.aa.minibrowser');

  if (CHROME_SPOOF.enabled) {
    // Covers any WebContents created from here on, plus the session default.
    app.userAgentFallback = CHROME_SPOOF.userAgent;
    session.defaultSession.setUserAgent(CHROME_SPOOF.userAgent, CHROME_SPOOF.acceptLanguage);
  }

  installCorsBypass();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// node-sqlite3-wasm is not garbage collected, so the handle must be closed by
// hand or the WASM instance and its file leak.
app.on('will-quit', () => {
  try { aaStore.close(); } catch { /* nothing to close */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
