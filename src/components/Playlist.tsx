import React from 'react';
import { motion } from 'motion/react';
import { Music, Play, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface Song {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  lrc: string;
  file?: File | string;
}

interface PlaylistProps {
  title?: string;
  subtitle?: string;
  songs: Song[];
  currentIndex: number;
  isCurrentPlayback?: boolean;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onPlayPlaylist?: () => void;
  playLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  getSecondaryText?: (song: Song) => string;
}

export const Playlist: React.FC<PlaylistProps> = ({
  title = '播放列表',
  subtitle,
  songs,
  currentIndex,
  isCurrentPlayback = true,
  onSelect,
  onRemove,
  onPlayPlaylist,
  playLabel,
  emptyTitle = '列表为空，请上传歌曲',
  emptyDescription,
  getSecondaryText,
}) => {
  return (
    <div className="h-full flex flex-col p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Music className="text-white/60" />
            {title}
            <span className="text-sm font-mono opacity-40 ml-2">({songs.length})</span>
          </h2>
          {subtitle && <p className="text-sm text-white/40 mt-2">{subtitle}</p>}
        </div>

        {onPlayPlaylist && playLabel && songs.length > 0 && (
          <button
            type="button"
            onClick={onPlayPlaylist}
            className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black transition-all"
          >
            {playLabel}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2 pr-4">
        {songs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-6">
            <Music size={48} className="mb-4" />
            <p>{emptyTitle}</p>
            {emptyDescription && <p className="mt-2 text-sm">{emptyDescription}</p>}
          </div>
        ) : (
          songs.map((song, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index * 0.05, 0.35) }}
              className={cn(
                "group flex items-center gap-4 p-4 rounded-xl transition-all cursor-pointer",
                isCurrentPlayback && index === currentIndex 
                  ? "bg-white/10 backdrop-blur-md" 
                  : "hover:bg-white/5"
              )}
              onClick={() => onSelect(index)}
            >
              <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
                {song.cover ? (
                  <img src={song.cover} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music size={16} className="opacity-20" />
                  </div>
                )}
                {isCurrentPlayback && index === currentIndex && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="flex gap-1 items-end h-3">
                      <motion.div 
                        animate={{ height: [4, 12, 6, 10, 4] }}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                        className="w-0.5 bg-white"
                      />
                      <motion.div 
                        animate={{ height: [8, 4, 12, 6, 8] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="w-0.5 bg-white"
                      />
                      <motion.div 
                        animate={{ height: [6, 10, 4, 12, 6] }}
                        transition={{ repeat: Infinity, duration: 0.7 }}
                        className="w-0.5 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className={cn(
                  "font-medium truncate",
                  isCurrentPlayback && index === currentIndex ? "text-white" : "text-white/70"
                )}>
                  {song.title}
                </h3>
                <p className="text-xs text-white/40 truncate">{getSecondaryText ? getSecondaryText(song) : song.artist}</p>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(index);
                  }}
                  className="p-2 hover:bg-white/10 rounded-full text-white/40 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
