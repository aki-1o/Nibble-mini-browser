# Nibble

A tiny Electron desktop "browser" with a built-in API console, for testing AA
consent journeys.

> This app intentionally disables a browser security feature (`webSecurity`). It
> is for **local testing only** and must never be used for real end users.
> **Open AA journeys and `localhost` only** — see [What not to open](#what-not-to-open).

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

## Build a Windows .exe

```powershell
npm run dist
```

Writes two things to `release/`, both about 75 MB because each bundles Chromium:

- **`Nibble Setup 1.0.0.exe`** — installer. Lets you pick the install folder and
  adds Start-menu and desktop shortcuts, so Nibble behaves like any other
  installed app.
- **`Nibble 1.0.0.exe`** — portable. Runs from wherever it sits, installs nothing.

`npm run pack` skips the installers and just produces `release/win-unpacked/`,
which is quicker when you only want to check that a packaged build starts.

Either way the AA list lives in `%APPDATA%\Nibble\nibble.db`, not next to the
executable, so it survives reinstalls and upgrades.

Two things about the first build on a machine:

- **The icon must be at least 256×256.** `assets/favicon.ico` holds only a 16×16
  frame — fine for the in-app menu, too small for electron-builder, which refuses
  to build rather than ship a blurry one, and too small for Windows' taskbar slot,
  which is why the window used to show Electron's logo. `assets/icon.ico` carries
  the same art at 16/32/48/64/128/256; both `build.win.icon` and the
  `BrowserWindow` icon point at it. Each frame above 16 is an integer
  nearest-neighbour multiple of the original, so it stays crisp pixel art rather
  than a smeared upscale — replace it with real artwork if you have it.
- **`winCodeSign` extraction can fail** with `Cannot create symbolic link: A
  required privilege is not held by the client`. electron-builder downloads that
  archive on first use; it contains macOS symlinks, and Windows only allows
  creating symlinks with Developer Mode on or from an admin shell. The Windows
  tools inside it extract fine — only the macOS files fail — but electron-builder
  treats the whole extraction as failed and retries four times. Turning on
  Developer Mode fixes it, or extract it once by hand, skipping the macOS tree:

  ```powershell
  $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
  $archive = (Get-ChildItem $cache -Filter *.7z | Select-Object -First 1).FullName
  node_modules\7zip-bin\win\x64\7za.exe x -bd "-o$cache\winCodeSign-2.6.0" "-x!darwin" $archive
  ```

  With that folder present, electron-builder stops re-downloading it.

The build is **not code-signed**, so Windows SmartScreen will warn on first run
("Windows protected your PC" → **More info** → **Run anyway**). Signing needs a
certificate; nothing in the app requires it.

---

## How to Use

### Tabs

A tab strip sits above the URL bar, so several AA journeys can be open at once.

- **+** (or **Ctrl+T**) opens a new tab, with the caret already in the URL bar so
  you can type straight away.
- Click a tab to switch to it; the URL bar, Back/Reload, DevTools and the API
  console's journey **Open** all act on the active tab.
- **✕** on a tab, middle-click, or **Ctrl+W** closes it. Closing the last tab
  leaves a fresh blank one.
- Each tab is a separate page view with its own history and SDK event listener,
  but they share one session and cookie jar.

### Browsing a journey

1. Make sure your AA SDK dev server is running on `http://localhost:3000`.
2. Paste the consent-journey URL into the top bar and press **Go** (or Enter).
3. The journey renders inside the app; its cross-origin API calls work despite CORS.
4. Past URLs are in **History** in the menu (**Ctrl+H**).

**F5** (or **Ctrl+R**) reloads the active tab; **Ctrl+Shift+R** reloads ignoring cache.

The URL field is deliberately narrow and centred: the top bar is a three-column
grid whose side tracks are equal, so the field sits on the window's centre line
*and* exactly midway between the two button clusters — both readings of "centred"
land on the same pixel. It is capped at 560px (or 44% of the window, whichever is
smaller), so a wider window gives the space to the page rather than to a longer
text box, and a narrow one keeps the buttons legible instead of clipping them.
Journey URLs are far too long to read in full at any width, so the whole URL is
in the field's tooltip.

### Menu (the favicon)

The app icon at the left of the URL bar is the menu button. Hover or focus it and
it turns into a three-line burger, drawn in the icon's own colours (sampled from
`assets/favicon.ico` at startup and brightened or darkened as needed so the lines
stay legible in both themes). While a page is loading the icon keeps spinning
instead — the load indicator wins.

Clicking it opens the **menu drawer** — a panel on the left of the window, built
like the API console: it takes its own column, so the journey shrinks beside it
instead of being covered. Tools sit at the top, **Appearance** at the bottom.

The drawer **takes over the left column**. If the API console is open on the left
it is set aside while the drawer is up — the two never stack — and it comes back
when the drawer closes. With the console flipped to the right (**⇆**) both are on
screen at once, drawer on the left, console on the right.

| Item | What it does |
|------|--------------|
| **DevTools** | Same as **F12** — toggles DevTools on the active tab. |
| **API console** | Opens the side panel (**Ctrl+B**). A tick marks it already open. |
| **AA mapping** | The AA list editor (**Ctrl+M**) — see below. |
| **Database** | Read-only browser for `nibble.db` (**Ctrl+D**) — see below. |
| **History** | The last 50 URLs opened from the top bar (**Ctrl+H**). Picking one opens it in a new tab. |
| **Download HAR** | Exports the active tab's captured traffic. `(n)` is the request count; it greys out with a tooltip when there is nothing to export. |
| **Documentation** | Opens `docs.html` in a new tab (**F1**) — the safety warnings, how to pin the app, the shortcut list, and credits. |
| **Appearance** | **Light** / **Dark** / **System** — see below. |

The first four are panels and share the one side column: picking any of them shows
that panel and hides the others, and the tick in the drawer says which one is up.
**Download HAR** is an action and **Documentation** is a page, so neither has a tick.

**Documentation** is a local file loaded into a tab like any other page. It is
handed the shell's resolved theme as a query parameter, because Nibble deliberately
leaves Chromium's `nativeTheme` alone — so a page cannot read the app's light/dark
choice on its own. `file://` URLs are kept out of the History panel, since the docs
are part of the app rather than a journey.

Entries act as a launcher: picking one **closes the drawer and opens what you
picked**, handing it the column the drawer was using. **Appearance** is a setting,
not an entry, so it leaves the drawer open. Close the drawer without picking
anything via the burger again or the **✕** in its header; its open/closed state is
remembered across restarts.

**Ctrl+B** follows what is on screen: with the drawer standing in front of the
console it brings the console forward rather than silently closing it.

The wrench and **{ }** buttons no longer sit in the top bar; both keyboard
shortcuts still work.

### Light & dark mode

**Appearance** in the menu switches the whole shell — tab strip, URL bar,
API console, body editor and response viewer — between light and dark.
**System** follows the OS setting and re-applies when it changes. The choice is
saved in `localStorage`, so it survives restarts.

Only Nibble's own chrome is themed. Chromium's `nativeTheme` is deliberately left
alone: flipping it would change `prefers-color-scheme` inside the journey as well,
which would misrepresent the very thing being tested.

### Download HAR

**Download HAR** in the menu exports the active tab's captured network traffic.
The count beside it, `(n)`, is the number of requests captured for that tab.

- Capture runs from the moment a tab is created — there is no arm/start step, so
  failures in the first second of a load are still recorded.
- Each top-level navigation clears the buffer, so one export equals one page load.
- The buffer is capped per tab (500 entries / 50 MB of bodies), dropping oldest first.
- Picking it writes a HAR 1.2 file to **Downloads/Nibble HAR/**, named
  `<aaId>-<host>-<yyyyMMdd-HHmmss>.har` (the `aaId` prefix is dropped if the URL
  has no such param). A toast shows the path with an **Open folder** action.
- SDK events collected by `page-preload.js` are included as a custom
  `log._sdkEvents` array, so network traffic and SDK events can be correlated in
  one file.

The entry is disabled — with a tooltip saying why — when the tab has nothing
loaded or when no requests have been captured.

> **HAR files are sensitive.** They contain full request and response bodies,
> including `ecreq` payloads, tokens and cookies. There is no redaction. They are
> written locally and never uploaded.

**DevTools does not interfere.** An earlier version stopped capture whenever
DevTools opened, on the belief that CDP allows only one debugger client per tab.
It does not — Chromium supports several, and a capture that attached first keeps
receiving `Network` events, response bodies included, with DevTools attached as
well (verified on Electron 31 / Chromium 126). That old behaviour silently
produced empty HARs for anyone who worked with DevTools open, which is most of
the time here, so it is gone: capture and DevTools now run together.

### Finvu path notice

Finvu's SDK config sets `REACT_APP_BASEURL=/finvu`, so a Finvu journey only renders
when the path carries that prefix:

```
http://localhost:3000/finvu/?aaId=FINVU&ecreq=...
```

Every other AA serves from the root. When a URL's `aaId` identifies Finvu
(`FINVU`, `finvu`, or `cookiejar-aa@finvu.in`) but the path lacks `/finvu`, a
notice appears under the URL bar with an **Add /finvu & open** button that inserts
it and reloads. **✕** dismisses it for that URL.

### Client fingerprint

Electron's default User-Agent carries an `Electron/<version>` token and its
client hints advertise only Chromium, which is enough for some WAFs (F5 BIG-IP
ASM, for one) to reject requests. `CHROME_SPOOF` at the top of `main.js` presents
a plain desktop Chrome UA and matching `sec-ch-ua*` / `Accept-Language` headers on
every request — document, subresource, XHR, and the API console's own calls. Set
`CHROME_SPOOF.enabled = false` to turn it off.

### API console

Pick **API console** in the menu (or press **Ctrl+B**) to open the API console.

- **Method + URL** — pick a verb, type the URL. It defaults to
  `{{baseUrl}}/web/multi-consent/initiate/phone-number`. Any `{{variable}}` in the
  URL renders as a highlighted token: **hover or click it to paste that variable's
  value inline** (it saves to the Variables tab). Tokens are red until they have a
  value, and sending is blocked while the URL still has an unresolved one.
- **Authorization** — API Key auth. Auth type and Key are fixed (`API_KEY`); only
  the **Value** is editable. It is sent as a request header.
- **Headers** — free-form key/value rows. `Content-Type: application/json` is
  added automatically when a body is present.
- **Body** — raw JSON, pre-filled with the usual multi-consent initiate payload.
  `//` and `/* */` comments are stripped before sending (along with the trailing
  commas they leave behind), so the commented-out `templateTypes` and `fipIds`
  entries work as toggles like in Postman.

  A variable can reach the body two ways, and both are listed as **chips under the
  editor** — hover or click one to open the same card the URL tokens use:

  - **`{{token}}`** (solid chip) — substituted textually wherever it appears. The
    phone number ships as `"{{phoneNumber}}"` rather than a literal for this reason.
    Red until the variable has a value.
  - **field name** (dashed chip) — a variable whose *name* matches a **top-level
    field** overwrites that field's value on send, even with no token in the JSON.
    Name a variable `trackingId` and the body's `trackingId` is replaced.

  Only top-level fields are matched: a variable never reaches into nested objects
  it was not meant to touch. Types are preserved — a string field takes the
  variable verbatim (so `0000000000` stays a string instead of becoming the number
  `0`), while an array, object, number or boolean field parses the variable as
  JSON, and is **left untouched with a note** if it does not parse. An empty
  variable means "unset" and changes nothing.
- **Variables** — name/value pairs, used as `{{name}}` in the URL, headers, body,
  and API key, and as field-name overwrites in the body as described above. Two are
  seeded: `baseUrl` = `https://fiupreprod.ignosis.ai/fiu/api/pirimid` and
  `phoneNumber` = `0000000000`.
  This tab also holds an **Inject a URL param** card: fill in a key and
  value and hit **Add to URL**, or **+ Add new pair** for more rows to submit at
  once. New keys go to the front of the query string (right after the host),
  existing keys are updated in place, and pairs that are already there are left
  alone (the URL only reloads if something actually changed).
- **AA** — pick the Account Aggregator by name; the matching `accountAggregatorId`
  is shown beneath it. On send it is written into the JSON body, replacing any
  `accountAggregatorId` already there, so you never have to edit the body to swap
  AA. Pick **— Don't set —** to leave the body alone. Defaults to SAAFE. The list
  comes from the **AA mapping** panel, so anything added there appears here.
- **Send** — performs the request from the Electron main process, so there are no
  CORS limits, `localhost` works, and cookies are shared with the page view.

The response pane shows status, time, size, pretty-printed JSON with line
numbers, and response headers.

### AA mapping

**AA mapping** in the menu opens the AA list editor in the side column. The list
used to be hardcoded; it now lives in a small SQLite database, so an AA can be
added without touching the source.

It is one table. Each saved row is a **name**, an **accountAggregatorId**, an
**Edit** button and a **✕**. The last row of that same table is the form: a name
field, an id field, and **Save** spanning both button columns, so it lines up with
the buttons above it.

- **Add** — type into the two fields and **Save**. **Enter** in either field saves.
- **Edit** — loads that row into the same bottom row, which highlights; **Save**
  shrinks to one column and **Cancel** takes the other. **Escape** also cancels.
- **✕** — deletes, after a confirmation dialog styled like the rest of the app.
  Deleting cannot be undone.

Name and `accountAggregatorId` are both unique, case-insensitively, so `FINVU` and
`finvu` cannot both exist; the panel says which one clashed. Any change redraws the
**AA** tab's dropdown immediately, so the two panels can never disagree about which
AAs exist.

A **Download** card sits below, writing a copy of the live `nibble.db` into
`Downloads/Nibble DB/` — every table, openable in any SQLite tool. The handle is
closed before the copy is taken, so the file is not missing writes that are still
sitting in the rollback journal.

The database is `nibble.db` in Electron's `userData` directory (on Windows,
`%APPDATA%\Nibble\`), not in the app folder — that is read-only once installed, and
keeping it in `userData` means the list survives upgrades. The schema is versioned
in SQLite's own `user_version` pragma and migrated on open, and the six original
AAs are seeded only into an empty table, so a deliberately emptied list stays empty.

Storage is `node-sqlite3-wasm` rather than `better-sqlite3`: it is a WebAssembly
build, so there is no C++ toolchain needed to install it and nothing to rebuild
after an Electron bump. It is not garbage collected, so `main.js` closes the handle
on `will-quit`.

### Database

**Database** in the menu (**Ctrl+D**) is a read-only browser for `nibble.db`. The
file's path, size, schema version and table count are at the top, then one card per
table showing:

- every **column** with its type and its constraints as badges — `PK`, `UNIQUE`,
  `NOT NULL`, and the default value where there is one;
- **foreign keys** drawn on the column that owns them, as `→ table.column`, so the
  relationships read as a diagram rather than a separate list. `aa_mapping` stands
  alone today, so the panel says so instead of leaving an empty section;
- any **index** that was created by hand (the ones SQLite generates for `UNIQUE`
  and `PRIMARY KEY` are already shown as column badges);
- the **rows**, up to 200 per table, with `null` rendered distinctly from an empty
  string.

Each table gets **two cards**: the first is its structure (columns, constraints,
indexes, foreign keys), the second its values. They answer different questions, and
splitting them keeps a wide row preview from burying the schema. With more than one
table, a rule separates each pair from the next.

Everything is read from SQLite's own pragmas (`table_info`, `foreign_key_list`,
`index_list`), never from a description of the schema kept in the UI, so the panel
cannot drift out of date when a migration is added — and it will show a column the
app itself no longer uses. **Refresh** re-reads the file; editing an AA while the
panel is open refreshes it too.

## What not to open

**Open AA consent journeys and your own `localhost` dev server. Nothing else.**

Tabs are created with `webSecurity: false`, which is what lets a journey's
cross-origin API calls work without CORS headers — the entire point of the tool.
It also removes the same-origin policy, the boundary that normally stops one site
reading another. With it off, script on any page loaded here can fetch any other
origin *with your cookies* and read the response back.

Three settings alongside it make that worse: `allowRunningInsecureContent` lets an
HTTPS page pull in HTTP scripts, so anyone on your network can inject code into a
page that looks secure; and `contextIsolation: false` with
`nodeIntegrationInSubFrames: true` puts page script in the same world as the
preload, which is far closer to code execution on your machine than a normal tab.
All tabs also share one session and cookie jar, so a session created in one tab is
reachable from every other.

So do not open:

- anything you are signed in to that matters — email, banking, cloud consoles,
  source hosting, internal admin tools;
- links from outside your own testing (chat, email, search results);
- unfamiliar shortener links. The journey flow legitimately uses
  `urlshortner.uat.ignosis.ai`; that is fine because you know where it came from.

Two related notes. Nibble runs in its own Electron session, so your system Chrome's
cookies and logins are not reachable from here — the exposure is limited to what
you do inside Nibble. And the API key in the console is stored in `localStorage` in
plaintext, so use a test key, never a production one.

The app says this once per launch, as a modal dialog over the window: it fades in,
and fades out on its own after about eleven seconds if you ignore it. **OK**
dismisses it, and so do **Escape** and a click outside the box. Hovering it stops
the countdown and reveals **✕** and **Don't show again**; the latter is remembered
in `localStorage`, so it is a per-machine choice and this section is the only copy
left after that.

### Journey URL shortcuts

When a response contains a `redirectionUrl`, it is auto-filled into the box at the
bottom of the response pane, with a single **Open** button that loads it as-is.

That URL is usually a **shortener link** (e.g.
`https://default.urlshortner.uat.ignosis.ai/TMBANK/c/Ef0`), so the flow is two
clicks:

1. **Open** in the sidebar — loads the short link; the page view follows the
   redirect, which leaves the real journey URL (with its `?ecreq=...` query) in the
   top URL bar.
2. **→ localhost:3000** in the top bar (just right of **Reload**) — rewrites that URL
   to the target protocol/host, keeping path, query, and fragment, and opens it
   immediately. No need to press **Go** afterwards.

   The target defaults to `http://localhost:3000`. Click the **▾** beside it to
   change the protocol or host (for when you don't want `http` or `localhost:3000`).
   Pressing **Enter** applies and opens straight away. A change only lasts for the
   current session — every launch starts back at `http://localhost:3000`, so a
   one-off port like `3443` never becomes the new default.

   To add query params such as `orgId`, use the **Inject a URL param** card in the
   API console's **Variables** tab.

Rewriting the short link directly would not work: its path only means something on
the shortener's host, and the query parameters the journey needs do not exist until
the redirect happens.

### Panel layout

- Drag the divider to resize the console.
- **⇆** moves it to the other side of the window.
- **✕** or **Ctrl+B** closes it.
- The menu drawer owns the left column while it is open: a left-hand console is
  set aside and returns when the drawer closes. Flipped right, both fit at once.
- One column, four panels (API console, AA mapping, Database, History): they share
  the same width and divider, and only one is in it at a time. Its width and side
  are remembered across restarts.
- **Every launch starts with the API console open**, whatever was on screen when
  you last quit. Closing it is a within-session action, not a saved preference —
  the console is the point of the app, so a window that opens empty is never what
  you wanted.

### SDK event logging

`page-preload.js` listens for the SDK's `postMessage` events and prints them to
the page's DevTools console as `[SDK Event] <eventCode> @ <time> {…}`. Open
DevTools with **F12** or **DevTools** in the menu. Inside that console:

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
| `net-capture.js` | Per-tab CDP network capture and HAR 1.2 export.                         |
| `db.js`          | SQLite store for the AA mapping (main process only; validates renderer input). |
| `migrations.js`  | Versioned schema for `nibble.db`, plus the first-run AA seed.            |
| `index.html`     | Shell UI: top bar + API console markup and styling.                     |
| `docs.html`      | In-app documentation page, opened in a tab from the menu (**F1**).       |
| `renderer.js`    | Top bar logic: navigation, URL history, burger menu, theme, sidebar layout and resizing. |
| `api-panel.js`   | API console logic: request building, sending, response rendering.       |
| `aa-mapping.js`  | AA mapping panel: add / edit / delete rows via IPC.                     |
| `package.json`   | Dependencies, scripts, and electron-builder config.                     |

---

## Notes / Troubleshooting

- **`Autofill.enable ... wasn't found`** messages in the terminal are a harmless
  Electron/DevTools quirk — safe to ignore.
- The API key is stored in `localStorage` in **plaintext** on disk. It is masked
  in the UI, but do not use a production key here.
- Requires **Electron 30+** (uses `WebContentsView`). This repo pins Electron 31.
- Everything is contained to this app — your system Chrome is unaffected.
