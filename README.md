# Nibble

A tiny Electron desktop "browser" with a built-in API console, for testing AA
consent journeys.

> This app intentionally disables a browser security feature (`webSecurity`). It
> is for **local testing only** and must never be used for real end users.

## Prerequisites

- **[Node.js](https://nodejs.org/)** (LTS) — provides `npm`.
- **[Git](https://git-scm.com/)** — to clone the repo.

## Clone & Run

```powershell
git clone https://github.com/YOUR_USERNAME/nibble.git
cd nibble
npm install
npm start
```

`npm install` downloads Electron (one-time). `npm start` launches the app.

---

## How to Use

### Browsing a journey

1. Make sure your AA SDK dev server is running on `http://localhost:3000`.
2. Paste the consent-journey URL into the top bar and press **Go** (or Enter).
3. The journey renders inside the app; its cross-origin API calls work despite CORS.
4. Click **▾** next to the URL bar for URL history.

### API console

Click **{ }** in the top bar (or press **Ctrl+B**) to open the API console.

- **Method + URL** — pick a verb, type the URL. It defaults to
  `{{baseUrl}}/web/multi-consent/initiate/phone-number`. Any `{{variable}}` in the
  URL renders as a highlighted token: **hover or click it to paste that variable's
  value inline** (it saves to the Variables tab). Tokens are red until they have a
  value, and sending is blocked while the URL still has an unresolved one.
- **Authorization** — API Key auth. Auth type and Key are fixed (`API_KEY`); only
  the **Value** is editable. It is sent as a request header.
- **Headers** — free-form key/value rows. `Content-Type: application/json` is
  added automatically when a body is present.
- **Body** — raw JSON, empty by default. `//` and `/* */` comments are stripped
  before sending (along with the trailing commas they leave behind), so you can
  keep lines commented out like in Postman.
- **Variables** — name/value pairs, used as `{{name}}` in the URL, headers, body,
  and API key.
- **Send** — performs the request from the Electron main process, so there are no
  CORS limits, `localhost` works, and cookies are shared with the page view.

The response pane shows status, time, size, pretty-printed JSON with line
numbers, and response headers.

### Journey URL shortcuts

When a response contains a `redirectionUrl`, it is auto-filled into the box at the
bottom of the response pane, with a single **Open** button that loads it as-is.

That URL is usually a **shortener link** (e.g.
`https://default.urlshortner.uat.ignosis.ai/TMBANK/c/Ef0`), so the flow is two
clicks:

1. **Open** in the sidebar — loads the short link; the page view follows the
   redirect, which leaves the real journey URL (with its `?ecreq=...` query) in the
   top URL bar.
2. **→ localhost:3000** in the top bar (just right of **{ }**) — rewrites that URL
   to the target protocol/host, keeping path, query, and fragment, and opens it
   immediately. No need to press **Go** afterwards.

   The target defaults to `http://localhost:3000`. Click the **▾** beside it to
   change the protocol or host (for when you don't want `http` or `localhost:3000`),
   and to add extra query **params** such as `orgId=abc&foo=bar`. Params are empty
   by default, so nothing is appended and the **Add params & open** button stays
   disabled until you type something. Keys already in the URL are overwritten
   rather than duplicated. Pressing **Enter** in any field applies and opens
   straight away. All three settings are remembered.

Rewriting the short link directly would not work: its path only means something on
the shortener's host, and the query parameters the journey needs do not exist until
the redirect happens.

### Panel layout

- Drag the divider to resize the console.
- **⇆** moves it to the other side of the window.
- **✕** or **Ctrl+B** closes it.

### SDK event logging

`page-preload.js` listens for the SDK's `postMessage` events and prints them to
the page's DevTools console as `[SDK Event] <eventCode> @ <time> {…}`. Open
DevTools with **F12** or the wrench button. Inside that console:

- `window.__lastSdkEvent` — the most recent event.
- `window.__sdkEvents` — the full sequence for the journey.

These are per-frame; if events logged with `frame: SUBFRAME`, switch the
Console's frame dropdown to that frame first.

## Project Structure

| File             | Purpose                                                                 |
|------------------|-------------------------------------------------------------------------|
| `main.js`        | Electron main process: window, `WebContentsView`, layout, CORS bypass, HTTP sender, IPC. |
| `preload.js`     | Safe IPC bridge between the shell UI and the main process.              |
| `page-preload.js`| Runs inside the loaded page; captures and logs SDK `postMessage` events.|
| `index.html`     | Shell UI: top bar + API console markup and styling.                     |
| `renderer.js`    | Top bar logic: navigation, URL history, sidebar layout and resizing.    |
| `api-panel.js`   | API console logic: request building, sending, response rendering.       |
| `package.json`   | Dependencies, scripts, and electron-builder config.                     |

---

## Notes / Troubleshooting

- **`Autofill.enable ... wasn't found`** messages in the terminal are a harmless
  Electron/DevTools quirk — safe to ignore.
- The API key is stored in `localStorage` in **plaintext** on disk. It is masked
  in the UI, but do not use a production key here.
- Requires **Electron 30+** (uses `WebContentsView`). This repo pins Electron 31.
- Everything is contained to this app — your system Chrome is unaffected.
