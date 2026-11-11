import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { LyricLine } from '../utils/lyricsParser';
import type { DesktopLyricsClock, DesktopLyricsTrack } from '../lib/desktopLyrics';

interface IpcLike {
  send: (channel: string, payload?: unknown) => void;
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
}

interface DesktopLyricsSyncOptions {
  ipc: IpcLike | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  hasActiveSong: boolean;
  title: string;
  artist: string;
  lyrics: LyricLine[];
  isLoadingLyrics: boolean;
}

const ENABLED_KEY = 'radiflow-player.desktop-lyrics.enabled';
// While playing, re-anchor the overlay clock periodically to absorb drift.
const CLOCK_RESYNC_MS = 2000;
const readAccent = () => document.documentElement.style.getPropertyValue('--rf-accent').trim() || undefined;

/** Publishes track + playback clock to the desktop lyrics overlay and owns its toggle. */
export function useDesktopLyricsSync({ ipc, audioRef, hasActiveSong, title, artist, lyrics, isLoadingLyrics }: DesktopLyricsSyncOptions) {
  const [visible, setVisible] = useState(false);
  const [accent, setAccent] = useState(readAccent);

  useEffect(() => {
    if (!ipc) return;
    const onVisibility = (_event: unknown, value: unknown) => {
      const next = Boolean(value);
      setVisible(next);
      try { window.localStorage.setItem(ENABLED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
    };
    ipc.on('desktop-lyrics:visibility-changed', onVisibility);
    let restore = false;
    try { restore = window.localStorage.getItem(ENABLED_KEY) === '1'; } catch { /* storage unavailable */ }
    if (restore) void ipc.invoke('desktop-lyrics:set-visible', true).then((value) => setVisible(Boolean(value)));
    return () => ipc.removeListener('desktop-lyrics:visibility-changed', onVisibility);
  }, [ipc]);

  // Background publishes the artwork accent as an inline custom property.
  useEffect(() => {
    const observer = new MutationObserver(() => setAccent(readAccent()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ipc) return;
    const track: DesktopLyricsTrack | null = hasActiveSong
      ? { key: `${title}\u0000${artist}`, title, artist, accent, lines: isLoadingLyrics ? [] : lyrics }
      : null;
    ipc.send('desktop-lyrics:track', track);
  }, [ipc, hasActiveSong, title, artist, lyrics, isLoadingLyrics, accent]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!ipc || !audio) return;
    let lastSent = 0;
    const send = (playing = !audio.paused && !audio.ended) => {
      lastSent = Date.now();
      const clock: DesktopLyricsClock = {
        time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        playing,
        rate: audio.playbackRate || 1,
        sentAt: lastSent,
      };
      ipc.send('desktop-lyrics:clock', clock);
    };
    const onSync = () => send();
    const onStall = () => send(false);
    const onTimeUpdate = () => { if (Date.now() - lastSent >= CLOCK_RESYNC_MS) send(); };
    const syncEvents = ['play', 'playing', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'ended', 'emptied'] as const;
    syncEvents.forEach((name) => audio.addEventListener(name, onSync));
    audio.addEventListener('waiting', onStall);
    audio.addEventListener('timeupdate', onTimeUpdate);
    send();
    return () => {
      syncEvents.forEach((name) => audio.removeEventListener(name, onSync));
      audio.removeEventListener('waiting', onStall);
      audio.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [ipc, audioRef]);

  const toggle = useCallback(() => {
    if (!ipc) return;
    void ipc.invoke('desktop-lyrics:set-visible', !visible).then((value) => setVisible(Boolean(value)));
  }, [ipc, visible]);

  return { isSupported: Boolean(ipc), isVisible: visible, toggle };
}
