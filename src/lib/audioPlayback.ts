export type PlaybackStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

// Own asynchronous play requests independently of React renders and effect cleanup.
export function createAudioPlayback(audio: HTMLAudioElement, onStatus: (status: PlaybackStatus) => void) {
  let request = 0;
  let wantsPlay = false;
  let disposed = false;
  let pendingSeek: number | null = null;
  const emit = (status: PlaybackStatus) => { if (!disposed) onStatus(status); };
  const listeners: Record<string, () => void> = {
    playing: () => { if (wantsPlay) emit('playing'); },
    pause: () => { if (audio.paused && !wantsPlay) emit('paused'); },
    waiting: () => { if (wantsPlay) emit('buffering'); },
    stalled: () => { if (wantsPlay && audio.readyState < 3) emit('buffering'); },
    loadedmetadata: () => {
      if (pendingSeek !== null) {
        audio.currentTime = Number.isFinite(audio.duration) ? Math.min(pendingSeek, audio.duration) : pendingSeek;
        pendingSeek = null;
      }
    },
    error: () => {
      request++;
      wantsPlay = false;
      pendingSeek = null;
      emit('error');
    },
    ended: () => { wantsPlay = false; emit('paused'); },
  };
  Object.entries(listeners).forEach(([event, listener]) => audio.addEventListener(event, listener));

  const play = async () => {
    const currentRequest = ++request;
    wantsPlay = true;
    emit('loading');
    try {
      await audio.play();
      if (!disposed && currentRequest === request && wantsPlay && !audio.paused) emit('playing');
    } catch (error) {
      if (disposed || currentRequest !== request) return;
      wantsPlay = false;
      emit(error instanceof Error && error.name === 'AbortError' ? 'paused' : 'error');
    }
  };
  const pause = () => {
    request++;
    wantsPlay = false;
    audio.pause();
    emit('paused');
  };
  const load = (url: string, autoplay = true, time = 0) => {
    pause();
    pendingSeek = Math.max(0, time);
    audio.src = url;
    audio.load();
    if (autoplay) void play();
    else emit('paused');
  };
  return {
    play, pause, load,
    // Preserve the restore target even if the app closes before metadata arrives.
    getPosition: () => pendingSeek ?? Math.max(0, audio.currentTime || 0),
    toggle: () => {
      if (wantsPlay || !audio.paused) pause();
      else if (audio.error) load(audio.src, true, audio.currentTime);
      else void play();
    },
    clear: () => {
      pause();
      pendingSeek = null;
      audio.removeAttribute('src');
      audio.load();
      emit('idle');
    },
    dispose: () => {
      disposed = true;
      request++;
      Object.entries(listeners).forEach(([event, listener]) => audio.removeEventListener(event, listener));
    },
  };
}
