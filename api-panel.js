// api-panel.js — the Postman-style request/response console in the sidebar.

(function apiPanel() {
  const nb = window.nibble;

  const methodSel   = document.getElementById('method');
  const apiUrlEl    = document.getElementById('apiUrl');
  const sendBtn     = document.getElementById('send');

  const varPop      = document.getElementById('varPop');
  const vpName      = document.getElementById('vpName');
  const vpValue     = document.getElementById('vpValue');

  const apiKeyInput = document.getElementById('apiKey');
  const revealKey   = document.getElementById('revealKey');

  const headerRows  = document.getElementById('headerRows');
  const addHeader   = document.getElementById('addHeader');
  const varRows     = document.getElementById('varRows');
  const addVar      = document.getElementById('addVar');

  const bodyText    = document.getElementById('bodyText');
  const bodyGutter  = document.getElementById('bodyGutter');
  const bodyErr     = document.getElementById('bodyErr');
  const beautifyBtn = document.getElementById('beautify');

  const resPill     = document.getElementById('resPill');
  const resTime     = document.getElementById('resTime');
  const resSize     = document.getElementById('resSize');
  const resPre      = document.getElementById('resPre');
  const resGutter   = document.getElementById('resGutter');
  const resHeaders  = document.getElementById('resHeaders');
  const resBodyWrap = document.getElementById('resBody');
  const copyRes     = document.getElementById('copyRes');

  const resWrap     = document.getElementById('resWrap');
  const resSplit    = document.getElementById('resSplit');

  const journeyUrl  = document.getElementById('journeyUrl');
  const openBtn     = document.getElementById('openJourney');

  const K = {
    method: 'nibble.api.method',
    url: 'nibble.api.url',
    apiKey: 'nibble.api.key',
    headers: 'nibble.api.headers',
    vars: 'nibble.api.vars',
    body: 'nibble.api.body',
    resH: 'nibble.api.resHeight',
    journey: 'nibble.api.journeyUrl',
  };

  // Shipped default: the path is pre-filled, the host lives in {{baseUrl}} so it
  // can be pasted in via the hover popover on the token.
  const DEFAULT_PATH = '/web/multi-consent/initiate/phone-number';
  const DEFAULT_URL = `{{baseUrl}}${DEFAULT_PATH}`;
  const BASE_VAR = 'baseUrl';

  /* ---------------------------- persistence ---------------------------- */

  const save = (k, v) => localStorage.setItem(k, v);
  const load = (k, d = '') => {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  };
  const loadJson = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      return v == null ? d : v;
    } catch {
      return d;
    }
  };

  function persistRows() {
    save(K.headers, JSON.stringify(readRows(headerRows)));
    save(K.vars, JSON.stringify(readRows(varRows)));
    renderUrl(); // token colours depend on which variables are set
  }

  /* ---------------------------- key/value rows ---------------------------- */

  function makeRow(tbody, key = '', value = '') {
    const tr = document.createElement('tr');

    const tdK = document.createElement('td');
    const inK = document.createElement('input');
    inK.type = 'text';
    inK.value = key;
    inK.spellcheck = false;
    inK.autocomplete = 'off';
    inK.setAttribute('aria-label', 'Name');
    inK.addEventListener('input', persistRows);
    tdK.appendChild(inK);

    const tdV = document.createElement('td');
    const inV = document.createElement('input');
    inV.type = 'text';
    inV.value = value;
    inV.spellcheck = false;
    inV.autocomplete = 'off';
    inV.setAttribute('aria-label', 'Value');
    inV.addEventListener('input', persistRows);
    tdV.appendChild(inV);

    const tdA = document.createElement('td');
    tdA.className = 'act';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tiny';
    del.textContent = '\u2715';
    del.title = 'Remove row';
    del.setAttribute('aria-label', 'Remove row');
    del.addEventListener('click', () => { tr.remove(); persistRows(); });
    tdA.appendChild(del);

    tr.append(tdK, tdV, tdA);
    tbody.appendChild(tr);
    return tr;
  }

  function readRows(tbody) {
    return Array.from(tbody.querySelectorAll('tr')).map((tr) => {
      const [k, v] = tr.querySelectorAll('input');
      return { key: k.value, value: v.value };
    });
  }

  addHeader.addEventListener('click', () => { makeRow(headerRows); persistRows(); });
  addVar.addEventListener('click', () => { makeRow(varRows); persistRows(); });

  /* ---------------------------- request tabs ---------------------------- */

  document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('[data-pane]').forEach((p) => {
        p.hidden = p.dataset.pane !== btn.dataset.tab;
      });
    });
  });

  document.querySelectorAll('.tabs [data-rtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs [data-rtab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      const showBody = btn.dataset.rtab === 'body';
      resBodyWrap.hidden = !showBody;
      resHeaders.hidden = showBody;
    });
  });

  /* ---------------------------- API key reveal ---------------------------- */

  revealKey.addEventListener('click', () => {
    const shown = apiKeyInput.type === 'text';
    apiKeyInput.type = shown ? 'password' : 'text';
    revealKey.textContent = shown ? 'Show' : 'Hide';
    revealKey.setAttribute('aria-pressed', String(!shown));
  });

  /* ---------------------------- body editor ---------------------------- */

  function syncBodyGutter() {
    const lines = bodyText.value.split('\n').length;
    let out = '';
    for (let i = 1; i <= lines; i++) out += i + '\n';
    bodyGutter.textContent = out || '1';
    bodyGutter.scrollTop = bodyText.scrollTop;
  }

  bodyText.addEventListener('input', () => {
    syncBodyGutter();
    save(K.body, bodyText.value);
    bodyErr.textContent = '';
  });
  bodyText.addEventListener('scroll', () => { bodyGutter.scrollTop = bodyText.scrollTop; });

  // Strip // and /* */ comments without touching anything inside strings.
  function stripJsonComments(src) {
    let out = '';
    let i = 0;
    let inStr = false;
    let esc = false;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; out += c; i++; continue; }
      if (c === '/' && n === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  // Commenting a line out often leaves a dangling comma, e.g. ["A", /*"B"*/ ]
  function removeTrailingCommas(src) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ',') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === '}' || src[j] === ']') continue; // drop it
      }
      out += c;
    }
    return out;
  }

  function cleanBody(raw) {
    return removeTrailingCommas(stripJsonComments(raw)).trim();
  }

  beautifyBtn.addEventListener('click', () => {
    const cleaned = cleanBody(bodyText.value);
    if (!cleaned) { bodyErr.textContent = ''; return; }
    try {
      bodyText.value = JSON.stringify(JSON.parse(cleaned), null, 2);
      bodyErr.textContent = '';
      syncBodyGutter();
      save(K.body, bodyText.value);
    } catch (err) {
      bodyErr.textContent = 'Invalid JSON: ' + err.message;
    }
  });

  /* ---------------------------- variables ---------------------------- */

  function varMap() {
    const map = new Map();
    for (const { key, value } of readRows(varRows)) {
      const k = key.trim();
      // An empty value counts as unresolved so it gets flagged instead of
      // silently collapsing into an empty string mid-URL.
      if (k && value !== '') map.set(k, value);
    }
    return map;
  }

  function applyVars(str, map, missing) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (full, name) => {
      if (map.has(name)) return map.get(name);
      if (missing) missing.add(name);
      return full;
    });
  }

  /* ---------------------------- URL editor with {{var}} tokens ---------------------------- */

  const getUrl = () => apiUrlEl.textContent;

  function caretOffset(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function setCaret(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let count = 0;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (count + len >= offset) {
        const r = document.createRange();
        r.setStart(node, Math.max(0, offset - count));
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
      count += len;
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  // Repaint the field, wrapping every {{name}} in a hoverable token span.
  function renderUrl() {
    const text = apiUrlEl.textContent;
    const map = varMap();
    let html = '';
    let last = 0;
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text))) {
      html += escapeHtml(text.slice(last, m.index));
      const name = m[1];
      const unset = !map.has(name) ? ' unset' : '';
      html += `<span class="tok${unset}" data-var="${escapeHtml(name)}" `
            + `title="Click or hover to set ${escapeHtml(name)}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    html += escapeHtml(text.slice(last));

    if (apiUrlEl.innerHTML === html) return;
    const off = caretOffset(apiUrlEl);
    apiUrlEl.innerHTML = html;
    if (off != null) setCaret(apiUrlEl, off);
  }

  function setUrl(text) {
    apiUrlEl.textContent = text || '';
    renderUrl();
  }

  apiUrlEl.addEventListener('input', () => {
    // contenteditable can leave a stray <br> behind when fully cleared.
    if (!apiUrlEl.textContent.trim() && apiUrlEl.innerHTML !== '') apiUrlEl.innerHTML = '';
    save(K.url, getUrl());
    renderUrl();
  });

  apiUrlEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    document.execCommand('insertText', false, text.replace(/\r?\n/g, ''));
  });

  apiUrlEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  /* ---------------------------- variable hover popover ---------------------------- */

  let popToken = null;
  let popTimer = null;

  function upsertVar(name, value) {
    const rows = Array.from(varRows.querySelectorAll('tr'));
    for (const tr of rows) {
      const [k, v] = tr.querySelectorAll('input');
      if (k.value.trim() === name) { v.value = value; persistRows(); return; }
    }
    for (const tr of rows) {
      const [k, v] = tr.querySelectorAll('input');
      if (!k.value.trim() && !v.value) { k.value = name; v.value = value; persistRows(); return; }
    }
    makeRow(varRows, name, value);
    persistRows();
  }

  function currentVarValue(name) {
    for (const { key, value } of readRows(varRows)) {
      if (key.trim() === name) return value;
    }
    return '';
  }

  function openVarPop(tok) {
    if (popTimer) { clearTimeout(popTimer); popTimer = null; }
    popToken = tok;
    const name = tok.dataset.var;
    vpName.textContent = `{{${name}}}`;
    vpValue.value = currentVarValue(name);
    varPop.hidden = false;

    // Keep the popover entirely inside the sidebar. Anything spilling into the
    // page region would be hidden behind the native page view.
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    varPop.style.width = Math.max(200, Math.min(330, sb.width - 16)) + 'px';

    const r = tok.getBoundingClientRect();
    const w = varPop.offsetWidth;
    const left = Math.min(Math.max(sb.left + 8, r.left), Math.max(sb.left + 8, sb.right - w - 8));

    let top = r.bottom + 6;
    if (top + varPop.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - varPop.offsetHeight - 6);
    }
    varPop.style.left = left + 'px';
    varPop.style.top = top + 'px';
  }

  function closeVarPop() {
    varPop.hidden = true;
    popToken = null;
  }

  function scheduleClose() {
    if (popTimer) clearTimeout(popTimer);
    popTimer = setTimeout(closeVarPop, 260);
  }

  apiUrlEl.addEventListener('mouseover', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.tok') : null;
    if (tok) openVarPop(tok);
  });
  apiUrlEl.addEventListener('mouseout', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.tok') : null;
    if (tok) scheduleClose();
  });
  apiUrlEl.addEventListener('click', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.tok') : null;
    if (tok) { openVarPop(tok); vpValue.focus(); vpValue.select(); }
  });

  varPop.addEventListener('mouseenter', () => {
    if (popTimer) { clearTimeout(popTimer); popTimer = null; }
  });
  varPop.addEventListener('mouseleave', scheduleClose);

  vpValue.addEventListener('input', () => {
    if (!popToken) return;
    upsertVar(popToken.dataset.var, vpValue.value);
  });
  vpValue.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeVarPop(); apiUrlEl.focus(); }
    if (e.key === 'Enter') { e.preventDefault(); closeVarPop(); }
  });

  /* ---------------------------- response rendering ---------------------------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightJson(text) {
    return escapeHtml(text).replace(
      /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?)|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m, str, bool, nul, num) => {
        if (str) return `<span class="${/:\s*$/.test(str) ? 'j-key' : 'j-str'}">${str}</span>`;
        if (bool) return `<span class="j-bool">${bool}</span>`;
        if (nul) return `<span class="j-null">${nul}</span>`;
        if (num) return `<span class="j-num">${num}</span>`;
        return m;
      },
    );
  }

  let lastShownText = '';

  function showBody(text, asJson) {
    lastShownText = text;
    resPre.innerHTML = asJson ? highlightJson(text) : escapeHtml(text);
    const lines = text.split('\n').length;
    let g = '';
    for (let i = 1; i <= lines; i++) g += i + '\n';
    resGutter.textContent = g;
  }

  resPre.addEventListener('scroll', () => { resGutter.scrollTop = resPre.scrollTop; });

  function setPill(cls, label) {
    resPill.className = 'pill ' + cls;
    resPill.textContent = label;
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function renderHeaders(headers) {
    resHeaders.textContent = '';
    const entries = Object.entries(headers || {});
    if (!entries.length) {
      resHeaders.textContent = '(no headers)';
      return;
    }
    for (const [k, v] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
      const line = document.createElement('div');
      const key = document.createElement('span');
      key.className = 'hk';
      key.textContent = k + ': ';
      line.appendChild(key);
      line.appendChild(document.createTextNode(Array.isArray(v) ? v.join(', ') : String(v)));
      resHeaders.appendChild(line);
    }
  }

  function findJourneyUrl(value) {
    let preferred = null;
    let fallback = null;
    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          if (/redirect/i.test(k)) { if (!preferred) preferred = v; }
          else if (!fallback) fallback = v;
        } else if (v && typeof v === 'object') {
          walk(v);
        }
      }
    };
    walk(value);
    return preferred || fallback;
  }

  /* ---------------------------- send ---------------------------- */

  async function send() {
    const map = varMap();
    const missing = new Set();

    let url = applyVars(getUrl(), map, missing).trim();
    if (!url) {
      setPill('err', 'ERR');
      resTime.textContent = '';
      resSize.textContent = '';
      showBody('Enter a request URL first.', false);
      return;
    }
    // If a {{var}} in the URL is still unresolved we would send a nonsense host,
    // so stop and say which one needs a value.
    const urlLeftovers = url.match(/\{\{\s*[\w.-]+\s*\}\}/g);
    if (urlLeftovers) {
      setPill('err', 'ERR');
      resTime.textContent = '';
      resSize.textContent = '';
      showBody(
        `Request not sent — unresolved variable(s) in the URL: ${urlLeftovers.join(', ')}\n\n`
        + 'Hover the highlighted token in the URL to paste a value, or set it in the Variables tab.',
        false,
      );
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;

    const method = methodSel.value;

    // Body: strip comments/trailing commas, then validate.
    const rawBody = bodyText.value;
    let body = '';
    const skipBody = method === 'GET' || method === 'HEAD';
    if (rawBody.trim() && !skipBody) {
      const cleaned = applyVars(cleanBody(rawBody), map, missing);
      try {
        JSON.parse(cleaned);
      } catch (err) {
        bodyErr.textContent = 'Invalid JSON: ' + err.message;
        setPill('err', 'ERR');
        resTime.textContent = '';
        resSize.textContent = '';
        showBody('Request not sent — body is not valid JSON after stripping comments:\n\n' + err.message, false);
        return;
      }
      bodyErr.textContent = '';
      body = cleaned;
    } else if (rawBody.trim() && skipBody) {
      bodyErr.textContent = `Body ignored for ${method} requests.`;
    }

    // Headers
    const headers = {};
    for (const { key, value } of readRows(headerRows)) {
      const k = applyVars(key, map, missing).trim();
      if (!k) continue;
      headers[k] = applyVars(value, map, missing);
    }
    const keyVal = applyVars(apiKeyInput.value, map, missing).trim();
    if (keyVal) headers.API_KEY = keyVal;
    if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    setPill('', '…');
    resTime.textContent = '';
    resSize.textContent = '';
    showBody('Waiting for response…', false);

    let res;
    try {
      res = await nb.sendRequest({ method, url, headers, body });
    } catch (err) {
      res = { error: String(err && err.message ? err.message : err) };
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }

    if (res && res.error) {
      setPill('err', 'ERR');
      renderHeaders({});
      showBody(res.error, false);
      return;
    }

    const s = res.status || 0;
    setPill('s' + String(s)[0], `${s} ${res.statusText || ''}`.trim());
    resTime.textContent = `${res.timeMs} ms`;
    resSize.textContent = fmtSize(res.size || 0);
    renderHeaders(res.headers);

    let parsed = null;
    let pretty = res.bodyText || '';
    try {
      parsed = JSON.parse(res.bodyText);
      pretty = JSON.stringify(parsed, null, 2);
      showBody(pretty, true);
    } catch {
      showBody(pretty, false);
    }

    if (missing.size) {
      bodyErr.textContent = `Unresolved variables: ${Array.from(missing).join(', ')}`;
    }

    const found = parsed ? findJourneyUrl(parsed) : null;
    if (found) {
      journeyUrl.value = found;
      save(K.journey, found);
    }
  }

  sendBtn.addEventListener('click', send);
  bodyText.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); }
  });

  copyRes.addEventListener('click', async () => {
    const text = resBodyWrap.hidden ? resHeaders.textContent : lastShownText;
    try {
      await navigator.clipboard.writeText(text);
      copyRes.textContent = 'Copied';
      setTimeout(() => { copyRes.textContent = 'Copy'; }, 1200);
    } catch {
      copyRes.textContent = 'Failed';
      setTimeout(() => { copyRes.textContent = 'Copy'; }, 1200);
    }
  });

  /* ---------------------------- journey URL tools ---------------------------- */

  /* ---------------------------- journey URL ---------------------------- */

  journeyUrl.addEventListener('input', () => save(K.journey, journeyUrl.value));

  // Opens the URL exactly as-is. If it is a shortener link the page view follows
  // the redirect itself, which leaves the real journey URL (with its ?ecreq=...
  // query) in the top URL bar — ready for the "→ local" button up there.
  openBtn.addEventListener('click', () => {
    const v = journeyUrl.value.trim();
    if (!v) return;
    window.NibbleNav.navigate(v);
  });

  journeyUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openBtn.click();
  });

  /* ---------------------------- response pane resize ---------------------------- */

  let splitting = false;
  let startY = 0;
  let startH = 0;

  resSplit.addEventListener('mousedown', (e) => {
    e.preventDefault();
    splitting = true;
    startY = e.clientY;
    startH = resWrap.offsetHeight;
    resSplit.classList.add('active');
    document.body.style.cursor = 'row-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!splitting) return;
    const max = Math.max(120, window.innerHeight - 260);
    const h = Math.min(Math.max(startH - (e.clientY - startY), 120), max);
    resWrap.style.height = h + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!splitting) return;
    splitting = false;
    resSplit.classList.remove('active');
    document.body.style.cursor = '';
    save(K.resH, String(resWrap.offsetHeight));
  });

  /* ---------------------------- startup ---------------------------- */

  methodSel.value = load(K.method, 'POST');
  apiKeyInput.value = load(K.apiKey, '');
  bodyText.value = load(K.body, '');
  journeyUrl.value = load(K.journey, '');

  const savedH = parseInt(load(K.resH, ''), 10);
  if (Number.isFinite(savedH)) resWrap.style.height = savedH + 'px';

  for (const r of loadJson(K.headers, [])) makeRow(headerRows, r.key, r.value);

  // Variables: on a first run, seed an empty {{baseUrl}} so the default URL has
  // a token to hover and paste into.
  const savedVars = loadJson(K.vars, null);
  if (savedVars) {
    for (const r of savedVars) makeRow(varRows, r.key, r.value);
  } else {
    makeRow(varRows, BASE_VAR, '');
  }

  if (!headerRows.children.length) makeRow(headerRows);
  if (!varRows.children.length) makeRow(varRows);

  // URL last, so token colouring can see the variable rows.
  const savedUrl = localStorage.getItem(K.url);
  setUrl(savedUrl === null ? DEFAULT_URL : savedUrl);

  methodSel.addEventListener('change', () => save(K.method, methodSel.value));
  apiKeyInput.addEventListener('input', () => save(K.apiKey, apiKeyInput.value));

  syncBodyGutter();
  showBody('No response yet. Configure the request above and hit Send.', false);
})();
