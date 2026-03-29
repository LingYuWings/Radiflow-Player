<p align="center">
  <img src="./logo.svg" alt="RadiFlow Player logo" width="120" />
</p>

<h1 align="center">RadiFlow Player</h1>

<p align="center">一个面向本地媒体库、沉浸式播放、歌词联动与动画浏览体验的桌面音乐播放器。</p>

<p align="center">
  <a href="./README.md">English</a> | 中文
</p>

## 项目概览

RadiFlow Player 是一个基于 Electron、React、Vite 和 Express 构建的桌面端音乐播放器。

它不是单纯的前端页面，而是一个完整的桌面应用：

- Electron 负责窗口壳层、托盘、快捷键和 IPC。
- Express 负责本地媒体扫描、资源访问和歌词代理接口。
- React 负责播放器界面、媒体库浏览、播放列表、设置和动画交互。

当前项目已经具备一套可持续迭代的本地桌面播放器基础能力，后续优化重点仍然集中在交互质量、动画流畅度和大媒体库性能。

## 当前能力

- 本地音乐目录扫描与媒体库浏览
- 歌曲、歌手、专辑、播放列表、搜索等视图
- 迷你播放器与完整播放器切换
- 播放、暂停、拖动进度、上一首、下一首、循环、随机、音量控制
- 歌词搜索、解析与滚动展示
- 动态背景与流光视觉效果
- 专辑与歌手详情浏览动画
- 媒体元数据与封面缓存，降低大媒体库重复扫描成本

当前窗口最小尺寸为 1200 × 880，界面主要面向桌面端体验。

## 技术栈

- Electron 41
- React 19
- TypeScript 5
- Vite 6
- Express 4
- Tailwind CSS 4
- motion/react
- music-metadata
- colorthief

## 架构说明

项目分为三层：

1. Electron 主进程层
   负责创建窗口、托盘行为、媒体快捷键以及窗口控制 IPC。
2. 本地服务层
   负责扫描音乐目录、读取元数据、提供本地媒体资源、写入缓存并代理歌词接口。
3. React 前端层
   负责媒体库、播放器、播放列表、设置页、动画以及播放状态管理。

核心入口文件：

- main.js: Electron 主进程入口
- server.ts: 本地服务与开发入口
- src/App.tsx: 前端主编排层
- src/components/Library.tsx: 媒体库视图与歌手/专辑详情流
- src/components/Background.tsx: 背景与流光系统

## 快速开始

### 环境要求

- 推荐 Node.js 20+
- npm

### 安装依赖

```bash
npm install
```

### 开发模式运行

启动本地服务层：

```bash
npm run dev
```

启动 Electron 桌面应用：

```bash
npm run electron:dev
```

如果要验证完整桌面交互，建议优先在 Electron 模式下调试。

### 构建与预览

```bash
npm run build
npm run electron:preview
```

## 常用脚本

```bash
npm run dev
npm run electron:dev
npm run build
npm run preview
npm run electron:preview
npm run lint
```

脚本说明：

- npm run dev: 启动 Express 服务和 Vite 中间件
- npm run electron:dev: 启动桌面开发模式
- npm run build: 构建前端产物
- npm run preview: 预览 Vite 构建结果
- npm run electron:preview: 构建后以 Electron 方式预览
- npm run lint: 执行 TypeScript 无输出检查

## 媒体库与缓存

- 默认音乐目录为仓库根目录下的 music/
- 应用启动时会确保默认目录存在
- 可以在设置页切换到其他本地音乐目录
- 服务层会缓存媒体元数据与封面资源，减少重复解析
- 手动刷新媒体库或切换目录时会同步更新缓存

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