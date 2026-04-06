import React from 'react';
import { motion } from 'motion/react';
import { Play, Pause, SkipBack, SkipForward, Music, Volume2, VolumeX } from 'lucide-react';

interface MiniPlayerProps {
  hasActiveSong: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  title: string;
  artist: string;
  cover?: string;
  onClick: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  emptyActionLabel: string;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  hasActiveSong,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  title,
  artist,
  cover,
  onClick,
  volume,
  onVolumeChange,
  emptyActionLabel,
}) => {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed left-1/2 bottom-4 z-100 w-[calc(100vw-2rem)] max-w-[24rem] -translate-x-1/2 lg:max-w-104"
    >
      <div 
        className="bg-black/40 backdrop-blur-2xl customizable-backdrop-medium border border-white/10 rounded-2xl p-3 flex items-center gap-4 shadow-2xl cursor-pointer group hover:bg-black/50 transition-all"
        onClick={onClick}
      >
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0 shadow-lg">
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music size={20} className="text-white/20" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-white truncate">{title}</h4>
          <p className="text-xs text-white/40 truncate">{artist}</p>
        </div>

        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          {hasActiveSong ? (
            <>
              <div className="flex items-center gap-1">
                <button 
                  onClick={onPrev}
                  className="p-2 text-white/40 hover:text-white transition-colors"
                >
                  <SkipBack size={18} fill="currentColor" />
                </button>
                <button 
                  onClick={onTogglePlay}
                  className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-black hover:scale-105 transition-transform"
                >
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                </button>
                <button 
                  onClick={onNext}
                  className="p-2 text-white/40 hover:text-white transition-colors"
                >
                  <SkipForward size={18} fill="currentColor" />
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-2 group/vol">
                <button 
                  onClick={() => onVolumeChange(volume === 0 ? 0.8 : 0)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <div className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-300 flex items-center">
                  <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/50">
              {emptyActionLabel}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
