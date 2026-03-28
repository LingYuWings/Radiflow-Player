import React, { useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { Copy, Minus, Music, Pause, Play, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react';
import { LyricLine } from '../utils/lyricsParser';
import { cn } from '../lib/utils';
import { AppLogo } from './AppLogo';

export interface DetachedMiniPlayerState {
  title: string;
  artist: string;
  cover?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  lyrics: LyricLine[];
  tone: 'dark' | 'light';
  hasSong: boolean;
}

interface DetachedMiniPlayerWindowProps {
  state: DetachedMiniPlayerState;
  isWindowMaximized: boolean;
  onWindowAction: (action: 'minimize' | 'maximize-toggle' | 'close') => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (value: number) => void;
}

const formatTime = (time: number) => {
  if (!Number.isFinite(time) || time < 0) return '0:00';
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const DetachedMiniPlayerWindow: React.FC<DetachedMiniPlayerWindowProps> = ({
  state,
  isWindowMaximized,
  onWindowAction,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
}) => {
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const activeIndex = useMemo(() => {
    return state.lyrics.findIndex(
      (line, index) =>
        state.currentTime >= line.startTime &&
        (index === state.lyrics.length - 1 || state.currentTime < state.lyrics[index + 1].startTime)
    );
  }, [state.currentTime, state.lyrics]);

  useEffect(() => {
    if (!lyricsContainerRef.current || !activeLineRef.current) return;

    const activeLine = activeLineRef.current;
    activeLine.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });
  }, [activeIndex]);

  const overlayClassName = state.tone === 'light' ? 'bg-[#fff5ea]/40' : 'bg-black/55';
  const panelClassName = state.tone === 'light'
    ? 'border-black/10 bg-white/55 text-black shadow-[0_30px_80px_rgba(120,85,45,0.2)]'
    : 'border-white/10 bg-black/35 text-white shadow-[0_30px_80px_rgba(0,0,0,0.45)]';
  const mutedTextClassName = state.tone === 'light' ? 'text-black/55' : 'text-white/45';
  const secondaryTextClassName = state.tone === 'light' ? 'text-black/75' : 'text-white/70';
  const iconButtonClassName = state.tone === 'light'
    ? 'text-black/60 hover:text-black hover:bg-black/8'
    : 'text-white/65 hover:text-white hover:bg-white/10';
  const rangeAccentClassName = state.tone === 'light' ? 'accent-black' : 'accent-white';
  const progressTrackClassName = state.tone === 'light' ? 'bg-black/10' : 'bg-white/10';
  const progressFillClassName = state.tone === 'light' ? 'bg-black/80' : 'bg-white';
  const activeLyricClassName = state.tone === 'light' ? 'text-black' : 'text-white';
  const inactiveLyricClassName = state.tone === 'light' ? 'text-black/35' : 'text-white/30';
  const titleBarClassName = state.tone === 'light'
    ? 'border-black/8 bg-white/30 text-black/85'
    : 'border-white/8 bg-black/18 text-white/85';
  const windowButtonClassName = state.tone === 'light'
    ? 'bg-black/4 border-black/8 text-black/60 hover:bg-black/8 hover:text-black'
    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center scale-110 blur-[90px] opacity-70"
        style={{ backgroundImage: state.cover ? `url(${state.cover})` : undefined }}
      />
      <div className={cn('absolute inset-0 backdrop-blur-[120px]', overlayClassName)} />

      <div className="relative z-10 min-h-screen p-2.5">
        <div
          className={cn(
            'drag-region mb-2.5 flex h-11 items-center justify-between rounded-3xl border px-3.5 backdrop-blur-2xl',
            titleBarClassName,
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo className="h-7.5 w-7.5 rounded-2xl shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">RadiFlow Player</p>
              <p className={cn('truncate text-[9px] uppercase tracking-[0.22em]', mutedTextClassName)}>Mini Player</p>
            </div>
          </div>

          <div className="no-drag flex items-center gap-2">
            <button
              type="button"
              onClick={() => onWindowAction('minimize')}
              className={cn('flex h-8 w-8 items-center justify-center rounded-2xl border transition-all', windowButtonClassName)}
              title="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => onWindowAction('maximize-toggle')}
              className={cn('flex h-8 w-8 items-center justify-center rounded-2xl border transition-all', windowButtonClassName)}
              title={isWindowMaximized ? 'Restore' : 'Maximize'}
            >
              {isWindowMaximized ? <Copy size={12} /> : <Square size={12} />}
            </button>
            <button
              type="button"
              onClick={() => onWindowAction('close')}
              className="flex h-8 w-8 items-center justify-center rounded-2xl border border-[#ff5f5720] bg-[#ff5f5715] text-[#ff8e88] transition-all hover:bg-[#ff5f57] hover:text-white"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'mx-auto flex min-h-[calc(100vh-4.75rem)] w-full max-w-sm flex-col rounded-4xl border p-4 backdrop-blur-3xl',
            panelClassName,
          )}
        >
          <div className="mx-auto mb-3 w-full max-w-54 overflow-hidden rounded-3xl bg-white/5 shadow-2xl aspect-square">
            {state.cover ? (
              <img src={state.cover} alt={state.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5">
                <Music className={cn('h-16 w-16', state.tone === 'light' ? 'text-black/15' : 'text-white/15')} />
              </div>
            )}
          </div>

          <div className="mb-3 min-w-0 text-center">
            <h1 className={cn('truncate text-xl font-black tracking-tight', state.tone === 'light' ? 'text-black' : 'text-white')}>
              {state.hasSong ? state.title : 'RadiFlow Player'}
            </h1>
            <p className={cn('mt-0.5 truncate text-xs font-medium', secondaryTextClassName)}>
              {state.hasSong ? state.artist : 'Waiting for playback'}
            </p>
          </div>

          <div className="mb-3 flex flex-col gap-1.5">
            <div
              className={cn('relative h-1.25 w-full cursor-pointer overflow-hidden rounded-full', progressTrackClassName)}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
                onSeek(Math.max(0, Math.min(state.duration, ratio * state.duration)));
              }}
            >
              <div
                className={cn('absolute inset-y-0 left-0 transition-all duration-150', progressFillClassName)}
                style={{ width: state.duration > 0 ? `${(state.currentTime / state.duration) * 100}%` : '0%' }}
              />
            </div>
            <div className={cn('flex justify-between text-[10px] font-mono uppercase tracking-[0.16em]', mutedTextClassName)}>
              <span>{formatTime(state.currentTime)}</span>
              <span>{formatTime(state.duration)}</span>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-center gap-2.5">
            <button onClick={onPrev} className={cn('rounded-full p-2.5 transition-colors', iconButtonClassName)}>
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              onClick={onTogglePlay}
              className={cn(
                'flex h-13 w-13 items-center justify-center rounded-full transition-transform hover:scale-105',
                state.tone === 'light' ? 'bg-black text-white' : 'bg-white text-black'
              )}
            >
              {state.isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
            </button>
            <button onClick={onNext} className={cn('rounded-full p-2.5 transition-colors', iconButtonClassName)}>
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>

          <div className="mb-3">
            <div className={cn('mb-1.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em]', mutedTextClassName)}>
              {state.volume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />}
              <span>Volume</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.volume}
              onChange={(event) => onVolumeChange(Number.parseFloat(event.target.value))}
              className={cn('h-1.25 w-full cursor-pointer appearance-none rounded-full bg-white/15', rangeAccentClassName)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/5 px-3 py-3">
            <div ref={lyricsContainerRef} className="h-full overflow-y-auto scrollbar-hide mask-fade-edges pr-1 [scroll-padding-top:0.5rem]">
              <div className="flex min-h-full flex-col justify-start gap-3 pr-2 pb-24 pt-1">
                {state.lyrics.length > 0 ? (
                  state.lyrics.map((line, index) => {
                    const isActive = index === activeIndex;

                    return (
                      <div
                        key={`${line.startTime}-${index}`}
                        ref={isActive ? activeLineRef : null}
                        onClick={() => onSeek(line.startTime)}
                        className={cn(
                          'cursor-pointer rounded-2xl px-2.5 py-2 transition-all duration-500 scroll-mt-2',
                          isActive
                            ? state.tone === 'light'
                              ? 'bg-black/8 scale-[1.01]'
                              : 'bg-white/8 scale-[1.01]'
                            : state.tone === 'light'
                              ? 'bg-transparent hover:bg-black/5'
                              : 'bg-transparent hover:bg-white/5'
                        )}
                      >
                        <p className={cn('text-[13px] font-semibold leading-5', isActive ? activeLyricClassName : inactiveLyricClassName)}>
                          {line.text}
                        </p>
                        {line.translation && line.translation !== '//' && (
                          <p className={cn('mt-0.5 text-[11px] leading-4.5', isActive ? secondaryTextClassName : mutedTextClassName)}>
                            {line.translation}
                          </p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className={cn('flex h-full items-center justify-center text-center text-sm', mutedTextClassName)}>
                    {state.hasSong ? 'Lyrics will appear here once they are loaded.' : 'Start playback from the main window to populate the mini player.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};