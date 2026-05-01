import React, { useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Music, ListMusic, Repeat, Repeat1, Shuffle, Mic2, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { SpectrumVisualizer } from './SpectrumVisualizer';

export type LoopMode = 'none' | 'all' | 'one';

interface PlayerControlsProps {
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
  isPlaying,
  controlsDisabled = false,
  onTogglePlay,
  onNext,
  onPrev,
  currentTime,
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
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    <div className="flex flex-col gap-6 w-full max-w-md">
      <div className="flex items-start justify-between overflow-hidden pl-4">
        <div className="flex flex-col min-w-0 gap-1">
          <div className="marquee-container">
            <h3 className="marquee-text text-white font-bold text-3xl">{title}</h3>
          </div>
          <p className="text-white/60 text-lg truncate">{artist}</p>
        </div>
        <button 
          onClick={onMinimize}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all text-white/60 hover:text-white"
        >
          <ChevronDown size={24} />
        </button>
      </div>

      <div className="px-4">
        <SpectrumVisualizer analyser={analyser} isPlaying={isPlaying} />
      </div>

      <div className="flex flex-col gap-2">
        <div
          className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden cursor-pointer group touch-none"
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerUp}
        >
          <div
            className="absolute top-0 left-0 h-full bg-white"
            style={{ width: progressWidth, transition: progressDragging ? 'none' : 'width 100ms' }}
          />
        </div>
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
            title={loopMode === 'none' ? 'No Loop' : loopMode === 'all' ? 'List Loop' : 'Single Loop'}
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
            title="Shuffle"
          >
            <Shuffle size={20} />
          </button>
        </div>

        <div className="flex items-center gap-6">
          <button onClick={onPrev} disabled={controlsDisabled} className="text-white/60 hover:text-white transition-colors disabled:opacity-35 disabled:hover:text-white/60">
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button 
            onClick={onTogglePlay}
            disabled={controlsDisabled}
            className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-black hover:scale-105 transition-transform disabled:opacity-45 disabled:hover:scale-100"
          >
            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
          </button>
          <button onClick={onNext} disabled={controlsDisabled} className="text-white/60 hover:text-white transition-colors disabled:opacity-35 disabled:hover:text-white/60">
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
            title="Playlist"
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
            title="Lyrics"
          >
            <Mic2 size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 uppercase tracking-widest">
          <Volume2 size={12} />
          <span>Volume</span>
        </div>
        <div
          className="relative h-1 w-full bg-white/10 rounded-full overflow-hidden cursor-pointer group touch-none"
          onPointerDown={handleVolumePointerDown}
          onPointerMove={handleVolumePointerMove}
          onPointerUp={handleVolumePointerUp}
        >
          <div
            className="absolute top-0 left-0 h-full bg-white/60"
            style={{ width: `${volume * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
};
