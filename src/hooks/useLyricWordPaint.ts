import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { LyricLine } from '../utils/lyricsParser';
import { lyricWordGlow, lyricWordProgress } from '../lib/lyricProgress';

/** Index of the line whose time window contains `time`, or -1 before the first line. */
export function findActiveLyricIndex(lyrics: LyricLine[], time: number): number {
  return lyrics.findIndex((line, index) => time >= line.startTime &&
    (index === lyrics.length - 1 || time < lyrics[index + 1].startTime));
}

/**
 * Paints word fill/glow on `[data-lyric-word]` children of the active line,
 * straight from the audio clock. Runs a frame loop only while audio plays.
 */
export function useLyricWordPaint(
  lineRef: RefObject<HTMLElement | null>,
  line: LyricLine | undefined,
  audioRef: RefObject<HTMLAudioElement | null> | undefined,
  timeRef: RefObject<number>,
) {
  useEffect(() => {
    const words = line?.words;
    const lineElement = lineRef.current;
    if (!words?.length || !lineElement) return;
    const elements = Array.from(lineElement.querySelectorAll('[data-lyric-word]')) as HTMLElement[];
    const audio = audioRef?.current;
    let frame = 0;
    let lastTime = -1;
    const previous = elements.map(() => '');
    const previousGlow = elements.map(() => '');
    const paint = () => {
      const time = audio ? audio.currentTime : timeRef.current;
      if (time === lastTime) return;
      lastTime = time;
      elements.forEach((element, index) => {
        const word = words[index];
        if (!word) return;
        const progress = lyricWordProgress(time, word.startTime, word.duration);
        const glow = lyricWordGlow(time, word.startTime, word.duration).toFixed(3);
        if (previousGlow[index] !== glow) {
          element.style.setProperty('--lyric-glow', glow);
          previousGlow[index] = glow;
        }
        const fill = `${(progress * 100).toFixed(2)}%`;
        if (previous[index] !== fill) {
          element.style.setProperty('--lyric-fill', fill);
          element.dataset.fill = progress <= 0 ? 'empty' : progress >= 1 ? 'full' : 'partial';
          previous[index] = fill;
        }
        const singing = String(time >= word.startTime && time < word.startTime + word.duration);
        if (element.dataset.singing !== singing) element.dataset.singing = singing;
      });
    };
    const tick = () => {
      paint();
      frame = audio && !audio.paused && !audio.ended && !document.hidden
        ? requestAnimationFrame(tick) : 0;
    };
    // Audio events update immediately, but must not restart a healthy frame loop.
    // Repeated timeupdate cancellation can otherwise create a visible cadence.
    const sync = () => {
      paint();
      if (!audio || audio.paused || audio.ended || document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };
    sync();
    const events = ['play', 'pause', 'seeking', 'seeked', 'timeupdate', 'ended'] as const;
    events.forEach((event) => audio?.addEventListener(event, sync));
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((event) => audio?.removeEventListener(event, sync));
      document.removeEventListener('visibilitychange', sync);
    };
  }, [line, lineRef, audioRef, timeRef]);
}
