# ColaMD

**Markdown as Database. The Agent Native editor and template rendering platform.**

Real-time collaboration between humans and AI agents — see your agent's changes as they happen. Turn any Markdown file into a slide deck, blog post, resume, or product page.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/marswaveai/colamd.svg)](https://github.com/marswaveai/colamd/releases)

[Download](#download) | [Why ColaMD](#why-colamd) | [Features](#features) | [Slides](#slides--markdown-as-database) | [Development](#development) | [中文](README_CN.md)

---

## Why ColaMD?

AI agents are rewriting how we work. They edit files, generate docs, and produce reports — all in Markdown.

But how do you **watch** an agent work? You close the file. You reopen it. You wait.

**ColaMD changes this.** Open a `.md` file in ColaMD, let your agent edit it, and watch the content update in real-time — like pair programming with an AI. No refresh, no reload, no friction.

This is what **Agent Native** means: built from the ground up for a world where humans and agents collaborate on the same files.

## Features

### Agent Native

- **Live Agent Sync** — When an AI agent (Claude Code, Cursor, Copilot, etc.) modifies your `.md` file, ColaMD detects the change and refreshes instantly. This is the core feature.
- **Agent Activity Indicator** — A subtle dot in the titlebar shows you when an agent is writing: orange breathing pulse while active, green flash when done. You always know if your agent is working.
- **Cmd+Click Links** — Click any link in the editor to open it in your browser.

### Editor

- **True WYSIWYG** — Type Markdown, see rich text. No split-pane preview.
- **Smart Line Breaks** — Single newlines render as line breaks, matching how AI agents write Markdown.
- **Rich Text Copy** — Copy content and paste into WeChat, email, or any rich text editor with formatting preserved.
- **Minimal by Design** — No toolbar, no sidebar, no distractions. Just your content.

### Themes & Export

- **Themes** — 4 built-in themes + [downloadable themes](themes/) + import custom CSS.
- **Export** — PDF and HTML.
- **Cross-platform** — macOS, Windows, Linux.

## Slides — Markdown as Database

HTML is hard to edit. Markdown is easy.

ColaMD introduces a new idea: **Markdown as Database**. Your `.md` file is the content layer. HTML templates are the view layer. Change the content by editing Markdown — never touch the HTML.

One Markdown file. Many possible renderings: slide deck, blog, resume, product page. Future templates can consume the same file in completely different ways.

### How to use

**File → New Slides (`⌘⇧N`)** — Creates a `slides.md` tutorial template and opens it in the editor.

**File → Open as Slides (`⌘⇧P`)** — Spins up a local server and opens your current `.md` file as a slide deck in the browser. If no file is open, it creates one first.

**File → Export Slides...** — Export a shareable version. Without video: a single `.html` file with images inlined as base64 — your friend double-clicks to view. With video: a folder containing `index.html` plus the video files — zip and send.

### Slide format

```markdown
---
kicker: YOUR BRAND
chip: Event · 2026
page: YOUR NAME
---

<!-- type: cover -->
# Title
Subtitle here

---

<!-- type: statement -->
## Key Message
One powerful sentence.

---

## Section
First point.

Second point.

---

<!-- type: thankyou -->
## Thank You
Closing message

call-to-action
```

Supported layouts: `cover` · `statement` · `section` · `video` · `thankyou`

Optional: background image (`bg: cover.png`), video embed (`src: demo.mp4`), inline image preview (`preview: screenshot.png`).

No image? The cover falls back to a clean orange-on-white design — it just works.

## Download

> Check [Releases](https://github.com/marswaveai/colamd/releases) for the latest builds.

| Platform | Format |
|----------|--------|
| macOS    | `.dmg` |
| Windows  | `.exe` |
| Linux    | `.AppImage` / `.deb` |

## How It Works

```
┌─────────────┐     writes     ┌──────────────┐
│  AI Agent   │ ──────────────▶│  .md file    │
│ (Claude,    │                │              │
│  Cursor...) │                └──────┬───────┘
└─────────────┘                       │
                              fs.watch detects
                                      │
                              ┌───────▼───────┐
                              │    ColaMD     │
                              │  auto-refresh │
                              │   ✨ live!    │
                              └───────────────┘
```

1. Open any `.md` file in ColaMD
2. Let your AI agent edit that file
3. Watch the content update in real-time — the indicator dot pulses orange while the agent writes

No configuration needed. It just works.

## What ColaMD Does NOT Do

ColaMD is intentionally simple:

- No file manager or workspace
- No cloud sync or collaboration
- No AI features built in — it's a **viewer/editor** for AI-generated content
- No plugin system

One thing, done well.

## Custom Themes

ColaMD supports custom CSS themes. Download themes from the [`themes/`](themes/) folder, or create your own and import via **Theme > Import Theme**.

Imported themes are saved to `~/.colamd/themes/` and persist across sessions.

## Development

```bash
git clone https://github.com/marswaveai/colamd.git
cd colamd
npm install
npm run dev
```

### Build

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### Tech Stack

- **Electron** — Cross-platform desktop
- **Milkdown** — WYSIWYG Markdown (ProseMirror-based)
- **TypeScript** — Strict mode
- **electron-vite** — Fast builds

## Roadmap

ColaMD will evolve alongside the agent ecosystem:

- v1.1 — Live file reload, file associations, drag & drop, themes
- v1.2 — New icon
- v1.3 — Agent activity indicator, Cmd+click links, rich text copy, smart line breaks, PDF/HTML export, theme persistence
- v1.4 — Slides: Markdown as Database, HTML template rendering
- v1.5 — Export Slides: shareable single-file HTML with inlined images (current)
- Future — More templates, bidirectional sync, multi-file watching

## License

[MIT](LICENSE) — Free forever.

---

Built by [marswave.ai](https://marswave.ai) for the agent-native future.
