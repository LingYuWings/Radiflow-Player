import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Lock, LockOpen, Minus, Pause, Play, Plus, SkipBack, SkipForward, X } from 'lucide-react';
import { lyricWordGlow, lyricWordProgress } from '../lib/lyricProgress';
import { findActiveLyricIndex } from '../hooks/useLyricWordPaint';
import { clockTimeAt } from '../lib/desktopLyrics';
import type { DesktopLyricsBridge, DesktopLyricsClock, DesktopLyricsTrack } from '../lib/desktopLyrics';
import type { LyricLine } from '../utils/lyricsParser';

const FONT_SCALE_KEY = 'radiflow-player.desktop-lyrics.font-scale';
const LOCKED_KEY = 'radiflow-player.desktop-lyrics.locked';
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.6;
const SCALE_STEP = 0.1;
// Below this shrink factor a line wraps (at that size) instead of shrinking further.
const MIN_FIT = 0.45;
// Re-sync anchors closer than this to the local clock are ignored to avoid fill jitter.
const MAX_IGNORED_DRIFT = 0.15;
const LINE_EASE = [0.23, 1, 0.32, 1] as const;
// Row geometry in em of the base lyric size: row height and the gap between rows.
const ROW_HEIGHT_EM = 1.32;
const ROW_GAP_EM = 0.12;
const BASE_FONT_PX = 34;
const IDLE_CLOCK: DesktopLyricsClock = { time: 0, playing: false, rate: 1, sentAt: 0 };

type Align = 'start' | 'center' | 'end';
type LyricRole = 'current' | 'next';
type StackItem = { key: string; role: LyricRole; line?: LyricLine; lineIndex?: number; text?: string; active: boolean; translation?: boolean };

const readNumber = (key: string, fallback: number) => {
  try { const value = Number(window.localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback; } catch { return fallback; }
};
const clampScale = (value: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 10) / 10;
const hasText = (line?: LyricLine) => Boolean(line?.text.trim());

// Shrinks a line to the available width (never truncates); very long lines wrap.
function FitText({ align, fitKey, children }: { align: Align; fitKey: string; children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const fit = () => {
      inner.style.whiteSpace = 'nowrap';
      inner.style.width = '';
      const available = outer.clientWidth;
      const natural = inner.offsetWidth;
      if (!available || natural <= available) { inner.style.transform = ''; return; }
      const ratio = available / natural;
      if (ratio >= MIN_FIT) { inner.style.transform = `scale(${ratio})`; return; }
      inner.style.whiteSpace = 'normal';
      inner.style.width = `${available / MIN_FIT}px`;
      inner.style.transform = `scale(${MIN_FIT})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [fitKey]);
  return <div ref={outerRef} className="rf-dl-fit" data-align={align}><span ref={innerRef} className="rf-dl-fit-inner">{children}</span></div>;
}

function LyricText({ line, active }: { line: LyricLine; active: boolean }) {
  if (!line.words?.length) return <>{line.text}</>;
  return <>{line.words.map((word, index) => (
    <span key={index} data-lyric-word={active ? '' : undefined} className="rf-lyric-word">
      {word.text}
      {active && <>
        <span aria-hidden="true" className="rf-lyric-word-glow"><span className="rf-lyric-word-fill">{word.text}</span></span>
        <span aria-hidden="true" className="rf-lyric-word-fill">{word.text}</span>
      </>}
    </span>
  ))}</>;
}

// Fixed rows: the current line is always on top, the next line (or the
// translation) below. Items are keyed by line, so the next line's element
// slides up into the current row instead of being replaced.
function buildStack(lines: LyricLine[], activeIndex: number, fallback: string): StackItem[] {
  if (!lines.length) return [{ key: `fallback-${fallback}`, role: 'current', text: fallback, active: false }];
  const current = Math.max(activeIndex, 0);
  const line = lines[current];
  const translation = line?.translation && line.translation !== '//' ? line.translation : undefined;
  const items: StackItem[] = [{ key: `line-${current}`, role: 'current', line, lineIndex: current, active: current === activeIndex }];
  if (translation) {
    items.push({ key: `t-sub-${current}`, role: 'next', text: translation, active: false, translation: true });
  } else if (lines[current + 1]) {
    items.push({ key: `line-${current + 1}`, role: 'next', line: lines[current + 1], lineIndex: current + 1, active: false });
  }
  return items;
}

// Transparent always-on-top overlay. Time is extrapolated locally from clock
// anchors, so the player only has to send state on play/pause/seek/track change.
export function DesktopLyrics({ bridge }: { bridge: DesktopLyricsBridge }) {
  const reducedMotion = useReducedMotion();
  const [track, setTrack] = useState<DesktopLyricsTrack | null>(null);
  const [clock, setClock] = useState<DesktopLyricsClock>(IDLE_CLOCK);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [locked, setLocked] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fontScale, setFontScale] = useState(() => clampScale(readNumber(FONT_SCALE_KEY, 1)));
  const stageRef = useRef<HTMLDivElement>(null);
  const lines = track?.lines ?? [];

  useEffect(() => {
    document.documentElement.dataset.surface = 'desktop-lyrics';
    const offTrack = bridge.onTrack(setTrack);
    const offClock = bridge.onClock((next) => setClock((previous) => {
      const isSteadyPlayback = previous.playing && next.playing && previous.rate === next.rate;
      return isSteadyPlayback && Math.abs(clockTimeAt(next) - clockTimeAt(previous)) < MAX_IGNORED_DRIFT ? previous : next;
    }));
    const offLocked = bridge.onLocked(setLocked);
    bridge.ready();
    try { if (window.localStorage.getItem(LOCKED_KEY) === '1') bridge.setLocked(true); } catch { /* storage unavailable */ }
    return () => { offTrack(); offClock(); offLocked(); };
  }, [bridge]);

  useEffect(() => {
    try { window.localStorage.setItem(FONT_SCALE_KEY, String(fontScale)); } catch { /* storage unavailable */ }
  }, [fontScale]);

  // One frame loop drives line selection and word fill; it idles while paused.
  // Words are looked up by line index, so exiting lines never steal the target.
  useEffect(() => {
    const words = lines[activeIndex]?.words ?? [];
    const elements: HTMLElement[] = Array.from(stageRef.current?.querySelectorAll<HTMLElement>(`[data-line-index="${activeIndex}"] [data-lyric-word]`) ?? []);
    const previousFill = elements.map(() => '');
    const previousGlow = elements.map(() => '');
    let frame = 0;
    const paint = () => {
      const time = clockTimeAt(clock);
      const index = findActiveLyricIndex(lines, time);
      if (index !== activeIndex) { setActiveIndex(index); return false; }
      elements.forEach((element, wordIndex) => {
        const word = words[wordIndex];
        if (!word) return;
        const progress = lyricWordProgress(time, word.startTime, word.duration);
        const fill = `${(progress * 100).toFixed(1)}%`;
        if (fill !== previousFill[wordIndex]) {
          previousFill[wordIndex] = fill;
          element.style.setProperty('--lyric-fill', fill);
          element.dataset.fill = progress <= 0 ? 'empty' : progress >= 1 ? 'full' : 'partial';
        }
        const glow = lyricWordGlow(time, word.startTime, word.duration).toFixed(2);
        if (glow !== previousGlow[wordIndex]) {
          previousGlow[wordIndex] = glow;
          element.style.setProperty('--lyric-glow', glow);
        }
      });
      return true;
    };
    const tick = () => {
      const isCurrent = paint();
      frame = isCurrent && clock.playing && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    tick();
    const onVisibility = () => { cancelAnimationFrame(frame); tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisibility); };
  }, [clock, lines, activeIndex]);

  const toggleLocked = () => {
    const next = !locked;
    try { window.localStorage.setItem(LOCKED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
    bridge.setLocked(next);
  };

  const fallback = track ? `${track.title} — ${track.artist}` : 'RadiFlow Player';
  const stack = buildStack(lines, activeIndex, fallback);
  const rowStep = BASE_FONT_PX * fontScale * (ROW_HEIGHT_EM + ROW_GAP_EM);
  const rowY = (role: LyricRole) => (role === 'current' ? 0 : rowStep);
  const blurred = reducedMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(10px)' };
  const lineTransition = { duration: reducedMotion ? 0.15 : 0.55, ease: LINE_EASE };
  const showToolbar = hovered && !locked;

  return (
    <div
      className="rf-dl"
      data-locked={locked ? 'true' : 'false'}
      data-hovered={hovered ? 'true' : 'false'}
      style={{ '--dl-scale': fontScale } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={() => { if (!hovered) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`rf-dl-toolbar${showToolbar ? ' is-visible' : ''}`} aria-hidden={!showToolbar}>
        <button type="button" onClick={() => bridge.control('prev')} title="上一首"><SkipBack size={16} fill="currentColor" /></button>
        <button type="button" onClick={() => bridge.control('toggle-play')} title={clock.playing ? '暂停' : '播放'}>
          {clock.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button type="button" onClick={() => bridge.control('next')} title="下一首"><SkipForward size={16} fill="currentColor" /></button>
        <span className="rf-dl-divider" />
        <button type="button" onClick={() => setFontScale((value) => clampScale(value - SCALE_STEP))} disabled={fontScale <= MIN_SCALE} title="缩小字体"><Minus size={16} /></button>
        <button type="button" onClick={() => setFontScale((value) => clampScale(value + SCALE_STEP))} disabled={fontScale >= MAX_SCALE} title="放大字体"><Plus size={16} /></button>
        <button type="button" onClick={toggleLocked} title="锁定（鼠标穿透）"><Lock size={15} /></button>
        <button type="button" onClick={() => bridge.close()} title="关闭桌面歌词"><X size={16} /></button>
      </div>

      {locked && (
        <button
          type="button"
          className={`rf-dl-unlock${hovered ? ' is-visible' : ''}`}
          onMouseEnter={() => bridge.setIgnoreMouse(false)}
          onMouseLeave={() => bridge.setIgnoreMouse(true)}
          onClick={() => { bridge.setIgnoreMouse(false); toggleLocked(); }}
          title="解锁桌面歌词"
        >
          <LockOpen size={15} />
        </button>
      )}

      <div ref={stageRef} className="rf-dl-stage">
        <AnimatePresence initial={false}>
          {stack.map((item) => (
            <motion.div
              key={item.key}
              data-line-index={item.lineIndex}
              className={`rf-dl-line${item.active ? ' is-active' : ''}${item.translation ? ' is-translation' : ''}`}
              // New lines blur in from just below their row; a line that arrives
              // straight into the top row rises from the next-line row.
              initial={{ ...blurred, y: reducedMotion ? rowY(item.role) : (item.role === 'current' ? rowStep : rowStep + 14) }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: rowY(item.role) }}
              // The previous line drifts upward while blurring out.
              exit={{ ...blurred, y: reducedMotion ? rowY(item.role) : rowY(item.role) - rowStep * 0.45 }}
              transition={lineTransition}
            >
              <FitText align="center" fitKey={`${item.key}:${item.active}:${fontScale}`}>
                {item.line && hasText(item.line) ? <LyricText line={item.line} active={item.active} /> : (item.text || '♪')}
              </FitText>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
