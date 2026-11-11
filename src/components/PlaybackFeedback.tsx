import React, { useSyncExternalStore } from 'react';
import type { PlaybackFeedbackStore } from '../lib/playbackFeedback';
import { MiniPlayer, type MiniPlayerProps } from './MiniPlayer';

function useStatus(store: PlaybackFeedbackStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function ConnectedMiniPlayer({ statusStore, ...props }: Omit<MiniPlayerProps, 'status'> & { statusStore: PlaybackFeedbackStore }) {
  return <MiniPlayer {...props} status={useStatus(statusStore)} />;
}

export function PlaybackFeedback({ store, language, onRetry }: {
  store: PlaybackFeedbackStore; language: 'zh-CN' | 'en-US'; onRetry: () => void;
}) {
  const status = useStatus(store);
  if (status !== 'loading' && status !== 'buffering' && status !== 'error') return null;
  return <div role="status" aria-live="polite" className="absolute top-16 left-1/2 -translate-x-1/2 z-110 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/85 px-4 py-3 text-sm text-white shadow-xl">
    <span>{language === 'zh-CN'
      ? (status === 'error' ? '播放失败，请检查文件或网络后重试' : status === 'buffering' ? '正在缓冲…' : '正在加载音频…')
      : (status === 'error' ? 'Playback failed. Check the file or connection and retry.' : status === 'buffering' ? 'Buffering…' : 'Loading audio…')}</span>
    {status === 'error' && <button type="button" onClick={onRetry} className="shrink-0 rounded-lg bg-white px-3 py-1 text-black">{language === 'zh-CN' ? '重试' : 'Retry'}</button>}
  </div>;
}
