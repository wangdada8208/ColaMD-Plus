import { createEditor, getMarkdown, getHTML, setMarkdown, insertImageAtCursor, findImageInDoc } from './editor/editor'
import { applyTheme, loadSavedTheme } from './themes/theme-manager'
import './themes/base.css'

function isSlidesContent(content: string): boolean {
  return /^---\s*\n[\s\S]*?(kicker|chip):/m.test(content)
}

let sourceModeActive = false
let galleryVisible = false
let currentFilePath: string | null = null
let needsSave = false
let galleryImages: Array<{ alt: string; src: string; absPath: string; exists: boolean; fileName: string }> = []

// Maps data: URLs → relative paths for pasted images that need file: conversion
const pendingImageMap = new Map<string, string>()

const editorEl = () => document.getElementById('editor') as HTMLElement
const sourceEl = () => document.getElementById('source-editor') as HTMLTextAreaElement
const slidesBtnEl = () => document.getElementById('slides-btn') as HTMLButtonElement

function enterSourceMode(content: string): void {
  sourceModeActive = true
  editorEl().classList.add('hidden')
  const ta = sourceEl()
  ta.classList.add('visible')
  ta.value = content
  slidesBtnEl().classList.add('visible')
}

function exitSourceMode(): void {
  sourceModeActive = false
  editorEl().classList.remove('hidden')
  sourceEl().classList.remove('visible')
  slidesBtnEl().classList.remove('visible')
}

function setContent(content: string): void {
  if (isSlidesContent(content)) {
    enterSourceMode(content)
  } else {
    exitSourceMode()
    setMarkdown(content)
  }
}

function getContent(): string {
  if (sourceModeActive) return sourceEl().value
  return getMarkdown()
}

// Convert data: URLs and file:// paths back to relative paths for saving
async function processContentForSave(content: string): Promise<string> {
  if (!currentFilePath) return content

  const fileDir = dirname(currentFilePath)

  // Process each pending image (data URL → file on disk → relative path)
  for (const [dataUrl, savedPath] of pendingImageMap) {
    if (savedPath) {
      // Already saved — just replace data URL with relative path
      content = content.replaceAll(dataUrl, savedPath)
    } else {
      // Deferred save: save the image to assets/ now
      const base64 = dataUrl.split(',')[1]
      const now = new Date()
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
      const ext = dataUrl.startsWith('data:image/png') ? 'png' : dataUrl.startsWith('data:image/jpeg') ? 'jpg' : dataUrl.startsWith('data:image/webp') ? 'webp' : dataUrl.startsWith('data:image/gif') ? 'gif' : 'png'
      const fileName = `${mdBasename()}-image-${ts}.${ext}`
      try {
        const relativePath = await window.electronAPI.saveImageFile({ base64Data: base64, fileName, fileDir, mdName: mdBasename() + '-assets' })
        pendingImageMap.set(dataUrl, relativePath)
        content = content.replaceAll(dataUrl, relativePath)
      } catch {
        // Can't save — leave as data URL (not ideal but won't lose data)
      }
    }
  }

  // Convert ![](file:///abs/path/assets/xxx.png) back to ![](assets/xxx.png)
  content = content.replace(
    /!\[([^\]]*)\]\(file:\/\/([^)]+)\)/g,
    (_match, alt, absPath: string) => {
      const cleanPath = absPath.replace(/^\//, '')
      const dir = fileDir.replace(/^\//, '')
      if (cleanPath.startsWith(dir)) {
        const rel = cleanPath.slice(dir.length).replace(/^\//, '')
        return `![${alt}](${rel})`
      }
      return _match
    }
  )

  return content
}

// ─── Image Gallery ────────────────────────────────────────────────

function toggleGallery(): void {
  galleryVisible = !galleryVisible
  const el = document.getElementById('image-gallery')
  if (!el) return
  el.classList.toggle('hidden', !galleryVisible)
  if (galleryVisible && currentFilePath) {
    loadGalleryImages()
    const searchInput = document.getElementById('gallery-search') as HTMLInputElement
    if (searchInput) { searchInput.value = ''; searchInput.focus() }
  }
}

async function loadGalleryImages(): Promise<void> {
  if (!currentFilePath) return
  try {
    const images = await window.electronAPI.scanDocumentImages(currentFilePath)
    galleryImages = images
    renderGallery(images)
  } catch (err) {
    console.error('Failed to scan images:', err)
  }
}

function renderGallery(images: Array<{ alt: string; src: string; absPath: string; exists: boolean; fileName: string }>): void {
  const grid = document.getElementById('gallery-grid')
  const empty = document.getElementById('gallery-empty')
  if (!grid || !empty) return

  if (images.length === 0) {
    grid.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  grid.innerHTML = images.map((img, idx) => `
    <div class="gallery-item" data-index="${idx}">
      <img src="${img.exists ? `file://${img.absPath}` : ''}" alt="${escapeHtml(img.alt)}" loading="lazy"
           onerror="this.style.display='none'">
      <div class="gallery-info">
        <div class="gallery-filename">${escapeHtml(img.fileName)}</div>
        <div class="gallery-path">${escapeHtml(img.src)}</div>
        ${img.exists ? '' : '<div class="gallery-missing">⚠ File not found</div>'}
      </div>
    </div>
  `).join('')

  // Click to jump to image in editor
  grid.querySelectorAll('.gallery-item').forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0')
      const img = galleryImages[index]
      if (img) {
        findImageInDoc(img.src)
        toggleGallery()
      }
    })
  })

  // Right-click to reveal in Finder
  grid.querySelectorAll('.gallery-item').forEach((item) => {
    item.addEventListener('contextmenu', async (e) => {
      e.preventDefault()
      const index = parseInt((item as HTMLElement).dataset.index || '0')
      const img = galleryImages[index]
      if (img?.exists && currentFilePath) {
        const absPath = await window.electronAPI.resolveImagePath(img.src, dirname(currentFilePath))
        window.electronAPI.revealInFinder(absPath)
      }
    })
  })
}

function filterGallery(query: string): void {
  const lower = query.toLowerCase()
  const filtered = galleryImages.filter(img =>
    img.fileName.toLowerCase().includes(lower) || img.src.toLowerCase().includes(lower)
  )
  renderGallery(filtered)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.substring(0, i) : '.'
}

function mdBasename(): string {
  if (!currentFilePath) return 'image'
  const name = currentFilePath.split('/').pop() || 'image'
  return name.replace(/\.[^.]+$/, '')
}

async function init(): Promise<void> {
  const api = window.electronAPI
  const savedTheme = loadSavedTheme()
  applyTheme(savedTheme)

  if (savedTheme.startsWith('custom:')) {
    const fileName = savedTheme.slice(7)
    const css = await api.loadThemeCSS(fileName)
    if (css) applyTheme(savedTheme, css)
  }

  await createEditor('editor', () => {
    if (!needsSave) {
      needsSave = true
      api.setDirty(true)
    }
  })

  // Slides button — open as slides
  slidesBtnEl().addEventListener('click', () => api.openAsSlides(getContent()))

  api.onMenuOpen(async () => {
    const result = await api.openFile()
    if (result) {
      currentFilePath = result.path
      setContent(result.content)
      needsSave = false; api.setDirty(false)
    }
  })

  api.onMenuSave(async () => {
    // For untitled docs: save first to establish a file path
    if (!currentFilePath) {
      const first = await api.saveFile(getContent())
      if (!first) return
      const p = await api.getCurrentFilePath()
      if (!p) return
      currentFilePath = p
    }
    // Process deferred images and save clean markdown
    const content = await processContentForSave(getContent())
    const saved = await api.saveFile(content)
    if (saved) {
      const p = await api.getCurrentFilePath()
      if (p) currentFilePath = p
      needsSave = false
      api.setDirty(false)
      // Clean up unreferenced images from the assets folder
      if (currentFilePath) {
        api.cleanupOrphanImages(content, dirname(currentFilePath), mdBasename() + '-assets')
      }
    }
  })
  api.onMenuSaveAs(async () => {
    const content = await processContentForSave(getContent())
    const saved = await api.saveFileAs(content)
    if (saved) {
      const p = await api.getCurrentFilePath()
      if (p) currentFilePath = p
      needsSave = false
      api.setDirty(false)
      if (currentFilePath) {
        api.cleanupOrphanImages(content, dirname(currentFilePath), mdBasename() + '-assets')
      }
    }
  })
  api.onMenuExportPDF(() => api.exportPDF())
  api.onMenuExportHTML(() => {
    const s = getComputedStyle(document.body)
    const v = (name: string) => s.getPropertyValue(name).trim()
    const bgColor = v('--bg-color')
    const textColor = v('--text-color')
    const textMuted = v('--text-muted')
    const borderColor = v('--border-color')
    const linkColor = v('--link-color')
    const codeBg = v('--code-bg')
    const codeBlockBg = v('--code-block-bg')
    const codeBlockText = v('--code-block-text') || textColor
    const blockquoteBorder = v('--blockquote-border')
    const blockquoteBg = v('--blockquote-bg') || 'transparent'
    const tableHeaderBg = v('--table-header-bg')
    const selectionBg = v('--selection-bg')

    const editor = document.querySelector('#editor .ProseMirror')
    const fontFamily = editor ? getComputedStyle(editor).fontFamily : '-apple-system,BlinkMacSystemFont,sans-serif'

    const getElColor = (selector: string, fallback: string): string => {
      const el = document.querySelector(`#editor .ProseMirror ${selector}`)
      return el ? getComputedStyle(el).color : fallback
    }
    const strongColor = getElColor('strong', textColor)
    const codeColor = getElColor('code', textColor)

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ColaMD Export</title>
<style>
body{max-width:780px;margin:40px auto;padding:20px;font-family:${fontFamily};line-height:1.75;background:${bgColor};color:${textColor}}
h1{font-size:2em;font-weight:700;border-bottom:1px solid ${borderColor};padding-bottom:.3em}
h2{font-size:1.5em;font-weight:600;border-bottom:1px solid ${borderColor};padding-bottom:.25em}
h3{font-size:1.25em;font-weight:600}
strong{color:${strongColor}}
a{color:${linkColor};text-decoration:none}
code{background:${codeBg};color:${codeColor};padding:2px 6px;border-radius:3px;font-size:.875em;font-family:'SF Mono','Fira Code',Menlo,monospace}
pre{background:${codeBlockBg};color:${codeBlockText};padding:16px;border-radius:6px;overflow-x:auto;margin:1em 0}
pre code{background:none;padding:0;color:inherit}
blockquote{border-left:4px solid ${blockquoteBorder};background:${blockquoteBg};padding-left:16px;margin:1em 0;color:${textMuted}}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid ${borderColor};padding:8px 12px}
th{background:${tableHeaderBg};font-weight:600}
hr{border:none;border-top:2px solid ${borderColor};margin:2em 0}
img{max-width:100%}
::selection{background:${selectionBg}}
</style>
</head><body>${getHTML()}</body></html>`
    api.exportHTML(html)
  })

  api.onNewFile(() => {
    exitSourceMode(); setMarkdown(''); currentFilePath = null
    needsSave = false; api.setDirty(false)
  })
  api.onFileOpened((data) => {
    currentFilePath = data.path
    setContent(data.content)
    needsSave = false; api.setDirty(false)
  })
  api.onFileChanged((content) => {
    if (sourceModeActive) {
      sourceEl().value = content
    } else {
      setMarkdown(content)
    }
  })
  api.onSetTheme((theme) => applyTheme(theme))
  api.onSetCustomCSS((css) => {
    const theme = loadSavedTheme()
    applyTheme(theme, css)
  })

  api.onMenuNewSlides(async () => {
    await api.newSlides()
  })

  api.onNewSlidesContent((content) => {
    enterSourceMode(content)
  })

  api.onMenuOpenAsSlides(async () => {
    await api.openAsSlides(getContent())
  })

  api.onMenuExportSlides(async () => {
    await api.exportSlides(getContent())
  })

  api.onMenuImportTheme(async () => {
    const result = await api.loadCustomTheme()
    if (result) applyTheme(`custom:${result.name}`, result.css)
  })

  const agentDot = document.getElementById('agent-dot')
  api.onAgentActivity((state) => {
    if (agentDot) agentDot.className = state === 'idle' ? '' : state
  })

  // ─── Close-with-save handling ───

  api.onTriggerSave(async () => {
    // Main process asked us to save before closing
    if (!currentFilePath) {
      const first = await api.saveFile(getContent())
      if (!first) return
      const p = await api.getCurrentFilePath()
      if (!p) return
      currentFilePath = p
    }
    const content = await processContentForSave(getContent())
    await api.saveFile(content)
    needsSave = false
    api.setDirty(false)
    if (currentFilePath) {
      api.cleanupOrphanImages(content, dirname(currentFilePath), mdBasename() + '-assets')
    }
    // Window will close via the main process timeout
  })

  // ─── Image Gallery wiring ───

  api.onMenuToggleGallery(() => toggleGallery())

  const closeBtn = document.getElementById('gallery-close')
  if (closeBtn) closeBtn.addEventListener('click', () => { if (galleryVisible) toggleGallery() })

  const backdrop = document.getElementById('gallery-backdrop')
  if (backdrop) backdrop.addEventListener('click', () => { if (galleryVisible) toggleGallery() })

  const searchInput = document.getElementById('gallery-search') as HTMLInputElement
  if (searchInput) {
    searchInput.addEventListener('input', () => filterGallery(searchInput.value))
  }

  // Keyboard: Esc to close gallery
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && galleryVisible) {
      toggleGallery()
      e.preventDefault()
    }
  })

  // ─── Image paste handling ───
  document.addEventListener('paste', async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) continue

        const now = new Date()
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
        const extMap: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
        const ext = extMap[file.type] || 'png'
        const fileName = `${mdBasename()}-image-${ts}.${ext}`

        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          const base64 = dataUrl.split(',')[1]

          if (currentFilePath) {
            // Have a file path — save to assets/ immediately
            try {
              const fileDir = dirname(currentFilePath)
              const relativePath = await api.saveImageFile({ base64Data: base64, fileName, fileDir, mdName: mdBasename() + '-assets' })
              pendingImageMap.set(dataUrl, relativePath)
            } catch (err) {
              console.error('Failed to save pasted image:', err)
            }
          } else {
            // Untitled — mark for deferred save (no file path yet)
            pendingImageMap.set(dataUrl, null)
          }

          // Always insert data URL — it displays correctly regardless of file state
          insertImageAtCursor(dataUrl)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  })

  // ─── Modified drop: image files save to assets, md files open ───
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (!file) return

    // Image files: save to assets and insert
    if (file.type.startsWith('image/')) {
      const ext = file.name.split('.').pop() || 'png'
      const now = new Date()
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
      const fileName = `${mdBasename()}-image-${ts}.${ext}`

      // Read as data URL for guaranteed display
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const base64 = dataUrl.split(',')[1]

      if (currentFilePath) {
        try {
          const fileDir = dirname(currentFilePath)
          const relativePath = await api.saveImageFile({ base64Data: base64, fileName, fileDir, mdName: mdBasename() + '-assets' })
          pendingImageMap.set(dataUrl, relativePath)
        } catch (err) {
          console.error('Failed to save dropped image:', err)
        }
      } else {
        // Untitled — mark for deferred save
        pendingImageMap.set(dataUrl, null)
      }
      insertImageAtCursor(dataUrl)
      return
    }

    // .md files: open normally
    const filePath = api.getPathForFile(file)
    if (!filePath) return
    const result = await api.openFilePath(filePath)
    if (result) {
      currentFilePath = result.path
      setContent(result.content)
    }
  })
}

init().catch((e) => console.error('ColaMD init failed:', e))
