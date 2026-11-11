import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MousePointer2, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

type Language = 'zh-CN' | 'en-US';
export type GuideSurface = 'library' | 'player';
export type GuidePanel = 'lyrics' | 'playlist';
type Copy = { title: string; body: string; action?: string };
type Step = { target: string; surface: GuideSurface; panel?: GuidePanel; advanceOnClick?: boolean; zh: Copy; en: Copy };
type Box = { x: number; y: number; width: number; height: number };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const steps: Step[] = [
  { target: 'guide-entry', surface: 'library', zh: { title: '随时重新打开指引', body: '顶部的问号是指引入口。接下来会指向真实控件，你可以边看边操作。' }, en: { title: 'Reopen this tour anytime', body: 'The question mark in the title bar reopens this guide. You can try each highlighted control.' } },
  { target: 'guide-eq', surface: 'library', zh: { title: '均衡器', body: '在这里选择预设，或调整各频段与声音效果。', action: '可以点开查看，再点“下一步”。' }, en: { title: 'Equalizer', body: 'Choose a preset or tune frequency bands and sound effects.', action: 'Try opening it, then press Next.' } },
  { target: 'guide-settings', surface: 'library', zh: { title: '设置', body: '背景、毛玻璃模糊、音频可视化和语言都在这里。', action: '可以点开查看，再点“下一步”。' }, en: { title: 'Settings', body: 'Change the background, glass blur, visualizer, and language here.', action: 'Try opening it, then press Next.' } },
  { target: 'guide-source', surface: 'library', zh: { title: '切换音乐来源', body: '在本地曲库与网易云之间切换；网易云内容需要登录。' }, en: { title: 'Choose your music source', body: 'Switch between local music and NetEase. NetEase content requires sign-in.' } },
  { target: 'guide-navigation', surface: 'library', zh: { title: '浏览与搜索', body: '左侧导航进入歌单、收藏与搜索；本地模式还提供歌曲、歌手和专辑入口。右侧内容随选择更新。' }, en: { title: 'Browse and search', body: 'Use the left navigation for playlists, favorites, and search. Local mode also offers songs, artists, and albums.' } },
  { target: 'guide-playlists', surface: 'library', zh: { title: '播放列表', body: '这里浏览歌单，右上角加号可新建播放列表。' }, en: { title: 'Playlists', body: 'Browse playlists here. Use the plus button to create one.' } },
  { target: 'guide-create-playlist', surface: 'library', zh: { title: '新建播放列表', body: '点击加号整理自己的歌曲。网易云歌单需要登录后才能创建。' }, en: { title: 'Create a playlist', body: 'Use the plus button to organize your songs. Creating a NetEase playlist requires sign-in.' } },
  { target: 'guide-library', surface: 'library', zh: { title: '曲库工作区', body: '歌曲、专辑和搜索结果在这里。选歌后，底部迷你播放器会更新。' }, en: { title: 'Library workspace', body: 'Songs, albums, and search results appear here. Selecting a track updates the mini player below.' } },
  { target: 'guide-dock-track', surface: 'library', zh: { title: '正在播放', body: '迷你播放器左侧显示歌曲信息。点击封面或标题可展开播放器。' }, en: { title: 'Now playing', body: 'The mini player shows the current track. Click the artwork or title to expand the player.' } },
  { target: 'guide-dock-transport', surface: 'library', zh: { title: '快捷播放控制', body: '在首页即可播放、暂停，以及切换上一首或下一首。' }, en: { title: 'Quick playback controls', body: 'Play, pause, and skip tracks without leaving Home.' } },
  { target: 'guide-dock-progress', surface: 'library', zh: { title: '调整进度', body: '拖动底部进度条可跳到歌曲的指定位置。' }, en: { title: 'Seek within a track', body: 'Drag the bottom progress bar to jump to a specific position.' } },
  { target: 'guide-dock-volume', surface: 'library', zh: { title: '音量浮窗', body: '点击音量按钮展开浮窗；点击外侧任意位置可收起。', action: '现在可以点开试试。' }, en: { title: 'Volume popover', body: 'Click to adjust volume; click outside to close the popover.', action: 'Try opening it now.' } },
  { target: 'guide-dock-queue', surface: 'library', zh: { title: '迷你播放队列', body: '点击列表按钮查看接下来播放的歌曲；队列会定位到当前歌曲。点击外侧可收起。', action: '现在可以点开试试。' }, en: { title: 'Mini play queue', body: 'Open upcoming tracks here. The queue follows the current song and closes on outside click.', action: 'Try opening it now.' } },
  { target: 'guide-dock-expand', surface: 'library', advanceOnClick: true, zh: { title: '进入完整播放器', body: '点击上箭头展开播放器，查看封面、歌词和更多功能。', action: '点击高亮按钮会自动进入下一步。' }, en: { title: 'Open the full player', body: 'Use the up arrow to reveal artwork, lyrics, and more controls.', action: 'Click the highlighted button to advance.' } },
  { target: 'guide-player-artwork', surface: 'player', zh: { title: '专辑封面', body: '当前歌曲封面是视觉中心。有专辑信息时，点击封面可进入专辑。' }, en: { title: 'Album artwork', body: 'The current artwork anchors the player. Click it to open the album when available.' } },
  { target: 'guide-player-track', surface: 'player', zh: { title: '歌曲信息与收起入口', body: '这里显示歌曲和歌手；向下按钮可回到主页，播放进度仍会保留。' }, en: { title: 'Track details and collapse', body: 'See the song and artist here. The down arrow returns Home without losing progress.' } },
  { target: 'guide-player-visualizer', surface: 'player', zh: { title: '随音乐律动', body: '这里显示音频可视化。可在设置中切换效果，也可以关闭。' }, en: { title: 'Visualize the music', body: 'Audio visualization lives here. Switch styles or turn it off in Settings.' } },
  { target: 'guide-player-progress', surface: 'player', zh: { title: '播放进度', body: '拖动跳转；下方显示时长及缓冲状态。' }, en: { title: 'Playback progress', body: 'Drag to seek. Time and buffering status appear below.' } },
  { target: 'guide-player-modes', surface: 'player', zh: { title: '播放模式', body: '循环按钮切换顺序、列表循环和单曲循环；旁边可开启随机播放。' }, en: { title: 'Playback modes', body: 'Cycle between no loop, repeat-all, and repeat-one; shuffle is beside it.' } },
  { target: 'guide-player-transport', surface: 'player', zh: { title: '播放与切歌', body: '中央按钮控制播放，左右按钮切换歌曲。' }, en: { title: 'Play and skip', body: 'The center button controls playback; the buttons beside it skip tracks.' } },
  { target: 'guide-player-lyrics', surface: 'player', zh: { title: '展开歌词', body: '麦克风按钮切换同步歌词；点击歌词行可跳转时间。', action: '选歌后可点击；也可继续预览右侧面板。' }, en: { title: 'Show lyrics', body: 'The microphone toggles synchronized lyrics. Click a line to seek.', action: 'Available after selecting a track; you can also preview the panel.' } },
  { target: 'guide-player-secondary', surface: 'player', panel: 'lyrics', zh: { title: '歌词面板', body: '当前行突出显示，翻译随当前歌词出现。无歌词时会显示提示。' }, en: { title: 'Lyrics panel', body: 'The active line takes focus and translations follow it. A placeholder appears if lyrics are unavailable.' } },
  { target: 'guide-player-queue', surface: 'player', zh: { title: '切换播放队列', body: '列表按钮切换到完整播放队列，可管理即将播放的歌曲。', action: '选歌后可点击；也可继续预览右侧面板。' }, en: { title: 'Switch to the queue', body: 'The list button opens the full queue for managing upcoming tracks.', action: 'Available after selecting a track; you can also preview the panel.' } },
  { target: 'guide-player-secondary', surface: 'player', panel: 'playlist', zh: { title: '完整播放队列', body: '右侧列出当前歌曲和队列；可以选择、排序或移除歌曲。' }, en: { title: 'Full play queue', body: 'Select, reorder, or remove tracks from the queue on the right.' } },
  { target: 'guide-player-volume', surface: 'player', zh: { title: '精细调整音量', body: '播放器底部音量滑条与迷你播放器同步。' }, en: { title: 'Fine-tune volume', body: 'The full-player volume slider stays in sync with the mini player.' } },
  { target: 'guide-player-fullscreen', surface: 'player', zh: { title: '沉浸模式', body: '右上角按钮将歌词区域扩展为沉浸视图；再次点击恢复。' }, en: { title: 'Immersive mode', body: 'The top-right button expands the lyrics area. Click again to restore it.' } },
];
const stepsWithoutVisualizer = steps.filter(step => step.target !== 'guide-player-visualizer');

export function OnboardingGuide({ language, onDismiss, onPrepareStep, visualizerEnabled }: { language: Language; onDismiss: () => void; onPrepareStep: (surface: GuideSurface, panel?: GuidePanel) => void; visualizerEnabled: boolean }) {
  const activeSteps = visualizerEnabled ? steps : stepsWithoutVisualizer;
  const [stepIndex, setIndex] = useState(0);
  const index = Math.min(stepIndex, activeSteps.length - 1);
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const [cardBox, setCardBox] = useState<Box>({ x: 16, y: 80, width: 360, height: 270 });
  const cardRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const step = activeSteps[index];
  const copy = step[language === 'zh-CN' ? 'zh' : 'en'];

  useEffect(() => { onPrepareStep(step.surface, step.panel); }, [index, onPrepareStep, step.surface, step.panel]);
  useEffect(() => { nextRef.current?.focus(); }, [index]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onDismiss(); }
      else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); setIndex(value => Math.min(activeSteps.length - 1, value + 1)); }
      else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activeSteps.length, onDismiss]);

  useLayoutEffect(() => {
    let frame = 0;
    let active = true;
    let observed: HTMLElement | null = null;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    const start = performance.now();
    function measure() {
      if (!active) return;
      const target = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
      if (target !== observed) {
        observer?.disconnect();
        if (target) observer?.observe(target);
        if (cardRef.current) observer?.observe(cardRef.current);
        observed = target;
      }
      const rect = target?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1 || target?.closest('[inert], [aria-hidden="true"]')) {
        setTargetBox(null);
        if (performance.now() - start < 2200) frame = requestAnimationFrame(measure);
        return;
      }
      const boxX = clamp(rect.left - 6, 8, window.innerWidth - 8);
      const boxY = clamp(rect.top - 6, 8, window.innerHeight - 8);
      const box = { x: boxX, y: boxY, width: Math.min(rect.width + 12, window.innerWidth - boxX - 8), height: Math.min(rect.height + 12, window.innerHeight - boxY - 8) };
      const width = Math.min(360, window.innerWidth - 32);
      const height = cardRef.current?.offsetHeight || 270;
      const room = { right: window.innerWidth - rect.right, left: rect.left, bottom: window.innerHeight - rect.bottom, top: rect.top };
      const side = room.right >= width + 28 ? 'right' : room.left >= width + 28 ? 'left' : room.bottom >= height + 28 ? 'bottom' : room.top >= height + 28 ? 'top' : room.right > room.left ? 'right' : 'left';
      const x = side === 'right' ? rect.right + 28 : side === 'left' ? rect.left - width - 28 : rect.left + rect.width / 2 - width / 2;
      const y = side === 'bottom' ? rect.bottom + 28 : side === 'top' ? rect.top - height - 28 : rect.top + rect.height / 2 - height / 2;
      const nextCard = { x: clamp(x, 16, Math.max(16, window.innerWidth - width - 16)), y: clamp(y, 64, Math.max(64, window.innerHeight - height - 16)), width, height };
      setTargetBox(previous => previous && Math.abs(previous.x - box.x) < .5 && Math.abs(previous.y - box.y) < .5 && Math.abs(previous.width - box.width) < .5 && Math.abs(previous.height - box.height) < .5 ? previous : box);
      setCardBox(previous => previous && Math.abs(previous.x - nextCard.x) < .5 && Math.abs(previous.y - nextCard.y) < .5 && Math.abs(previous.width - nextCard.width) < .5 && Math.abs(previous.height - nextCard.height) < .5 ? previous : nextCard);
      if (performance.now() - start < 1100) frame = requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { active = false; cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [index, step.target]);

  useEffect(() => {
    if (!step.advanceOnClick) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`[data-guide="${step.target}"]`)) setIndex(value => Math.min(activeSteps.length - 1, value + 1));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [activeSteps.length, step.advanceOnClick, step.target]);

  const connector = targetBox ? (() => {
    const fromX = clamp(cardBox.x + cardBox.width / 2, targetBox.x, targetBox.x + targetBox.width);
    const fromY = clamp(cardBox.y + cardBox.height / 2, targetBox.y, targetBox.y + targetBox.height);
    const toX = clamp(targetBox.x + targetBox.width / 2, cardBox.x, cardBox.x + cardBox.width);
    const toY = clamp(targetBox.y + targetBox.height / 2, cardBox.y, cardBox.y + cardBox.height);
    return `M ${fromX} ${fromY} Q ${(fromX + toX) / 2} ${(fromY + toY) / 2 - 16} ${toX} ${toY}`;
  })() : '';

  return <div className="rf-guide-layer fixed inset-0 z-130 pointer-events-none" aria-live="polite">
    {targetBox && <div className="rf-guide-spotlight absolute" style={{ left: targetBox.x, top: targetBox.y, width: targetBox.width, height: targetBox.height, transitionDuration: reducedMotion ? '0ms' : undefined }} />}
    {targetBox && <svg className="rf-guide-connector absolute inset-0 h-full w-full" aria-hidden="true"><motion.path initial={false} animate={{ d: connector }} transition={{ duration: reducedMotion ? 0 : .38, ease: [.16, 1, .3, 1] }} /></svg>}
    <section ref={cardRef} role="dialog" aria-modal="false" aria-labelledby="rf-guide-title" aria-describedby="rf-guide-body"
      className="rf-guide-popover pointer-events-auto fixed rounded-[26px] p-5 text-white shadow-2xl sm:p-6"
      style={{ width: Math.min(360, window.innerWidth - 32), left: targetBox ? cardBox.x : '50%', top: targetBox ? cardBox.y : '50%', transform: targetBox ? undefined : 'translate(-50%, -50%)', transitionDuration: reducedMotion ? '0ms' : undefined }}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.19em] text-white/60"><MousePointer2 size={15} />{step.surface === 'library' ? (language === 'zh-CN' ? '主界面' : 'Home') : (language === 'zh-CN' ? '播放器' : 'Player')} · {index + 1}/{activeSteps.length}</span>
        <button type="button" onClick={onDismiss} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white" aria-label={language === 'zh-CN' ? '跳过指引' : 'Skip guide'}>{language === 'zh-CN' ? '跳过' : 'Skip'}<X size={15} /></button>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white/85 transition-[width] duration-300" style={{ width: `${(index + 1) / activeSteps.length * 100}%` }} /></div>
      <h2 id="rf-guide-title" className="mt-5 text-xl font-bold tracking-tight">{copy.title}</h2>
      <p id="rf-guide-body" className="mt-2 text-sm leading-6 text-white/75">{copy.body}</p>
      {copy.action && <p className="mt-3 border-l-2 border-white/50 pl-3 text-xs leading-5 text-white/55">{copy.action}</p>}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setIndex(value => Math.max(0, value - 1))} disabled={index === 0} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"><ArrowLeft size={15} />{language === 'zh-CN' ? '上一步' : 'Back'}</button>
        <button ref={nextRef} type="button" onClick={() => index === activeSteps.length - 1 ? onDismiss() : setIndex(value => value + 1)} className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#152026] hover:bg-white/90">{index === activeSteps.length - 1 ? (language === 'zh-CN' ? '完成' : 'Finish') : (language === 'zh-CN' ? '下一步' : 'Next')}{index < activeSteps.length - 1 && <ArrowRight size={15} />}</button>
      </div>
    </section>
  </div>;
}
