# House Loan & Honoka Lite — Repository Wiki

> Comprehensive documentation generated from source code analysis.
> Last updated: 2026-05-15 | Codebase version: v1.4.6

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Module Index](#3-module-index)
4. [Honoka Bridge (Backend Server)](#4-honoka-bridge-backend-server)
5. [Chrome Extension (Honoka Lite)](#5-chrome-extension-honoka-lite)
6. [House Loan Clipper (Standalone)](#6-house-loan-clipper-standalone)
7. [Honoka Charts (Dashboard)](#7-honoka-charts-dashboard)
8. [Notion Forum Experiment](#8-notion-forum-experiment)
9. [Legacy Code](#9-legacy-code)
10. [API Reference](#10-api-reference)
11. [Data Storage Design](#11-data-storage-design)
12. [Implementation Status Matrix](#12-implementation-status-matrix)
13. [Configuration & Environment](#13-configuration--environment)
14. [Deployment](#14-deployment)
15. [Changelog Summary](#15-changelog-summary)

---

## 1. Project Overview

**House Loan & Honoka Lite** is a local-first knowledge management ecosystem built around mortgage/property research. It clips web content (especially from property sites like 591, 永慶, 大家房屋), converts it to Markdown, and stores it locally with full metadata.

### Core Capabilities

| Feature | Status | Module |
|---------|--------|--------|
| Visual web clipper (multi-block selection) | Implemented | Chrome Extension + Clipper |
| Notion page auto-analysis (token budget) | Implemented | Chrome Extension content.js |
| Notion page save to local Markdown | Implemented | content.js → Bridge |
| Telegram Bot URL → auto-save | Implemented | Bridge telegram.js |
| Full-page capture (PNG + PDF) via Playwright | Implemented | Bridge index.js |
| Property site data extraction (591/永慶/大家房屋) | Implemented | Bridge SITE_RULES |
| Video download (YouTube/X/Bilibili/Google Drive) | Implemented | Bridge downloader.js |
| Local document dashboard & preview | Implemented | Bridge dashboard.js + router.js |
| Charts & analytics for saved documents | Implemented | honoka-charts |
| Notion forum (Next.js) | Experimental | notion-forum-experiment |
| RxDB-based knowledge hub | Legacy | legacy/main.js |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     INPUT SOURCES                         │
│  ┌─────────────────┐  ┌──────────────────┐               │
│  │ Chrome Extension │  │ Telegram Bot User│               │
│  │ (Visual Clipper, │  │ (Send URL → save)│               │
│  │  Token Analyzer, │  │                  │               │
│  │  Video Download) │  │                  │               │
│  └────────┬────────┘  └────────┬─────────┘               │
└───────────┼────────────────────┼──────────────────────────┘
            │ HTTP POST          │ Long-polling
            ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│               HONOKA BRIDGE (Node.js)                     │
│  Port: 44124 (Lite) / 7749 (Company)                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ router.js — HTTP routing                             │ │
│  │  ├── /          → Dashboard HTML                     │ │
│  │  ├── /status    → JSON health check                  │ │
│  │  ├── /save      → Save document to disk              │ │
│  │  ├── /list      → List all saved docs                │ │
│  │  ├── /open      → Open in editor                     │ │
│  │  ├── /settings  → Read/write settings                │ │
│  │  ├── /preview   → Markdown preview                   │ │
│  │  ├── /restart   → Restart bridge                     │ │
│  │  ├── /files/*   → Static file serving                │ │
│  │  └── /api/*     → Capture, video, analytics, etc.   │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ storage.js       │  │ telegram.js      │              │
│  │ (Markdown gen,   │  │ (URL → Readability│              │
│  │  image download, │  │  → Turndown → MD)│              │
│  │  frontmatter)    │  │                  │              │
│  └──────────────────┘  └──────────────────┘              │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ downloader.js    │  │ settings.js      │              │
│  │ (yt-dlp wrapper) │  │ (config persist) │              │
│  └──────────────────┘  └──────────────────┘              │
│  ┌──────────────────────────────────────────────────┐    │
│  │ handlers/                                        │    │
│  │  ├── analytics.js — Document scanning & stats    │    │
│  │  ├── preview.js   — Markdown → HTML renderer     │    │
│  │  └── diff.js      — Line-level diff (Myers algo) │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│                 DATA LAYER (Local Filesystem)             │
│  ~/honoka-docs/           — Primary document store        │
│  ~/honoka-docs/Inbox/     — Telegram/clipped content      │
│  ~/honoka-docs/Inbound_Videos/ — Downloaded videos        │
│  ~/honoka-docs/.honoka/   — Settings & registry           │
│    ├── settings.json      — Bot tokens, config             │
│    └── registry.json      — Document index                 │
└──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│                   OUTPUT / VIEWING                        │
│  Dashboard (http://127.0.0.1:44124/)                     │
│  Honoka Charts (Vite + ECharts)                          │
│  Obsidian / Any Markdown editor                          │
└──────────────────────────────────────────────────────────┘
```

### Environment Detection

The Chrome Extension auto-detects its environment by checking `manifest.name`:

```javascript
const isLite = chrome.runtime.getManifest().name.includes("Lite");
const BRIDGE_URL = isLite ? "http://127.0.0.1:44124" : "http://127.0.0.1:7749";
```

- **Lite** → port `44124` (personal use)
- **Company** → port `7749` (corporate environment)

---

## 3. Module Index

| Directory | Type | Version | Description |
|-----------|------|---------|-------------|
| `honoka-lite/honoka-bridge/` | Node.js Server | v1.4.6 | Local bridge server (HTTP API + Telegram Bot) |
| `honoka-lite/chrome-extension/` | Chrome Extension | v1.4.6 | Notion token analyzer, visual clipper, video downloader |
| `honoka-lite/honoka-charts/` | Vite + ECharts | v1.2.2 | Document analytics dashboard |
| `house-loan-clipper/` | Chrome Extension | v2.0.0 | Standalone visual clipper (no Notion dependency) |
| `notion-forum-experiment/` | Next.js 16 | v0.1.0 | Experimental Notion-powered forum UI |
| `legacy/` | Express + RxDB | — | Original knowledge hub prototype |
| `docs/` | Markdown | — | Protocol & design documents |
| `doc2-4/` | Markdown | — | Planning & upgrade guides |

---

## 4. Honoka Bridge (Backend Server)

**Location**: `honoka-lite/honoka-bridge/`

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js >= 18.19.0 |
| HTTP Server | Native `http` module (no Express) |
| HTML → Markdown | Turndown |
| Article Extraction | @mozilla/readability + jsdom |
| Video Download | yt-dlp (spawned as child process) |
| Page Capture | Playwright (headless Chromium) |
| Telegram Bot | node-telegram-bot-api |
| Process Management | Node.js `cluster` (Manager/Worker) |
| Packaging | pkg (cross-platform binaries) |

### File Map

```
honoka-bridge/
├── index.js           (3055 lines) — Main server, routing, site rules, capture
├── lib/
│   ├── router.js      (141 lines)  — HTTP route handlers
│   ├── storage.js     (206 lines)  — Markdown generation, image download, frontmatter
│   ├── telegram.js    (191 lines)  — Telegram Bot integration
│   ├── downloader.js  (62 lines)   — yt-dlp video download wrapper
│   ├── dashboard.js   (101 lines)  — Dashboard HTML generation
│   ├── settings.js    (39 lines)   — Settings persistence
│   └── handlers/
│       ├── analytics.js (56 lines) — Document directory scanner
│       ├── preview.js   (63 lines) — Markdown → HTML renderer
│       └── diff.js      (36 lines) — Myers diff algorithm
├── install.sh / uninstall.sh  — Linux systemd setup
└── package.json
```

### Site-Specific Extraction Rules

The Bridge contains hardcoded rules for Taiwanese property websites:

| Site | Key | Data Extracted |
|------|-----|---------------|
| 591 售屋網 | `sale.591.com.tw` | price, ping (坪數), floor, layout, address, community |
| 永慶房仲網 | `buy.yungching.com.tw` | price, ping, floor, layout, address |
| 大家房屋 | `www.great-home.com.tw` | price (DOM-based) |

Extraction bypasses obfuscated DOM by reading `window.dataLayer` and `window.__INITIAL_STATE__` via regex on raw HTML.

### Process Architecture

```
Manager Process (cluster.isPrimary)
  └── Worker Process (cluster.fork)
        ├── HTTP Server
        ├── Telegram Bot (long-polling)
        └── All route handlers
```

If the Worker dies, the Manager auto-restarts it after 1.5 seconds. This prevents zombie states from Telegram long-polling connections.

---

## 5. Chrome Extension (Honoka Lite)

**Location**: `honoka-lite/chrome-extension/`

### Manifest

- **MV3** (Manifest Version 3)
- **Permissions**: `activeTab`, `scripting`, `storage`, `history`
- **Host Permissions**: Notion domains, `127.0.0.1:44124`, `127.0.0.1:7749`, `<all_urls>`

### File Map

```
chrome-extension/
├── manifest.json
├── popup/
│   ├── popup.html     — 3-tab UI (Analyzer, Clipper, Video)
│   ├── popup.js       (288 lines)  — Popup logic
│   └── popup.css
├── options/
│   ├── options.html   — Library / document browser
│   ├── options.js
│   └── options.css
├── src/
│   ├── background.js  (572 lines)  — Service worker: storage queue, clipper polling, API refresh
│   ├── content.js     (1448 lines) — Notion content script: token analysis, overlay, save
│   ├── content.css    — Overlay styles
│   ├── notion-api.js  (492 lines)  — Notion internal API client
│   ├── config.js      — Budget & method defaults
│   ├── history-idb.js — (IndexedDB history, if present)
│   └── features/clipper/
│       └── selector.js (237 lines) — Visual block selector (injected into any page)
├── icons/
└── dist/              — Built/bundled content script
```

### Key Features

#### Token Budget Analyzer (content.js)

When a Notion page loads, the content script:
1. Auto-detects the page and runs analysis
2. Splits the page into sections by headings (h1-h4)
3. Estimates tokens using multiple methods:
   - **Claude BPE** (exact, using `js-tiktoken` with Claude's vocabulary)
   - **chars/4** — heuristic for English text
   - **chars/3** — heuristic for CJK-heavy text
   - **words×1.3** — mixed text/code
   - **code** — code-weighted (chars/3.5)
4. Calculates media overhead (images, SVG, draw.io, Mermaid, PlantUML, tables)
5. Renders a floating overlay with budget ring and per-section breakdown
6. Auto-refreshes via MutationObserver when content changes

#### Visual Clipper (selector.js + background.js)

Flow:
1. User clicks "選取區塊" in popup
2. `background.js` injects `selector.js` into the active tab
3. User hovers to highlight elements, clicks to select/deselect
4. Bottom toolbar shows count + confirm/cancel/clear buttons
5. On confirm, `selector.js` cleans HTML (removes scripts/styles/data URIs) and stores result in `window.__khSelectionResult`
6. `background.js` polls `window.__khGetResult()` every 1 second
7. When result is ready, it POSTs to `BRIDGE_URL/save`

#### Notion API Client (notion-api.js)

Uses the browser's session cookies (`token_v2`) to call undocumented Notion APIs:
- `loadPageChunk` — load block tree
- `loadFullPage` — auto-paginate all chunks
- `queryCollection` — query a database
- `getSnapshotsList` — version history
- `getActivityLog` — edit/comment activity
- `getRecordValues` — fetch arbitrary records
- `getCurrentUser` — detect logged-in user
- `getPageDiscussions` — page comments
- `analyzePageViaAPI` — full structured analysis
- `extractPageProperties` — database properties with schema mapping

#### Storage Queue (background.js)

All Chrome storage writes are serialized through a Promise queue (`enqueue()`) to prevent race conditions when multiple Notion tabs write concurrently. Each page gets a key `honoka_page_{pageId}` and a global index `honoka_global_index`.

---

## 6. House Loan Clipper (Standalone)

**Location**: `house-loan-clipper/`

A simpler, standalone Chrome extension for visual content clipping without Notion dependencies.

| Property | Value |
|----------|-------|
| Manifest Version | 3 |
| Name | Knowledge Hub Clipper |
| Version | 2.0.0 |
| Bridge Port | 44123 (different from Honoka Lite's 44124) |
| Permissions | `activeTab`, `scripting` |

### Files

```
house-loan-clipper/
├── manifest.json
├── popup.html         — Minimal clip UI
├── popup.js           — Triggers content script, sends to bridge
└── content-script.js  (226 lines) — Visual selector (same pattern as selector.js)
```

The content script is functionally identical to `honoka-lite/chrome-extension/src/features/clipper/selector.js` — same hover/select/confirm pattern, same `window.__khGetResult()` polling mechanism. The key difference is that it talks to port 44123 instead of 44124.

---

## 7. Honoka Charts (Dashboard)

**Location**: `honoka-lite/honoka-charts/`

A Vite-powered ECharts dashboard for visualizing saved documents.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Build | Vite 6 |
| Charts | ECharts 5 |
| Module Type | ES Modules |

### File Map

```
honoka-charts/
├── index.html          — Main entry
├── csv-viewer.html     — CSV data viewer
├── vite.config.js
├── package.json        — v1.2.2
└── src/
    ├── main.js         (75 lines)  — Bootstrap, loads data from Bridge
    ├── api.js          — Fetch from Bridge /list endpoint
    ├── store.js        — Shared reactive state
    ├── filters.js      — Date/source filter bar
    ├── table.js        — Searchable data table
    ├── style.css
    └── charts/
        ├── timeline.js  — Save activity over time
        ├── tokens.js    — Token distribution
        ├── authors.js   — Content authorship
        ├── lifecycle.js — Document lifecycle stages
        └── stacked.js   — Stacked category breakdown
```

### Data Source

Fetches from `http://127.0.0.1:44124/list` and auto-refreshes every 30 seconds.

---

## 8. Notion Forum Experiment

**Location**: `notion-forum-experiment/`

An experimental Next.js application that uses the official Notion SDK to render a forum-style interface.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16.2.4 |
| React | 19.2.4 |
| Styling | Tailwind CSS 4 |
| Notion SDK | @notionhq/client 5.20.0 |
| Language | TypeScript |

### File Map

```
notion-forum-experiment/
├── src/
│   ├── app/
│   │   ├── layout.tsx      — Root layout
│   │   ├── page.tsx        — Forum post list
│   │   ├── actions.ts      — Server actions
│   │   ├── globals.css
│   │   └── post/[id]/
│   │       └── page.tsx    — Individual post view
│   ├── components/
│   │   ├── FormSubmitButton.tsx
│   │   ├── NewPostModal.tsx
│   │   └── NotionRenderer.tsx
│   └── lib/
│       └── notion.ts       — Notion API client (official SDK)
└── package.json
```

**Status**: Experimental/prototype. Uses the official Notion API (not the internal undocumented API used by the Chrome extension).

---

## 9. Legacy Code

**Location**: `legacy/`

The original Express + RxDB implementation of the Knowledge Hub.

| File | Description |
|------|-------------|
| `index.html` | Forum-style UI with glassmorphism design |
| `forum.html` | Alternative forum layout |
| `main.js` (241 lines) | Express server with RxDB in-memory storage, Turndown conversion, slugify |

This used RxDB with in-memory storage, dumping to `rxdb_data.json` for persistence. It served as the initial prototype before the current filesystem-based architecture was adopted.

---

## 10. API Reference

### Honoka Bridge HTTP Endpoints

Base URL: `http://127.0.0.1:44124`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| GET | `/` | Dashboard HTML | — | HTML |
| GET | `/status` | Health check | — | `{ ok, version, docsDir, editor, port, pid, startedAt, integrations }` |
| POST | `/save` | Save document to disk | `{ pageId?, title?, markdown?, html?, images[], properties?, url?, source?, category? }` | `{ ok, slug, folder, path }` |
| GET | `/list` | List all saved docs | — | `{ docs[], docsDir, count }` |
| POST | `/open` | Open in editor | `{ folder?, file?, editor? }` | `{ ok, opened }` |
| GET | `/settings` | Read settings | — | Settings JSON |
| POST | `/settings` | Update settings | `{ telegramBotToken?, telegramAllowedUser? }` | `{ ok, changed }` |
| GET | `/preview?folder=` | Preview doc in iframe | — | HTML |
| GET | `/preview-content?folder=` | Rendered Markdown | — | HTML |
| POST | `/restart` | Restart bridge server | — | `{ ok, message }` |
| GET | `/files/{folder}/{path}` | Serve static files | — | File content |
| POST | `/api/capture` | Playwright full-page capture | `{ url, folder? }` | `{ ok, screenshots[] }` |
| POST | `/api/video/download` | Download video via yt-dlp | `{ url }` | `{ ok, filename? }` |
| GET | `/api/video/status` | Video download progress | — | Progress JSON |
| POST | `/history/ingest` | Receive page visit from extension | `{ pageId, title, url, ... }` | `{ ok }` |

### Chrome Extension Messages (Internal)

| Action | Direction | Description |
|--------|-----------|-------------|
| `analyze` | popup → content | Trigger token analysis with budget & method |
| `saveLocally` | popup → content | Save current page via Bridge |
| `checkBridge` | popup → content | Check if Bridge is running |
| `startClipper` | popup → background | Inject selector.js and start polling |
| `clipperResult` | background → popup | Report clipper save result |
| `updateBadge` | content → background | Update extension badge with token count |
| `upsertPageEntry` | content → background | Create/update page in history |
| `patchPageMeta` | content → background | Update page metadata |
| `patchPageTitle` | content → background | Update page title |
| `refreshPageMeta` | popup → background | Refresh metadata via Notion API |
| `deletePages` | popup → background | Delete pages from history |
| `clearAllHistory` | popup → background | Clear all visit history |
| `enforceLimit` | popup → background | Trim history to N entries |
| `getTitleFromHistory` | background → background | Lookup title from Chrome history |
| `fetchPageMeta` | background → content | Fetch page metadata (fallback) |

---

## 11. Data Storage Design

### Directory Structure

```
~/honoka-docs/                        (DOCS_DIR)
├── .honoka/
│   ├── settings.json                 (bot tokens, config)
│   └── registry.json                 (document index)
├── Inbox/                            (clipped/telegram content)
│   └── {folder-name}/
│       ├── index.md                  (Markdown with frontmatter)
│       ├── source.html               (original HTML, if available)
│       └── images/                   (downloaded images)
├── Inbound_Videos/                   (yt-dlp downloads)
│   ├── Video-{timestamp}-{title}.mp4
│   └── Video-{timestamp}-{title}.mp4.md  (sidecar metadata)
└── {folder-name}/                    (Notion-saved content)
    ├── index.md
    ├── source.html
    ├── images/
    ├── capture.png                   (Playwright full-page screenshot)
    └── capture.pdf                   (Playwright PDF archive)
```

### Markdown Frontmatter Schema

Every saved `index.md` starts with YAML frontmatter:

```yaml
---
title: "Page Title"
source: notion|clip|telegram
category: mine|reference
page_id: "notion-page-uuid"       # Notion pages only
url: "https://original-url"
saved_at: "2026-05-15T10:30:00.000Z"
price: "1,200萬"                   # Property sites only
ping: "32.5坪"
floor: "12F/15F"
layout: "3房2廳"
address: "台北市..."
community: "社區名稱"
---
```

### Registry Schema (`registry.json`)

```json
{
  "page-id-or-slug": {
    "folder": "folder-name",
    "title": "Document Title",
    "category": "mine|reference",
    "notionUrl": "https://notion.so/...",
    "savedAt": "ISO-8601",
    "lastSynced": "ISO-8601"
  }
}
```

---

## 12. Implementation Status Matrix

### Code vs. Plans Cross-Reference

| Feature | ROADMAP Phase | Documented In | Code Status | Notes |
|---------|---------------|---------------|-------------|-------|
| Visual clipper (multi-block) | Phase 1 | README | **Implemented** | `selector.js` in both clipper and extension |
| Notion page save | Phase 1 | README | **Implemented** | `content.js` → Bridge `/save` |
| Markdown generation + frontmatter | Phase 1 | storage-design.md | **Implemented** | `storage.js` |
| Local file storage | Phase 1 | storage-design.md | **Implemented** | `~/honoka-docs/` hierarchy |
| Bridge HTTP API | Phase 1 | README | **Implemented** | `router.js`, `index.js` |
| Telegram Bot | Phase 2 | README | **Implemented** | `telegram.js` |
| Video download (yt-dlp) | Phase 2 | CHANGELOG | **Implemented** | `downloader.js` |
| Playwright capture (PNG+PDF) | Phase 2 | CHANGELOG | **Implemented** | `index.js` SITE_RULES + capture |
| Property site extraction | Phase 2 | doc3/ report | **Implemented** | `index.js` SITE_RULES |
| Document analytics | Phase 2 | — | **Implemented** | `honoka-charts/` |
| Dashboard + preview | Phase 2 | — | **Implemented** | `dashboard.js`, `preview.js` |
| Notion API property extraction | Phase 2 | — | **Implemented** | `notion-api.js` |
| Document diff | Phase 2 | — | **Implemented** | `diff.js` (Myers algorithm) |
| Notion forum (official SDK) | Phase 2 | notion_forum_architecture.md | **Experimental** | `notion-forum-experiment/` |
| Notion reverse sync | Phase 2 | ROADMAP | **Not implemented** | Listed as `[/]` (in progress) |
| Bidirectional sync | Phase 2 | ROADMAP | **Not implemented** | Listed as `[ ]` |
| Sanitization layer | Phase 2.5 | ROADMAP | **Not implemented** | Explicitly deferred |
| Consensus protocol | Phase 2.5 | ROADMAP | **Not implemented** | Explicitly deferred |
| P2P social layer | Phase 3 | ROADMAP | **Not implemented** | Explicitly deferred (白日夢) |
| Local RAG | Phase 4 | ROADMAP | **Not implemented** | Explicitly deferred |

### Undocumented Features Found in Code

These features exist in the codebase but are not mentioned in README or ROADMAP:

| Feature | Location | Description |
|---------|----------|-------------|
| Claude BPE tokenizer | `content.js` | Uses `js-tiktoken` with Claude's vocabulary for exact token counts |
| Chrome storage queue | `background.js` | Serialized Promise queue to prevent concurrent write races |
| Direct API fallback | `background.js` | Service worker can directly call Notion API (no content script needed) |
| Canvas image capture | `content.js` | Falls back to `<canvas>` drawImage when fetch fails for images |
| Auto-categorization | `content.js` | Auto-detects "mine" vs "reference" by matching Notion user ID |
| Escape key support | `selector.js` | Press Escape to cancel clipper selection |
| DevTools debug harness | `content.js` | `window.__honoka` API for console debugging |

---

## 13. Configuration & Environment

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HONOKA_PORT` | `44124` | Bridge server port |
| `HONOKA_DOCS_DIR` | `~/honoka-docs` | Primary document storage directory |
| `HONOKA_EDITOR` | `cursor` | Editor for `/open` command (`cursor` or `code`) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram Bot API token (can also be set via UI) |
| `TELEGRAM_ALLOWED_USER` | — | Telegram user ID whitelist |
| `SLACK_BOT_TOKEN` | — | Slack Bot token (placeholder, not implemented) |
| `SLACK_ALLOWED_CHANNEL` | — | Slack channel whitelist (placeholder) |

### Settings File

Persisted at `~/honoka-docs/.honoka/settings.json`:

```json
{
  "telegramBotToken": "...",
  "telegramAllowedUser": "...",
  "slackBotToken": "",
  "slackAllowedChannel": ""
}
```

Environment variables override file settings.

### Key Paths

| Path | Description |
|------|-------------|
| `~/honoka-docs/` | Primary document store (DOCS_DIR) |
| `~/honoka-docs/Inbox/` | Clipped/Telegram content |
| `~/honoka-docs/Inbound_Videos/` | Downloaded videos |
| `~/honoka-docs/.honoka/settings.json` | Bridge settings |
| `~/honoka-docs/.honoka/registry.json` | Document registry |

---

## 14. Deployment

### Linux (systemd)

```bash
cd honoka-lite
./install.sh    # Registers as systemd --user service
```

The service auto-restarts on failure. The Manager/Worker cluster provides additional resilience.

### Windows

```cmd
cd honoka-lite\honoka-bridge
node index.js
```

For auto-restart, use a wrapper `.bat`:

```cmd
:start
node index.js
goto start
```

Or use the compiled binary with `--install` flag to register as a startup service.

### Cross-Platform Binaries

```bash
npm run build:win      # → bin/honoka-bridge.exe
npm run build:macos    # → bin/honoka-bridge-macos
npm run build:linux    # → bin/honoka-bridge-linux
npm run build:all      # All platforms
```

### Chrome Extension Installation

1. Open `chrome://extensions`
2. Enable Developer Mode
3. "Load unpacked" → select `honoka-lite/chrome-extension`

---

## 15. Changelog Summary

| Version | Date | Highlights |
|---------|------|-----------|
| **v1.4.6** | 2026-04-30 | Playwright auto-installer, full property data sync, filename decoupling |
| **v1.4.4** | 2026-04-30 | Telegram auto-capture (PNG+PDF on URL send) |
| **v1.4.2** | 2026-04-30 | 591/永慶/大家房屋 extraction, Playwright capture |
| **v1.4.0** | 2026-04-30 | Dashboard video downloader, extension video tab |
| **v1.3.4** | 2026-04-29 | Universal video (Google Drive, YouTube, Bilibili) |
| **v1.3.2** | 2026-04-29 | X/Twitter video via yt-dlp |
| **v1.2.1** | 2026-04-28 | Telegram Bot integration, dynamic settings UI, restart fix |
| **v1.2.6** | — | ESM compatibility fix for Node 18 |
| **v1.2.5** | — | IPv4-first DNS for Linux Telegram stability |
| **v1.2.3** | — | Cluster architecture, dual-view preview |

Full changelog: `honoka-lite/CHANGELOG.md`
