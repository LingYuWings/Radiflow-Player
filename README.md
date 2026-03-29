<p align="center">
  <img src="./logo.svg" alt="RadiFlow Player logo" width="120" />
</p>

<h1 align="center">RadiFlow Player</h1>

<p align="center">A desktop music player focused on local libraries, immersive playback, synced lyrics, and animated browsing.</p>

<p align="center">
  English | <a href="./readme-zh.md">中文</a>
</p>

## Overview

RadiFlow Player is a desktop-first music player built with Electron, React, Vite, and Express.

The project is structured as a full desktop application rather than a standalone frontend:

- Electron handles the window shell, tray, shortcuts, and IPC.
- Express handles local media scanning, asset serving, and lyric proxy APIs.
- React handles the player UI, library browsing, playlists, animations, and settings.

The current project state is already usable as a local desktop player foundation and is being actively iterated around interaction quality, animation smoothness, and large-library performance.

## Current Capabilities

- Local music folder scanning and library browsing
- Song, artist, album, playlist, and search views
- Mini player and full player playback flow
- Play, pause, seek, next, previous, loop, shuffle, and volume control
- Synced lyrics lookup, parsing, and scrolling display
- Dynamic background and streamer-style visual effects
- Album and artist detail browsing with animated transitions
- Metadata and cover caching to reduce repeated scanning cost on large libraries

The current minimum window size is 1200 × 880, and the UI is optimized primarily for desktop usage.

## Tech Stack

- Electron 41
- React 19
- TypeScript 5
- Vite 6
- Express 4
- Tailwind CSS 4
- motion/react
- music-metadata
- colorthief

## Architecture

The app is split into three layers:

1. Electron main process
	Creates the application window, manages tray behavior, media shortcuts, and window control IPC.
2. Local service layer
	Scans the music folder, reads metadata, serves local media assets, stores cache artifacts, and proxies lyric APIs.
3. React frontend layer
	Manages the library, player, playlists, settings, animations, and playback session state.

Primary entry points:

- main.js: Electron main process entry
- server.ts: local server and development entry
- src/App.tsx: top-level frontend orchestration
- src/components/Library.tsx: library views and artist/album detail flows
- src/components/Background.tsx: background and streamer visual system

## Quick Start

### Requirements

- Node.js 20+ recommended
- npm

### Install

```bash
npm install
```

### Run In Development

Start the local service layer:

```bash
npm run dev
```

Start the Electron desktop app:

```bash
npm run electron:dev
```

For full UI and system interaction testing, Electron mode is the recommended environment.

### Build And Preview

```bash
npm run build
npm run electron:preview
```

## Scripts

```bash
npm run dev
npm run electron:dev
npm run build
npm run preview
npm run electron:preview
npm run lint
```

Script summary:

- npm run dev: starts the Express server with Vite middleware
- npm run electron:dev: launches the desktop app in development mode
- npm run build: builds the frontend output
- npm run preview: previews the Vite build
- npm run electron:preview: builds and launches the Electron preview flow
- npm run lint: runs TypeScript no-emit checks

## Library And Cache Behavior

- The default music folder is music/ in the repository root.
- The app ensures the default folder exists on startup.
- Users can switch to another local music folder in Settings.
- The service layer caches metadata and cover assets to reduce repeated parsing work.
- Manual library refresh and folder switching trigger cache updates.

This cache path is intended to keep large local libraries responsive across repeated app launches and library revisits.

## Project Structure

```text
.
├─ main.js
├─ server.ts
├─ package.json
├─ README.md
├─ readme-zh.md
├─ DOCUMENT.md
├─ music/
├─ scripts/
└─ src/
	├─ App.tsx
	├─ main.tsx
	├─ index.css
	├─ components/
	├─ hooks/
	├─ lib/
	├─ types/
	└─ utils/
```

## Where To Start Reading The Code

If you are new to the codebase, this order is the fastest way to understand it:

1. src/App.tsx
2. src/components/Library.tsx
3. src/components/PlayerControls.tsx
4. src/components/Background.tsx
5. src/hooks/useLibrary.ts
6. server.ts
7. main.js

This sequence helps you understand the UI state model first, then the service layer and desktop shell.

## Development Notes

- The project is desktop-first rather than mobile-first.
- Some interactions depend on Electron, especially folder selection and window controls.
- Lyrics depend on proxied remote APIs, so network failures should be considered during debugging.
- Animation quality and large-library performance are active optimization areas.

## More Documentation

For a deeper maintenance-oriented guide, read DOCUMENT.md.

README is intended as the project front page. DOCUMENT.md is intended as the detailed developer manual.

## Chinese Version

If you prefer Chinese documentation, open [readme-zh.md](./readme-zh.md).

这套缓存逻辑的目标是让较大的本地曲库在多次打开应用或反复进入媒体库时保持更快响应。

## 目录结构

```text
.
├─ main.js
├─ server.ts
├─ package.json
├─ README.md
├─ readme-zh.md
├─ DOCUMENT.md
├─ music/
├─ scripts/
└─ src/
	├─ App.tsx
	├─ main.tsx
	├─ index.css
	├─ components/
	├─ hooks/
	├─ lib/
	├─ types/
	└─ utils/
```

## 建议的阅读顺序

如果你第一次接手这个项目，建议按下面顺序阅读：

1. src/App.tsx
2. src/components/Library.tsx
3. src/components/PlayerControls.tsx
4. src/components/Background.tsx
5. src/hooks/useLibrary.ts
6. server.ts
7. main.js

这样可以先理解界面主状态，再回到本地服务层和桌面壳层。

## 开发注意事项

- 项目当前以桌面端体验优先，不以移动端适配为主要目标
- 部分交互依赖 Electron 环境，尤其是文件夹选择与窗口控制
- 歌词依赖代理远程接口，调试时要考虑网络失败场景
- 动画质量和大媒体库性能是当前持续优化重点

## 更多文档

如果你需要更完整的维护说明、模块边界和开发手册，请继续阅读 DOCUMENT.md。

README 用于快速了解项目，DOCUMENT.md 用于深入维护项目。
