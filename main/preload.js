// preload.js — レンダラー(エディタUI)へ安全なAPIだけを公開する

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectDirectory: (opts) => ipcRenderer.invoke('dialog:selectDirectory', opts),
  selectFiles: (opts) => ipcRenderer.invoke('dialog:selectFiles', opts),
  selectProjectFile: () => ipcRenderer.invoke('dialog:selectProjectFile'),

  createProject: (args) => ipcRenderer.invoke('project:create', args),
  openProject: (args) => ipcRenderer.invoke('project:open', args),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),

  importAssets: (args) => ipcRenderer.invoke('assets:import', args),
  listAssets: (args) => ipcRenderer.invoke('assets:list', args),
  revealAssets: (args) => ipcRenderer.invoke('assets:reveal', args),

  launchPreview: (args) => ipcRenderer.invoke('preview:launch', args),
  exportGame: (args) => ipcRenderer.invoke('export:game', args),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
});
