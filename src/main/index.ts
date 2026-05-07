import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { join, basename, dirname, extname } from 'path'
import { readFile, writeFile, readdir, copyFile, mkdir } from 'fs/promises'
import { watch, FSWatcher, existsSync, readdirSync, readFileSync, createServer } from 'fs'
import { IncomingMessage, ServerResponse } from 'http'
import { createServer as createHttpServer } from 'http'

// Custom themes directory
const themesDir = join(app.getPath('home'), '.colamd', 'themes')

function ensureThemesDir(): void {
  if (!existsSync(themesDir)) {
    mkdir(themesDir, { recursive: true }).catch(() => {})
  }
}

async function scanCustomThemes(): Promise<string[]> {
  try {
    const files = await readdir(themesDir)
    return files.filter(f => f.endsWith('.css')).sort()
  } catch {
    return []
  }
}

// Per-window state
interface WindowState {
  filePath: string | null
  watcher: FSWatcher | null
  isInternalSave: boolean
  debounceTimer: ReturnType<typeof setTimeout> | null
  agentState: 'idle' | 'active' | 'cooldown'
  lastExternalChange: number
  agentCooldownTimer: ReturnType<typeof setTimeout> | null
}

const windowStates = new Map<number, WindowState>()
let pendingFilePaths: string[] = []

function getState(win: BrowserWindow): WindowState {
  let state = windowStates.get(win.id)
  if (!state) {
    state = { filePath: null, watcher: null, isInternalSave: false, debounceTimer: null, agentState: 'idle', lastExternalChange: 0, agentCooldownTimer: null }
    windowStates.set(win.id, state)
  }
  return state
}

function getWinFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function createWindow(filePath?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const state = getState(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('did-finish-load', () => {
    if (filePath) {
      loadFileInWindow(win, filePath)
    }
  })

  win.on('closed', () => {
    stopWatching(state)
    windowStates.delete(win.id)
  })

  updateTitle(win)
  return win
}

function updateTitle(win: BrowserWindow): void {
  const state = getState(win)
  const fileName = state.filePath ? basename(state.filePath) : 'Untitled'
  win.setTitle(`${fileName} — ColaMD`)
}

function suggestFileName(win: BrowserWindow, content?: string): string | undefined {
  const state = getState(win)
  if (state.filePath) return basename(state.filePath, '.md')
  if (!content) return undefined
  // Extract first heading or first non-empty line
  const match = content.match(/^#\s+(.+)/m) || content.match(/^(.+)/m)
  if (!match) return undefined
  return match[1].trim().replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || undefined
}

function stopWatching(state: WindowState): void {
  if (state.watcher) {
    state.watcher.close()
    state.watcher = null
  }
  if (state.agentCooldownTimer) {
    clearTimeout(state.agentCooldownTimer)
    state.agentCooldownTimer = null
  }
  state.agentState = 'idle'
  state.lastExternalChange = 0
}

function transitionAgentState(win: BrowserWindow, state: WindowState, newState: 'idle' | 'active' | 'cooldown'): void {
  if (state.agentCooldownTimer) {
    clearTimeout(state.agentCooldownTimer)
    state.agentCooldownTimer = null
  }

  if (newState === 'active') {
    if (state.agentState !== 'active') {
      state.agentState = 'active'
      if (!win.isDestroyed()) win.webContents.send('agent-activity', 'active')
    }
    // Reset cooldown timer — 3s after last write
    state.agentCooldownTimer = setTimeout(() => {
      transitionAgentState(win, state, 'cooldown')
    }, 3000)
  } else if (newState === 'cooldown') {
    state.agentState = 'cooldown'
    if (!win.isDestroyed()) win.webContents.send('agent-activity', 'cooldown')
    state.agentCooldownTimer = setTimeout(() => {
      transitionAgentState(win, state, 'idle')
    }, 2000)
  } else {
    state.agentState = 'idle'
    if (!win.isDestroyed()) win.webContents.send('agent-activity', 'idle')
  }
}

function watchFile(win: BrowserWindow, state: WindowState): void {
  if (!state.filePath) return
  stopWatching(state)
  const filePath = state.filePath
  state.watcher = watch(filePath, (eventType) => {
    if (eventType !== 'change' || state.isInternalSave) return

    // Agent activity detection
    const now = Date.now()
    const gap = now - state.lastExternalChange
    state.lastExternalChange = now
    if (gap > 0 && gap < 2000) {
      transitionAgentState(win, state, 'active')
    } else if (state.agentState === 'active') {
      transitionAgentState(win, state, 'active') // reset cooldown timer
    }

    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => {
      readFile(filePath, 'utf-8')
        .then((data) => {
          if (!win.isDestroyed()) win.webContents.send('file-changed', resolveImagePaths(data, filePath))
        })
        .catch(() => {})
    }, 100)
  })
}

// Rewrite relative image paths in markdown to absolute file:// URLs
function resolveImagePaths(content: string, filePath: string): string {
  const dir = dirname(filePath)
  return content.replace(/!\[([^\]]*)\]\((?!https?:\/\/|file:\/\/|data:)([^)]+)\)/g, (_match, alt, src) => {
    const abs = join(dir, src)
    return `![${alt}](file://${abs})`
  })
}

function loadFileInWindow(win: BrowserWindow, filePath: string): void {
  readFile(filePath, 'utf-8')
    .then((data) => {
      const state = getState(win)
      state.filePath = filePath
      watchFile(win, state)
      updateTitle(win)
      win.webContents.send('file-opened', { path: filePath, content: resolveImagePaths(data, filePath) })
    })
    .catch(() => {})
}

// Find window that already has this file open
function findWindowForFile(filePath: string): BrowserWindow | null {
  for (const [id, state] of windowStates) {
    if (state.filePath === filePath) {
      return BrowserWindow.fromId(id) || null
    }
  }
  return null
}

// Open file: reuse existing window or create new one
function openFile(filePath: string): void {
  // If already open, focus that window
  const existing = findWindowForFile(filePath)
  if (existing) {
    existing.focus()
    return
  }

  // Find an untitled empty window to reuse
  const emptyWin = findEmptyWindow()
  if (emptyWin) {
    loadFileInWindow(emptyWin, filePath)
    emptyWin.focus()
    return
  }

  // Create new window
  const win = createWindow(filePath)
  win.focus()
}

function findEmptyWindow(): BrowserWindow | null {
  for (const [id, state] of windowStates) {
    if (!state.filePath) {
      return BrowserWindow.fromId(id) || null
    }
  }
  return null
}

async function saveToPath(win: BrowserWindow, filePath: string, content: string): Promise<boolean> {
  const state = getState(win)
  try {
    state.isInternalSave = true
    await writeFile(filePath, content, 'utf-8')
    state.filePath = filePath
    watchFile(win, state)
    updateTitle(win)
    return true
  } catch {
    return false
  } finally {
    setTimeout(() => { state.isInternalSave = false }, 100)
  }
}

// IPC Handlers

ipcMain.on('open-external', (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url)
  }
})

ipcMain.handle('open-file', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]

  // If this window has no file, load here; otherwise open in new window
  const state = getState(win)
  if (!state.filePath) {
    try {
      const content = await readFile(filePath, 'utf-8')
      state.filePath = filePath
      watchFile(win, state)
      updateTitle(win)
      return { path: filePath, content }
    } catch {
      return null
    }
  } else {
    openFile(filePath)
    return null
  }
})

ipcMain.handle('open-file-path', async (event, filePath: string) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const state = getState(win)

  // If this window has no file, load here
  if (!state.filePath) {
    try {
      const content = await readFile(filePath, 'utf-8')
      state.filePath = filePath
      watchFile(win, state)
      updateTitle(win)
      return { path: filePath, content }
    } catch {
      return null
    }
  } else {
    openFile(filePath)
    return null
  }
})

ipcMain.handle('save-file', async (event, content: string) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const state = getState(win)
  if (!state.filePath) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestFileName(win, content),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    state.filePath = result.filePath
    // Copy slides assets alongside the file if this looks like a slides file
    if (content.includes('kicker:') || content.includes('chip:')) {
      const destDir = dirname(state.filePath)
      try {
        const files = await readdir(slidesTemplateDir)
        await Promise.all(files.filter(f => f !== 'slides-template.md').map(async (f) => {
          const dest = join(destDir, f)
          if (!existsSync(dest)) await copyFile(join(slidesTemplateDir, f), dest)
        }))
      } catch { /* best effort */ }
    }
  }
  return saveToPath(win, state.filePath, content)
})

ipcMain.handle('save-file-as', async (event, content: string) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win, content),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePath) return false
  return saveToPath(win, result.filePath, content)
})

ipcMain.handle('export-pdf', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return false

  try {
    // Expand editor to full content height for printing
    const cssKey = await win.webContents.insertCSS(
      'html, body { height: auto !important; overflow: visible !important; } #titlebar { display: none !important; } #editor { height: auto !important; overflow: visible !important; } #editor .ProseMirror { min-height: auto !important; }'
    )
    const pdfData = await win.webContents.printToPDF({
      marginType: 0,
      printBackground: true,
      pageSize: 'A4'
    })
    await win.webContents.removeInsertedCSS(cssKey)
    await writeFile(result.filePath, pdfData)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('export-html', async (event, htmlContent: string) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win),
    filters: [{ name: 'HTML', extensions: ['html'] }]
  })
  if (result.canceled || !result.filePath) return false

  try {
    await writeFile(result.filePath, htmlContent, 'utf-8')
    return true
  } catch {
    return false
  }
})

// ─── Slides feature ──────────────────────────────────────────────────────────

const slidesTemplateDir = app.isPackaged
  ? join(process.resourcesPath, 'templates', 'slides')
  : join(__dirname, '../../resources/templates/slides')

// Per-directory HTTP servers for slides preview: dir -> { server, port }
const slidesServers = new Map<string, { port: number; server: ReturnType<typeof createHttpServer> }>()

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.md': 'text/plain',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function getOrCreateSlidesServer(dir: string): Promise<number> {
  const existing = slidesServers.get(dir)
  if (existing) return Promise.resolve(existing.port)

  return new Promise((resolve, reject) => {
    const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url === '/' ? '/template.html' : (req.url || '/')
      const filePath = join(dir, url.split('?')[0])
      const ext = extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'
      try {
        const data = readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': mime })
        res.end(data)
      } catch {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') { reject(new Error('no port')); return }
      slidesServers.set(dir, { port: addr.port, server })
      resolve(addr.port)
    })
    server.on('error', reject)
  })
}

// New Slides: load template into editor without saving first (⌘S saves later)
// Also copy assets (template.html, icon.png) to the save directory when user saves
ipcMain.handle('new-slides', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  try {
    const content = await readFile(join(slidesTemplateDir, 'slides-template.md'), 'utf-8')
    win.webContents.send('new-slides-content', content)
    return true
  } catch {
    return null
  }
})

// Open as Slides: serve the directory containing the current .md file
// If no file is open, first create a new slides file (same as New Slides)
ipcMain.handle('open-as-slides', async (event, content?: string) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const state = getState(win)

  // No file open — create one first
  if (!state.filePath) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Create New Slides',
      defaultPath: 'slides.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return false
    try {
      await copyFile(join(slidesTemplateDir, 'slides-template.md'), result.filePath)
      loadFileInWindow(win, result.filePath)
      state.filePath = result.filePath
    } catch {
      return false
    }
  }

  // Auto-save current content to disk before opening browser
  if (content !== undefined && state.filePath) {
    try {
      await writeFile(state.filePath, content, 'utf-8')
    } catch { /* best effort */ }
  }

  const dir = dirname(state.filePath)
  const mdName = basename(state.filePath)

  // Always overwrite template.html so updates take effect
  const templateDest = join(dir, 'template.html')
  try {
    await copyFile(join(slidesTemplateDir, 'template.html'), templateDest)
  } catch {
    return false
  }

  // Rename slides.md reference in template to match actual filename
  // (template always fetches 'slides.md' — if file is named differently, patch it)
  if (mdName !== 'slides.md') {
    try {
      let html = await readFile(templateDest, 'utf-8')
      html = html.replace(/fetch\('slides\.md'\)/, `fetch('${mdName}')`)
      await writeFile(templateDest, html, 'utf-8')
    } catch { /* best effort */ }
  }

  try {
    const port = await getOrCreateSlidesServer(dir)
    shell.openExternal(`http://127.0.0.1:${port}/template.html`)
    return true
  } catch {
    return false
  }
})

// Export Slides: inline images as base64, copy videos alongside, produce shareable output
ipcMain.handle('export-slides', async (event, content: string) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const state = getState(win)
  if (!state.filePath) return false

  const srcDir = dirname(state.filePath)

  // Detect if content references any video files
  const videoRefs = [...content.matchAll(/<!--\s*type:\s*video[^>]*src:\s*([^\s,>]+)/g)]
    .map(m => m[1].trim())
    .filter(Boolean)
  const hasVideo = videoRefs.length > 0

  // Choose export destination
  let destDir: string
  let destHtml: string

  if (hasVideo) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Slides Folder',
      defaultPath: join(srcDir, 'slides-export'),
      buttonLabel: 'Export'
    })
    if (result.canceled || !result.filePath) return false
    destDir = result.filePath
    destHtml = join(destDir, 'index.html')
    await mkdir(destDir, { recursive: true })
  } else {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Slides',
      defaultPath: join(srcDir, 'slides.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (result.canceled || !result.filePath) return false
    destDir = dirname(result.filePath)
    destHtml = result.filePath
  }

  // Read template and inline the markdown content
  let html = await readFile(join(srcDir, 'template.html'), 'utf-8')

  // Replace fetch('slides.md') with inline content
  const escaped = content.replace(/`/g, '\\`').replace(/\$/g, '\\$')
  html = html.replace(
    /fetch\('[^']+'\)\s*\n?\s*\.then\(r => r\.text\(\)\)/,
    `Promise.resolve(\`${escaped}\`)`
  )

  // Inline images as base64
  const imgMatches = [...content.matchAll(/!\[[^\]]*\]\((?!https?:\/\/|data:)([^)]+)\)/g)]
  const inlinedImages = new Map<string, string>()
  for (const m of imgMatches) {
    const imgPath = m[1].trim()
    if (inlinedImages.has(imgPath)) continue
    try {
      const abs = join(srcDir, imgPath)
      const buf = await readFile(abs)
      const ext = extname(imgPath).slice(1).toLowerCase()
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'png' ? 'image/png'
        : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/png'
      inlinedImages.set(imgPath, `data:${mime};base64,${buf.toString('base64')}`)
    } catch { /* skip missing images */ }
  }
  for (const [src, dataUrl] of inlinedImages) {
    html = html.replaceAll(`src="${src}"`, `src="${dataUrl}"`)
    html = html.replaceAll(`src='${src}'`, `src='${dataUrl}'`)
  }

  // Copy video files alongside if needed
  if (hasVideo) {
    for (const videoSrc of videoRefs) {
      try {
        await copyFile(join(srcDir, videoSrc), join(destDir, videoSrc))
      } catch { /* skip missing videos */ }
    }
  }

  await writeFile(destHtml, html, 'utf-8')
  shell.showItemInFolder(destHtml)
  return true
})

ipcMain.handle('load-custom-theme', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'CSS', extensions: ['css'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  try {
    const srcPath = result.filePaths[0]
    const fileName = basename(srcPath)
    const destPath = join(themesDir, fileName)
    await copyFile(srcPath, destPath)
    const css = await readFile(destPath, 'utf-8')
    buildMenu() // rebuild menu to include new theme
    return { name: fileName, css }
  } catch {
    return null
  }
})

ipcMain.handle('load-theme-css', async (_event, fileName: string) => {
  try {
    return await readFile(join(themesDir, fileName), 'utf-8')
  } catch {
    return null
  }
})

// Menu — targets the focused window

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow()
}

function sendToFocused(channel: string, ...args: unknown[]): void {
  const win = getFocusedWindow()
  if (win) win.webContents.send(channel, ...args)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  // Scan custom themes synchronously for menu building
  const customThemeItems: Electron.MenuItemConstructorOptions[] = []
  try {
    const files = readdirSync(themesDir).filter((f: string) => f.endsWith('.css')).sort()
    for (const file of files) {
      customThemeItems.push({
        label: file.replace(/\.css$/, ''),
        click: async () => {
          try {
            const css = await readFile(join(themesDir, file), 'utf-8')
            sendToFocused('set-theme', `custom:${file}`)
            sendToFocused('set-custom-css', css)
          } catch { /* ignore */ }
        }
      })
    }
  } catch { /* themes dir may not exist yet */ }

  const themeSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Light', click: () => sendToFocused('set-theme', 'light') },
    { label: 'Dark', click: () => sendToFocused('set-theme', 'dark') },
    { label: 'Elegant', click: () => sendToFocused('set-theme', 'elegant') },
    { label: 'Newsprint', click: () => sendToFocused('set-theme', 'newsprint') },
  ]
  if (customThemeItems.length > 0) {
    themeSubmenu.push({ type: 'separator' }, ...customThemeItems)
  }
  themeSubmenu.push({ type: 'separator' }, {
    label: 'Import Theme...',
    click: () => sendToFocused('menu-import-theme')
  })

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: 'ColaMD',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        {
          label: 'New Slides...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendToFocused('menu-new-slides')
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('menu-open')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('menu-save')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToFocused('menu-save-as')
        },
        { type: 'separator' },
        {
          label: 'Export PDF...',
          click: () => sendToFocused('menu-export-pdf')
        },
        {
          label: 'Export HTML...',
          click: () => sendToFocused('menu-export-html')
        },
        {
          label: 'Export Slides...',
          click: () => sendToFocused('menu-export-slides')
        },
        {
          label: 'Open as Slides',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendToFocused('menu-open-as-slides')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Theme',
      submenu: themeSubmenu
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ColaMD',
          click: () => shell.openExternal('https://github.com/marswaveai/colamd')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// App lifecycle

app.whenReady().then(() => {
  ensureThemesDir()
  buildMenu()

  // Check command line args for file paths
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  const fileArgs = args.filter((arg) => !arg.startsWith('-'))
  if (fileArgs.length > 0) {
    pendingFilePaths = fileArgs
  }

  if (pendingFilePaths.length > 0) {
    for (const fp of pendingFilePaths) {
      createWindow(fp)
    }
    pendingFilePaths = []
  } else {
    createWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    openFile(filePath)
  } else {
    pendingFilePaths.push(filePath)
  }
})
