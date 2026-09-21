const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  Menu,
  net,
} = require('electron');
const path = require('path');

const DEFAULT_TOP = 84;      // fallback until the renderer reports its real chrome height
const MIN_SIDEBAR = 300;     // px
const MIN_PAGE = 240;        // never let the page area get narrower than this

let win;        // the shell BrowserWindow (hosts the top bar + API console)
let pageView;   // WebContentsView that renders the consent journey

// Live layout state, driven by the renderer via the 'layout:set' IPC.
const layout = {
  top: DEFAULT_TOP,
  sidebarVisible: false,
  sidebarSide: 'left',   // 'left' | 'right'
  sidebarWidth: 460,
};

function layoutPageView() {
  if (!win || !pageView) return;
  const { width, height } = win.getContentBounds();

  let sw = 0;
  if (layout.sidebarVisible) {
    const maxSidebar = Math.max(MIN_SIDEBAR, width - MIN_PAGE);
    sw = Math.min(Math.max(layout.sidebarWidth, MIN_SIDEBAR), maxSidebar);
  }

  const x = layout.sidebarVisible && layout.sidebarSide === 'left' ? sw : 0;

  pageView.setBounds({
    x,
    y: layout.top,
    width: Math.max(0, width - sw),
    height: Math.max(0, height - layout.top),
  });
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

function createPageView() {
  pageView = new WebContentsView({
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

  win.contentView.addChildView(pageView);
  layoutPageView();

  const contents = pageView.webContents;
  wirePageContextMenu(contents);

  contents.on('did-start-loading', () => win.webContents.send('page-loading'));
  contents.on('did-stop-loading', () => win.webContents.send('page-loaded'));
  contents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED (benign)
    win.webContents.send('page-error', { errorCode, errorDescription, validatedURL });
  });
  contents.on('did-navigate', (e, url) => win.webContents.send('page-navigated', url));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    title: 'Nibble',
    icon: path.join(__dirname, 'assets', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  createPageView();

  win.on('resize', layoutPageView);
}

// Inject permissive CORS headers on ALL responses so calls succeed even when
// the AA server sends no Access-Control-Allow-Origin.
function installCorsBypass() {
  const filter = { urls: ['*://*/*'] };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    cb({ requestHeaders: details.requestHeaders });
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
// cookies are shared with the page view (so a session cookie set here carries
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
ipcMain.handle('nav:go', (e, rawUrl) => {
  const u = normalizeUrl(rawUrl);
  if (u && pageView) pageView.webContents.loadURL(u);
  return u;
});
ipcMain.handle('nav:back', () => {
  if (pageView && pageView.webContents.canGoBack()) pageView.webContents.goBack();
});
ipcMain.handle('nav:reload', () => {
  if (pageView) pageView.webContents.reload();
});
ipcMain.handle('nav:devtools', () => {
  if (!pageView) return;
  const c = pageView.webContents;
  if (c.isDevToolsOpened()) c.closeDevTools();
  else c.openDevTools({ mode: 'bottom' });
});

ipcMain.handle('layout:set', (e, patch) => {
  Object.assign(layout, patch || {});
  layoutPageView();
  return { ...layout };
});

// The WebContentsView is a native overlay drawn on top of the window's DOM, so
// DOM popovers and dropdowns cannot paint above it and the divider drag loses
// mouse events once the cursor crosses into it. Hiding the view is the only way
// to let our own UI occupy that region; the page keeps running underneath.
ipcMain.handle('layout:pageHidden', (e, hidden) => {
  if (pageView) pageView.setVisible(!hidden);
});

ipcMain.handle('http:send', (e, spec) => sendHttp(spec || {}));

app.whenReady().then(() => {
  // Without an explicit AppUserModelID, Windows attributes the window to the
  // host executable and shows its icon instead of ours.
  if (process.platform === 'win32') app.setAppUserModelId('com.aa.minibrowser');

  installCorsBypass();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
