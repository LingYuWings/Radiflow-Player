import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { pageMotion } from '../lib/pageMotion';
import { SkipBack, SkipForward, Music, Volume2, VolumeX, ListMusic, ChevronUp, X } from 'lucide-react';
import { PlaybackSlider, formatPlaybackTime } from './PlaybackSlider';
import type { PlaybackStatus } from '../lib/audioPlayback';
import { useAudioClock } from '../hooks/useAudioClock';
import { playbackAction, PlaybackStateIcon, PlaybackStatusLine } from './PlaybackStatus';
import { MiniLyric } from './MiniLyric';
import type { LyricLine } from '../utils/lyricsParser';
export interface MiniPlayerProps {
  queuePanel?: React.ReactNode;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  hasActiveSong: boolean; isPlaying: boolean; onTogglePlay: () => void; onNext: () => void; onPrev: () => void;
  title: string; artist: string; cover?: string; onClick: () => void; volume: number;
  onVolumeChange: (value: number) => void; emptyActionLabel: string;
  currentTime: number; duration: number; onSeek: (time: number) => void;
  onToggleQueue: () => void; showQueue: boolean; queueCount: number; language: 'zh-CN' | 'en-US'; status: PlaybackStatus;
  lyrics?: LyricLine[];
}
export function MiniPlayer(props: MiniPlayerProps) {
  const reducedMotion = useReducedMotion();
  const { hasActiveSong, isPlaying, title, artist, cover, volume, duration, status } = props;
  const currentTime = useAudioClock(props.audioRef, props.currentTime);
  const [showVolume, setShowVolume] = useState(false);
  const previousVolume = useRef(0.8);
  const volumeRootRef = useRef<HTMLDivElement>(null);
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const queueAnchorRef = useRef<HTMLDivElement>(null);
  const queuePanelRef = useRef<HTMLDivElement>(null);
  const volumeId = useId();
  const queueId = useId();
  const [queueHost, setQueueHost] = useState<HTMLElement | null>(null);
  const [queuePosition, setQueuePosition] = useState({ right: 0, bottom: 0 });
  useLayoutEffect(() => {
    const dock = queueButtonRef.current?.closest<HTMLElement>('.rf-player-dock');
    setQueueHost(dock?.parentElement ?? null);
  }, []);
  useLayoutEffect(() => {
    if (!props.showQueue) return;
    const button = queueButtonRef.current;
    if (!button) return;
    const updatePosition = () => {
      const rect = button.getBoundingClientRect();
      setQueuePosition({ right: Math.max(20, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 20 });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(button);
    if (queueHost) observer.observe(queueHost);
    window.addEventListener('resize', updatePosition);
    return () => { observer.disconnect(); window.removeEventListener('resize', updatePosition); };
  }, [props.showQueue, queueHost]);
  useEffect(() => {
    if (!showVolume && !props.showQueue) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inVolume = volumeRootRef.current?.contains(target);
      const inQueue = queueAnchorRef.current?.contains(target) || queuePanelRef.current?.contains(target);
      if (showVolume && !inVolume) setShowVolume(false);
      if (props.showQueue && !inQueue) props.onToggleQueue();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (props.showQueue) closeQueue();
      else { setShowVolume(false); volumeRootRef.current?.querySelector('button')?.focus(); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [showVolume, props.showQueue, props.onToggleQueue]);
  const closeQueue = () => { if (props.showQueue) props.onToggleQueue(); queueButtonRef.current?.focus(); };
  const t = (cn: string, en: string) => props.language === 'zh-CN' ? cn : en;
  // Keep the popup's ancestors opaque: opacity animation creates a backdrop
  // root and prevents the queue glass from sampling the page behind the dock.
  const dockMotion = pageMotion(reducedMotion, 'y', 12);
  return <motion.div {...dockMotion}
    initial={{ y: reducedMotion ? 0 : 12 }} animate={{ y: 0 }}
    exit={{ y: reducedMotion ? 0 : 6, transition: dockMotion.exit.transition }}
    style={{ willChange: 'auto' }} className="rf-player-dock rf-glass">
    <div className="rf-dock-row">
      <button data-guide="guide-dock-track" className="rf-dock-track" onClick={props.onClick} title={t('展开播放器', 'Expand player')}>
        <span className="rf-dock-art">{cover ? <img src={cover} alt="" /> : <Music size={24} />}</span>
        <span className="min-w-0 text-left"><span className="block truncate text-sm font-semibold text-white" title={title}>{title}</span><span className="block truncate text-xs text-white/65 mt-1">{hasActiveSong ? artist : props.emptyActionLabel}</span></span>
      </button>
      <div data-guide="guide-dock-transport" className="rf-dock-controls">
        <button className="rf-icon-button" disabled={!hasActiveSong} onClick={props.onPrev} aria-label={t('上一首', 'Previous')} title={t('上一首', 'Previous')}><SkipBack size={19} fill="currentColor" /></button>
        <button className="rf-play-button" disabled={!hasActiveSong} onClick={props.onTogglePlay} aria-label={playbackAction(status, isPlaying, props.language)}>
          <PlaybackStateIcon status={status} playing={isPlaying} size={21} />
        </button>
        <button className="rf-icon-button" disabled={!hasActiveSong} onClick={props.onNext} aria-label={t('下一首', 'Next')} title={t('下一首', 'Next')}><SkipForward size={19} fill="currentColor" /></button>
      </div>
      <div className="rf-dock-tools">
        <div ref={volumeRootRef} data-guide="guide-dock-volume" className="relative">
          <button className="rf-icon-button" onClick={() => { setShowVolume(value => !value); if (props.showQueue) props.onToggleQueue(); }} aria-controls={showVolume ? volumeId : undefined} aria-expanded={showVolume} aria-label={t('音量', 'Volume')} title={t('音量', 'Volume')}>{volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          <AnimatePresence initial={false}>
            {showVolume && <motion.div key="dock-volume" id={volumeId} role="region" aria-label={t('音量', 'Volume')} {...pageMotion(reducedMotion, 'y', 8)} className="rf-volume-popover rf-glass"><div className="flex justify-between items-center text-xs text-white/75"><button onClick={() => { if (volume > 0) previousVolume.current = volume; props.onVolumeChange(volume === 0 ? previousVolume.current : 0); }}>{volume === 0 ? t('取消静音', 'Unmute') : t('静音', 'Mute')}</button><span>{Math.round(volume * 100)}%</span></div><PlaybackSlider label={t('音量', 'Volume')} value={volume} onChange={props.onVolumeChange} /></motion.div>}
          </AnimatePresence>
        </div>
        <div ref={queueAnchorRef} data-guide="guide-dock-queue" className="rf-queue-anchor">
          <button ref={queueButtonRef} className="rf-icon-button rf-queue-toggle" onClick={() => { setShowVolume(false); props.onToggleQueue(); }} aria-controls={props.showQueue ? queueId : undefined} aria-expanded={props.showQueue} aria-label={t('播放队列', 'Play queue')} title={t('播放队列', 'Play queue')}><ListMusic size={19} /><span className="text-[10px] tabular-nums">{props.queueCount}</span></button>
          {/* Render beside the dock so Chromium can sample the page behind it.
              The home host retains inherited blur settings and inert/visibility. */}
          {queueHost && createPortal(<AnimatePresence initial={false}>
            {props.showQueue && <motion.div ref={queuePanelRef} key="dock-queue" id={queueId} role="region" aria-label={t('播放队列', 'Play queue')}
              {...pageMotion(reducedMotion, 'y', 10)} style={{ ...queuePosition, willChange: 'auto' }} className="rf-queue-popover rf-glass">
              <button type="button" className="rf-queue-close rf-icon-button" aria-label={t('关闭队列', 'Close queue')} onClick={closeQueue}><X size={15} /></button>
              {props.queuePanel}
            </motion.div>}
          </AnimatePresence>, queueHost)}
        </div>
        <button data-guide="guide-dock-expand" className="rf-icon-button rf-expand" onClick={props.onClick} aria-label={t('展开播放器', 'Expand player')} title={t('展开播放器', 'Expand player')}><ChevronUp size={19} /></button>
      </div>
    </div>
    <div data-guide="guide-dock-progress" className="rf-dock-progress"><span>{formatPlaybackTime(currentTime)}</span><PlaybackSlider audioRef={props.audioRef} value={currentTime} max={duration} onChange={props.onSeek} label={t('播放进度', 'Playback position')} disabled={!hasActiveSong} time /><span>{formatPlaybackTime(duration)}</span></div>
    {/* Fixed-height slot: lyrics and status messages share it so the dock never resizes. */}
    <div className="rf-dock-meta">
      {hasActiveSong && props.lyrics && props.lyrics.length > 0 && <MiniLyric lyrics={props.lyrics} audioRef={props.audioRef} currentTime={props.currentTime} />}
      <PlaybackStatusLine status={hasActiveSong ? status : 'idle'} language={props.language} />
    </div>
  </motion.div>;
}
