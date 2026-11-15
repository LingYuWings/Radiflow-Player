import { useState, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, FileText, ListMusic, LoaderCircle, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Trash2, Undo2, Volume2, X } from 'lucide-react';
import { LyricsView } from '../components/LyricsView';
import { MiniLyric } from '../components/MiniLyric';
import { PlaybackSlider, formatPlaybackTime } from '../components/PlaybackSlider';
import type { AudioClock } from '../hooks/useAudioClock';
import type { AppLanguage } from '../lib/copy';
import { pageMotion } from '../lib/pageMotion';
import type { VisualizerMode } from '../lib/visualizer';
import type { LyricLine } from '../utils/lyricsParser';
import { artworkUrl } from './appearance';
import type { androidPlayback, AndroidPlaybackState, AndroidTrack } from './playback';

export type PlayerPanel = 'artwork' | 'lyrics' | 'queue';
type ChangePlayback = Parameters<typeof androidPlayback.configurePlayback>[0];
type QueueEdit = Parameters<typeof androidPlayback.editQueue>[0];

const english = {
  player: 'Now playing', back: 'Back to library', collapse: 'Collapse player', showLyrics: 'Lyrics',
  showQueue: 'Queue', play: 'Play', pause: 'Pause', previous: 'Previous track', next: 'Next track',
  progress: 'Playback position', volume: 'Volume', shuffle: 'Shuffle', off: 'Repeat off', all: 'Repeat all',
  one: 'Repeat one', clear: 'Clear queue', undo: 'Undo', remove: 'Remove from queue', up: 'Move up',
  down: 'Move down', noLyrics: 'No lyrics available', loading: 'Loading lyrics…', unknown: 'Unknown artist',
  album: 'Open album', buffering: 'Buffering…', importLyrics: 'Import LRC lyrics',
};
const chinese = {
  player: '正在播放', back: '返回曲库', collapse: '收起播放器', showLyrics: '歌词',
  showQueue: '播放队列', play: '播放', pause: '暂停', previous: '上一首', next: '下一首',
  progress: '播放进度', volume: '音量', shuffle: '随机播放', off: '关闭循环', all: '列表循环',
  one: '单曲循环', clear: '清空队列', undo: '撤销', remove: '从队列移除', up: '向上移动',
  down: '向下移动', noLyrics: '暂无歌词', loading: '正在获取歌词…', unknown: '未知歌手',
  album: '打开专辑', buffering: '正在缓冲…', importLyrics: '导入 LRC 歌词',
};

export function Cover({ track, className }: { track: Pick<AndroidTrack, 'cover' | 'title'>; className?: string }) {
  const url = artworkUrl(track.cover);
  const [failed, setFailed] = useState<string | undefined>();
  return <span className={'rf-mobile-cover ' + (className || '')}>
    {url && url !== failed
      ? <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(url)} />
      : <Music2 aria-hidden="true" />}
  </span>;
}

type SharedProps = {
  active: AndroidTrack; playback: AndroidPlaybackState; language: AppLanguage;
  lyrics: LyricLine[]; clock: RefObject<AudioClock | null>;
  onToggle: () => void; onSkip: (direction: 'previous' | 'next') => void; onSeek: (seconds: number) => void;
};

const PlayGlyph = ({ playback }: { playback: AndroidPlaybackState }) => playback.buffering
  ? <LoaderCircle className="rf-mobile-loading" aria-hidden="true" />
  : playback.playing ? <Pause fill="currentColor" aria-hidden="true" /> : <Play fill="currentColor" aria-hidden="true" />;

export function AndroidDock({ active, playback, language, lyrics, clock, onToggle, onSkip, onSeek, onOpen }: SharedProps & {
  onOpen: () => void;
}) {
  const copy = language === 'zh-CN' ? chinese : english;
  return <footer className="rf-mobile-mini rf-glass">
    <div className="rf-mobile-dock-row">
      <button type="button" className="rf-mobile-mini-track" aria-label={copy.player + ' · ' + active.title} onClick={onOpen}>
        <Cover track={active} className="rf-dock-art" />
        <span className="rf-mobile-track-label">
          <strong>{active.title}</strong><span>{active.artist || copy.unknown}</span>
        </span>
      </button>
      <button className="rf-mobile-icon-button" type="button" aria-label={playback.playing || playback.buffering ? copy.pause : copy.play} onClick={onToggle}>
        <PlayGlyph playback={playback} />
      </button>
      <button className="rf-mobile-icon-button" type="button" aria-label={copy.next} disabled={!playback.hasNext} onClick={() => onSkip('next')}>
        <SkipForward size={20} fill="currentColor" />
      </button>
    </div>
    <div className="rf-dock-progress rf-mobile-dock-progress">
      <span>{formatPlaybackTime(playback.position)}</span>
      <PlaybackSlider label={copy.progress} time value={playback.position} max={playback.duration} onChange={onSeek} />
      <span>{formatPlaybackTime(playback.duration)}</span>
    </div>
    {lyrics.length > 0 && <MiniLyric lyrics={lyrics} currentTime={playback.position} audioRef={clock} />}
  </footer>;
}

function NativeVisualizer({ mode, samples }: { mode: VisualizerMode; samples?: number[] }) {
  if (mode === 'off' || !samples?.length) return null;
  const limit = (number: number) => Math.max(-1, Math.min(1, number));
  if (mode === 'waveform') {
    const points = samples.map((sample, index) => [index / Math.max(1, samples.length - 1) * 300, 18 - limit(sample) * 17].join(','));
    return <svg aria-hidden="true" className="rf-mobile-visualizer" viewBox="0 0 300 36" preserveAspectRatio="none">
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>;
  }
  const width = 300 / samples.length;
  return <svg aria-hidden="true" className="rf-mobile-visualizer" viewBox="0 0 300 36" preserveAspectRatio="none">
    {samples.map((sample, index) => {
      const height = Math.max(0, limit(sample)) * 36;
      return <rect key={index} x={index * width} y={(36 - height) * (mode === 'mirror' ? .5 : 1)}
        width={Math.max(1, width - 2)} height={height} rx="1" fill="currentColor" />;
    })}
  </svg>;
}

interface PlayerProps extends SharedProps {
  panel: PlayerPanel; queue: AndroidTrack[]; lyricLoading: boolean; visualizer: VisualizerMode;
  canUndoQueue: boolean; onPanel: (panel: PlayerPanel) => void; onClose: () => void;
  onOpenAlbum?: () => void; onAttachLyrics?: () => void;
  onSelect: (id: string) => void; onUndoQueue: () => void; onQueueEdit: (edit: QueueEdit) => void;
  onConfigure: (changes: ChangePlayback) => void;
}

export function AndroidPlayer({
  active, playback, language, panel, queue, lyrics, clock, lyricLoading, visualizer, canUndoQueue, onPanel,
  onClose, onOpenAlbum, onAttachLyrics, onSelect, onUndoQueue, onQueueEdit, onConfigure, onToggle, onSkip, onSeek,
}: PlayerProps) {
  const reduce = useReducedMotion();
  const copy = language === 'zh-CN' ? chinese : english;
  const repeat = playback.repeat ?? 'off';
  const artwork = <Cover track={active} className="rf-mobile-art rf-player-artwork" />;

  return <div className="rf-mobile-player">
    <header className="rf-mobile-header rf-mobile-player-header">
      <button className="rf-mobile-icon-button" type="button" aria-label={panel === 'artwork' ? copy.collapse : copy.back}
        onClick={panel === 'artwork' ? onClose : () => onPanel('artwork')}>
        {panel === 'artwork' ? <ChevronDown /> : <ArrowLeft />}
      </button>
      <h1>{panel === 'queue' ? copy.showQueue : panel === 'lyrics' ? copy.showLyrics : copy.player}</h1>
      <div className="rf-mobile-header-actions">
        <button className="rf-mobile-icon-button" type="button" aria-label={copy.showLyrics} aria-pressed={panel === 'lyrics'}
          onClick={() => onPanel(panel === 'lyrics' ? 'artwork' : 'lyrics')}><Music2 size={19} /></button>
        <button className="rf-mobile-icon-button" type="button" aria-label={copy.showQueue} aria-pressed={panel === 'queue'}
          onClick={() => onPanel(panel === 'queue' ? 'artwork' : 'queue')}><ListMusic size={20} /></button>
      </div>
    </header>

    <div className="rf-mobile-player-stage">
      <AnimatePresence initial={false} mode="wait">
        <motion.main key={panel} {...pageMotion(reduce, 'y', 12)}
          className={'rf-mobile-content rf-mobile-player-panel rf-mobile-panel-' + panel}>
          {panel === 'lyrics' ? (<>
            {lyrics.length ? <LyricsView lyrics={lyrics} currentTime={playback.position} audioRef={clock} onSeek={onSeek} />
              : <div className="rf-mobile-empty" role="status">{lyricLoading ? copy.loading : copy.noLyrics}</div>}
            {onAttachLyrics && <button type="button" className="rf-mobile-text-button rf-mobile-lyric-import"
              onClick={onAttachLyrics}><FileText size={17} />{copy.importLyrics}</button>}
            </>
          ) : panel === 'queue' ? (
            <div className="rf-mobile-queue rf-glass">
              <div className="rf-mobile-queue-actions">
                <button type="button" onClick={() => onQueueEdit({ action: 'clear' })}><Trash2 size={16} />{copy.clear}</button>
                {canUndoQueue && <button type="button" onClick={onUndoQueue}><Undo2 size={16} />{copy.undo}</button>}
              </div>
              <ol>
                {queue.map((track, index) => <li className={track.id === active.id ? 'rf-queue-row-active' : ''} key={track.id}>
                  <button type="button" className="rf-mobile-track" aria-current={track.id === active.id || undefined} onClick={() => onSelect(track.id)}>
                    <Cover track={track} className="rf-mobile-track-icon" /><span className="rf-mobile-track-label"><strong>{track.title}</strong><span>{track.artist}</span></span>
                  </button>
                  <button className="rf-mobile-icon-button" type="button" aria-label={copy.up + ' · ' + track.title} disabled={!index}
                    onClick={() => onQueueEdit({ action: 'move', from: index, to: index - 1 })}><ArrowUp size={17} /></button>
                  <button className="rf-mobile-icon-button" type="button" aria-label={copy.down + ' · ' + track.title} disabled={index + 1 === queue.length}
                    onClick={() => onQueueEdit({ action: 'move', from: index, to: index + 1 })}><ArrowDown size={17} /></button>
                  <button className="rf-mobile-icon-button" type="button" aria-label={copy.remove + ' · ' + track.title}
                    onClick={() => onQueueEdit({ action: 'remove', from: index })}><X size={17} /></button>
                </li>)}
              </ol>
            </div>
          ) : (
            <div className="rf-mobile-player-content">
              <div className="rf-mobile-art-frame" data-resting={!playback.playing}>
                <AnimatePresence initial={false}>
                  <motion.div key={active.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {onOpenAlbum ? <button type="button" aria-label={copy.album} onClick={onOpenAlbum}>{artwork}</button> : artwork}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="rf-mobile-song">
                <h2>{active.title}</h2>
                <p>{active.artist || copy.unknown}{active.album ? ' · ' + active.album : ''}</p>
              </div>
            </div>
          )}
        </motion.main>
      </AnimatePresence>
    </div>

    <footer className="rf-mobile-transport">
      <NativeVisualizer mode={visualizer} samples={visualizer === 'waveform' ? playback.waveform : playback.visualizer} />
      {playback.buffering && <span className="rf-mobile-buffering" role="status">{copy.buffering}</span>}
      <PlaybackSlider label={copy.progress} time max={playback.duration} value={playback.position} onChange={onSeek} />
      <div className="rf-mobile-times"><span>{formatPlaybackTime(playback.position)}</span><span>{formatPlaybackTime(playback.duration)}</span></div>
      <div className="rf-mobile-controls">
        <button className="rf-mobile-icon-button" type="button" aria-label={copy.shuffle} aria-pressed={!!playback.shuffle}
          onClick={() => onConfigure({ shuffle: !playback.shuffle })}><Shuffle size={20} /></button>
        <button className="rf-mobile-icon-button" type="button" aria-label={copy.previous} disabled={!playback.hasPrevious}
          onClick={() => onSkip('previous')}><SkipBack fill="currentColor" size={23} /></button>
        <button className="rf-mobile-play rf-play-button" type="button" aria-label={playback.playing || playback.buffering ? copy.pause : copy.play}
          onClick={onToggle}><PlayGlyph playback={playback} /></button>
        <button className="rf-mobile-icon-button" type="button" aria-label={copy.next} disabled={!playback.hasNext}
          onClick={() => onSkip('next')}><SkipForward fill="currentColor" size={23} /></button>
        <button className="rf-mobile-icon-button" type="button" aria-label={copy[repeat]} aria-pressed={repeat !== 'off'}
          onClick={() => onConfigure({ repeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })}>
          {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
        </button>
      </div>
      <div className="rf-mobile-volume"><Volume2 size={17} aria-hidden="true" />
        <PlaybackSlider label={copy.volume} value={playback.volume ?? 1} onChange={volume => onConfigure({ volume })} />
      </div>
    </footer>
  </div>;
}
