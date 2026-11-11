import React, { useSyncExternalStore } from 'react';
import { Play, Pause, RotateCcw, LoaderCircle } from 'lucide-react';
import type { PlaybackStatus } from '../lib/audioPlayback';
import type { PlaybackFeedbackStore } from '../lib/playbackFeedback';

const idle = () => 'idle' as const;
const subscribeIdle = () => () => {};
export function usePlaybackStatus(store?: PlaybackFeedbackStore) {
  return useSyncExternalStore(store?.subscribe ?? subscribeIdle, store?.getSnapshot ?? idle, idle);
}
export function playbackAction(status: PlaybackStatus, playing: boolean, language: string) {
  return language === 'zh-CN'
    ? status === 'error' ? '重试播放' : playing ? '暂停' : '播放'
    : status === 'error' ? 'Retry playback' : playing ? 'Pause' : 'Play';
}
export function PlaybackStateIcon({ status, playing, size }: { status: PlaybackStatus; playing: boolean; size: number }) {
  const busy = status === 'loading' || status === 'buffering';
  return <span className="relative inline-flex items-center justify-center" aria-hidden="true" style={{ width: size, height: size }}>
    {status === 'error' ? <RotateCcw size={size} /> : playing ? <Pause size={busy ? size * .62 : size} fill="currentColor" /> : <Play size={size} fill="currentColor" />}
    {busy && <LoaderCircle className="absolute inset-0 animate-spin motion-reduce:animate-none" size={size} />}
  </span>;
}
export function PlaybackStatusLine({ status, language }: { status: PlaybackStatus; language: string }) {
  const text = language === 'zh-CN'
    ? status === 'error' ? '播放失败，请检查文件或网络后重试' : status === 'buffering' ? '正在缓冲…可暂停或切歌' : status === 'loading' ? '正在加载音频…' : ''
    : status === 'error' ? 'Playback failed. Check the file or network and retry.' : status === 'buffering' ? 'Buffering… Pause or skip is available.' : status === 'loading' ? 'Loading audio…' : '';
  return <div role="status" aria-live="polite" aria-atomic="true" className="h-5 truncate text-center text-[11px] text-white/65" title={text}>{text}</div>;
}
