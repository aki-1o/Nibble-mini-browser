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
const backBtn     = document.getElementById('back');
const reloadBtn   = document.getElementById('reload');
const statusEl    = document.getElementById('status');

// The favicon doubles as the burger button; DevTools and the panels now live in
// a drawer on the left of the shell instead of the top bar.
const menuBtn     = document.getElementById('menuBtn');
const menuPanel   = document.getElementById('menuPanel');
const menuDrag    = document.getElementById('menuDrag');
const closeMenuBtn = document.getElementById('closeMenu');
const miDevtools  = document.getElementById('miDevtools');
const miApi       = document.getElementById('miApi');
const miApiOn     = document.getElementById('miApiOn');
const miMap       = document.getElementById('miMap');
const miMapOn     = document.getElementById('miMapOn');
const miDb        = document.getElementById('miDb');
const miDbOn      = document.getElementById('miDbOn');
const miHist      = document.getElementById('miHist');
const miHistOn    = document.getElementById('miHistOn');
const miHar       = document.getElementById('miHar');
const miHarCount  = document.getElementById('miHarCount');
const miDocs      = document.getElementById('miDocs');
const themeBtns   = Array.from(menuPanel.querySelectorAll('[data-theme]'));

// Themed confirm dialog, used for destructive actions.
const confirmBackdrop = document.getElementById('confirmBackdrop');
const confirmBox      = document.getElementById('confirmBox');
const confirmTitle    = document.getElementById('confirmTitle');
const confirmText     = document.getElementById('confirmText');
const confirmOk       = document.getElementById('confirmOk');
const confirmCancel   = document.getElementById('confirmCancel');
const notice      = document.getElementById('notice');
const noticeText  = document.getElementById('noticeText');
const noticeFix   = document.getElementById('noticeFix');
const noticeClose = document.getElementById('noticeClose');
const favicon     = document.getElementById('favicon');
const chromeEl    = document.getElementById('chrome');
const tablist     = document.getElementById('tablist');
const newTabBtn   = document.getElementById('newTab');
const toast       = document.getElementById('toast');
const toastText   = document.getElementById('toastText');
const toastOpen   = document.getElementById('toastOpen');
const toastClose  = document.getElementById('toastClose');

const histList    = document.getElementById('histList');
const histCount   = document.getElementById('histCount');
const histClear   = document.getElementById('histClear');

const dbFileEl    = document.getElementById('dbFile');
const dbTablesEl  = document.getElementById('dbTables');
const dbRefresh   = document.getElementById('dbRefresh');

const alertBackdrop = document.getElementById('alertBackdrop');
const alertBox      = document.getElementById('alertBox');
const alertExtra    = document.getElementById('alertExtra');
const alertOk       = document.getElementById('alertOk');
const alertNever    = document.getElementById('alertNever');
const alertClose    = document.getElementById('alertClose');

const shell       = document.getElementById('shell');
const sidebar     = document.getElementById('sidebar');
const sbTitle     = document.getElementById('sbTitle');
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
  panel: 'nibble.sidebar.panel',
  menuVisible: 'nibble.menu.visible',
  menuWidth: 'nibble.menu.width',
  rwProto: 'nibble.rewrite.proto',
  rwHost: 'nibble.rewrite.host',
  theme: 'nibble.theme',
  secNotice: 'nibble.securityNotice.hidden',
};

const SEC_NOTICE_MS = 11000;   // long enough to read three lines, short enough to ignore
const SEC_NOTICE_FADE_MS = 450; // must match the CSS transition on #alertBackdrop

const MIN_SIDEBAR = 300;
const MIN_PAGE = 240;
const HISTORY_CAP = 50;

/* ------------------------------ status / spinner ------------------------------ */

// The URL field is capped and centred, so a long journey URL no longer fits in
// it. Every write goes through here, which mirrors the full value into the
// tooltip and keeps the two from drifting apart.
function setBarUrl(value) {
  urlInput.value = value == null ? '' : String(value);
  urlInput.title = urlInput.value;
}

urlInput.addEventListener('input', () => { urlInput.title = urlInput.value; });

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

/* ------------------------------ theme ------------------------------ */
// 'light' | 'dark' | 'system'. Only the shell chrome is themed: the journey is a
// native page view, and flipping Chromium's nativeTheme would change
// prefers-color-scheme inside the journey too — which would falsify what we are
// here to test.

const THEMES = ['light', 'dark', 'system'];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

let themePref = 'system';

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark.matches ? 'dark' : 'light';
}

function applyTheme(pref, { persist = true } = {}) {
  themePref = THEMES.includes(pref) ? pref : 'system';
  document.documentElement.dataset.theme = resolveTheme(themePref);
  for (const b of themeBtns) {
    b.setAttribute('aria-checked', String(b.dataset.theme === themePref));
  }
  paintBurger();   // icon colours are re-tuned for the new background
  if (persist) localStorage.setItem(K.theme, themePref);
}

for (const b of themeBtns) {
  b.addEventListener('click', () => applyTheme(b.dataset.theme));
}

// Follow the OS while on 'system'.
systemDark.addEventListener('change', () => {
  if (themePref === 'system') applyTheme('system', { persist: false });
});

/* ---- burger lines coloured from the favicon ---- */
// Canvas cannot read a file:// image (it taints), so main hands us the icon as a
// data URL. Purely cosmetic: the CSS fallback stands if anything here fails.

let iconColors = null;   // [{r,g,b}] ranked by how much of the icon they cover

const lumOf = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// An icon colour can be almost black (or almost white) and vanish against the
// current chrome, so nudge it toward the readable end before painting.
function legible(c, dark) {
  let out = { ...c };
  const mix = (t, target) => ({
    r: Math.round(t.r + (target - t.r) * 0.18),
    g: Math.round(t.g + (target - t.g) * 0.18),
    b: Math.round(t.b + (target - t.b) * 0.18),
  });
  for (let i = 0; i < 12; i++) {
    const l = lumOf(out);
    if (dark && l < 0.42) out = mix(out, 255);
    else if (!dark && l > 0.68) out = mix(out, 0);
    else break;
  }
  return out;
}

function paintBurger() {
  if (!iconColors || !iconColors.length) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  const css = iconColors.map((c) => {
    const { r, g, b } = legible(c, dark);
    return `rgb(${r}, ${g}, ${b})`;
  });
  const root = document.documentElement.style;
  root.setProperty('--fav-1', css[0]);
  root.setProperty('--fav-2', css[1] || css[0]);
  root.setProperty('--fav-3', css[2] || css[1] || css[0]);
}

function sampleIconColors(dataUrl) {
  const img = new Image();
  img.onload = () => {
    try {
      const size = 32;
      const cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Bucket to 5 bits per channel so anti-aliased edges collapse into the
      // colour they belong to, then rank by how much of the icon they cover.
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 140) continue;
        if (r > 244 && g > 244 && b > 244) continue;   // background white
        const key = `${r >> 3},${g >> 3},${b >> 3}`;
        const c = counts.get(key) || { r: 0, g: 0, b: 0, n: 0 };
        c.r += r; c.g += g; c.b += b; c.n += 1;
        counts.set(key, c);
      }
      if (!counts.size) return;

      iconColors = Array.from(counts.values())
        .sort((a, b) => b.n - a.n)
        .slice(0, 3)
        .map((c) => ({
          r: Math.round(c.r / c.n),
          g: Math.round(c.g / c.n),
          b: Math.round(c.b / c.n),
        }));
      paintBurger();
    } catch {
      /* keep the CSS fallback */
    }
  };
  img.src = dataUrl;
}

/* ------------------------------ menu drawer ------------------------------ */
// A panel in the shell like the API console, so the page view shrinks beside it
// instead of being covered — the journey stays visible while the drawer is open.
// It owns the left column while open: a left-hand panel is set aside and comes
// back when the drawer closes (see consoleShown/applyLayout).

function setMenuVisible(visible) {
  layoutState.menuVisible = Boolean(visible);
  applyLayout();
}

menuBtn.addEventListener('click', () => setMenuVisible(!layoutState.menuVisible));
closeMenuBtn.addEventListener('click', () => setMenuVisible(false));

// The drawer is a launcher: picking an entry closes it and opens what was picked,
// so the column it was occupying is handed straight to that panel.
miDevtools.addEventListener('click', () => {
  setMenuVisible(false);
  nb.devtools();
});
miApi.addEventListener('click', () => openPanel('api'));
miMap.addEventListener('click', () => openPanel('map'));
miDb.addEventListener('click', () => openPanel('db'));
miHist.addEventListener('click', () => openPanel('hist'));

// Not a panel: it performs the export and closes the drawer, like DevTools.
miHar.addEventListener('click', () => {
  if (miHar.disabled) return;
  setMenuVisible(false);
  exportHar();
});

// Also not a panel — it is a page, and a long one, so it gets a tab.
function openDocs() {
  setMenuVisible(false);
  // Hand over the resolved theme; the page cannot read the shell's setting.
  nb.openDocs(document.documentElement.dataset.theme || 'light');
}

miDocs.addEventListener('click', openDocs);

/* ------------------------------ confirm dialog ------------------------------ */
// window.confirm draws Chromium's own dialog, which ignores the app theme, so
// destructive actions use this instead. Returns a promise resolving true/false.
// The page render is a native view above our DOM, so it is hidden while the
// dialog is up — otherwise the backdrop would only cover our own chrome.

let confirmResolve = null;

function closeConfirm(answer) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmBackdrop.hidden = true;
  setPageOverlay('confirm', false);
  resolve(answer);
}

function askConfirm(opts = {}) {
  // A second call would orphan the first promise, so settle it as a cancel.
  if (confirmResolve) closeConfirm(false);

  return new Promise((resolve) => {
    confirmResolve = resolve;
    confirmTitle.textContent = opts.title || 'Are you sure?';
    // textContent, never innerHTML: the message carries user-entered names.
    confirmText.textContent = opts.message || '';
    confirmText.hidden = !opts.message;
    confirmOk.textContent = opts.confirmLabel || 'Delete';
    confirmCancel.textContent = opts.cancelLabel || 'Cancel';
    confirmOk.classList.toggle('danger', opts.danger !== false);
    confirmBackdrop.hidden = false;
    setPageOverlay('confirm', true);
    confirmOk.focus();
  });
}

confirmOk.addEventListener('click', () => closeConfirm(true));
confirmCancel.addEventListener('click', () => closeConfirm(false));
// Clicking the backdrop (but not the box) cancels, as a dialog normally does.
confirmBackdrop.addEventListener('mousedown', (e) => {
  if (!confirmBox.contains(e.target)) closeConfirm(false);
});
// Keep focus inside the dialog while it is open.
confirmBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  (document.activeElement === confirmOk ? confirmCancel : confirmOk).focus();
});

/* ------------------------------ Finvu path check ------------------------------ */
// Finvu's SDK config sets REACT_APP_BASEURL=/finvu, so a Finvu journey only
// renders when the path is prefixed with /finvu — e.g.
//   http://localhost:3000/finvu/?aaId=FINVU&ecreq=...
// Every other AA serves from the root, so this is Finvu-specific. We detect it
// from the journey's own aaId query param and offer to fix the URL rather than
// rewriting it silently.
// Both the old and current Finvu handles, because a journey URL in flight may still
// carry either. The registry value is cookiejaraalive@finvu.
const FINVU_AA_IDS = ['finvu', 'FINVU', 'cookiejaraalive@finvu', 'cookiejar-aa@finvu.in'];
const FINVU_PREFIX = '/finvu';

let noticeDismissedFor = null;

function asAbsolute(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : 'http://' + v;
}

function isFinvuUrl(url) {
  try {
    const aaId = new URL(url).searchParams.get('aaId');
    if (!aaId) return false;
    return FINVU_AA_IDS.some((id) => id.toLowerCase() === aaId.trim().toLowerCase());
  } catch {
    return false;
  }
}

function needsFinvuPrefix(url) {
  if (!isFinvuUrl(url)) return false;
  try {
    const p = new URL(url).pathname;
    return !(p === FINVU_PREFIX || p.startsWith(FINVU_PREFIX + '/'));
  } catch {
    return false;
  }
}

function withFinvuPrefix(url) {
  try {
    const u = new URL(url);
    u.pathname = u.pathname === '/' ? `${FINVU_PREFIX}/` : FINVU_PREFIX + u.pathname;
    return u.toString();
  } catch {
    return url;
  }
}

function hideNotice() {
  notice.hidden = true;
  pushLayout();
}

function checkFinvuPath(rawUrl) {
  const url = asAbsolute(rawUrl);
  if (!url || !needsFinvuPrefix(url)) {
    if (!notice.hidden) hideNotice();
    return;
  }
  if (noticeDismissedFor === url) return;

  noticeText.textContent = '';
  noticeText.append(
    document.createTextNode('This looks like a Finvu journey, but the path is missing '),
  );
  const code = document.createElement('code');
  code.textContent = FINVU_PREFIX;
  noticeText.append(code, document.createTextNode(' — Finvu serves from that prefix, so it will render blank without it.'));

  notice.hidden = false;
  notice.dataset.url = url;
  pushLayout();
}

noticeFix.addEventListener('click', () => {
  const fixed = withFinvuPrefix(notice.dataset.url || asAbsolute(urlInput.value));
  hideNotice();
  setBarUrl(fixed);
  navigate(fixed);
});

noticeClose.addEventListener('click', () => {
  noticeDismissedFor = notice.dataset.url || null;
  hideNotice();
});

/* ------------------------------ tabs ------------------------------ */

let tabState = { activeId: null, tabs: [] };

function renderTabs() {
  tablist.textContent = '';

  for (const t of tabState.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === tabState.activeId ? ' active' : '');
    el.dataset.id = String(t.id);
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t.id === tabState.activeId));
    el.title = t.url || t.title;

    if (t.loading) {
      const spin = document.createElement('span');
      spin.className = 'tabSpin';
      el.appendChild(spin);
    }

    const label = document.createElement('span');
    label.className = 'tabTitle';
    label.textContent = t.title;
    el.appendChild(label);

    const close = document.createElement('button');
    close.className = 'tabClose';
    close.type = 'button';
    close.textContent = '\u2715';
    close.title = 'Close tab (Ctrl+W)';
    close.setAttribute('aria-label', `Close ${t.title}`);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      nb.closeTab(t.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => {
      if (t.id !== tabState.activeId) nb.activateTab(t.id);
    });
    // Middle-click closes, like a normal browser.
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); nb.closeTab(t.id); }
    });

    tablist.appendChild(el);
  }
}

nb.onTabs((state) => {
  tabState = state;
  renderTabs();
  refreshHarButton();
  pushLayout();       // the strip's height can change with wrapping/scrollbars
});

// A blank tab has nothing to look at, so the useful next action is always typing
// a URL. Focus follows the creation rather than waiting for a second click.
// Awaited because main gives the shell OS focus as part of opening the tab; if we
// focused first, that would take it straight back off the field.
async function openBlankTab() {
  await nb.newTab('');
  urlInput.focus();
  urlInput.select();
}

newTabBtn.addEventListener('click', openBlankTab);

/* ------------------------------ HAR export ------------------------------ */

function activeTabState() {
  return (tabState.tabs || []).find((t) => t.id === tabState.activeId) || null;
}

// Re-evaluated on every tabs-updated push, which main sends on request capture,
// navigation, tab switch and tab close — so the state always follows the
// active tab without needing a separate trigger. The drawer entry is the only
// place the export lives now; the tab-strip pill is gone.
function refreshHarButton() {
  const t = activeTabState();
  const har = (t && t.har) || {
    count: 0,
    available: false,
    reason: 'Nothing loaded in this tab yet — open a journey first.',
  };

  miHarCount.textContent = `(${har.count})`;
  miHar.disabled = !har.available;
  miHar.title = har.available
    ? `Download a HAR of this tab's ${har.count} captured request(s)`
    : (har.reason || 'HAR export is unavailable for this tab.');
}

let toastTimer = null;

function showToast(text, { bad = false, filePath = null } = {}) {
  if (toastTimer) clearTimeout(toastTimer);
  toastText.textContent = text;
  toast.classList.toggle('bad', bad);
  toastOpen.hidden = !filePath;
  toast.dataset.path = filePath || '';
  toast.hidden = false;
  pushLayout();
  toastTimer = setTimeout(hideToast, bad ? 9000 : 12000);
}

function hideToast() {
  if (toastTimer) clearTimeout(toastTimer);
  toast.hidden = true;
  pushLayout();
}

// Driven from the drawer entry.
async function exportHar() {
  miHar.disabled = true;
  const label = miHar.querySelector('.mi-label').textContent;
  miHar.querySelector('.mi-label').textContent = 'Saving…';
  try {
    const res = await nb.exportHar();
    if (res && res.error) {
      showToast(res.error, { bad: true });
    } else if (res && res.path) {
      showToast(
        `Saved ${res.entries} request(s) and ${res.sdkEvents} SDK event(s) → ${res.path}`,
        { filePath: res.path },
      );
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`, { bad: true });
  } finally {
    miHar.querySelector('.mi-label').textContent = label;
    refreshHarButton();
  }
}

toastOpen.addEventListener('click', () => {
  if (toast.dataset.path) nb.revealFile(toast.dataset.path);
});
toastClose.addEventListener('click', hideToast);

/* ------------------------------ startup security alert ------------------------------ */
// This build runs with webSecurity disabled, which is the one thing a user has to
// know before typing a URL, so it is said once per launch as a modal rather than
// living only in the README. The page render is a native view above our DOM, so
// it is hidden while the dialog is up — otherwise the backdrop would only cover
// our own chrome.

let secTimer = null;
// showSecAlert focuses OK, which fires focusin on the dialog. That must not count
// as the user reaching for the extra choices, or they would be visible from the
// start instead of on demand.
let secProgrammaticFocus = false;

function armSecAlert(ms) {
  clearTimeout(secTimer);
  secTimer = setTimeout(() => hideSecAlert(), ms);
}

function hideSecAlert({ remember = false } = {}) {
  if (alertBackdrop.hidden) return;
  if (remember) localStorage.setItem(K.secNotice, '1');
  clearTimeout(secTimer);
  secTimer = null;
  alertBackdrop.classList.remove('in');
  // Stays in the DOM until the fade finishes, then the page view comes back.
  setTimeout(() => {
    alertBackdrop.hidden = true;
    alertExtra.hidden = true;
    setPageOverlay('secAlert', false);
  }, SEC_NOTICE_FADE_MS);
}

function showSecAlert() {
  if (localStorage.getItem(K.secNotice) === '1') return;
  alertBackdrop.hidden = false;
  setPageOverlay('secAlert', true);
  // Commit the zero-opacity starting point, then flip the class, so the
  // transition has something to animate from.
  //
  // NOT requestAnimationFrame: at startup the frame loop has not necessarily
  // begun, and the callback can go unrun — which left the dialog shown but stuck
  // at opacity 0, i.e. invisible. Reading offsetWidth forces the style to be
  // resolved synchronously, which works whenever this is called.
  void alertBackdrop.offsetWidth;
  alertBackdrop.classList.add('in');
  secProgrammaticFocus = true;
  alertOk.focus();          // dispatches focusin synchronously
  secProgrammaticFocus = false;
  armSecAlert(SEC_NOTICE_MS);
}

// Hovering means it is being read: stop the countdown and offer the two extra
// choices. Leaving restarts a shorter countdown rather than dismissing at once.
alertBox.addEventListener('mouseenter', () => {
  clearTimeout(secTimer);
  secTimer = null;
  alertExtra.hidden = false;
});
alertBox.addEventListener('mouseleave', () => {
  alertExtra.hidden = true;
  if (!alertBackdrop.hidden) armSecAlert(3500);
});
// Keyboard users reach the same choices by tabbing within the dialog.
alertBox.addEventListener('focusin', () => {
  if (secProgrammaticFocus) return;
  clearTimeout(secTimer);
  secTimer = null;
  alertExtra.hidden = false;
});

alertOk.addEventListener('click', () => hideSecAlert());
alertClose.addEventListener('click', () => hideSecAlert());
alertNever.addEventListener('click', () => hideSecAlert({ remember: true }));
// Clicking the backdrop dismisses, as a dialog normally does.
alertBackdrop.addEventListener('mousedown', (e) => {
  if (!alertBox.contains(e.target)) hideSecAlert();
});

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

// api-panel.js uses this for its own popovers when they must overlap the page;
// aa-mapping.js uses confirm() for destructive actions and toast() to report
// where an exported file landed.
window.NibbleUI = { setPageOverlay, confirm: askConfirm, toast: showToast };

/* ------------------------------ layout plumbing ------------------------------ */

const layoutState = {
  top: 84,
  menuVisible: false,
  menuWidth: 250,
  sidebarVisible: false,
  sidebarSide: 'left',
  sidebarWidth: 460,
  panel: 'api',          // which panel the shared column is showing
};

// The panels that share the resizable column. Adding one here plus its markup
// and a drawer entry is all a new tool needs. `onShow` is called when the panel
// becomes the visible one, for the panels whose contents can go stale while they
// are hidden (history grows as you browse; the database changes underneath).
const PANELS = {
  api: {
    title: 'API Console',
    body: document.getElementById('panelApi'),
    item: miApi,
    tick: miApiOn,
  },
  map: {
    title: 'AA Mapping',
    body: document.getElementById('panelMap'),
    item: miMap,
    tick: miMapOn,
  },
  db: {
    title: 'Database',
    body: document.getElementById('panelDb'),
    item: miDb,
    tick: miDbOn,
    onShow: () => renderDb(),
  },
  hist: {
    title: 'History',
    body: document.getElementById('panelHist'),
    item: miHist,
    tick: miHistOn,
    onShow: () => renderHistory(),
  },
};

const MENU_MIN = 190;
const MENU_MAX = 420;

// Only one panel owns the left column: while the drawer is open it takes that
// column over, so a left-hand panel steps aside rather than stacking next to it.
// The panel's own visibility is untouched, so closing the drawer brings it
// straight back. With the column flipped right, both are shown at once.
function consoleShown() {
  return layoutState.sidebarVisible
    && !(layoutState.menuVisible && layoutState.sidebarSide === 'left');
}

// Only counts when the drawer and the panel column are on screen together.
function menuInset() {
  return layoutState.menuVisible && layoutState.sidebarSide === 'right'
    ? layoutState.menuWidth
    : 0;
}

function clampWidth(w) {
  const max = Math.max(MIN_SIDEBAR, window.innerWidth - MIN_PAGE - menuInset());
  return Math.min(Math.max(Math.round(w), MIN_SIDEBAR), max);
}

function clampMenuWidth(w) {
  const used = consoleShown() && layoutState.sidebarSide === 'right'
    ? layoutState.sidebarWidth
    : 0;
  const max = Math.max(MENU_MIN, Math.min(MENU_MAX, window.innerWidth - MIN_PAGE - used));
  return Math.min(Math.max(Math.round(w), MENU_MIN), max);
}

// Tell the main process where to put the native page view. It is given the
// EFFECTIVE panel visibility, so no space is reserved for a panel the drawer is
// currently standing in front of.
function pushLayout() {
  layoutState.top = chromeEl.offsetHeight;
  nb.setLayout({
    top: layoutState.top,
    menuVisible: layoutState.menuVisible,
    menuWidth: layoutState.menuWidth,
    sidebarVisible: consoleShown(),
    sidebarSide: layoutState.sidebarSide,
    sidebarWidth: layoutState.sidebarWidth,
  });
}

// One place that reconciles both columns, so they can never both claim the left
// side or disagree about what the page view should make room for.
function applyLayout() {
  const showPanel = consoleShown();
  const active = PANELS[layoutState.panel] ? layoutState.panel : 'api';
  layoutState.panel = active;

  menuPanel.hidden = !layoutState.menuVisible;
  menuDrag.hidden = !layoutState.menuVisible;
  menuBtn.setAttribute('aria-expanded', String(layoutState.menuVisible));
  layoutState.menuWidth = clampMenuWidth(layoutState.menuWidth);
  menuPanel.style.width = layoutState.menuWidth + 'px';

  sidebar.hidden = !showPanel;
  dragbar.hidden = !showPanel;
  shell.classList.toggle('right', layoutState.sidebarSide === 'right');
  layoutState.sidebarWidth = clampWidth(layoutState.sidebarWidth);
  sidebar.style.width = layoutState.sidebarWidth + 'px';
  sbTitle.textContent = PANELS[active].title;

  // Only one panel body is in the column at a time. The drawer's tick marks the
  // one that is open, not merely the one that would open — so it clears when the
  // column is closed.
  for (const [name, p] of Object.entries(PANELS)) {
    p.body.hidden = name !== active;
    const open = layoutState.sidebarVisible && name === active;
    p.item.setAttribute('aria-pressed', String(open));
    p.tick.hidden = !open;
  }

  localStorage.setItem(K.menuVisible, layoutState.menuVisible ? '1' : '0');
  localStorage.setItem(K.menuWidth, String(layoutState.menuWidth));
  localStorage.setItem(K.sbVisible, layoutState.sidebarVisible ? '1' : '0');
  localStorage.setItem(K.sbSide, layoutState.sidebarSide);
  localStorage.setItem(K.sbWidth, String(layoutState.sidebarWidth));
  localStorage.setItem(K.panel, active);

  // After the bodies are placed, so a panel that redraws on show measures the
  // column it is actually in.
  if (showPanel && PANELS[active].onShow) PANELS[active].onShow();

  pushLayout();
}

function setSidebarVisible(visible) {
  layoutState.sidebarVisible = Boolean(visible);
  // Opening a panel takes the left column back off the drawer.
  if (layoutState.sidebarVisible && layoutState.sidebarSide === 'left') {
    layoutState.menuVisible = false;
  }
  applyLayout();
}

// Show a named panel in the shared column, closing the drawer that launched it.
function openPanel(name) {
  layoutState.panel = PANELS[name] ? name : 'api';
  layoutState.menuVisible = false;
  setSidebarVisible(true);
}

// Keyboard shortcuts toggle: the same key closes the column if that panel is
// already the one on screen.
function togglePanel(name) {
  if (consoleShown() && layoutState.panel === name) setSidebarVisible(false);
  else openPanel(name);
}

closeSbBtn.addEventListener('click', () => setSidebarVisible(false));
flipSideBtn.addEventListener('click', () => {
  layoutState.sidebarSide = layoutState.sidebarSide === 'left' ? 'right' : 'left';
  applyLayout();
});

/* ------------------------------ column resizing ------------------------------ */
// The page view is a native overlay that eats mouse events, so we hide it for
// the duration of a drag and show a placeholder instead. Both the drawer and the
// panel column resize the same way.

let dragging = null;   // 'panel' | 'menu' | null

function startDrag(which, handle) {
  dragging = which;
  handle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  setPageOverlay('drag', true, 'resizing…');
}

dragbar.addEventListener('mousedown', (e) => {
  e.preventDefault();
  startDrag('panel', dragbar);
});

menuDrag.addEventListener('mousedown', (e) => {
  e.preventDefault();
  startDrag('menu', menuDrag);
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;

  if (dragging === 'menu') {
    // The drawer is always the leftmost column, so its width is the cursor x.
    layoutState.menuWidth = clampMenuWidth(e.clientX);
    menuPanel.style.width = layoutState.menuWidth + 'px';
    return;
  }

  // A left-hand panel column is never on screen together with the drawer, so its
  // left edge is the window edge; on the right the drawer does not shift it.
  const w = layoutState.sidebarSide === 'left'
    ? e.clientX
    : window.innerWidth - e.clientX;
  layoutState.sidebarWidth = clampWidth(w);
  sidebar.style.width = layoutState.sidebarWidth + 'px';
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = null;
  dragbar.classList.remove('active');
  menuDrag.classList.remove('active');
  document.body.style.cursor = '';
  setPageOverlay('drag', false);
  applyLayout();
});

window.addEventListener('resize', () => {
  applyLayout();
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
  // The documentation page is part of the app, not a journey — recording it would
  // just push real URLs off the end of the list.
  if (url.startsWith('file://')) return;
  const list = readHistory().filter((u) => u !== url);
  list.unshift(url);
  writeHistory(list);
  // The panel may be open while a page navigates, and a list that silently
  // misses the URL you just opened is worse than no list.
  if (consoleShown() && layoutState.panel === 'hist') renderHistory();
}

// Drawn into the History panel. The panel is redrawn every time it is shown
// (PANELS.hist.onShow), so browsing while it is closed cannot leave it stale.
function renderHistory() {
  const list = readHistory();
  histList.textContent = '';

  histCount.textContent = list.length ? `${list.length} recent` : 'History';
  histClear.hidden = !list.length;

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'histEmpty';
    empty.textContent = 'No URLs yet.';
    histList.appendChild(empty);
    return;
  }

  for (const u of list) {
    const row = document.createElement('div');
    row.className = 'histItem';

    const pick = document.createElement('button');
    pick.className = 'pick';
    pick.type = 'button';
    // textContent, not innerHTML: a URL is untrusted text and must not be parsed
    // as markup.
    pick.textContent = u;
    pick.title = `Open in a new tab:\n${u}`;
    // A new tab, not the active one: picking an old URL should never throw away
    // the journey already loaded in front of you.
    pick.addEventListener('click', () => nb.newTab(u));
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

    histList.appendChild(row);
  }
}

histClear.addEventListener('click', () => { writeHistory([]); renderHistory(); });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideSecAlert(); closeConfirm(false); }
});

/* ------------------------------ database panel ------------------------------ */
// Read-only view of nibble.db, built from what the main process reports rather
// than from a hardcoded description of the schema, so it cannot fall out of date
// when a migration is added.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function humanBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Two cards per table, because they answer different questions: the first is the
// shape (what the columns are, how they are constrained, what they point at), the
// second is the contents. Returns both plus a separator so a multi-table database
// reads as distinct groups rather than one long stack of cards.
function renderDbTable(t) {
  const cards = [];

  /* ---- card 1: structure ---- */
  const structure = el('div', 'formCard');

  const head = el('div', 'dbTableHead');
  head.appendChild(el('span', 'tname', t.name));
  head.appendChild(el('span', 'rows', 'structure'));
  structure.appendChild(head);

  const cols = el('table', 'dbCols');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const h of ['Column', 'Type', 'Constraints']) hrow.appendChild(el('th', null, h));
  thead.appendChild(hrow);
  cols.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const c of t.columns) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'cname', c.name));
    tr.appendChild(el('td', 'ctype', c.type || '—'));

    const flags = el('td');
    if (c.pk) flags.appendChild(el('span', 'flag pk', 'PK'));
    if (c.unique && !c.pk) flags.appendChild(el('span', 'flag uq', 'UNIQUE'));
    if (c.notNull && !c.pk) flags.appendChild(el('span', 'flag', 'NOT NULL'));
    if (c.default !== null) flags.appendChild(el('span', 'flag', `= ${c.default}`));
    // The relationship, drawn on the column that owns it — this is what makes the
    // panel show how the tables connect rather than just listing them.
    if (c.references) {
      flags.appendChild(el('span', 'fk', `\u2192 ${c.references.table}.${c.references.column}`));
    }
    if (!flags.childNodes.length) flags.appendChild(el('span', 'ctype', '—'));
    tr.appendChild(flags);

    tbody.appendChild(tr);
  }
  cols.appendChild(tbody);
  structure.appendChild(cols);

  // Only the indexes someone wrote by hand; the ones SQLite makes for UNIQUE and
  // PRIMARY KEY are already shown as flags on the columns.
  const explicit = t.indexes.filter((ix) => ix.origin === 'c');
  if (explicit.length) {
    const p = el('p', 'dbSub');
    p.appendChild(document.createTextNode('Indexes: '));
    explicit.forEach((ix, i) => {
      if (i) p.appendChild(document.createTextNode(', '));
      p.appendChild(el('code', null, `${ix.name} (${ix.columns.join(', ')})${ix.unique ? ' unique' : ''}`));
    });
    structure.appendChild(p);
  }

  if (!t.foreignKeys.length) {
    structure.appendChild(el('p', 'dbSub', 'No foreign keys — this table stands alone.'));
  }

  cards.push(structure);

  /* ---- card 2: values ---- */
  const values = el('div', 'formCard');
  const vhead = el('div', 'dbTableHead');
  vhead.appendChild(el('span', 'tname', t.name));
  vhead.appendChild(el('span', 'rows', `${t.rowCount} row${t.rowCount === 1 ? '' : 's'}`));
  values.appendChild(vhead);

  if (t.rows.length) {
    const wrap = el('div', 'dbRowsWrap');
    const table = el('table', 'dbRows');
    const rh = document.createElement('tr');
    for (const c of t.columns) rh.appendChild(el('th', null, c.name));
    table.appendChild(rh);

    for (const row of t.rows) {
      const tr = document.createElement('tr');
      for (const c of t.columns) {
        const v = row[c.name];
        tr.appendChild(v === null || v === undefined
          ? el('td', 'null', 'null')
          : el('td', null, String(v)));
      }
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    values.appendChild(wrap);
  } else {
    values.appendChild(el('p', 'dbSub', 'Empty table.'));
  }

  cards.push(values);
  return cards;
}

async function renderDb() {
  dbFileEl.textContent = '';
  dbFileEl.appendChild(el('span', null, 'Reading…'));

  let res;
  try {
    res = await nb.db.schema();
  } catch (err) {
    res = { ok: false, error: err.message };
  }

  dbTablesEl.textContent = '';
  dbFileEl.textContent = '';

  if (!res || !res.ok) {
    dbFileEl.appendChild(el('span', 'err', (res && res.error) || 'Could not read the database.'));
    return;
  }

  dbFileEl.appendChild(el('span', 'path', res.file));
  dbFileEl.appendChild(el('span', null,
    `${humanBytes(res.bytes)} · schema version ${res.userVersion} · `
    + `${res.tables.length} table${res.tables.length === 1 ? '' : 's'}`
    + ` · showing up to ${res.previewLimit} rows each`));

  if (!res.tables.length) {
    dbTablesEl.appendChild(el('p', 'hint', 'No tables yet.'));
    return;
  }
  // A rule between each table's pair of cards, so several tables read as groups
  // rather than one undifferentiated stack. None before the first or after the
  // last.
  res.tables.forEach((t, i) => {
    if (i) dbTablesEl.appendChild(el('hr', 'dbSep'));
    for (const card of renderDbTable(t)) dbTablesEl.appendChild(card);
  });
}

dbRefresh.addEventListener('click', () => renderDb());

// aa-mapping.js changes rows behind the Database panel's back, so it calls this
// after every write to keep the two from disagreeing.
window.__nibbleDbReload = () => {
  if (consoleShown() && layoutState.panel === 'db') renderDb();
};

/* ------------------------------ navigation ------------------------------ */

async function navigate(rawOverride) {
  const raw = rawOverride != null ? rawOverride : urlInput.value;
  if (!String(raw).trim()) return;
  clearStatus();
  const applied = await nb.go(raw);
  if (applied) {
    setBarUrl(applied);
    localStorage.setItem(K.lastUrl, applied);
    addHistory(applied);
  }
  checkFinvuPath(applied || raw);
}

// Used by api-panel.js when opening the journey URL from a response, and by the
// Variables tab's inject-param form.
window.NibbleNav = {
  navigate,
  addHistory,
  setSidebarVisible,
  getPageUrl: () => urlInput.value,
  setPageUrl: (u) => { setBarUrl(u); },
  // The page's real URL. Preferred over the bar text, which the page can
  // overwrite at any time via its own navigations.
  getLiveUrl: async () => {
    try {
      const u = await nb.currentUrl();
      return /^https?:\/\//i.test(u || '') ? u : '';
    } catch {
      return '';
    }
  },
};

/* ---- rewrite button: retarget the URL's protocol/host, then open ---- */

// Defaults match the usual local dev setup. Deliberately NOT persisted: a
// one-off change (say port 3443) should not become the new default, so every
// launch starts from http://localhost:3000 again.
const REWRITE_DEFAULTS = { proto: 'http:', host: 'localhost:3000' };
const rewriteTarget = { ...REWRITE_DEFAULTS };

function applyRewriteTarget(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const abs = /^https?:\/\//i.test(v) ? v : 'http://' + v;
  try {
    const u = new URL(abs);
    u.protocol = rewriteTarget.proto;
    u.host = rewriteTarget.host;
    return u.toString();
  } catch {
    // Textual fallback if the URL will not parse.
    return abs
      .replace(/^https?:/i, rewriteTarget.proto)
      .replace(/^(https?:\/\/)[^/?#]+/i, `$1${rewriteTarget.host}`);
  }
}

function refreshRewriteUi() {
  rewriteLabel.textContent = rewriteTarget.host;
  rewriteOpenBtn.title =
    `Rewrite the URL to ${rewriteTarget.proto}//${rewriteTarget.host} (keeping path & query) and open it`;
  rwProto.value = rewriteTarget.proto;
  rwHost.value = rewriteTarget.host;
}

function doRewriteAndOpen() {
  const next = applyRewriteTarget(urlInput.value);
  if (!next) return;
  setBarUrl(next);
  navigate(next);

  // One-shot override: a custom protocol/host applies to THIS rewrite only, then
  // the default comes back. Otherwise typing 3443 once would quietly become the
  // new default for the rest of the session.
  if (rewriteTarget.host !== REWRITE_DEFAULTS.host
      || rewriteTarget.proto !== REWRITE_DEFAULTS.proto) {
    Object.assign(rewriteTarget, REWRITE_DEFAULTS);
    refreshRewriteUi();
  }
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
  refreshRewriteUi();
  doRewriteAndOpen();
});

rwHost.addEventListener('input', () => {
  const h = rwHost.value.trim();
  if (!h) return;
  rewriteTarget.host = h;
  rewriteLabel.textContent = h;
});

// "Enter" applies the target and opens straight away.
rwHost.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const h = rwHost.value.trim();
    if (!h) return;
    rewriteTarget.host = h;
    refreshRewriteUi();
    closeRewritePop();
    doRewriteAndOpen();
  }
  if (e.key === 'Escape') {
    closeRewritePop();
    refreshRewriteUi();
  }
});

goBtn.addEventListener('click', () => navigate());
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });
reloadBtn.addEventListener('click', () => nb.reload());
backBtn.addEventListener('click', () => nb.back());

window.addEventListener('keydown', (e) => {
  if (e.key === 'F12') nb.devtools();

  // Ctrl+Shift+R = hard reload (ignore cache); F5 / Ctrl+R = normal reload.
  if (e.ctrlKey && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    nb.reloadHard();
    return;
  }
  if (e.key === 'F5' || (e.ctrlKey && !e.shiftKey && (e.key === 'r' || e.key === 'R'))) {
    e.preventDefault();
    nb.reload();
    return;
  }

  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    // Based on what is on screen: if the drawer is standing in the column, Ctrl+B
    // brings the API console forward rather than silently closing it.
    togglePanel('api');
  }
  if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    togglePanel('map');
  }
  if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    togglePanel('db');
  }
  if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) {
    e.preventDefault();
    togglePanel('hist');
  }
  if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    openBlankTab();
  }
  if (e.key === 'F1') {
    e.preventDefault();
    openDocs();
  }
  if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    if (tabState.activeId != null) nb.closeTab(tabState.activeId);
  }
});

/* ------------------------------ main-process events ------------------------------ */

nb.onLoading(() => { clearStatus(); startSpin(); });
nb.onLoaded(() => { stopSpin(); });
nb.onNavigated((url) => {
  if (!url) {
    // A freshly opened (blank) tab became active.
    setBarUrl('');
    checkFinvuPath('');
    return;
  }
  if (!url.startsWith('devtools://')) {
    setBarUrl(url);
    localStorage.setItem(K.lastUrl, url);
    addHistory(url);
    checkFinvuPath(url);
  }
});
nb.onError((info) => {
  stopSpin();
  showStatus(`Load failed (${info.errorCode}): ${info.errorDescription} — ${info.validatedURL}`);
});

/* ------------------------------ startup ------------------------------ */

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem(K.theme) || 'system', { persist: false });

  // Cosmetic: colour the burger lines from the app icon.
  if (nb.iconData) {
    nb.iconData().then((d) => { if (d) sampleIconColors(d); }).catch(() => {});
  }

  const last = localStorage.getItem(K.lastUrl);
  if (last) setBarUrl(last);

  // The rewrite target is intentionally not restored — clear anything an older
  // build persisted so it can't resurrect a one-off host.
  localStorage.removeItem(K.rwProto);
  localStorage.removeItem(K.rwHost);
  refreshRewriteUi();

  // The API console is the point of the app, so every launch starts with it open.
  // Deliberately NOT restored from the saved state: closing it during one session
  // should not carry over into the next launch. Width and side are still restored
  // below, since those are preferences rather than a transient state.
  layoutState.sidebarVisible = true;
  layoutState.panel = 'api';
  layoutState.sidebarSide = localStorage.getItem(K.sbSide) === 'right' ? 'right' : 'left';
  layoutState.menuVisible = localStorage.getItem(K.menuVisible) === '1';
  const savedW = parseInt(localStorage.getItem(K.sbWidth) || '', 10);
  layoutState.sidebarWidth = clampWidth(Number.isFinite(savedW) ? savedW : 460);
  const savedMenuW = parseInt(localStorage.getItem(K.menuWidth) || '', 10);
  layoutState.menuWidth = clampMenuWidth(Number.isFinite(savedMenuW) ? savedMenuW : 250);

  applyLayout();

  // The first tab is created before this window finishes loading, so its
  // 'tabs-updated' push can be missed — pull the current state instead.
  nb.listTabs().then((state) => {
    if (state) { tabState = state; renderTabs(); refreshHarButton(); pushLayout(); }
  });

  // Keep the native page view aligned if the chrome height ever changes.
  if (window.ResizeObserver) {
    new ResizeObserver(() => pushLayout()).observe(chromeEl);
  }

  // Last, so it fades in over a settled layout rather than fighting it.
  showSecAlert();
});
