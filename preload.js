const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge: the shell UI (top bar + API console) calls these to drive the
// page WebContentsView and to perform HTTP requests from the main process.
contextBridge.exposeInMainWorld('nibble', {
  version: '3.0.0',

  // Navigation
  go:       (url) => ipcRenderer.invoke('nav:go', url),
  back:     ()    => ipcRenderer.invoke('nav:back'),
  reload:   ()    => ipcRenderer.invoke('nav:reload'),
  devtools: ()    => ipcRenderer.invoke('nav:devtools'),

  // Layout (sidebar side/width/visibility + measured chrome height)
  setLayout:     (patch)  => ipcRenderer.invoke('layout:set', patch),
  setPageHidden: (hidden) => ipcRenderer.invoke('layout:pageHidden', hidden),

  // API console
  sendRequest: (spec) => ipcRenderer.invoke('http:send', spec),

  // Events pushed from main -> UI.
  onLoading:   (cb) => ipcRenderer.on('page-loading', () => cb()),
  onLoaded:    (cb) => ipcRenderer.on('page-loaded', () => cb()),
  onNavigated: (cb) => ipcRenderer.on('page-navigated', (e, url) => cb(url)),
  onError:     (cb) => ipcRenderer.on('page-error', (e, info) => cb(info)),
});
