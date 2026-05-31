# RadiFlow Player Harness Guardrails

这些约束用于限制后续在本仓库中的自动化改动范围，目标是让修改保持在当前架构边界内，而不是让 agent 重新发明运行链路。

## 架构边界

- 保持三层结构不变：main.js 负责 Electron 主进程、窗口、IPC 和平台能力；server.ts 负责文件系统、媒体扫描、歌词缓存与 HTTP API；src/ 下负责 React UI 与前端状态。
- 不要把文件系统读写、第三方歌词请求或缓存落盘逻辑搬到渲染进程。
- 优先扩展现有 API / Hook / 组件，不要无故新增 preload、第二服务进程或新的全局状态中心。

## 持久化约束

- userData 目录仅用于应用级状态：shell-preferences.json、server-port.json。
- 选中的 music 目录下的 local 子目录用于媒体库与封面缓存。
- 选中的 music 目录下的 lyric 子目录用于歌词缓存；远端缓存持久化在 lyrics.db，用户手动歌词文件也保存在这里。
- lyric 目录允许用户手动放入与歌曲文件同名的 .lrc / .yrc / .txt 文件，用作远端无结果时的回退来源。
- 歌词命中顺序应保持为：先本地 lyrics.db 远端缓存，再远端搜索/获取；若远端无结果再尝试同名手动歌词文件；仅远端成功的歌词需要写入 lyrics.db。
- 不要把“暂无歌词”或失败结果当作长期落盘缓存写入 lyric 目录。

## 打包与运行链路

- 打包版必须继续通过 main.js 启动 dist-electron/server.js，再由窗口加载本地 HTTP 服务地址。
- 不要破坏稳定端口复用机制；server-port.json 仍然是打包版 localStorage origin 稳定性的前提。
- Vite 产物仍需保持相对路径加载；不要把资源路径改回绝对 /assets。

## UI 与平台约束

- src/index.css 中自定义背景模糊覆盖规则不要手写 -webkit-backdrop-filter，只写 backdrop-filter。
- Windows 任务栏缩略图工具栏和进度条逻辑只允许留在 main.js，并始终带 process.platform === 'win32' 守卫。
- App.tsx 仍然是全局播放器状态编排中心；若修改其状态流，必须同时检查 useLibrary、useLyrics、播放会话恢复和播放器控制区。

## 修改纪律

- 涉及架构、持久化、IPC、API 或缓存格式变化时，同步更新 DOCUMENT.md。
- 发生跨层改动时，优先执行 npm run build 进行验证。
- 不要顺手重构无关模块；优先做局部、可验证、可回滚的改动。
- 除非任务明确要求，否则不要把媒体库扫描改成递归，不要改写当前播放列表 identity 设计。
