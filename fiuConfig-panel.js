// fiuConfig-panel.js
// Reads the ?fiuConfig= base64-encoded query param from the active page's URL,
// decodes it to JSON, displays it in an editable editor, validates changes, and
// re-encodes + applies the edited value back to the URL on demand.
//
// Decoding:
//   fiuConfig is standard base64 (sometimes URL-safe: - → +, _ → /), and may
//   carry URL-encoding on the = padding (i.e. %3D or %3D%3D at the end).
//   atob() handles all of that after we normalise the alphabet and padding.
//
// Re-encoding:
//   btoa() produces standard base64.  The SDK accepts that without issues, so
//   we do not convert back to URL-safe base64 — the browser's own URLSearchParams
//   will percent-encode any + or = that need it.

(function fiuConfigPanel() {

  /* ── element refs ─────────────────────────────────────────────────── */
  const editor    = document.getElementById('fiuEditor');
  const gutter    = document.getElementById('fiuGutter');
  const errEl     = document.getElementById('fiuErr');
  const statusEl  = document.getElementById('fiuStatus');
  const applyBtn  = document.getElementById('fiuApply');

  /* ── base64url decoding ───────────────────────────────────────────── */

  /**
   * Decode a base64 / base64url string to a plain UTF-8 string.
   *
   * Handles:
   *   • URL-safe alphabet  (- → +, _ → /)
   *   • URL-encoded padding (%3D → =)
   *   • Missing padding     (pads to a multiple of 4)
   *   • UTF-8 content       (decoded via TextDecoder / decodeURIComponent trick)
   *
   * Returns the decoded string, or throws a descriptive Error on failure.
   */
  function decodeBase64(raw) {
    // 1. Percent-decode any %-sequences (e.g. %3D for padding '=')
    let s;
    try {
      s = decodeURIComponent(raw);
    } catch {
      s = raw; // not percent-encoded at all — that is fine
    }

    // 2. Normalise URL-safe alphabet to standard base64
    s = s.replace(/-/g, '+').replace(/_/g, '/');

    // 3. Restore any stripped padding
    const pad = s.length % 4;
    if (pad === 2) s += '==';
    else if (pad === 3) s += '=';

    // 4. Decode.  atob() only handles Latin-1, but the JSON here is ASCII-safe.
    //    If it ever contains non-ASCII characters we use the escape trick to get
    //    proper UTF-8.
    let bytes;
    try {
      bytes = atob(s);
    } catch (err) {
      throw new Error(`base64 decode failed: ${err.message}`);
    }

    // 5. UTF-8 → string via percent-encoding roundtrip (handles multi-byte chars)
    try {
      return decodeURIComponent(
        bytes.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
      );
    } catch {
      // Fallback: the content is ASCII, return as-is
      return bytes;
    }
  }

  /**
   * Encode a plain UTF-8 string to standard base64.
   * btoa() chokes on code points > 255, so we percent-encode first.
   */
  function encodeBase64(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      ),
    );
  }

  /* ── gutter sync ──────────────────────────────────────────────────── */

  function syncGutter() {
    const lines = editor.value.split('\n').length;
    let out = '';
    for (let i = 1; i <= lines; i++) out += i + '\n';
    gutter.textContent = out || '1';
    gutter.scrollTop = editor.scrollTop;
  }

  editor.addEventListener('input', () => {
    syncGutter();
    errEl.textContent = '';     // clear previous error on any edit
  });
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });

  /* ── status helpers ───────────────────────────────────────────────── */

  function setStatus(text, kind /* 'ok' | 'bad' | 'warn' | '' */) {
    statusEl.textContent = text;
    statusEl.className = 'fiuStatus' + (kind ? ' ' + kind : '');
  }

  function setErr(text) {
    errEl.textContent = text;
  }

  /* ── load fiuConfig from the active page URL ──────────────────────── */

  async function loadFromUrl() {
    setStatus('Reading URL…', '');
    setErr('');
    editor.value = '';
    syncGutter();

    // Use the live URL of the page view (what the address bar shows after any
    // redirect), falling back to whatever the bar currently says.
    let raw = '';
    try {
      raw = (await window.nibble.currentUrl()) || '';
    } catch {
      raw = String(window.NibbleNav ? window.NibbleNav.getPageUrl() || '' : '');
    }

    if (!raw) {
      setStatus('No URL loaded yet.', 'warn');
      return;
    }

    // Parse the URL.  The top bar may hold a bare path or a relative URL while
    // the page is still navigating; guard against that.
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://placeholder/' + raw);
    } catch {
      setStatus('URL could not be parsed.', 'bad');
      return;
    }

    const encoded = u.searchParams.get('fiuConfig');
    if (!encoded) {
      setStatus('No fiuConfig param in URL.', 'warn');
      editor.value = '';
      syncGutter();
      return;
    }

    let decoded;
    try {
      decoded = decodeBase64(encoded);
    } catch (err) {
      setStatus('Decode failed.', 'bad');
      setErr(err.message);
      return;
    }

    // Pretty-print the JSON so it is immediately readable.
    let pretty;
    try {
      pretty = JSON.stringify(JSON.parse(decoded), null, 2);
    } catch {
      // Not JSON — show as-is (rare: the SDK always sends JSON here).
      pretty = decoded;
      setStatus('Decoded (not valid JSON).', 'warn');
      editor.value = pretty;
      syncGutter();
      return;
    }

    editor.value = pretty;
    syncGutter();
    setStatus('Loaded ✓', 'ok');
  }

  /* ── validate JSON in the editor ─────────────────────────────────── */

  /**
   * Returns { ok: true, parsed } or { ok: false, message }.
   * Checks for:
   *   • Empty editor
   *   • JSON.parse failure (catches any syntax error, missing brackets, etc.)
   */
  function validateEditor() {
    const text = editor.value.trim();
    if (!text) {
      return { ok: false, message: 'Editor is empty — nothing to apply.' };
    }
    try {
      const parsed = JSON.parse(text);
      return { ok: true, parsed };
    } catch (err) {
      return { ok: false, message: 'Invalid JSON: ' + err.message };
    }
  }

  /* ── apply: re-encode and reload ─────────────────────────────────── */

  applyBtn.addEventListener('click', async () => {
    setErr('');

    const { ok, parsed, message } = validateEditor();
    if (!ok) {
      setErr(message);
      return;
    }

    // Re-serialise to a compact canonical form, then base64-encode.
    const canonical = JSON.stringify(parsed);
    let encoded;
    try {
      encoded = encodeBase64(canonical);
    } catch (err) {
      setErr('Encode failed: ' + err.message);
      return;
    }

    // Get the live URL to patch.
    let raw = '';
    try {
      raw = (await window.nibble.currentUrl()) || '';
    } catch {
      raw = String(window.NibbleNav ? window.NibbleNav.getPageUrl() || '' : '');
    }

    if (!raw) {
      setErr('No URL in the top bar to patch.');
      return;
    }

    let u;
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://placeholder/' + raw);
    } catch {
      setErr('Current URL could not be parsed.');
      return;
    }

    // Replace (or add) fiuConfig.
    u.searchParams.set('fiuConfig', encoded);
    const next = u.toString();

    // Push the URL back to the top bar and navigate.
    try {
      window.NibbleNav.setPageUrl(next);
      window.NibbleNav.navigate(next);
      setStatus('Applied & reloading…', 'ok');
      setErr('');
    } catch (err) {
      setErr('Navigation failed: ' + err.message);
    }
  });

  /* ── auto-load when the tab becomes active ────────────────────────── */

  // The tab switching in api-panel.js toggles [data-pane] visibility.
  // We watch for our pane becoming visible and reload automatically.
  const pane = document.querySelector('[data-pane="fiuconfig"]');
  if (pane) {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'hidden') {
          if (!pane.hidden) loadFromUrl();
        }
      }
    });
    obs.observe(pane, { attributes: true });
  }

  // Also reload when the page navigates while our tab is already visible,
  // so a URL change is reflected without a manual Refresh click.
  if (window.nibble && window.nibble.onNavigated) {
    window.nibble.onNavigated(() => {
      if (pane && !pane.hidden) loadFromUrl();
    });
  }

  // Initial state message — we don't auto-load on startup, only when the user
  // opens the tab, to avoid an unnecessary IPC call at boot.
  setStatus('Open this tab to load.', '');
  syncGutter();

})();
