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

  const injRows     = document.getElementById('injRows');
  const injAdd      = document.getElementById('injAdd');
  const injNewPair  = document.getElementById('injNewPair');
  const injMsg      = document.getElementById('injMsg');

  const aaSelect    = document.getElementById('aaSelect');
  const aaIdDisplay = document.getElementById('aaIdDisplay');
  const aaBuildDisplay = document.getElementById('aaBuildDisplay');

  const bodyText    = document.getElementById('bodyText');
  const bodyVars    = document.getElementById('bodyVars');
  const bodyVarList = document.getElementById('bodyVarList');
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
    aa: 'nibble.api.aa',
  };

  // Shipped default: the path is pre-filled, the host lives in {{baseUrl}} so it
  // can be pasted in via the hover popover on the token.
  const DEFAULT_PATH = '/web/multi-consent/initiate/phone-number';
  const DEFAULT_URL = `{{baseUrl}}${DEFAULT_PATH}`;
  const BASE_VAR = 'baseUrl';
  const PHONE_VAR = 'phoneNumber';
  const TRACKING_VAR = 'trackingId';

  // Seeded on a first run, and back-filled for an existing install that predates
  // one of them — a token with no variable row is unresolved, which blocks Send.
  const SEED_VARS = [
    [BASE_VAR, 'https://fiupreprod.ignosis.ai/fiu/api/pirimid'],
    [PHONE_VAR, '0000000000'],
    [TRACKING_VAR, 'DEFAULT'],
  ];

  // The usual initiate payload. phoneNumber and trackingId are {{tokens}} rather
  // than literals so they can be changed from the hover card instead of by editing
  // JSON, and the commented-out entries are kept: `//` comments are stripped before
  // the request is sent, so they work as toggles the way they do in Postman.
  const DEFAULT_BODY = `{
    "phoneNumber": "{{${PHONE_VAR}}}",
    "templateTypes": [
        "UNDERWRITING"
        // ,"MONITORING"
        // ,"COLLECTIONS"
        // "PFM"
    ],
    "trackingId": "{{${TRACKING_VAR}}}",
    "fipIds": [
        "FIP-ID"
        // ,"IGNOSIS_FIP_UAT"
    ],
    "redirectionUrl": "http://google.com",
    "accountAggregatorId": "onemoney"
}`;

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
    renderBodyVars();          // and so do the body chips
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
    renderBodyVars();   // a token can be typed or deleted at any time
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

  // A variable whose NAME matches a key in the body replaces that key's value on
  // send. That is what makes the phone number editable from the hover card even
  // when the JSON holds a literal rather than a {{token}}, and it generalises: add
  // a variable called `trackingId` and the body's trackingId is overwritten too.
  //
  // Only TOP-LEVEL keys are considered. Matching at any depth would let a variable
  // silently reach into nested objects it was never meant to touch.
  //
  // Types are preserved rather than flattened to strings:
  //   - existing string (or null) -> the variable is used verbatim as a string.
  //     This matters for "0000000000", which would otherwise JSON.parse to 0.
  //   - anything else (array, object, number, boolean) -> the variable is parsed as
  //     JSON, so `["UNDERWRITING","MONITORING"]` replaces an array properly. If it
  //     does not parse, the key is left untouched and reported, rather than turning
  //     an array into a string.
  function applyVarsToBodyKeys(obj) {
    const applied = [];
    const skipped = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { applied, skipped };

    for (const { key, value } of readRows(varRows)) {
      const name = key.trim();
      // An empty value means "unset", the same as it does for {{tokens}}, so it
      // does not wipe whatever the body already has.
      if (!name || value === '') continue;
      if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;

      const current = obj[name];
      if (typeof current === 'string' || current === null) {
        obj[name] = value;
        applied.push(name);
        continue;
      }
      try {
        obj[name] = JSON.parse(value);
        applied.push(name);
      } catch {
        skipped.push(name);
      }
    }
    return { applied, skipped };
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

  /* ---- the same card, for {{tokens}} in the body ---- */
  // The body is a plain textarea, so a token inside the JSON cannot be wrapped in
  // a hoverable span the way the URL field's are. Instead every token found in the
  // body gets a chip underneath it, and the chips carry the same data-var contract
  // openVarPop expects — so hovering one opens the identical card and editing it
  // writes straight back to the Variables tab.
  function renderBodyVars() {
    // Tokens written into the JSON, substituted textually before it is parsed.
    const tokens = [];
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(bodyText.value))) {
      if (!tokens.includes(m[1])) tokens.push(m[1]);
    }

    // Variables that will overwrite a top-level key by NAME on send, even though
    // no token appears in the JSON. Shown so the rewrite is visible before it
    // happens rather than being a surprise in the sent payload.
    const keyMatches = [];
    try {
      const parsed = JSON.parse(cleanBody(bodyText.value));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const { key, value } of readRows(varRows)) {
          const name = key.trim();
          if (!name || value === '') continue;
          if (!Object.prototype.hasOwnProperty.call(parsed, name)) continue;
          // A token already covers it; do not list the same variable twice.
          if (tokens.includes(name) || keyMatches.includes(name)) continue;
          keyMatches.push(name);
        }
      }
    } catch {
      // Half-typed JSON: fall back to showing tokens only.
    }

    bodyVars.hidden = tokens.length === 0 && keyMatches.length === 0;
    bodyVarList.textContent = '';
    const map = varMap();

    for (const name of tokens) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `bodyTok${map.has(name) ? '' : ' unset'}`;
      chip.dataset.var = name;
      chip.textContent = `{{${name}}}`;
      chip.title = `Click or hover to set ${name}`;
      bodyVarList.appendChild(chip);
    }

    for (const name of keyMatches) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bodyTok keyMatch';
      chip.dataset.var = name;
      chip.textContent = name;
      chip.title = `The "${name}" variable overwrites the "${name}" field in the body on send.`
                 + ` Click or hover to change it.`;
      bodyVarList.appendChild(chip);
    }
  }

  bodyVarList.addEventListener('mouseover', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.bodyTok') : null;
    if (tok) openVarPop(tok);
  });
  bodyVarList.addEventListener('mouseout', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.bodyTok') : null;
    if (tok) scheduleClose();
  });
  bodyVarList.addEventListener('click', (e) => {
    const tok = e.target instanceof Element ? e.target.closest('.bodyTok') : null;
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

  /* ---------------------------- account aggregator ---------------------------- */

  // Name -> accountAggregatorId. That pair is all the request needs.
  //
  // This is only the fallback list. The real one comes from the aa_mapping table
  // via __nibbleAaReload() at the bottom of this file; these values are what the
  // dropdown shows for the moment before the database answers, and what it keeps
  // if the database cannot be read at all.
  //
  // Ids are from AccountAggregatorIds.java / AAFolderMappings.java. They must match
  // the AA the SDK host was built with, or decodeParam fails.
  let AA_OPTIONS = [
    { name: 'SAAFE (preprod)', id: 'dashboard-aa-preprod', aaclass: 'SAAFE', sdkFolder: 'AAServices/SAAFE', env: 'preprod' },
    { name: 'SAAFE', id: 'saafe', aaclass: 'SAAFE', sdkFolder: 'AAServices/SAAFE', env: 'prod' },
    { name: 'CAMS', id: 'AA00022277', aaclass: 'CAMS', sdkFolder: 'AAServices/CAMS', env: 'prod' },
    { name: 'ONEMONEY', id: 'onemoney', aaclass: 'ONEMONEY', sdkFolder: 'AAServices/ONEMONEY', env: 'prod' },
    { name: 'NADL', id: 'AA00023404', aaclass: 'NADL', sdkFolder: 'AAServices/NADL', env: 'prod' },
    { name: 'Anumati', id: 'Anumati', aaclass: 'ANUMATI', sdkFolder: 'AAServices/ANUMATI', env: 'prod' },
    { name: 'CookieJar (Finvu)', id: 'cookiejaraalive@finvu', aaclass: 'FINVU', sdkFolder: 'AAServices/FINVU', env: 'prod' },
  ];
  const AA_DEFAULT = 'dashboard-aa-preprod';

  function buildAaOptions() {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— Don\u2019t set —';
    aaSelect.appendChild(none);

    for (const { name, id } of AA_OPTIONS) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = name;
      aaSelect.appendChild(o);
    }
  }

  function refreshAaDisplay() {
    const id = aaSelect.value;
    const opt = AA_OPTIONS.find((o) => o.id === id);

    if (id) {
      aaIdDisplay.textContent = id;
      aaIdDisplay.classList.remove('unset');
    } else {
      aaIdDisplay.textContent = 'not set — the body is sent as-is';
      aaIdDisplay.classList.add('unset');
    }

    // The build-time half of the AA choice: what the SDK host must have been built
    // with for this id to decode. Only known for rows the registry has tagged.
    const parts = [];
    if (opt && opt.aaclass) parts.push(`yarn start ${opt.aaclass.toLowerCase()} <env>`);
    if (opt && opt.sdkFolder) parts.push(opt.sdkFolder);
    if (opt && opt.env) parts.push(`env: ${opt.env}`);
    if (parts.length) {
      aaBuildDisplay.textContent = parts.join('  ·  ');
      aaBuildDisplay.classList.remove('unset');
    } else {
      aaBuildDisplay.textContent = 'not recorded for this AA';
      aaBuildDisplay.classList.add('unset');
    }
  }

  aaSelect.addEventListener('change', () => {
    save(K.aa, aaSelect.value);
    refreshAaDisplay();
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

  // The pill stays out of the DOM flow until there is a real status to show —
  // an em-dash placeholder just looked like a button that did nothing.
  function setPill(cls, label) {
    resPill.className = 'pill ' + cls;
    resPill.textContent = label;
    resPill.hidden = false;
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
      let parsedBody;
      try {
        parsedBody = JSON.parse(cleaned);
      } catch (err) {
        bodyErr.textContent = 'Invalid JSON: ' + err.message;
        setPill('err', 'ERR');
        resTime.textContent = '';
        resSize.textContent = '';
        showBody('Request not sent — body is not valid JSON after stripping comments:\n\n' + err.message, false);
        return;
      }
      bodyErr.textContent = '';

      // Variables matching a top-level key overwrite it...
      const keyed = applyVarsToBodyKeys(parsedBody);

      // ...and the AA tab wins over both the body and a variable of the same name,
      // because it is the explicit control for that field.
      const aaId = aaSelect.value;
      const isPlainObject = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody);
      if (aaId && isPlainObject) parsedBody.accountAggregatorId = aaId;

      // Only re-serialise when something actually changed, so an untouched body is
      // sent exactly as written rather than silently reformatted.
      const changed = keyed.applied.length > 0 || (aaId && isPlainObject);
      body = changed ? JSON.stringify(parsedBody, null, 2) : cleaned;

      if (keyed.skipped.length) {
        bodyErr.textContent = `Left alone (value is not valid JSON for that field): ${keyed.skipped.join(', ')}`;
      }
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
      // Auto-open, so Send is the only click needed. Gated on a 2xx: an error
      // response (e.g. a 404 whose body still carries some URL) must not navigate
      // away. The Open button stays for re-opening or opening a non-2xx result by
      // hand. openJourney() is the same path the button uses.
      if (s >= 200 && s < 300) openJourney(found);
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

  /* ---------------------------- inject URL params ---------------------------- */
  // Acts on the URL in the top bar. Per pair, three outcomes:
  //   1. key and value both already present -> leave alone
  //   2. key present with a different value  -> update in place (position kept)
  //   3. key absent                          -> added at the FRONT of the query
  // The URL only reloads if something actually changed.

  let injMsgTimer = null;
  let injFadeTimer = null;

  function showInjMsg(text, kind) {
    if (injMsgTimer) clearTimeout(injMsgTimer);
    if (injFadeTimer) clearTimeout(injFadeTimer);
    injMsg.textContent = text;
    injMsg.className = 'injectMsg ' + kind;
    injMsg.hidden = false;
    injFadeTimer = setTimeout(() => injMsg.classList.add('fade'), 2600);
    injMsgTimer = setTimeout(() => { injMsg.hidden = true; }, 3000);
  }

  function updateInjRemoveButtons() {
    const rows = injRows.querySelectorAll('.injectRow');
    rows.forEach((tr) => {
      const rm = tr.querySelector('button.rm');
      if (rm) rm.hidden = rows.length < 2;
    });
  }

  function makeInjRow(key = '', value = '') {
    const row = document.createElement('div');
    row.className = 'injectRow';

    const inK = document.createElement('input');
    inK.type = 'text';
    inK.value = key;
    inK.spellcheck = false;
    inK.autocomplete = 'off';
    inK.placeholder = 'key (e.g. orgId)';
    inK.setAttribute('aria-label', 'Param key');

    const inV = document.createElement('input');
    inV.type = 'text';
    inV.value = value;
    inV.spellcheck = false;
    inV.autocomplete = 'off';
    inV.placeholder = 'value';
    inV.setAttribute('aria-label', 'Param value');

    for (const f of [inK, inV]) {
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); injectParams(); }
      });
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'tiny rm';
    rm.textContent = '\u2715';
    rm.title = 'Remove this pair';
    rm.setAttribute('aria-label', 'Remove this pair');
    rm.addEventListener('click', () => { row.remove(); updateInjRemoveButtons(); });

    row.append(inK, inV, rm);
    injRows.appendChild(row);
    updateInjRemoveButtons();
    return row;
  }

  function readInjRows() {
    return Array.from(injRows.querySelectorAll('.injectRow')).map((row) => {
      const [k, v] = row.querySelectorAll('input');
      return { key: k.value.trim(), value: v.value };
    });
  }

  // After navigating, the page may redirect and drop what we just added. Re-read
  // the real URL and say so rather than leaving a misleading success message.
  async function verifyInjection(expected) {
    await new Promise((r) => setTimeout(r, 1600));
    const live = await window.NibbleNav.getLiveUrl();
    if (!live) return;
    let u;
    try {
      u = new URL(live);
    } catch {
      return;
    }
    const lost = expected.filter(({ key, value }) => u.searchParams.get(key) !== value);
    if (!lost.length) return;
    showInjMsg(
      `The page navigated and dropped ${lost.map((p) => p.key).join(', ')}. `
      + 'Re-add after it settles, or add it before opening the journey.',
      'bad',
    );
  }

  async function injectParams() {
    const pairs = readInjRows().filter((p) => p.key);
    if (!pairs.length) {
      showInjMsg('Enter a key first.', 'bad');
      return;
    }

    // Prefer the page's real URL; fall back to the bar if nothing is loaded yet.
    const live = await window.NibbleNav.getLiveUrl();
    const raw = live || String(window.NibbleNav.getPageUrl() || '').trim();
    if (!raw) {
      showInjMsg('No URL in the top bar to add params to.', 'bad');
      return;
    }

    const abs = /^https?:\/\//i.test(raw) ? raw : 'http://' + raw;
    let u;
    try {
      u = new URL(abs);
    } catch {
      showInjMsg('The URL in the top bar could not be parsed.', 'bad');
      return;
    }

    // Work on the query as an ordered list so new keys can go to the front while
    // existing keys keep their original position.
    const entries = Array.from(u.searchParams.entries()).map(([k, v]) => [k, v]);
    const fresh = [];

    const added = [];
    const updated = [];
    const same = [];

    for (const { key, value } of pairs) {
      const idx = entries.findIndex(([k]) => k === key);

      if (idx !== -1) {
        const existing = entries[idx][1];
        if (existing === value) {
          same.push({ key, value });          // case 1
          continue;
        }
        updated.push({ key, from: existing, to: value }); // case 2
        entries[idx][1] = value;
        // Collapse any later duplicates of the same key, matching set() semantics.
        for (let i = entries.length - 1; i > idx; i--) {
          if (entries[i][0] === key) entries.splice(i, 1);
        }
        continue;
      }

      // Same key twice within one submit: last value wins, still one new pair.
      const fIdx = fresh.findIndex(([k]) => k === key);
      if (fIdx !== -1) {
        fresh[fIdx][1] = value;
        continue;
      }
      added.push({ key, value });             // case 3
      fresh.push([key, value]);
    }

    const show = (s) => (s === '' ? '(empty)' : s);

    // Case 1 only — nothing to do.
    if (!added.length && !updated.length) {
      showInjMsg(
        same.length === 1
          ? `${same[0].key}=${show(same[0].value)} is already in the URL.`
          : `All ${same.length} pairs are already in the URL.`,
        'info',
      );
      return;
    }

    // New pairs first, then the existing query in its original order.
    const sp = new URLSearchParams();
    for (const [k, v] of fresh) sp.append(k, v);
    for (const [k, v] of entries) sp.append(k, v);
    u.search = sp.toString();

    const next = u.toString();
    window.NibbleNav.setPageUrl(next);
    window.NibbleNav.navigate(next);

    let msg;
    if (added.length === 1 && !updated.length && !same.length) {
      msg = `Added ${added[0].key}=${show(added[0].value)} and reloaded.`;
    } else if (updated.length === 1 && !added.length && !same.length) {
      msg = `Updated ${updated[0].key}: ${show(updated[0].from)} → ${show(updated[0].to)} and reloaded.`;
    } else {
      const bits = [];
      if (added.length) bits.push(`added ${added.length}`);
      if (updated.length) bits.push(`updated ${updated.length}`);
      if (same.length) bits.push(`${same.length} already there`);
      msg = bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + ' — reloaded.';
    }
    showInjMsg(msg, 'ok');

    // Confirm the page kept them.
    verifyInjection([
      ...fresh.map(([key, value]) => ({ key, value })),
      ...updated.map((p) => ({ key: p.key, value: p.to })),
    ]);
  }

  injAdd.addEventListener('click', injectParams);
  injNewPair.addEventListener('click', () => {
    const row = makeInjRow();
    row.querySelector('input').focus();
  });

  /* ---------------------------- journey URL ---------------------------- */

  journeyUrl.addEventListener('input', () => save(K.journey, journeyUrl.value));

  // Opens the URL exactly as-is. If it is a shortener link the page view follows
  // the redirect itself, which leaves the real journey URL (with its ?ecreq=...
  // query) in the top URL bar — ready for the "→ local" button up there.
  function openJourney(u) {
    const v = (u != null ? u : journeyUrl.value).trim();
    if (!v) return;
    window.NibbleNav.navigate(v);
  }

  openBtn.addEventListener('click', () => openJourney());

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
  // An empty saved body counts as "no body yet" and gets the default back. Only a
  // body you have actually written is preserved.
  const savedBody = localStorage.getItem(K.body);
  bodyText.value = (savedBody === null || savedBody.trim() === '') ? DEFAULT_BODY : savedBody;
  save(K.body, bodyText.value);
  journeyUrl.value = load(K.journey, '');

  const savedH = parseInt(load(K.resH, ''), 10);
  if (Number.isFinite(savedH)) resWrap.style.height = savedH + 'px';

  for (const r of loadJson(K.headers, [])) makeRow(headerRows, r.key, r.value);

  // Variables: seed the two the shipped defaults refer to. An existing install
  // keeps whatever it has; a missing one is back-filled rather than left blank,
  // because a token with no row is unresolved and blocks Send.
  const savedVars = loadJson(K.vars, null);
  if (savedVars) {
    for (const r of savedVars) makeRow(varRows, r.key, r.value);
  }
  const haveVar = (name) => readRows(varRows).some((r) => r.key.trim() === name);
  for (const [name, value] of SEED_VARS) {
    if (!haveVar(name)) makeRow(varRows, name, value);
  }

  if (!headerRows.children.length) makeRow(headerRows);
  if (!varRows.children.length) makeRow(varRows);
  // Whatever the rows ended up as, persist them so the seeded values survive a
  // restart, and draw the body chips from them.
  persistRows();

  // The inject form always starts with one empty pair.
  makeInjRow();

  buildAaOptions();
  const savedAa = load(K.aa, null);
  const validAa = savedAa !== null
    && (savedAa === '' || AA_OPTIONS.some((o) => o.id === savedAa));
  aaSelect.value = validAa ? savedAa : AA_DEFAULT;
  refreshAaDisplay();

  // The dropdown's real contents live in the aa_mapping table. Startup above is
  // synchronous and a database read is not, so the fallback list is shown first
  // and swapped out as soon as the main process answers — fast enough to be
  // invisible. aa-mapping.js calls this again after every add/edit/delete, so
  // the two tabs can never disagree about which AAs exist.
  window.__nibbleAaReload = async function reloadAa() {
    const res = await nb.aaMap.list();
    if (!res || !res.ok) return;   // unreadable DB: keep the fallback list

    AA_OPTIONS = res.rows.map((r) => ({
      name: r.name,
      id: r.aaId,
      aaclass: r.aaclass || '',
      sdkFolder: r.sdkFolder || '',
      env: r.env || '',
    }));

    const keep = aaSelect.value;   // don't lose the user's pick on a redraw
    aaSelect.textContent = '';     // buildAaOptions appends, so clear first
    buildAaOptions();
    aaSelect.value = AA_OPTIONS.some((o) => o.id === keep) ? keep : '';
    save(K.aa, aaSelect.value);
    refreshAaDisplay();
  };
  window.__nibbleAaReload();

  // URL last, so token colouring can see the variable rows.
  const savedUrl = localStorage.getItem(K.url);
  setUrl(savedUrl === null ? DEFAULT_URL : savedUrl);

  methodSel.addEventListener('change', () => save(K.method, methodSel.value));
  apiKeyInput.addEventListener('input', () => save(K.apiKey, apiKeyInput.value));

  syncBodyGutter();
  showBody('No response yet. Configure the request above and hit Send.', false);
})();
