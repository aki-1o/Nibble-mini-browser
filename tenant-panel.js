// tenant-panel.js — the API console's Tenant tab.
//
// Runs in the WINDOW, so it has no database access: everything goes through
// window.nibble.tenant.* (see preload.js) and is drawn from what comes back.
//
// WHY THIS IS NOT A SECOND AA PICKER: the AA is the RBI-licensed aggregator whose
// APIs the consent lives on, and it is baked into an SDK deployment at build time
// (REACT_APP_AACLASS). The tenant is the FIU-branded UI that deployment renders,
// chosen per request from redirect-URL params. So the AA tab writes a body field
// and this tab emits query params — they are orthogonal axes of the same journey.

(function tenantPanel() {
  const nb = window.nibble;

  const bundleSel = document.getElementById('tnBundle');
  const tenantSel = document.getElementById('tnTenant');
  const tenantInput = document.getElementById('tnTenantInput');
  const tenantList  = document.getElementById('tnTenantList');
  const componentEl = document.getElementById('tnComponent');
  const notesEl   = document.getElementById('tnNotes');
  const paramsEl  = document.getElementById('tnParams');
  const otherEl   = document.getElementById('tnOtherParams');
  const reloadBtn = document.getElementById('tnReload');
  const msgEl     = document.getElementById('tnMsg');

  const paramsFilter = document.getElementById('tnParamsFilter');
  const otherFilter  = document.getElementById('tnOtherFilter');
  const rowsFilter   = document.getElementById('tnRowsFilter');

  const customKeyIn   = document.getElementById('tnCustomKey');
  const customValueIn = document.getElementById('tnCustomValue');
  const customMsgEl   = document.getElementById('tnCustomMsg');
  const customKeyList   = document.getElementById('tnCustomKeyList');
  const customValueList = document.getElementById('tnCustomValueList');

  const rowsEl    = document.getElementById('tnRows');
  const nameIn    = document.getElementById('tnName');
  const prioIn    = document.getElementById('tnPriority');
  const saveBtn   = document.getElementById('tnSave');
  const cancelBtn = document.getElementById('tnCancel');
  const saveCell  = document.getElementById('tnSaveCell');
  const cancelCell = document.getElementById('tnCancelCell');
  const formRow   = document.getElementById('tnFormRow');
  const exportBtn = document.getElementById('tnExport');

  const K = { bundle: 'nibble.tenant.bundle', tenant: 'nibble.tenant.id' };

  // Params the SDK reads but never routes on. Kept here rather than in the routing
  // table because that is exactly the distinction: a rule decides which tenant
  // renders, these only change how it behaves once it has.
  const NON_ROUTING = ['fiTypes', 'platform', 'redirectBack', 'aaId', 'theme', 'darkMode'];

  let tree = null;
  let editingId = null;

  function msg(text, kind) {
    msgEl.textContent = text;
    msgEl.className = `injectMsg ${kind || ''}`;
    msgEl.hidden = !text;
  }

  const bundles = () => (tree && tree.bundles) || [];
  const currentBundle = () => bundles().find((b) => String(b.id) === bundleSel.value) || bundles()[0] || null;

  function currentTenant() {
    const b = currentBundle();
    if (!b) return null;
    return b.tenants.find((t) => String(t.id) === tenantSel.value) || b.tenants[0] || null;
  }

  /* ---------------------------- injecting into the URL ---------------------------- */

  // Merge, never rebuild. decryptURL() only proceeds when fi, reqdate and ecreq are
  // all present and the UI only mounts once orgId is set, so a URL assembled from
  // scratch will never render — the existing query string has to survive.
  function injectParam(name, value) {
    const current = window.NibbleNav.getPageUrl();
    if (!current || !/^https?:\/\//i.test(current)) {
      msg('Open a journey URL first — params are merged into the URL bar, not used to '
        + 'build one from scratch.', 'bad');
      return false;
    }
    let url;
    try {
      url = new URL(current);
    } catch {
      msg('The URL bar does not hold a URL this can be merged into.', 'bad');
      return false;
    }
    if (url.searchParams.get(name) === value) {
      msg(`${name} is already ${value}.`);
      return true;
    }
    url.searchParams.set(name, value);
    const next = url.toString();
    window.NibbleNav.setPageUrl(next);
    window.NibbleNav.navigate(next);
    msg(`Injected ${name}=${value}.`, 'ok');
    return true;
  }

  // The inverse of injectParam: drop the param from the URL bar and reload so the
  // change takes effect. Merge-not-rebuild still holds — only this one key is
  // removed, everything else in the query string survives.
  function removeParam(name) {
    const current = window.NibbleNav.getPageUrl();
    if (!current || !/^https?:\/\//i.test(current)) return false;
    let url;
    try {
      url = new URL(current);
    } catch {
      return false;
    }
    if (!url.searchParams.has(name)) {
      msg(`${name} is not in the URL.`);
      return true;
    }
    url.searchParams.delete(name);
    const next = url.toString();
    window.NibbleNav.setPageUrl(next);
    window.NibbleNav.navigate(next);
    msg(`Removed ${name} and reloaded.`, 'ok');
    return true;
  }

  // What the URL bar currently has, so a value can be shown as already applied.
  function appliedParams() {
    const out = new Map();
    const current = window.NibbleNav.getPageUrl();
    if (!current || !/^https?:\/\//i.test(current)) return out;
    try {
      for (const [k, v] of new URL(current).searchParams) out.set(k, v);
    } catch { /* not a URL yet */ }
    return out;
  }

  /* ---------------------------- custom (free-form) param ---------------------------- */

  // A confirmation line matching injectParam's green "Injected key=value." style, but
  // on its own element so it does not fight the routing-rule messages above it.
  function customMsg(text, kind) {
    customMsgEl.textContent = text;
    customMsgEl.className = `injectMsg ${kind || ''}`;
    customMsgEl.hidden = !text;
  }

  // The last key this injected, so clearing/renaming can pull the right param back
  // out of the URL rather than orphaning it.
  let lastCustomKey = '';

  // Reactive upsert: reuse injectParam / removeParam (the same setters the routing
  // "Use" / drop buttons call) so encoding, overwrite-not-duplicate and reload all
  // behave identically. URL.searchParams.set already percent-encodes key and value.
  function syncCustomParam() {
    const key = customKeyIn.value.trim();
    const value = customValueIn.value.trim();

    // Renamed the key? Drop the old one before writing the new, so no orphan is left.
    if (lastCustomKey && lastCustomKey !== key) {
      removeParam(lastCustomKey);
      lastCustomKey = '';
    }

    if (key && value) {
      // Silence injectParam's own message (it writes to msgEl) and mirror the result
      // into the custom line instead, so the styling matches "Injected orgId=…".
      if (injectParam(key, value)) {
        lastCustomKey = key;
        customMsg(`Injected ${key}=${value}.`, 'ok');
      } else {
        customMsg(msgEl.textContent || 'Could not inject — open a journey URL first.', 'bad');
      }
      renderParams();
      return;
    }

    // Either field empty: remove whatever this control last put in.
    if (lastCustomKey) {
      removeParam(lastCustomKey);
      lastCustomKey = '';
      renderParams();
    }
    customMsg('');
  }

  customKeyIn.addEventListener('input', syncCustomParam);
  customValueIn.addEventListener('input', syncCustomParam);

  // Offer every param the SDK accepts as a key suggestion, and — once a known key is
  // typed — that param's known values, both drawn from the tree the panel already
  // holds. Purely suggestions: any free-form key/value still injects.
  function fillCustomKeyOptions() {
    customKeyList.textContent = '';
    for (const p of (tree && tree.params) || []) {
      const o = document.createElement('option');
      o.value = p.name;
      if (p.description) o.label = p.description;
      customKeyList.appendChild(o);
    }
  }

  function fillCustomValueOptions() {
    const key = customKeyIn.value.trim().toLowerCase();
    customValueList.textContent = '';
    if (!key || !tree) return;
    for (const pv of tree.paramValues || []) {
      if (pv.param.toLowerCase() !== key) continue;
      const o = document.createElement('option');
      o.value = pv.value;
      customValueList.appendChild(o);
    }
  }

  customKeyIn.addEventListener('input', fillCustomValueOptions);

  /* ---------------------------- drawing ---------------------------- */

  function fillBundles() {
    const keep = bundleSel.value || localStorage.getItem(K.bundle) || '';
    bundleSel.textContent = '';
    for (const b of bundles()) {
      const routed = b.tenants.filter((t) => t.isActive).length;
      const o = document.createElement('option');
      o.value = String(b.id);
      // Only the routed ones are counted: including dead components would overstate
      // how many journeys the bundle can actually reach.
      o.textContent = `${b.name} (${routed})`;
      o.title = b.notes || '';
      bundleSel.appendChild(o);
    }
    if (keep && bundles().some((b) => String(b.id) === keep)) bundleSel.value = keep;
  }

  // Options, sorted alphabetically by tenant name (case-insensitive). Priority is
  // kept in the label because it explains routing order, but the user asked to find
  // a tenant by name, so name is the sort key, not priority.
  function tenantOptions() {
    const b = currentBundle();
    if (!b) return [];
    return b.tenants
      .map((t) => ({
        id: String(t.id),
        name: t.name,
        tag: !t.isActive ? '  [not routed]' : (t.isFallback ? '  [fallback]' : ''),
        label: `${t.priority}. ${t.name}${!t.isActive ? '  [not routed]' : (t.isFallback ? '  [fallback]' : '')}`,
      }))
      .sort((a, x) => a.name.toLowerCase().localeCompare(x.name.toLowerCase()));
  }

  function fillTenants() {
    const b = currentBundle();
    const keep = tenantSel.value || localStorage.getItem(K.tenant) || '';
    const opts = tenantOptions();
    // The hidden <select> is still the value contract the rest of the panel reads;
    // the combobox only drives it. Rebuild it in the sorted order.
    tenantSel.textContent = '';
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.id;
      el.textContent = o.label;
      tenantSel.appendChild(el);
    }
    if (keep && opts.some((o) => o.id === keep)) tenantSel.value = keep;
    else if (opts.length) tenantSel.value = opts[0].id;
    syncComboInput();
  }

  // Show the chosen tenant's label in the combo input when it is not being typed in.
  function syncComboInput() {
    const opt = tenantOptions().find((o) => o.id === tenantSel.value);
    if (document.activeElement !== tenantInput) tenantInput.value = opt ? opt.label : '';
  }

  function operatorHelp(op, param, value) {
    switch (op) {
      case 'EQUALS': return `${param} === "${value}"`;
      case 'NOT_EQUALS': return `Only routes here when ${param} is NOT "${value}"`;
      case 'CONTAINS_CI': return `${param}.toLowerCase().includes("${String(value).toLowerCase()}")`;
      case 'PRESENT': return `${param} is read, with no fixed value`;
      case 'ABSENT': return `${param} must not be in the URL`;
      default: return op;
    }
  }

  // Full text, as the query param it will become: `sdkVersion=v2`. A negation or an
  // absence is a condition, not a value you can set, so it says so instead.
  function valueRow(param, v, applied) {
    const row = document.createElement('div');
    row.className = 'tnVal';

    const op = document.createElement('span');
    op.className = `op ${v.operator}`;
    op.textContent = v.operator;
    op.title = operatorHelp(v.operator, param, v.value);
    row.appendChild(op);

    const kv = document.createElement('span');
    kv.className = 'kv';
    if (v.operator === 'PRESENT' || v.operator === 'ABSENT' || !v.value) {
      kv.textContent = param;
    } else {
      kv.appendChild(document.createTextNode(`${param}=`));
      const b = document.createElement('b');
      b.textContent = v.value;
      kv.appendChild(b);
    }
    row.appendChild(kv);

    const settable = (v.operator === 'EQUALS' || v.operator === 'CONTAINS_CI') && v.value;
    if (!settable) {
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = v.operator === 'NOT_EQUALS' ? 'must not be this'
        : (v.operator === 'ABSENT' ? 'must be absent' : 'no fixed value');
      row.appendChild(why);
      return row;
    }

    if (applied.get(param) === v.value) row.classList.add('applied');

    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'tiny';
    use.textContent = applied.get(param) === v.value ? 'In URL' : 'Use';
    use.title = `Inject ${param}=${v.value} into the URL bar`;
    use.addEventListener('click', () => {
      if (injectParam(param, v.value)) renderParams();
    });
    row.appendChild(use);

    // Once a value is in the URL, offer to take it back out. Reads from the live
    // URL, not this row, so it also clears a differing value the same param holds.
    if (applied.has(param)) {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'tiny drop';
      drop.textContent = '\u2715';
      drop.title = `Remove ${param} from the URL and reload`;
      drop.addEventListener('click', () => {
        if (removeParam(param)) renderParams();
      });
      row.appendChild(drop);
    }
    return row;
  }

  function paramBlock(group, applied) {
    const block = document.createElement('div');
    block.className = 'tnParam';

    const head = document.createElement('div');
    const nm = document.createElement('span');
    nm.className = 'tnName';
    nm.textContent = group.param;
    head.appendChild(nm);
    const ty = document.createElement('span');
    ty.className = 'tnType';
    ty.textContent = group.type || 'string';
    head.appendChild(ty);
    block.appendChild(head);

    // The param's own quirks belong to the param, not to every tenant that uses it.
    if (group.description) {
      const d = document.createElement('div');
      d.className = 'tnDesc';
      d.textContent = group.description;
      block.appendChild(d);
    }

    const list = document.createElement('div');
    list.className = 'tnVals';
    for (const v of group.values) list.appendChild(valueRow(group.param, v, applied));
    block.appendChild(list);
    return block;
  }

  function renderParams() {
    const t = currentTenant();
    const applied = appliedParams();

    paramsEl.textContent = '';
    otherEl.textContent = '';
    componentEl.textContent = t ? (t.component || '—') : '—';
    componentEl.classList.toggle('unset', !(t && t.component));

    notesEl.hidden = !(t && t.notes);
    notesEl.textContent = t && t.notes ? t.notes : '';

    if (!t) return;

    const routing = t.params.filter((g) => !NON_ROUTING.includes(g.param));
    const other = t.params.filter((g) => NON_ROUTING.includes(g.param));

    // A group matches if the query hits its name, description, or any of its
    // operator/value pairs — so "equals", "v2" or "orgId" all narrow the list.
    const groupMatches = (g, q) => {
      if (!q) return true;
      if (g.param.toLowerCase().includes(q)) return true;
      if ((g.description || '').toLowerCase().includes(q)) return true;
      return g.values.some((v) => `${v.operator} ${v.value || ''}`.toLowerCase().includes(q));
    };
    const rq = (paramsFilter.value || '').trim().toLowerCase();
    const oq = (otherFilter.value || '').trim().toLowerCase();
    const routingShown = routing.filter((g) => groupMatches(g, rq));
    const otherShown = other.filter((g) => groupMatches(g, oq));

    if (!routing.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      // The three reasons a tenant has no routing rules are different, and
      // conflating them would be misleading.
      p.textContent = !t.isActive
        ? 'This component exists in the repo but is not referenced by the routing, so no '
          + 'combination of params reaches it.'
        : (t.isFallback
          ? 'This is the fallback: it renders when no earlier tenant in the chain matches, '
            + 'so it has no routing rules of its own.'
          : 'No routing rules recorded for this tenant.');
      paramsEl.appendChild(p);
    } else if (!routingShown.length) {
      const p = document.createElement('p');
      p.className = 'tnEmpty';
      p.textContent = `No rules match "${rq}".`;
      paramsEl.appendChild(p);
    } else {
      for (const g of routingShown) paramsEl.appendChild(paramBlock(g, applied));
    }

    if (!other.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'None recorded for this tenant.';
      otherEl.appendChild(p);
    } else if (!otherShown.length) {
      const p = document.createElement('p');
      p.className = 'tnEmpty';
      p.textContent = `No params match "${oq}".`;
      otherEl.appendChild(p);
    } else {
      for (const g of otherShown) otherEl.appendChild(paramBlock(g, applied));
    }
  }

  function renderTenantRows() {
    const b = currentBundle();
    rowsEl.textContent = '';
    if (!b) return;

    const q = (rowsFilter.value || '').trim().toLowerCase();
    const shown = b.tenants.filter((t) =>
      !q || t.name.toLowerCase().includes(q) || String(t.priority).includes(q));

    if (!shown.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'tnEmpty';
      td.textContent = `No tenants match "${q}".`;
      tr.appendChild(td);
      rowsEl.appendChild(tr);
      return;
    }

    for (const t of shown) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = t.name;      // textContent: tenant names are user input
      if (!t.isActive) tdName.style.color = 'var(--muted)';
      const tdPrio = document.createElement('td');
      tdPrio.className = 'mono';
      tdPrio.textContent = String(t.priority);

      const tdEdit = document.createElement('td');
      tdEdit.className = 'act';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'tiny';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => startEdit(t));
      tdEdit.appendChild(edit);

      const tdDel = document.createElement('td');
      tdDel.className = 'act';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tiny';
      del.textContent = '\u2715';
      del.title = `Delete ${t.name}`;
      del.addEventListener('click', async () => {
        const sure = await window.NibbleUI.confirm({
          title: 'Delete this tenant?',
          message: `"${t.name}" and all ${t.params.reduce((n, g) => n + g.values.length, 0)} `
                 + 'of its routing values will be removed. This cannot be undone.',
          confirmLabel: 'Delete',
        });
        if (!sure) return;
        if (apply(await nb.tenant.remove(t.id))) msg(`Deleted "${t.name}".`, 'ok');
      });
      tdDel.appendChild(del);

      tr.append(tdName, tdPrio, tdEdit, tdDel);
      rowsEl.appendChild(tr);
    }
  }

  function redraw() {
    fillBundles();
    fillTenants();
    renderParams();
    renderTenantRows();
    fillCustomKeyOptions();
  }

  // Every call answers with the whole tree, so one function handles them all.
  function apply(res) {
    if (res && res.ok) {
      tree = res;
      redraw();
      return true;
    }
    msg((res && res.error) || 'Something went wrong.', 'bad');
    return false;
  }

  /* ---------------------------- tenant rows ---------------------------- */

  function setMode(editing) {
    saveCell.colSpan = editing ? 1 : 2;
    cancelCell.hidden = !editing;
    formRow.classList.toggle('editing', editing);
  }

  function resetForm() {
    editingId = null;
    nameIn.value = '';
    prioIn.value = '';
    setMode(false);
  }

  function startEdit(t) {
    editingId = t.id;
    nameIn.value = t.name;
    prioIn.value = String(t.priority);
    setMode(true);
    msg(`Editing "${t.name}".`);
    nameIn.focus();
    nameIn.select();
  }

  saveBtn.addEventListener('click', async () => {
    const b = currentBundle();
    if (!b) return;
    const row = {
      name: nameIn.value,
      priority: prioIn.value,
      bundle: b.name,
      component: editingId === null ? '' : (currentTenant() || {}).component || '',
    };
    const res = editingId === null
      ? await nb.tenant.add(row)
      : await nb.tenant.update({ ...row, id: editingId });
    if (apply(res)) {
      const what = editingId === null ? 'Added' : 'Updated';
      const label = row.name.trim();
      resetForm();
      msg(`${what} "${label}".`, 'ok');
    }
  });

  cancelBtn.addEventListener('click', () => { resetForm(); msg(''); });

  for (const input of [nameIn, prioIn]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      if (e.key === 'Escape' && editingId !== null) { e.stopPropagation(); resetForm(); msg(''); }
    });
  }

  exportBtn.addEventListener('click', async () => {
    const original = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Saving…';
    try {
      const res = await nb.tenant.exportSeed();
      if (res && res.error) window.NibbleUI.toast(res.error, { bad: true });
      else if (res && res.path) window.NibbleUI.toast(`Seed file saved → ${res.path}`, { filePath: res.path });
    } catch (err) {
      window.NibbleUI.toast(`Export failed: ${err.message}`, { bad: true });
    } finally {
      exportBtn.textContent = original;
      exportBtn.disabled = false;
    }
  });

  /* ---------------------------- wiring ---------------------------- */

  bundleSel.addEventListener('change', () => {
    localStorage.setItem(K.bundle, bundleSel.value);
    tenantSel.value = '';
    resetForm();
    fillTenants();
    renderParams();
    renderTenantRows();
  });

  tenantSel.addEventListener('change', () => {
    localStorage.setItem(K.tenant, tenantSel.value);
    renderParams();
    // Picking a tenant injects the rules that have exactly one possible value, since
    // those are unambiguous. Anything with a choice is left to a Use click.
    const t = currentTenant();
    if (!t) return;
    const singles = t.params.filter((g) => !NON_ROUTING.includes(g.param)
      && g.values.length === 1
      && (g.values[0].operator === 'EQUALS' || g.values[0].operator === 'CONTAINS_CI')
      && g.values[0].value);
    let applied = 0;
    for (const g of singles) {
      const current = window.NibbleNav.getPageUrl();
      if (!current || !/^https?:\/\//i.test(current)) break;
      try {
        const url = new URL(current);
        if (url.searchParams.get(g.param) === g.values[0].value) continue;
        url.searchParams.set(g.param, g.values[0].value);
        const next = url.toString();
        window.NibbleNav.setPageUrl(next);
        applied++;
      } catch { break; }
    }
    if (applied) {
      window.NibbleNav.navigate(window.NibbleNav.getPageUrl());
      msg(`Injected ${applied} unambiguous param(s) for "${t.name}".`, 'ok');
    }
    renderParams();
    syncComboInput();
  });

  /* ---------------------------- tenant combobox ---------------------------- */
  // A type-to-filter dropdown over the hidden <select>. activeIdx tracks the
  // keyboard-highlighted option so Enter picks it.
  let comboOpen = false;
  let activeIdx = -1;

  function chooseTenant(id) {
    if (tenantSel.value !== id) {
      tenantSel.value = id;
      tenantSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeCombo();
    // Blur first so syncComboInput (which leaves a focused input alone, to not
    // overwrite what is being typed) will write the chosen label back in.
    tenantInput.blur();
    syncComboInput();
  }

  function openCombo() {
    comboOpen = true;
    tenantInput.setAttribute('aria-expanded', 'true');
    tenantList.hidden = false;
    renderComboList();
  }

  function closeCombo() {
    comboOpen = false;
    activeIdx = -1;
    tenantInput.setAttribute('aria-expanded', 'false');
    tenantList.hidden = true;
  }

  // Filter is a plain case-insensitive substring on the label, so "mobi", "21" or
  // "fallback" all narrow it. Only filters while the input is being typed in; an
  // untouched input shows the whole (sorted) list.
  function filteredOptions() {
    const typed = document.activeElement === tenantInput ? tenantInput.value.trim().toLowerCase() : '';
    const sel = tenantSel.value;
    const all = tenantOptions();
    // If the input still equals the chosen label, treat it as "no filter" so the
    // list opens on the full set rather than just the current pick.
    const chosenLabel = (all.find((o) => o.id === sel) || {}).label || '';
    const q = (typed && typed !== chosenLabel.toLowerCase()) ? typed : '';
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  }

  function renderComboList() {
    const opts = filteredOptions();
    tenantList.textContent = '';
    if (!opts.length) {
      const e = document.createElement('div');
      e.className = 'comboEmpty';
      e.textContent = 'No tenants match.';
      tenantList.appendChild(e);
      return;
    }
    if (activeIdx >= opts.length) activeIdx = opts.length - 1;
    opts.forEach((o, i) => {
      const el = document.createElement('div');
      el.className = 'comboOpt';
      el.setAttribute('role', 'option');
      if (o.id === tenantSel.value) el.classList.add('chosen');
      if (i === activeIdx) el.classList.add('active');
      // Priority + name in normal ink, the [fallback]/[not routed] tag muted.
      el.appendChild(document.createTextNode(`${o.label.replace(o.tag, '')}`));
      if (o.tag) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = o.tag;
        el.appendChild(t);
      }
      // mousedown, not click: click fires after the input's blur, which would have
      // already closed the list.
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); chooseTenant(o.id); });
      tenantList.appendChild(el);
    });
  }

  tenantInput.addEventListener('focus', () => { openCombo(); tenantInput.select(); });
  tenantInput.addEventListener('input', () => { activeIdx = -1; if (!comboOpen) openCombo(); else renderComboList(); });
  tenantInput.addEventListener('blur', () => {
    // A mousedown on an option handles selection before this runs; here we just
    // close and restore the chosen label if the user typed and clicked away.
    setTimeout(() => { closeCombo(); syncComboInput(); }, 0);
  });
  tenantInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!comboOpen) return openCombo();
      const n = filteredOptions().length;
      if (!n) return;
      activeIdx = e.key === 'ArrowDown'
        ? (activeIdx + 1) % n
        : (activeIdx - 1 + n) % n;
      renderComboList();
      const active = tenantList.querySelector('.comboOpt.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opts = filteredOptions();
      const pick = activeIdx >= 0 ? opts[activeIdx] : opts[0];
      if (pick) chooseTenant(pick.id);
    } else if (e.key === 'Escape') {
      if (comboOpen) { e.stopPropagation(); closeCombo(); syncComboInput(); tenantInput.blur(); }
    }
  });

  reloadBtn.addEventListener('click', async () => { apply(await nb.tenant.list()); });

  // Each filter redraws only the list it governs, so typing in one does not reset
  // another.
  paramsFilter.addEventListener('input', () => { renderParams(); });
  otherFilter.addEventListener('input', () => { renderParams(); });
  rowsFilter.addEventListener('input', () => { renderTenantRows(); });

  resetForm();
  (async () => { apply(await nb.tenant.list()); })();
})();
