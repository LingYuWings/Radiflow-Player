import type { PlaybackStatus } from './audioPlayback';

// Buffering is not a user pause: keep transport/cover/visualizer state stable.
export const hasPlaybackIntent = (status: PlaybackStatus) =>
  status === 'playing' || status === 'loading' || status === 'buffering';

// Only small feedback surfaces subscribe; transient network events never render App.
export function createPlaybackFeedback() {
  let snapshot: PlaybackStatus = 'idle';
  let pending: PlaybackStatus | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (status: PlaybackStatus) => {
    if (snapshot === status) return;
    snapshot = status;
    listeners.forEach(listener => listener());
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setStatus: (status: PlaybackStatus) => {
      if (status === pending) return;
      cancel();
      if (status === 'loading' || status === 'buffering') {
        if (snapshot === status) return;
        pending = status;
        timer = setTimeout(() => { cancel(); publish(status); }, 180);
      } else {
        publish(status);
      }
    },
    cancelPending: cancel,
  };
}

export type PlaybackFeedbackStore = ReturnType<typeof createPlaybackFeedback>;
