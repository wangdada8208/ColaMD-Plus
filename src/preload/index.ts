import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface ElectronAPI {
  openFile: () => Promise<{ path: string; content: string } | null>
  openFilePath: (path: string) => Promise<{ path: string; content: string } | null>
  saveFile: (content: string) => Promise<boolean>
  saveFileAs: (content: string) => Promise<boolean>
  exportPDF: () => Promise<boolean>
  exportHTML: (html: string) => Promise<boolean>
  newSlides: () => Promise<string | null>
  openAsSlides: (content: string) => Promise<boolean>
  loadCustomTheme: () => Promise<{ name: string; css: string } | null>
  loadThemeCSS: (fileName: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  openExternal: (url: string) => void
  onFileChanged: (callback: (content: string) => void) => void
  onNewFile: (callback: () => void) => void
  onFileOpened: (callback: (data: { path: string; content: string }) => void) => void
  onMenuOpen: (callback: () => void) => void
  onMenuSave: (callback: () => void) => void
  onMenuSaveAs: (callback: () => void) => void
  onMenuExportPDF: (callback: () => void) => void
  onMenuExportHTML: (callback: () => void) => void
  onMenuNewSlides: (callback: () => void) => void
  onMenuOpenAsSlides: (callback: () => void) => void
  onNewSlidesContent: (callback: (content: string) => void) => void
  onSetTheme: (callback: (theme: string) => void) => void
  onSetCustomCSS: (callback: (css: string) => void) => void
  exportSlides: (content: string) => Promise<boolean>
  onMenuExportSlides: (callback: () => void) => void
  onAgentActivity: (callback: (state: string) => void) => void
  // Image Management
  saveImageFile: (data: { base64Data: string; fileName: string; fileDir: string; mdName?: string }) => Promise<string>
  scanDocumentImages: (filePath: string) => Promise<Array<{ alt: string; src: string; absPath: string; exists: boolean; fileName: string }>>
  resolveImagePath: (relativePath: string, fileDir: string) => Promise<string>
  revealInFinder: (absPath: string) => void
  getCurrentFilePath: () => Promise<string | null>
  cleanupOrphanImages: (content: string, fileDir: string, folderName: string) => Promise<void>
  setDirty: (dirty: boolean) => void
  onTriggerSave: (callback: () => void) => void
  onMenuToggleGallery: (callback: () => void) => void
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFilePath: (path: string) => ipcRenderer.invoke('open-file-path', path),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content: string) => ipcRenderer.invoke('save-file-as', content),
  exportPDF: () => ipcRenderer.invoke('export-pdf'),
  exportHTML: (html: string) => ipcRenderer.invoke('export-html', html),
  exportSlides: (content: string) => ipcRenderer.invoke('export-slides', content),
  newSlides: () => ipcRenderer.invoke('new-slides'),
  openAsSlides: (content: string) => ipcRenderer.invoke('open-as-slides', content),
  loadCustomTheme: () => ipcRenderer.invoke('load-custom-theme'),
  loadThemeCSS: (fileName: string) => ipcRenderer.invoke('load-theme-css', fileName),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onFileChanged: (callback: (content: string) => void) => {
    ipcRenderer.on('file-changed', (_event, content) => callback(content))
  },
  onNewFile: (callback: () => void) => {
    ipcRenderer.on('new-file', () => callback())
  },
  onFileOpened: (callback: (data: { path: string; content: string }) => void) => {
    ipcRenderer.on('file-opened', (_event, data) => callback(data))
  },
  onMenuOpen: (callback: () => void) => {
    ipcRenderer.on('menu-open', () => callback())
  },
  onMenuSave: (callback: () => void) => {
    ipcRenderer.on('menu-save', () => callback())
  },
  onMenuSaveAs: (callback: () => void) => {
    ipcRenderer.on('menu-save-as', () => callback())
  },
  onMenuExportPDF: (callback: () => void) => {
    ipcRenderer.on('menu-export-pdf', () => callback())
  },
  onMenuExportHTML: (callback: () => void) => {
    ipcRenderer.on('menu-export-html', () => callback())
  },
  onMenuNewSlides: (callback: () => void) => {
    ipcRenderer.on('menu-new-slides', () => callback())
  },
  onMenuOpenAsSlides: (callback: () => void) => {
    ipcRenderer.on('menu-open-as-slides', () => callback())
  },
  onNewSlidesContent: (callback: (content: string) => void) => {
    ipcRenderer.on('new-slides-content', (_event, content) => callback(content))
  },
  onSetTheme: (callback: (theme: string) => void) => {
    ipcRenderer.on('set-theme', (_event, theme) => callback(theme))
  },
  onSetCustomCSS: (callback: (css: string) => void) => {
    ipcRenderer.on('set-custom-css', (_event, css) => callback(css))
  },
  onMenuImportTheme: (callback: () => void) => {
    ipcRenderer.on('menu-import-theme', () => callback())
  },
  onMenuExportSlides: (callback: () => void) => {
    ipcRenderer.on('menu-export-slides', () => callback())
  },
  onAgentActivity: (callback: (state: string) => void) => {
    ipcRenderer.on('agent-activity', (_event, state) => callback(state))
  },
  // Image Management
  saveImageFile: (data: { base64Data: string; fileName: string; fileDir: string }) =>
    ipcRenderer.invoke('save-image-file', data),
  scanDocumentImages: (filePath: string) =>
    ipcRenderer.invoke('scan-document-images', filePath),
  resolveImagePath: (relativePath: string, fileDir: string) =>
    ipcRenderer.invoke('resolve-image-path', relativePath, fileDir),
  revealInFinder: (absPath: string) =>
    ipcRenderer.invoke('reveal-in-finder', absPath),
  getCurrentFilePath: () =>
    ipcRenderer.invoke('get-current-file-path'),
  cleanupOrphanImages: (content: string, fileDir: string, folderName: string) =>
    ipcRenderer.invoke('cleanup-orphan-images', content, fileDir, folderName),
  setDirty: (dirty: boolean) => ipcRenderer.send('set-dirty', dirty),
  onTriggerSave: (callback: () => void) => {
    ipcRenderer.on('trigger-save', () => callback())
  },
  onMenuToggleGallery: (callback: () => void) => {
    ipcRenderer.on('menu-toggle-gallery', () => callback())
  }
} satisfies ElectronAPI)
