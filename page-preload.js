// page-preload.js
// Runs in the consent-journey page (the WebContentsView) BEFORE any of the
// page's own scripts load — including the embedded FIU consent SDK iframe.
//
// IMPORTANT (frame topology): an Electron preload runs in EVERY frame that has
// a real `src` (main frame AND nested iframes), not just the top document.
// It is NOT injected into `about:blank` / srcdoc iframes. Because of this we
// register the message listener in whichever frame this preload happens to be
// running in — so no matter whether the SDK's window.parent resolves to the
// page-view top document or to an intermediate iframe, SOME preloaded frame
// receives the postMessage.
//
// The SDK inside its iframe emits events via:
//     window.parent.postMessage(JSON.stringify(payload), '*')

(function installSdkEventListener() {
  // --- Step 1: report the frame topology at registration time ---
  // window === window.top  -> true means we are the top document of the view.
  // If false, we are inside a nested iframe.
  const isTop = (window === window.top);
  const here = (() => {
    try { return location.href; } catch { return '(cross-origin href blocked)'; }
  })();

  const frameTag = isTop ? 'TOP' : 'SUBFRAME';
  console.log(
    `[SDK Event] listener installed in ${frameTag} frame`,
    '| window===window.top:', isTop,
    '| location.href:', here,
  );

  // Shared review buffers. These are per-frame globals; you should read them in
  // the DevTools console of the SAME frame that logged the events (use the
  // frame dropdown at the top of the Console panel to switch frames).
  if (!window.__sdkEvents) window.__sdkEvents = [];

  window.addEventListener('message', (event) => {
    // The SDK sends a JSON string. Other sources (React devtools, webpack HMR,
    // etc.) also post messages, so parse defensively and ignore non-JSON.
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return; // not our JSON payload — ignore
    }

    // Guard: only treat objects as SDK events (a bare JSON number/string like
    // JSON.parse('5') would otherwise slip through).
    if (parsed === null || typeof parsed !== 'object') return;

    const ts = new Date().toISOString();

    // --- Step 3: eventCode prominent + timestamp, then the full object ---
    console.log(
      '[SDK Event]',
      parsed.eventCode || '(no eventCode)',
      '@', ts,
      parsed,
      '| origin:', event.origin,
      '| frame:', frameTag,
    );

    // --- Step 4: keep last event + push into a reviewable sequence ---
    const record = { ts, origin: event.origin, frame: frameTag, parsed };
    window.__lastSdkEvent = record;   // inspect the most recent event
    window.__sdkEvents.push(record);  // full sequence: window.__sdkEvents
  });
})();
