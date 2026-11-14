import { NETEASE_STREAM_PATH_PREFIX } from '../types/player';

export type PlaybackStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

export interface PlaybackError {
  code: string;
  httpStatus?: number;
  retryAfter?: number;
}

export async function checkNetEasePlayback(url: string, signal: AbortSignal) {
  const checkUrl = new URL(url, window.location.origin);
  checkUrl.searchParams.set('check', '1');
  const response = await fetch(checkUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (response.status === 204) return;
  const body = await response.json().catch(() => null);
  const retryAfter = Number(response.headers.get('Retry-After'));
  throw {
    code: typeof body?.code === 'string' ? body.code : 'NETEASE_LOOKUP_FAILED',
    httpStatus: response.status,
    ...(retryAfter > 0 ? { retryAfter } : {}),
  } satisfies PlaybackError;
}

// Own asynchronous play requests independently of React renders and effect cleanup.
export function createAudioPlayback(
  audio: HTMLAudioElement,
  onStatus: (status: PlaybackStatus, error?: PlaybackError) => void,
  checkPlayback = checkNetEasePlayback,
) {
  let request = 0;
  let wantsPlay = false;
  let disposed = false;
  let pendingSeek: number | null = null;
  let source = '';
  let needsCheck = false;
  let pendingCheck: AbortController | undefined;
  let reportedError = false;
  const emit = (status: PlaybackStatus) => { if (!disposed) onStatus(status); };
  const fail = (error: PlaybackError) => {
    if (disposed || reportedError) return;
    reportedError = true;
    wantsPlay = false;
    needsCheck = source.startsWith(NETEASE_STREAM_PATH_PREFIX);
    onStatus('error', error);
  };
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
      if (!audio.src || pendingCheck) return;
      request++;
      pendingSeek = null;
      fail({ code: audio.error ? `MEDIA_ERR_${audio.error.code}` : 'MEDIA_PLAYBACK_FAILED' });
    },
    ended: () => { wantsPlay = false; emit('paused'); },
  };
  Object.entries(listeners).forEach(([event, listener]) => audio.addEventListener(event, listener));

  const play = async () => {
    const currentRequest = ++request;
    pendingCheck?.abort();
    reportedError = false;
    wantsPlay = true;
    emit('loading');
    try {
      if (needsCheck) {
        const check = new AbortController();
        pendingCheck = check;
        await checkPlayback(source, check.signal);
        if (disposed || currentRequest !== request) return;
        pendingCheck = undefined;
        needsCheck = false;
        audio.src = source;
        audio.load();
      }
      await audio.play();
      if (!disposed && currentRequest === request && wantsPlay && !audio.paused) emit('playing');
    } catch (error) {
      if (disposed || currentRequest !== request) return;
      const checkFailed = Boolean(pendingCheck);
      pendingCheck = undefined;
      if (error instanceof Error && error.name === 'AbortError') {
        wantsPlay = false;
        emit('paused');
        return;
      }
      fail(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error as PlaybackError
        : { code: checkFailed
          ? error instanceof Error && error.name === 'TimeoutError' ? 'NETEASE_CHECK_TIMEOUT' : 'NETEASE_CHECK_NETWORK'
          : error instanceof Error ? error.name : 'MEDIA_PLAYBACK_FAILED' });
    }
  };
  const pause = () => {
    request++;
    pendingCheck?.abort();
    pendingCheck = undefined;
    wantsPlay = false;
    audio.pause();
    emit('paused');
  };
  const load = (url: string, autoplay = true, time = 0) => {
    pause();
    source = url;
    needsCheck = url.startsWith(NETEASE_STREAM_PATH_PREFIX);
    reportedError = false;
    pendingSeek = Math.max(0, time);
    if (needsCheck) audio.removeAttribute('src');
    else audio.src = url;
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
      else if (audio.error && source) load(source, true, audio.currentTime);
      else void play();
    },
    clear: () => {
      pause();
      source = '';
      needsCheck = false;
      pendingSeek = null;
      audio.removeAttribute('src');
      audio.load();
      emit('idle');
    },
    dispose: () => {
      disposed = true;
      request++;
      pendingCheck?.abort();
      Object.entries(listeners).forEach(([event, listener]) => audio.removeEventListener(event, listener));
    },
  };
}
