import type { LyricLine } from '../utils/lyricsParser';

/** Song + lyrics snapshot sent to the desktop lyrics window when the track changes. */
export interface DesktopLyricsTrack {
  key: string;
  title: string;
  artist: string;
  accent?: string;
  lines: LyricLine[];
}

/** Playback clock anchor; the lyrics window extrapolates time locally from it. */
export interface DesktopLyricsClock {
  time: number;
  playing: boolean;
  rate: number;
  sentAt: number;
}

export type DesktopLyricsCommand = 'toggle-play' | 'next' | 'prev';

/** Bridge exposed by desktop-lyrics-preload.cjs (absent in the main window). */
export interface DesktopLyricsBridge {
  onTrack: (callback: (track: DesktopLyricsTrack | null) => void) => () => void;
  onClock: (callback: (clock: DesktopLyricsClock) => void) => () => void;
  onLocked: (callback: (locked: boolean) => void) => () => void;
  ready: () => void;
  setLocked: (locked: boolean) => void;
  setIgnoreMouse: (ignore: boolean) => void;
  control: (command: DesktopLyricsCommand) => void;
  close: () => void;
}

export const DESKTOP_LYRICS_HASH = '#desktop-lyrics';

export function clockTimeAt(clock: DesktopLyricsClock, now = Date.now()): number {
  if (!clock.playing) return clock.time;
  return clock.time + Math.max(0, now - clock.sentAt) / 1000 * clock.rate;
}
