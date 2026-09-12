import React, { useState } from 'react';
import { Music, Play, Pause, Trash2, GripVertical, ArrowUp, ArrowDown, Undo2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Song } from '../types/player';
interface PlaylistProps {
  title?: string; subtitle?: string; songs: Song[]; currentIndex: number; isCurrentPlayback?: boolean;
  isPlaying?: boolean; onSelect: (index: number) => void; onRemove: (index: number) => void;
  onMove?: (from: number, to: number) => void; onClear?: () => void; onUndo?: () => void; language?: 'zh-CN' | 'en-US';
}
export function Playlist({ title, subtitle, songs, currentIndex, isCurrentPlayback = true, isPlaying, onSelect, onRemove, onMove, onClear, onUndo, language = 'zh-CN' }: PlaylistProps) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const t = (cn: string, en: string) => language === 'zh-CN' ? cn : en;
  return <div className="rf-queue"><div className="rf-queue-heading">
    <div><h2 className="text-xl font-semibold text-white">{title || t('播放队列', 'Play queue')} <span className="text-sm font-normal text-white/55">{songs.length}</span></h2><p className="mt-1 text-xs text-white/60">{subtitle || t('拖动排序，点击歌曲播放', 'Drag to reorder · Click to play')}</p></div>
    <div className="flex gap-1">{onUndo && <button className="rf-icon-button" onClick={onUndo} aria-label={t('撤销队列修改', 'Undo queue edit')} title={t('撤销', 'Undo')}><Undo2 size={17} /></button>}{onClear && <button className="rf-icon-button" disabled={!songs.length} onClick={onClear} aria-label={t('清空队列', 'Clear queue')} title={t('清空队列', 'Clear queue')}><Trash2 size={17} /></button>}</div>
  </div><div className="rf-queue-list rf-scroll" role="list" aria-label={t('队列歌曲', 'Queued tracks')}>
    {!songs.length && <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-white/65"><Music size={32} /><p>{t('队列为空', 'Your queue is empty')}</p><p className="text-xs">{t('从曲库选择歌曲开始播放', 'Choose a track from your library')}</p></div>}
    {songs.map((song, index) => { const active = isCurrentPlayback && index === currentIndex;
      return <div key={`${typeof song.file === 'string' ? song.file : song.title}-${index}`} role="listitem" draggable={Boolean(onMove)}
        onDragStart={(event) => { setDragged(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
        onDragOver={(event) => { if (dragged !== null) { event.preventDefault(); setOver(index); } }}
        onDrop={(event) => { event.preventDefault(); if (dragged !== null && dragged !== index) onMove?.(dragged, index); setDragged(null); setOver(null); }} onDragEnd={() => { setDragged(null); setOver(null); }}
        className={cn('rf-queue-row', active && 'rf-queue-row-active', over === index && 'rf-drop-target')}>
        <GripVertical size={14} className="text-white/30 shrink-0" />
        <button className="rf-queue-cover" onClick={() => onSelect(index)} aria-label={`${t('播放', 'Play')} ${song.title}`}>
          {song.cover ? <img src={song.cover} alt="" loading="lazy" /> : <Music size={18} />}{active && <span className="absolute inset-0 bg-black/45 flex items-center justify-center">{isPlaying ? <Pause size={17} /> : <Play size={17} />}</span>}
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(index)}><span className="block truncate text-sm font-medium">{song.title}</span><span className="block truncate text-xs text-white/60 mt-1">{song.artist}</span></button>
        <div className="rf-queue-actions">{onMove && <><button disabled={index === 0} className="rf-icon-button" onClick={() => onMove(index, index - 1)} aria-label={t('上移', 'Move up')} title={t('上移', 'Move up')}><ArrowUp size={14} /></button><button disabled={index === songs.length - 1} className="rf-icon-button" onClick={() => onMove(index, index + 1)} aria-label={t('下移', 'Move down')} title={t('下移', 'Move down')}><ArrowDown size={14} /></button></>}<button className="rf-icon-button" onClick={() => onRemove(index)} aria-label={`${t('移除', 'Remove')} ${song.title}`} title={t('移除', 'Remove')}><Trash2 size={15} /></button></div>
      </div>;
    })}
  </div></div>;
}
