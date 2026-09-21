// renderer.js — top bar + layout (sidebar placement, resizing, URL history).
// The API console's own logic lives in api-panel.js.

const nb = window.nibble;

const urlInput    = document.getElementById('url');
const goBtn       = document.getElementById('go');
const rewriteOpenBtn   = document.getElementById('rewriteOpen');
const rewriteConfigBtn = document.getElementById('rewriteConfig');
const rewriteLabel     = document.getElementById('rewriteLabel');
const rewritePop       = document.getElementById('rewritePop');
const rwProto          = document.getElementById('rwProto');
const rwHost           = document.getElementById('rwHost');
const rwParams         = document.getElementById('rwParams');
const rwApplyParams    = document.getElementById('rwApplyParams');
const backBtn     = document.getElementById('back');
const reloadBtn   = document.getElementById('reload');
const devtoolsBtn = document.getElementById('devtools');
const apiToggle   = document.getElementById('apiToggle');
const statusEl    = document.getElementById('status');
const favicon     = document.getElementById('favicon');
const chromeEl    = document.getElementById('chrome');

const histBtn     = document.getElementById('histBtn');
const histPanel   = document.getElementById('histPanel');

const shell       = document.getElementById('shell');
const sidebar     = document.getElementById('sidebar');
const dragbar     = document.getElementById('dragbar');
const pageHint    = document.getElementById('pageHint');
const flipSideBtn = document.getElementById('flipSide');
const closeSbBtn  = document.getElementById('closeSb');

const K = {
  lastUrl: 'nibble.lastUrl',
  history: 'nibble.history',
  sbVisible: 'nibble.sidebar.visible',
  sbSide: 'nibble.sidebar.side',
  sbWidth: 'nibble.sidebar.width',
  rwProto: 'nibble.rewrite.proto',
  rwHost: 'nibble.rewrite.host',
  rwParams: 'nibble.rewrite.params',
};

const MIN_SIDEBAR = 300;
const MIN_PAGE = 240;
const HISTORY_CAP = 50;

/* ------------------------------ status / spinner ------------------------------ */

function startSpin() { favicon.classList.add('spinning'); }
function stopSpin()  { favicon.classList.remove('spinning'); }

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add('show');
  pushLayout();
}
function clearStatus() {
  statusEl.textContent = '';
  statusEl.classList.remove('show');
  pushLayout();
}

/* ------------------------------ page-view overlays ------------------------------ */
// The page render is a native view painted above our DOM, so anything that needs
// to draw over it (dropdowns, popovers, the resize drag) must hide it first.
// Reference-counted by name so overlapping overlays can't un-hide each other.

const openOverlays = new Set();

function setPageOverlay(name, on, hintText) {
  const was = openOverlays.size > 0;
  if (on) openOverlays.add(name); else openOverlays.delete(name);
  const now = openOverlays.size > 0;
  if (now !== was) {
    pageHint.textContent = now ? (hintText || '') : '';
    nb.setPageHidden(now);
  } else if (now && hintText) {
    pageHint.textContent = hintText;
  }
}

// api-panel.js uses this for its own popovers when they must overlap the page.
window.NibbleUI = { setPageOverlay };

/* ------------------------------ layout plumbing ------------------------------ */

const layoutState = {
  top: 84,
  sidebarVisible: false,
  sidebarSide: 'left',
  sidebarWidth: 460,
};

function clampWidth(w) {
  const max = Math.max(MIN_SIDEBAR, window.innerWidth - MIN_PAGE);
  return Math.min(Math.max(Math.round(w), MIN_SIDEBAR), max);
}

// Tell the main process where to put the native page view.
function pushLayout() {
  layoutState.top = chromeEl.offsetHeight;
  nb.setLayout({
    top: layoutState.top,
    sidebarVisible: layoutState.sidebarVisible,
    sidebarSide: layoutState.sidebarSide,
    sidebarWidth: layoutState.sidebarWidth,
  });
}

function applySidebar() {
  sidebar.hidden = !layoutState.sidebarVisible;
  dragbar.hidden = !layoutState.sidebarVisible;
  shell.classList.toggle('right', layoutState.sidebarSide === 'right');
  sidebar.style.width = layoutState.sidebarWidth + 'px';
  apiToggle.setAttribute('aria-pressed', String(layoutState.sidebarVisible));

  localStorage.setItem(K.sbVisible, layoutState.sidebarVisible ? '1' : '0');
  localStorage.setItem(K.sbSide, layoutState.sidebarSide);
  localStorage.setItem(K.sbWidth, String(layoutState.sidebarWidth));

  pushLayout();
}

function setSidebarVisible(visible) {
  layoutState.sidebarVisible = Boolean(visible);
  applySidebar();
}

apiToggle.addEventListener('click', () => setSidebarVisible(!layoutState.sidebarVisible));
closeSbBtn.addEventListener('click', () => setSidebarVisible(false));
flipSideBtn.addEventListener('click', () => {
  layoutState.sidebarSide = layoutState.sidebarSide === 'left' ? 'right' : 'left';
  applySidebar();
});

/* ------------------------------ sidebar resizing ------------------------------ */
// The page view is a native overlay that eats mouse events, so we hide it for
// the duration of the drag and show a placeholder instead.

let dragging = false;

dragbar.addEventListener('mousedown', (e) => {
  e.preventDefault();
  dragging = true;
  dragbar.classList.add('active');
  document.body.style.cursor = 'col-resize';
  setPageOverlay('drag', true, 'resizing…');
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const w = layoutState.sidebarSide === 'left'
    ? e.clientX
    : window.innerWidth - e.clientX;
  layoutState.sidebarWidth = clampWidth(w);
  sidebar.style.width = layoutState.sidebarWidth + 'px';
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  dragbar.classList.remove('active');
  document.body.style.cursor = '';
  setPageOverlay('drag', false);
  applySidebar();
});

window.addEventListener('resize', () => {
  layoutState.sidebarWidth = clampWidth(layoutState.sidebarWidth);
  sidebar.style.width = layoutState.sidebarWidth + 'px';
  pushLayout();
});

/* ------------------------------ URL history ------------------------------ */

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(K.history) || '[]');
    return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  localStorage.setItem(K.history, JSON.stringify(list.slice(0, HISTORY_CAP)));
}

function addHistory(url) {
  if (!url || url.startsWith('devtools://') || url === 'about:blank') return;
  const list = readHistory().filter((u) => u !== url);
  list.unshift(url);
  writeHistory(list);
}

function renderHistory() {
  const list = readHistory();
  histPanel.textContent = '';

  const head = document.createElement('div');
  head.className = 'histHead';
  const label = document.createElement('span');
  label.textContent = list.length ? `${list.length} recent` : 'History';
  head.appendChild(label);
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  head.appendChild(spacer);
  if (list.length) {
    const clear = document.createElement('button');
    clear.className = 'tiny';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => { writeHistory([]); renderHistory(); });
    head.appendChild(clear);
  }
  histPanel.appendChild(head);

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'histEmpty';
    empty.textContent = 'No URLs yet.';
    histPanel.appendChild(empty);
    return;
  }

  for (const u of list) {
    const row = document.createElement('div');
    row.className = 'histItem';

    const pick = document.createElement('button');
    pick.className = 'pick';
    pick.type = 'button';
    pick.textContent = u;
    pick.title = u;
    pick.addEventListener('click', () => {
      urlInput.value = u;
      closeHistory();
      navigate();
    });
    row.appendChild(pick);

    const del = document.createElement('button');
    del.className = 'tiny';
    del.type = 'button';
    del.textContent = '\u2715';
    del.title = 'Remove';
    del.setAttribute('aria-label', `Remove ${u}`);
    del.addEventListener('click', () => {
      writeHistory(readHistory().filter((x) => x !== u));
      renderHistory();
    });
    row.appendChild(del);

    histPanel.appendChild(row);
  }
}

function openHistory() {
  renderHistory();
  histPanel.hidden = false;
  histBtn.setAttribute('aria-expanded', 'true');
  setPageOverlay('history', true);
}
function closeHistory() {
  if (histPanel.hidden) return;
  histPanel.hidden = true;
  histBtn.setAttribute('aria-expanded', 'false');
  setPageOverlay('history', false);
}

histBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (histPanel.hidden) openHistory(); else closeHistory();
});
document.addEventListener('click', (e) => {
  if (histPanel.hidden) return;
  if (!histPanel.contains(e.target) && e.target !== histBtn) closeHistory();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeHistory();
});

/* ------------------------------ navigation ------------------------------ */

async function navigate(rawOverride) {
  const raw = rawOverride != null ? rawOverride : urlInput.value;
  if (!String(raw).trim()) return;
  clearStatus();
  const applied = await nb.go(raw);
  if (applied) {
    urlInput.value = applied;
    localStorage.setItem(K.lastUrl, applied);
    addHistory(applied);
  }
}

// Used by api-panel.js when opening the journey URL from a response.
window.NibbleNav = { navigate, addHistory, setSidebarVisible };

/* ---- rewrite button: retarget the URL's protocol/host, then open ---- */

// Defaults match the usual local dev setup; all three are editable via the caret.
// `params` is empty by default, so nothing is appended to the URL.
const rewriteTarget = {
  proto: 'http:',
  host: 'localhost:3000',
  params: '',
};

// Merge extra query params (e.g. "orgId=abc&foo=bar") into a URL. Keys already
// present in the URL are overwritten; an empty string is a no-op.
function mergeParams(urlStr, paramsStr) {
  const s = String(paramsStr || '').trim().replace(/^[?&]+/, '');
  if (!s) return urlStr;
  try {
    const u = new URL(urlStr);
    for (const [k, v] of new URLSearchParams(s)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return urlStr + (urlStr.includes('?') ? '&' : '?') + s;
  }
}

function applyRewriteTarget(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const abs = /^https?:\/\//i.test(v) ? v : 'http://' + v;
  let out;
  try {
    const u = new URL(abs);
    u.protocol = rewriteTarget.proto;
    u.host = rewriteTarget.host;
    out = u.toString();
  } catch {
    // Textual fallback if the URL will not parse.
    out = abs
      .replace(/^https?:/i, rewriteTarget.proto)
      .replace(/^(https?:\/\/)[^/?#]+/i, `$1${rewriteTarget.host}`);
  }
  return mergeParams(out, rewriteTarget.params);
}

function refreshRewriteUi() {
  rewriteLabel.textContent = rewriteTarget.host;
  rewriteOpenBtn.title =
    `Rewrite the URL to ${rewriteTarget.proto}//${rewriteTarget.host} (keeping path & query) and open it`;
  rwProto.value = rewriteTarget.proto;
  rwHost.value = rewriteTarget.host;
  rwParams.value = rewriteTarget.params;
  rwApplyParams.disabled = rewriteTarget.params.trim() === '';
}

function saveRewriteTarget() {
  localStorage.setItem(K.rwProto, rewriteTarget.proto);
  localStorage.setItem(K.rwHost, rewriteTarget.host);
  localStorage.setItem(K.rwParams, rewriteTarget.params);
}

function doRewriteAndOpen() {
  const next = applyRewriteTarget(urlInput.value);
  if (!next) return;
  urlInput.value = next;
  navigate(next);
}

rewriteOpenBtn.addEventListener('click', doRewriteAndOpen);

function openRewritePop() {
  refreshRewriteUi();
  rewritePop.hidden = false;
  rewriteConfigBtn.setAttribute('aria-expanded', 'true');
  setPageOverlay('rewrite', true);
  const r = rewriteConfigBtn.getBoundingClientRect();
  const w = rewritePop.offsetWidth;
  rewritePop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
  rewritePop.style.top = r.bottom + 6 + 'px';
  rwHost.focus();
  rwHost.select();
}
function closeRewritePop() {
  if (rewritePop.hidden) return;
  rewritePop.hidden = true;
  rewriteConfigBtn.setAttribute('aria-expanded', 'false');
  setPageOverlay('rewrite', false);
}

rewriteConfigBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (rewritePop.hidden) openRewritePop(); else closeRewritePop();
});

document.addEventListener('click', (e) => {
  if (rewritePop.hidden) return;
  if (!rewritePop.contains(e.target) && e.target !== rewriteConfigBtn) closeRewritePop();
});

// Changing the protocol applies immediately.
rwProto.addEventListener('change', () => {
  rewriteTarget.proto = rwProto.value === 'https:' ? 'https:' : 'http:';
  saveRewriteTarget();
  refreshRewriteUi();
  doRewriteAndOpen();
});

rwHost.addEventListener('input', () => {
  const h = rwHost.value.trim();
  if (!h) return;
  rewriteTarget.host = h;
  saveRewriteTarget();
  rewriteLabel.textContent = h;
});

// Extra query params. Empty by default -> nothing appended, button disabled.
rwParams.addEventListener('input', () => {
  rewriteTarget.params = rwParams.value;
  saveRewriteTarget();
  rwApplyParams.disabled = rwParams.value.trim() === '';
});

rwApplyParams.addEventListener('click', () => {
  if (rwApplyParams.disabled) return;
  closeRewritePop();
  doRewriteAndOpen();
});

function commitRewritePop() {
  const h = rwHost.value.trim();
  if (!h) return;
  rewriteTarget.host = h;
  rewriteTarget.params = rwParams.value;
  saveRewriteTarget();
  refreshRewriteUi();
  closeRewritePop();
  doRewriteAndOpen();
}

// "Enter" in either text field applies the target and opens straight away.
for (const field of [rwHost, rwParams]) {
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRewritePop();
    }
    if (e.key === 'Escape') {
      closeRewritePop();
      refreshRewriteUi();
    }
  });
}

goBtn.addEventListener('click', () => navigate());
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });
reloadBtn.addEventListener('click', () => nb.reload());
backBtn.addEventListener('click', () => nb.back());
devtoolsBtn.addEventListener('click', () => nb.devtools());

window.addEventListener('keydown', (e) => {
  if (e.key === 'F12') nb.devtools();
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    setSidebarVisible(!layoutState.sidebarVisible);
  }
});

/* ------------------------------ main-process events ------------------------------ */

nb.onLoading(() => { clearStatus(); startSpin(); });
nb.onLoaded(() => { stopSpin(); });
nb.onNavigated((url) => {
  if (url && !url.startsWith('devtools://')) {
    urlInput.value = url;
    localStorage.setItem(K.lastUrl, url);
    addHistory(url);
  }
});
nb.onError((info) => {
  stopSpin();
  showStatus(`Load failed (${info.errorCode}): ${info.errorDescription} — ${info.validatedURL}`);
});

/* ------------------------------ startup ------------------------------ */

window.addEventListener('DOMContentLoaded', () => {
  const last = localStorage.getItem(K.lastUrl);
  if (last) urlInput.value = last;

  const savedProto = localStorage.getItem(K.rwProto);
  if (savedProto === 'https:' || savedProto === 'http:') rewriteTarget.proto = savedProto;
  const savedHost = localStorage.getItem(K.rwHost);
  if (savedHost && savedHost.trim()) rewriteTarget.host = savedHost.trim();
  rewriteTarget.params = localStorage.getItem(K.rwParams) || '';
  refreshRewriteUi();

  layoutState.sidebarVisible = localStorage.getItem(K.sbVisible) === '1';
  layoutState.sidebarSide = localStorage.getItem(K.sbSide) === 'right' ? 'right' : 'left';
  const savedW = parseInt(localStorage.getItem(K.sbWidth) || '', 10);
  layoutState.sidebarWidth = clampWidth(Number.isFinite(savedW) ? savedW : 460);

  applySidebar();

  // Keep the native page view aligned if the chrome height ever changes.
  if (window.ResizeObserver) {
    new ResizeObserver(() => pushLayout()).observe(chromeEl);
  }
});
