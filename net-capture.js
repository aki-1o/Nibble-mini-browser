// net-capture.js
// Per-tab network recording over the Chrome DevTools Protocol, plus HAR 1.2
// export.
//
// WHY CDP AND NOT session.webRequest: webRequest gives neither timings nor
// response bodies. A WAF returning HTTP 200 with an HTML block page was the key
// evidence in a real bug here, so capturing the body is a hard requirement.
//
// SENSITIVE OUTPUT: exported HAR files contain full request/response data —
// `ecreq` payloads, bearer tokens, cookies and consent identifiers. They are
// written locally and never uploaded, and there is intentionally no redaction
// yet. Treat the files as secrets.

const MAX_ENTRIES = 500;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB of captured bodies per tab

// Bodies above this are recorded as a placeholder instead — one huge response
// would otherwise blow the whole per-tab budget.
const MAX_SINGLE_BODY = 8 * 1024 * 1024;

const headerArray = (headers) =>
  Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));

function queryStringOf(url) {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function httpVersionOf(protocol) {
  if (!protocol) return '';
  const p = String(protocol).toLowerCase();
  if (p === 'h2' || p === 'h2c') return 'HTTP/2.0';
  if (p.startsWith('h3')) return 'HTTP/3.0';
  if (p === 'http/1.1' || p === 'http/1.0') return p.toUpperCase();
  return protocol;
}

// CDP timings are offsets in ms from response.timing.requestTime (seconds).
function harTimings(timing, finishedTimestamp) {
  if (!timing) {
    return { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 0 };
  }
  const span = (a, b) => (a >= 0 && b >= 0 && b >= a ? b - a : -1);

  const dns = span(timing.dnsStart, timing.dnsEnd);
  const connect = span(timing.connectStart, timing.connectEnd);
  const ssl = span(timing.sslStart, timing.sslEnd);
  const send = Math.max(0, span(timing.sendStart, timing.sendEnd));
  const wait = Math.max(0, span(timing.sendEnd, timing.receiveHeadersEnd));

  let blocked = -1;
  for (const first of [timing.dnsStart, timing.connectStart, timing.sendStart]) {
    if (first >= 0) { blocked = Math.max(0, first); break; }
  }

  let receive = 0;
  if (typeof finishedTimestamp === 'number' && typeof timing.requestTime === 'number') {
    const totalMs = Math.max(0, (finishedTimestamp - timing.requestTime) * 1000);
    receive = Math.max(0, totalMs - Math.max(0, timing.receiveHeadersEnd));
  }

  return { blocked, dns, connect, ssl, send, wait, receive };
}

const timingsTotal = (t) =>
  ['blocked', 'dns', 'connect', 'send', 'wait', 'receive']
    .reduce((sum, k) => sum + (t[k] > 0 ? t[k] : 0), 0);

class TabCapture {
  /**
   * @param {Electron.WebContents} contents
   * @param {() => void} onUpdate called whenever the visible state changes
   */
  constructor(contents, onUpdate) {
    this.contents = contents;
    this.onUpdate = onUpdate || (() => {});

    this.entries = [];              // finished HAR entries
    this.pending = new Map();       // CDP requestId -> partial entry
    this.bytes = 0;
    this.dropped = 0;

    this.attached = false;
    this.unavailableReason = null;  // string when capture cannot run
    this.pageStartedAt = null;      // Date of the current page load
    this.pageUrl = '';

    this.onMessage = this.onMessage.bind(this);
    this.onDetach = this.onDetach.bind(this);
  }

  get count() {
    return this.entries.length;
  }

  get available() {
    return this.attached;
  }

  /** Attach the debugger and switch the Network domain on. */
  attach() {
    if (this.attached) return true;
    const dbg = this.contents.debugger;
    try {
      dbg.attach('1.3');
    } catch (err) {
      // Chromium allows several debugger clients per target, so an open DevTools
      // window is not a problem by itself; this is only reached if we somehow
      // attach twice, or the target is gone.
      this.attached = false;
      this.unavailableReason = /already attached|another debugger/i.test(err.message)
        ? 'HAR capture could not attach: another debugger already holds this tab.'
        : `HAR capture unavailable: ${err.message}`;
      this.onUpdate();
      return false;
    }

    dbg.removeListener('message', this.onMessage);
    dbg.removeListener('detach', this.onDetach);
    dbg.on('message', this.onMessage);
    dbg.on('detach', this.onDetach);

    this.attached = true;
    this.unavailableReason = null;

    // NOTE: this command does not resolve when the debugger was attached before
    // the tab has loaded anything — which is exactly when capture starts, so
    // that is the normal case. It still takes effect (events arrive for the
    // first load), so the promise is deliberately not awaited and a rejection is
    // the only thing worth reacting to. Treating "never resolved" as failure
    // here would disable capture on every tab.
    dbg.sendCommand('Network.enable', {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 20 * 1024 * 1024,
    }).catch((err) => {
      this.attached = false;
      this.unavailableReason = `Network.enable failed: ${err.message}`;
      this.onUpdate();
    });

    this.onUpdate();
    return true;
  }

  detach(reason) {
    if (!this.attached) return;
    try {
      this.contents.debugger.detach();
    } catch { /* already gone */ }
    this.attached = false;
    this.unavailableReason = reason || null;
    this.onUpdate();
  }

  onDetach(event, reason) {
    this.attached = false;
    this.unavailableReason = reason === 'target closed'
      ? 'Tab is closing.'
      : `HAR capture stopped: the debugger was detached (${reason || 'unknown reason'}).`;
    this.onUpdate();
  }

  /** One export = one page load, so wipe on each top-level navigation. */
  startNewPage(url) {
    this.entries = [];
    this.pending.clear();
    this.bytes = 0;
    this.dropped = 0;
    this.pageStartedAt = new Date();
    this.pageUrl = url || '';
    this.onUpdate();
  }

  enforceCaps() {
    let changed = false;
    while (this.entries.length > MAX_ENTRIES) {
      const gone = this.entries.shift();
      this.bytes -= gone.__bodyBytes || 0;
      this.dropped++;
      changed = true;
    }
    while (this.bytes > MAX_BYTES && this.entries.length > 1) {
      const gone = this.entries.shift();
      this.bytes -= gone.__bodyBytes || 0;
      this.dropped++;
      changed = true;
    }
    if (this.bytes < 0) this.bytes = 0;
    return changed;
  }

  onMessage(event, method, params) {
    switch (method) {
      case 'Network.requestWillBeSent': return this.onRequest(params);
      case 'Network.responseReceived': return this.onResponse(params);
      case 'Network.loadingFinished': return this.onFinished(params);
      case 'Network.loadingFailed': return this.onFailed(params);
      default: return undefined;
    }
  }

  onRequest(p) {
    // A redirect arrives as a new requestWillBeSent carrying the previous
    // response; close the old hop off so the chain is preserved.
    if (p.redirectResponse) {
      const prev = this.pending.get(p.requestId);
      if (prev) {
        prev.response = p.redirectResponse;
        prev.finishedTimestamp = p.timestamp;
        prev.redirectURL = p.redirectResponse.headers
          ? (p.redirectResponse.headers.Location || p.redirectResponse.headers.location || '')
          : '';
        this.commit(prev, null);
      }
    }

    this.pending.set(p.requestId, {
      requestId: p.requestId,
      request: p.request || {},
      type: p.type || '',
      wallTime: p.wallTime,
      timestamp: p.timestamp,
      response: null,
      finishedTimestamp: null,
      encodedDataLength: 0,
      error: null,
      redirectURL: '',
    });
  }

  onResponse(p) {
    const e = this.pending.get(p.requestId);
    if (!e) return;
    e.response = p.response || null;
    e.type = p.type || e.type;
  }

  async onFinished(p) {
    const e = this.pending.get(p.requestId);
    if (!e) return;
    this.pending.delete(p.requestId);
    e.finishedTimestamp = p.timestamp;
    e.encodedDataLength = p.encodedDataLength || 0;

    let body = null;
    try {
      const res = await this.contents.debugger.sendCommand('Network.getResponseBody', {
        requestId: p.requestId,
      });
      body = { text: res.body, base64Encoded: Boolean(res.base64Encoded) };
    } catch {
      // Normal for redirects, 204s, and anything already evicted from the
      // renderer's buffer — the entry is still worth keeping without a body.
      body = null;
    }
    this.commit(e, body);
  }

  onFailed(p) {
    const e = this.pending.get(p.requestId);
    if (!e) return;
    this.pending.delete(p.requestId);
    e.finishedTimestamp = p.timestamp;
    e.error = p.errorText || 'failed';
    this.commit(e, null);
  }

  commit(e, body) {
    const req = e.request || {};
    const res = e.response || {};
    const timings = harTimings(res.timing, e.finishedTimestamp);

    let text = body ? body.text : undefined;
    let encoding = body && body.base64Encoded ? 'base64' : undefined;
    let bodyBytes = text ? Buffer.byteLength(text, encoding === 'base64' ? 'base64' : 'utf8') : 0;

    if (bodyBytes > MAX_SINGLE_BODY) {
      text = `[body omitted by Nibble: ${bodyBytes} bytes exceeds the per-response cap]`;
      encoding = undefined;
      bodyBytes = Buffer.byteLength(text, 'utf8');
    }

    const startedDateTime = typeof e.wallTime === 'number'
      ? new Date(e.wallTime * 1000).toISOString()
      : new Date().toISOString();

    const entry = {
      startedDateTime,
      time: timingsTotal(timings),
      request: {
        method: req.method || 'GET',
        url: req.url || '',
        httpVersion: httpVersionOf(res.protocol),
        cookies: [],
        headers: headerArray(req.headers),
        queryString: queryStringOf(req.url || ''),
        headersSize: -1,
        bodySize: req.postData ? Buffer.byteLength(req.postData, 'utf8') : 0,
        ...(req.postData
          ? {
            postData: {
              mimeType: (req.headers && (req.headers['Content-Type'] || req.headers['content-type'])) || '',
              text: req.postData,
            },
          }
          : {}),
      },
      response: {
        status: res.status || (e.error ? 0 : 0),
        statusText: res.statusText || (e.error ? e.error : ''),
        httpVersion: httpVersionOf(res.protocol),
        cookies: [],
        headers: headerArray(res.headers),
        content: {
          size: bodyBytes || (res.encodedDataLength || 0),
          mimeType: res.mimeType || 'x-unknown',
          ...(text !== undefined ? { text } : {}),
          ...(encoding ? { encoding } : {}),
        },
        redirectURL: e.redirectURL || '',
        headersSize: -1,
        bodySize: e.encodedDataLength || -1,
      },
      cache: {},
      timings,
      serverIPAddress: res.remoteIPAddress || '',
      _resourceType: e.type || '',
      ...(e.error ? { _error: e.error } : {}),
      __bodyBytes: bodyBytes,
    };

    this.entries.push(entry);
    this.bytes += bodyBytes;
    this.enforceCaps();
    this.onUpdate();
  }

  /**
   * @param {{ pageUrl: string, sdkEvents: any[], creatorVersion: string }} meta
   */
  toHar(meta = {}) {
    const started = this.pageStartedAt || new Date();
    const pageUrl = meta.pageUrl || this.pageUrl || '';

    const entries = this.entries.map((e) => {
      const { __bodyBytes, ...clean } = e;
      return { ...clean, pageref: 'page_1' };
    });

    const onLoad = entries.length
      ? Math.max(...entries.map((e) => e.time || 0))
      : -1;

    return {
      log: {
        version: '1.2',
        creator: { name: 'Nibble', version: meta.creatorVersion || '1.0.0' },
        browser: { name: 'Nibble (Electron)', version: process.versions.electron },
        pages: [
          {
            startedDateTime: started.toISOString(),
            id: 'page_1',
            title: pageUrl || 'Nibble capture',
            pageTimings: { onContentLoad: -1, onLoad },
          },
        ],
        entries,
        // Custom (underscore-prefixed fields are allowed by the HAR spec) so
        // network traffic and SDK events can be correlated in one file.
        _sdkEvents: meta.sdkEvents || [],
        _capture: {
          droppedEntries: this.dropped,
          capturedBodyBytes: this.bytes,
          limits: { maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES },
        },
      },
    };
  }
}

module.exports = { TabCapture, MAX_ENTRIES, MAX_BYTES };
