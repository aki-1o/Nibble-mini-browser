// aa-mapping.js — the AA mapping panel: add / edit / delete rows in aa_mapping,
// and download the database or the migration that seeds it.
//
// This runs in the WINDOW, which has no Node and therefore no database access.
// It only calls window.nibble.aaMap.* / window.nibble.db.* (see preload.js) and
// draws what comes back. Every one of those calls is async.

(function aaMapping() {
  const nb = window.nibble;

  const nameIn    = document.getElementById('mapName');
  const aaIdIn    = document.getElementById('mapAaId');
  const saveBtn   = document.getElementById('mapSave');
  const cancelBtn = document.getElementById('mapCancel');
  const saveCell  = document.getElementById('mapSaveCell');
  const cancelCell = document.getElementById('mapCancelCell');
  const formRow   = document.getElementById('mapFormRow');
  const msgEl     = document.getElementById('mapMsg');
  const rowsEl    = document.getElementById('mapRows');
  const dlDbBtn   = document.getElementById('mapDlDb');

  // null = the row at the bottom of the table is adding. A number = it is editing
  // that row id. One row does both jobs, so there is no second form to keep in
  // sync and no way for the two to disagree about what is being saved.
  let editingId = null;

  function msg(text, kind) {
    msgEl.textContent = text;
    msgEl.className = `injectMsg ${kind || ''}`;
    msgEl.hidden = !text;
  }

  // Adding: Save spans both action columns, so it is exactly as wide as the Edit
  // and ✕ buttons above it. Editing: the span drops to one and Cancel takes the
  // other, keeping the same total width.
  function setMode(editing) {
    saveCell.colSpan = editing ? 1 : 2;
    cancelCell.hidden = !editing;
    formRow.classList.toggle('editing', editing);
    // The label stays "Save" either way: the cell is narrow, and Cancel appearing
    // beside it is the clearer signal that the row is editing rather than adding.
    saveBtn.title = editing ? 'Save changes to this AA' : 'Add this AA';
  }

  function resetForm() {
    editingId = null;
    nameIn.value = '';
    aaIdIn.value = '';
    nameIn.placeholder = 'AA name';
    aaIdIn.placeholder = 'accountAggregatorId';
    setMode(false);
  }

  function startEdit(row) {
    editingId = row.id;
    nameIn.value = row.name;
    aaIdIn.value = row.aaId;
    setMode(true);
    msg(`Editing "${row.name}".`);
    nameIn.focus();
    nameIn.select();
  }

  function render(rows) {
    rowsEl.textContent = '';

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'hint';
      td.textContent = 'No AAs yet — add one below.';
      tr.appendChild(td);
      rowsEl.appendChild(tr);
      return;
    }

    for (const row of rows) {
      const tr = document.createElement('tr');

      // textContent, never innerHTML — an AA name is user input and must not be
      // parsed as markup.
      const tdName = document.createElement('td');
      tdName.textContent = row.name;

      const tdId = document.createElement('td');
      tdId.className = 'mono';
      tdId.textContent = row.aaId;

      const tdEdit = document.createElement('td');
      tdEdit.className = 'act';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'tiny';
      edit.textContent = 'Edit';
      edit.title = `Edit ${row.name}`;
      // The row object is captured here, so the handler always edits the values
      // as they were drawn, even after the list is redrawn around it.
      edit.addEventListener('click', () => startEdit(row));
      tdEdit.appendChild(edit);

      const tdDel = document.createElement('td');
      tdDel.className = 'act';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tiny';
      del.textContent = '\u2715';
      del.title = `Delete ${row.name}`;
      del.addEventListener('click', async () => {
        // NibbleUI.confirm, not window.confirm: Chromium's own dialog ignores the
        // app theme, and deleting a mapping cannot be undone.
        const sure = await window.NibbleUI.confirm({
          title: 'Delete this AA mapping?',
          message: `"${row.name}" (${row.aaId}) will be removed from the AA list. `
                 + 'This cannot be undone.',
          confirmLabel: 'Delete',
        });
        if (!sure) return;

        if (apply(await nb.aaMap.remove(row.id))) {
          if (editingId === row.id) resetForm();
          msg(`Deleted "${row.name}".`, 'ok');
        }
      });
      tdDel.appendChild(del);

      tr.append(tdName, tdId, tdEdit, tdDel);
      rowsEl.appendChild(tr);
    }
  }

  // db.js answers every call with the same shape, so one function handles all
  // four: redraw on success, show the reason on failure.
  function apply(res) {
    if (res && res.ok) {
      render(res.rows);
      // Rebuild the AA tab's dropdown from the new list, so the two panels can
      // never disagree about which AAs exist, and refresh the Database panel if
      // it happens to be the one on screen.
      if (typeof window.__nibbleAaReload === 'function') window.__nibbleAaReload();
      if (typeof window.__nibbleDbReload === 'function') window.__nibbleDbReload();
      return true;
    }
    msg((res && res.error) || 'Something went wrong.', 'bad');
    return false;
  }

  saveBtn.addEventListener('click', async () => {
    const row = { name: nameIn.value, aaId: aaIdIn.value };

    // The only difference between add and edit: whether an id goes along.
    const res = editingId === null
      ? await nb.aaMap.add(row)
      : await nb.aaMap.update({ ...row, id: editingId });

    if (apply(res)) {
      const what = editingId === null ? 'Added' : 'Updated';
      const label = row.name.trim();
      resetForm();
      msg(`${what} "${label}".`, 'ok');
      nameIn.focus();
    }
  });

  cancelBtn.addEventListener('click', () => { resetForm(); msg(''); });

  for (const input of [nameIn, aaIdIn]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      // Escape only means "stop editing"; in add mode there is nothing to cancel.
      if (e.key === 'Escape' && editingId !== null) {
        e.stopPropagation();
        resetForm();
        msg('');
      }
    });
  }

  /* ---------------------------- download ---------------------------- */
  // Answers { path } or { error }, the same shape as the HAR export, so the
  // toast in renderer.js shows it too.
  async function download(btn, call, label) {
    if (btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await call();
      if (res && res.error) {
        window.NibbleUI.toast(res.error, { bad: true });
      } else if (res && res.path) {
        window.NibbleUI.toast(`${label} saved → ${res.path}`, { filePath: res.path });
      }
    } catch (err) {
      window.NibbleUI.toast(`${label} failed: ${err.message}`, { bad: true });
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  dlDbBtn.addEventListener('click', () => download(dlDbBtn, () => nb.db.exportDb(), 'Database'));

  // Draw the saved list once at startup.
  resetForm();
  (async () => { apply(await nb.aaMap.list()); })();
})();
