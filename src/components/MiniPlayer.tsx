import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Play, Pause, SkipBack, SkipForward, Music, Volume2, VolumeX, ListMusic, ChevronUp, LoaderCircle } from 'lucide-react';
import { PlaybackSlider, formatPlaybackTime } from './PlaybackSlider';
import type { PlaybackStatus } from '../lib/audioPlayback';
import { useAudioClock } from '../hooks/useAudioClock';
interface MiniPlayerProps {
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  hasActiveSong: boolean; isPlaying: boolean; onTogglePlay: () => void; onNext: () => void; onPrev: () => void;
  title: string; artist: string; cover?: string; onClick: () => void; volume: number;
  onVolumeChange: (value: number) => void; emptyActionLabel: string;
  currentTime: number; duration: number; onSeek: (time: number) => void;
  onToggleQueue: () => void; showQueue: boolean; queueCount: number; language: 'zh-CN' | 'en-US'; status: PlaybackStatus;
}
export function MiniPlayer(props: MiniPlayerProps) {
  const { hasActiveSong, isPlaying, title, artist, cover, volume, duration, status } = props;
  const currentTime = useAudioClock(props.audioRef, props.currentTime);
  const [showVolume, setShowVolume] = useState(false);
  const previousVolume = useRef(0.8);
  const busy = status === 'loading' || status === 'buffering';
  const t = (cn: string, en: string) => props.language === 'zh-CN' ? cn : en;
  return <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} className="rf-player-dock rf-glass">
    <div className="rf-dock-row">
      <button className="rf-dock-track" onClick={props.onClick} title={t('展开播放器', 'Expand player')}>
        <span className="rf-dock-art">{cover ? <img src={cover} alt="" /> : <Music size={24} />}</span>
        <span className="min-w-0 text-left"><span className="block truncate text-sm font-semibold text-white" title={title}>{title}</span><span className="block truncate text-xs text-white/65 mt-1">{hasActiveSong ? artist : props.emptyActionLabel}</span></span>
      </button>
      <div className="rf-dock-controls">
        <button className="rf-icon-button" disabled={!hasActiveSong} onClick={props.onPrev} aria-label={t('上一首', 'Previous')} title={t('上一首', 'Previous')}><SkipBack size={19} fill="currentColor" /></button>
        <button className="rf-play-button" disabled={!hasActiveSong} onClick={props.onTogglePlay} aria-label={busy ? t('取消加载', 'Cancel loading') : isPlaying ? t('暂停', 'Pause') : t('播放', 'Play')}>
          {busy ? <LoaderCircle className="animate-spin" size={21} /> : isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
        </button>
        <button className="rf-icon-button" disabled={!hasActiveSong} onClick={props.onNext} aria-label={t('下一首', 'Next')} title={t('下一首', 'Next')}><SkipForward size={19} fill="currentColor" /></button>
      </div>
      <div className="rf-dock-tools">
        <div className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setShowVolume(false); }}>
          <button className="rf-icon-button" onClick={() => setShowVolume(!showVolume)} aria-expanded={showVolume} aria-label={t('音量', 'Volume')} title={t('音量', 'Volume')}>{volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          {showVolume && <div className="rf-volume-popover rf-glass"><div className="flex justify-between items-center text-xs text-white/75"><button onClick={() => { if (volume > 0) previousVolume.current = volume; props.onVolumeChange(volume === 0 ? previousVolume.current : 0); }}>{volume === 0 ? t('取消静音', 'Unmute') : t('静音', 'Mute')}</button><span>{Math.round(volume * 100)}%</span></div><PlaybackSlider label={t('音量', 'Volume')} value={volume} onChange={props.onVolumeChange} /></div>}
        </div>
        <button className="rf-icon-button rf-queue-toggle" onClick={props.onToggleQueue} aria-expanded={props.showQueue} aria-label={t('播放队列', 'Play queue')} title={t('播放队列', 'Play queue')}><ListMusic size={19} /><span className="text-[10px] tabular-nums">{props.queueCount}</span></button>
        <button className="rf-icon-button rf-expand" onClick={props.onClick} aria-label={t('展开播放器', 'Expand player')} title={t('展开播放器', 'Expand player')}><ChevronUp size={19} /></button>
      </div>
    </div>
    <div className="rf-dock-progress"><span>{formatPlaybackTime(currentTime)}</span><PlaybackSlider value={currentTime} max={duration} onChange={props.onSeek} label={t('播放进度', 'Playback position')} disabled={!hasActiveSong} time /><span>{formatPlaybackTime(duration)}</span></div>
  </motion.div>;
}
