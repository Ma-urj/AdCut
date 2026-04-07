const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Project
  getRecentProjects:  ()           => ipcRenderer.invoke('get-recent-projects'),
  pickProjectFolder:  ()           => ipcRenderer.invoke('pick-project-folder'),
  pickProjectFile:    ()           => ipcRenderer.invoke('pick-project-file'),
  createProject:      (d)          => ipcRenderer.invoke('create-project', d),
  openProject:        (f)          => ipcRenderer.invoke('open-project', f),
  saveProject:        (d)          => ipcRenderer.invoke('save-project', d),
  getActiveProject:   ()           => ipcRenderer.invoke('get-active-project'),

  // Media
  openFiles:          ()           => ipcRenderer.invoke('open-files'),
  importToMkv:        (d)          => ipcRenderer.invoke('import-to-mkv', d),

  // Export
  saveFile:           (n)          => ipcRenderer.invoke('save-file', n),
  exportVideo:        (d)          => ipcRenderer.invoke('export-video', d),
  onExportProgress:   (cb)         => ipcRenderer.on('export-progress', (_, d) => cb(d)),

  // Analysis
  analyzeClip:        (d)          => ipcRenderer.invoke('analyze-clip', d),
  onAnalyzeProgress:  (cb)         => ipcRenderer.on('analyze-progress', (_, d) => cb(d)),
  getPythonStatus:    ()           => ipcRenderer.invoke('get-python-status'),

  // Ad generation
  generateAd:         (d)          => ipcRenderer.invoke('generate-ad', d),
  onGenerateProgress: (cb)         => ipcRenderer.on('generate-ad-progress', (_, d) => cb(d)),

  // Settings
  getSettings:        ()           => ipcRenderer.invoke('get-settings'),
  saveSettings:       (d)          => ipcRenderer.invoke('save-settings', d),
})
