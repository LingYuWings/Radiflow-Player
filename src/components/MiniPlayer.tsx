import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  const [showVolumePopover, setShowVolumePopover] = useState(false);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingVolume = useRef(false);

  useEffect(() => () => {
    if (volumeHideTimerRef.current) clearTimeout(volumeHideTimerRef.current);
  }, []);

  const openVolume = () => {
    if (volumeHideTimerRef.current) clearTimeout(volumeHideTimerRef.current);
    setShowVolumePopover(true);
  };

  const scheduleCloseVolume = () => {
    volumeHideTimerRef.current = setTimeout(() => {
      if (!isDraggingVolume.current) setShowVolumePopover(false);
    }, 300);
  };

  const handleVolumeTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingVolume.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    onVolumeChange(Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)));
  };

  const handleVolumeTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingVolume.current) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onVolumeChange(Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)));
  };

  const handleVolumeTrackPointerUp = () => {
    isDraggingVolume.current = false;
    scheduleCloseVolume();
  };

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
          <div className="marquee-container">
            <h4 className="marquee-text text-sm font-bold text-white">{title}</h4>
          </div>
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

              <div className="hidden sm:flex items-center gap-2">
                <div
                  className="relative"
                  onMouseEnter={openVolume}
                  onMouseLeave={scheduleCloseVolume}
                  onClick={e => e.stopPropagation()}
                >
                  <AnimatePresence>
                    {showVolumePopover && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center gap-1.5 px-3 pt-3 pb-2 rounded-xl bg-black/70 backdrop-blur-xl border border-white/10 shadow-xl z-10"
                        onMouseEnter={openVolume}
                        onMouseLeave={scheduleCloseVolume}
                      >
                        <span className="text-[9px] font-mono text-white/50 tabular-nums">{Math.round(volume * 100)}</span>
                        <div
                          className="relative w-1.5 h-20 bg-white/20 rounded-full cursor-pointer touch-none select-none"
                          onPointerDown={handleVolumeTrackPointerDown}
                          onPointerMove={handleVolumeTrackPointerMove}
                          onPointerUp={handleVolumeTrackPointerUp}
                        >
                          <div
                            className="absolute bottom-0 left-0 w-full rounded-full bg-white"
                            style={{ height: `${volume * 100}%` }}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={() => onVolumeChange(volume === 0 ? 0.8 : 0)}
                    className="p-2 text-white/40 hover:text-white transition-colors"
                  >
                    {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
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
