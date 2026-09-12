import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Music, ListMusic, Repeat, Repeat1, Shuffle, Mic2, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { SpectrumVisualizer } from './SpectrumVisualizer';
import { PlaybackSlider } from './PlaybackSlider';
import { useAudioClock } from '../hooks/useAudioClock';
import type { VisualizerMode } from '../lib/visualizer';

const TITLE_MARQUEE_PADDING_PX = 24;
const TITLE_MARQUEE_THRESHOLD_PX = 1;

export type LoopMode = 'none' | 'all' | 'one';

interface PlayerControlsProps {
  visualizerMode?: VisualizerMode;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  language?: 'zh-CN' | 'en-US';
  isPlaying: boolean;
  controlsDisabled?: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  title: string;
  artist: string;
  cover?: string;
  analyser: AnalyserNode | null;
  volume: number;
  onVolumeChange: (volume: number) => void;
  loopMode: LoopMode;
  onToggleLoop: () => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  showPlaylist: boolean;
  onTogglePlaylist: () => void;
  showLyrics: boolean;
  onToggleLyrics: () => void;
  onMinimize: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  visualizerMode = 'spectrum',
  language = 'zh-CN',
  isPlaying,
  controlsDisabled = false,
  onTogglePlay,
  onNext,
  onPrev,
  currentTime: fallbackTime,
  audioRef,
  duration,
  onSeek,
  title,
  artist,
  analyser,
  volume,
  onVolumeChange,
  loopMode,
  onToggleLoop,
  isShuffle,
  onToggleShuffle,
  showPlaylist,
  onTogglePlaylist,
  showLyrics,
  onToggleLyrics,
  onMinimize
}) => {
  const currentTime = useAudioClock(audioRef, fallbackTime);
  const t = (cn: string, en: string) => language === 'zh-CN' ? cn : en;
  // Keep formatting local to the control surface so the rest of the app can work
  // with raw second values.
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // One button cycles through three loop states, so the icon is derived here from
  // the current mode instead of branching in JSX.
  const getLoopIcon = () => {
    switch (loopMode) {
      case 'one': return <Repeat1 size={20} className="text-white" />;
      case 'all': return <Repeat size={20} className="text-white" />;
      default: return <Repeat size={20} className="text-white/40" />;
    }
  };

  const progressWidth = duration > 0 ? `${(currentTime / duration) * 100}%` : '0%';

  const isDraggingProgress = useRef(false);
  const [progressDragging, setProgressDragging] = useState(false);
  const isDraggingVolume = useRef(false);
  const titleContainerRef = useRef<HTMLDivElement>(null);
  const titleTextRef = useRef<HTMLHeadingElement>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [titleMarqueeDistance, setTitleMarqueeDistance] = useState(0);

  useEffect(() => {
    const container = titleContainerRef.current;
    const titleElement = titleTextRef.current;
    if (!container || !titleElement) {
      return;
    }

    const updateTitleMarqueeState = () => {
      const overflow = Math.max(0, titleElement.scrollWidth - container.clientWidth);
      const shouldAnimate = overflow > TITLE_MARQUEE_THRESHOLD_PX;

      setIsTitleOverflowing(shouldAnimate);
      setTitleMarqueeDistance(shouldAnimate ? overflow + TITLE_MARQUEE_PADDING_PX : 0);
    };

    updateTitleMarqueeState();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateTitleMarqueeState());
    observer.observe(container);
    observer.observe(titleElement);

    return () => observer.disconnect();
  }, [title]);

  const titleMarqueeStyle = isTitleOverflowing
    ? ({ '--marquee-distance': `-${titleMarqueeDistance}px` } as React.CSSProperties)
    : undefined;

  // Pointer capture keeps scrubbing reliable even if the cursor/finger leaves the
  // track while dragging.
  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled) return;
    isDraggingProgress.current = true;
    setProgressDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingProgress.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const handleProgressPointerUp = () => {
    isDraggingProgress.current = false;
    setProgressDragging(false);
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingVolume.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    onVolumeChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingVolume.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onVolumeChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const handleVolumePointerUp = () => {
    isDraggingVolume.current = false;
  };

  return (
    <div className="rf-player-controls flex flex-col gap-6 w-full max-w-md">
      {/* Only the title scrolls; keeping the artist static reduces motion noise. */}
      <div className="flex items-start justify-between overflow-hidden pl-4">
        <div className="flex flex-col min-w-0 gap-1">
          <div ref={titleContainerRef} className="marquee-container" style={titleMarqueeStyle}>
            <h3
              ref={titleTextRef}
              className={cn(
                'text-white font-bold text-3xl',
                isTitleOverflowing ? 'marquee-text' : 'block'
              )}
            >
              {title}
            </h3>
          </div>
          <p className="text-white/60 text-lg truncate">{artist}</p>
        </div>
        <button 
          onClick={onMinimize}
          aria-label={t('收起播放器', 'Collapse player')}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all text-white/60 hover:text-white"
        >
          <ChevronDown size={24} />
        </button>
      </div>

      {visualizerMode !== 'off' && <div className="px-4">
        <SpectrumVisualizer analyser={analyser} isPlaying={isPlaying} mode={visualizerMode} />
      </div>}

      <div className="flex flex-col gap-2">
        <PlaybackSlider value={currentTime} max={duration} onChange={onSeek} label={t('播放进度', 'Playback position')} disabled={controlsDisabled} time />
        <div className="flex justify-between text-[10px] font-mono text-white/40 uppercase tracking-widest">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onToggleLoop}
            disabled={controlsDisabled}
            className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
            title={loopMode === 'none' ? t('顺序播放', 'No Loop') : loopMode === 'all' ? t('列表循环', 'List Loop') : t('单曲循环', 'Single Loop')}
          >
            {getLoopIcon()}
          </button>
          <button 
            onClick={onToggleShuffle}
            disabled={controlsDisabled}
            className={cn(
              "p-2 hover:bg-white/10 rounded-full transition-colors",
              isShuffle ? "text-white" : "text-white/40",
              controlsDisabled && "opacity-35 hover:bg-transparent"
            )}
            title={t('随机播放', 'Shuffle')} aria-pressed={isShuffle}
          >
            <Shuffle size={20} />
          </button>
        </div>

        <div className="flex items-center gap-6">
          <button aria-label={t('上一首', 'Previous')} onClick={onPrev} disabled={controlsDisabled} className="text-white/60 hover:text-white transition-colors disabled:opacity-35 disabled:hover:text-white/60">
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button 
            onClick={onTogglePlay}
            aria-label={isPlaying ? t('暂停', 'Pause') : t('播放', 'Play')}
            disabled={controlsDisabled}
            className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-black hover:scale-105 transition-transform disabled:opacity-45 disabled:hover:scale-100"
          >
            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
          </button>
          <button aria-label={t('下一首', 'Next')} onClick={onNext} disabled={controlsDisabled} className="text-white/60 hover:text-white transition-colors disabled:opacity-35 disabled:hover:text-white/60">
            <SkipForward size={28} fill="currentColor" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={onTogglePlaylist}
            disabled={controlsDisabled}
            className={cn(
              "p-2 hover:bg-white/10 rounded-full transition-colors",
              showPlaylist ? "text-white" : "text-white/40",
              controlsDisabled && "opacity-35 hover:bg-transparent"
            )}
            title={t('播放队列', 'Play queue')} aria-pressed={showPlaylist}
          >
            <ListMusic size={20} />
          </button>
          <button 
            onClick={onToggleLyrics}
            disabled={controlsDisabled}
            className={cn(
              "p-2 hover:bg-white/10 rounded-full transition-colors",
              showLyrics ? "text-white" : "text-white/40",
              controlsDisabled && "opacity-35 hover:bg-transparent"
            )}
            title={t('歌词', 'Lyrics')} aria-pressed={showLyrics}
          >
            <Mic2 size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 uppercase tracking-widest">
          <Volume2 size={12} />
          <span>{t('音量', 'Volume')}</span>
        </div>
        <PlaybackSlider value={volume} onChange={onVolumeChange} label={t('音量', 'Volume')} />
      </div>
    </div>
  );
};
