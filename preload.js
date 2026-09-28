const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge: the shell UI (top bar + API console) calls these to drive the
// page WebContentsView and to perform HTTP requests from the main process.
contextBridge.exposeInMainWorld('nibble', {
  version: '3.0.0',

  // Navigation
  go:       (url) => ipcRenderer.invoke('nav:go', url),
  back:     ()    => ipcRenderer.invoke('nav:back'),
  reload:   ()    => ipcRenderer.invoke('nav:reload'),
  reloadHard: ()  => ipcRenderer.invoke('nav:reloadHard'),
  devtools: ()    => ipcRenderer.invoke('nav:devtools'),
  currentUrl: ()  => ipcRenderer.invoke('nav:currentUrl'),

  // Tabs
  newTab:      (url) => ipcRenderer.invoke('tabs:new', url),
  openDocs:    (theme) => ipcRenderer.invoke('docs:open', theme),
  closeTab:    (id)  => ipcRenderer.invoke('tabs:close', id),
  activateTab: (id)  => ipcRenderer.invoke('tabs:activate', id),
  listTabs:    ()    => ipcRenderer.invoke('tabs:list'),

  // HAR export
  exportHar: ()      => ipcRenderer.invoke('har:export'),

  // Show a written file in the OS file manager. Shared by every export.
  revealFile: (p)    => ipcRenderer.invoke('file:reveal', p),

  // Layout (sidebar side/width/visibility + measured chrome height)
  setLayout:     (patch)  => ipcRenderer.invoke('layout:set', patch),
  setPageHidden: (hidden) => ipcRenderer.invoke('layout:pageHidden', hidden),

  // API console
  sendRequest: (spec) => ipcRenderer.invoke('http:send', spec),

  // AA mapping store (SQLite in the main process). Every call answers with the
  // full list, so the UI never needs a second round trip to redraw.
  aaMap: {
    list:   ()    => ipcRenderer.invoke('aamap:list'),
    add:    (row) => ipcRenderer.invoke('aamap:add', row),
    update: (row) => ipcRenderer.invoke('aamap:update', row),
    remove: (id)  => ipcRenderer.invoke('aamap:remove', id),
  },

  // The database itself: what is in it (for the Database panel) and a copy of it
  // (for the download button in the AA mapping panel).
  db: {
    schema:   () => ipcRenderer.invoke('db:schema'),
    exportDb: () => ipcRenderer.invoke('db:exportDb'),
  },

  // Tenant routing table. Reads and writes answer with the whole tree, so the
  // panel never has to reconcile a partial update.
  tenant: {
    list:        ()    => ipcRenderer.invoke('tenant:list'),
    add:         (row) => ipcRenderer.invoke('tenant:add', row),
    update:      (row) => ipcRenderer.invoke('tenant:update', row),
    remove:      (id)  => ipcRenderer.invoke('tenant:remove', id),
    paramAdd:    (row) => ipcRenderer.invoke('tenant:paramAdd', row),
    paramRemove: (id)  => ipcRenderer.invoke('tenant:paramRemove', id),
    exportSeed:  ()    => ipcRenderer.invoke('tenant:exportSeed'),
  },

  // The app icon as a data URL. Used to sample the burger-menu line colours:
  // canvas cannot read a file:// image without tainting.
  iconData: () => ipcRenderer.invoke('app:iconData'),

  // Events pushed from main -> UI.
  onLoading:   (cb) => ipcRenderer.on('page-loading', () => cb()),
  onLoaded:    (cb) => ipcRenderer.on('page-loaded', () => cb()),
  onNavigated: (cb) => ipcRenderer.on('page-navigated', (e, url) => cb(url)),
  onError:     (cb) => ipcRenderer.on('page-error', (e, info) => cb(info)),
  onTabs:      (cb) => ipcRenderer.on('tabs-updated', (e, state) => cb(state)),
});
