import React, { useCallback, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { LyricLine } from '../utils/lyricsParser';
import { useAudioClock } from '../hooks/useAudioClock';
import { findActiveLyricIndex, useLyricWordPaint } from '../hooks/useLyricWordPaint';

const LINE_EASE = [0.23, 1, 0.32, 1] as const;

type MiniLyricProps = {
  lyrics: LyricLine[];
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
};

// One-line lyric for the dock: lines blur in/out, timed words share the main
// player's fill + glow rendering and are painted from the same audio clock.
export function MiniLyric({ lyrics, audioRef, currentTime }: MiniLyricProps) {
  const reducedMotion = useReducedMotion();
  const lineRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  const selectLine = useCallback((time: number) => findActiveLyricIndex(lyrics, time), [lyrics]);
  const activeIndex = useAudioClock(audioRef, currentTime, selectLine);
  const line = activeIndex >= 0 ? lyrics[activeIndex] : undefined;
  useLyricWordPaint(lineRef, line, audioRef, timeRef);

  const hidden = reducedMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(6px)' };
  const text = line?.text.trim();

  return (
    <div className="rf-mini-lyric" aria-live="off" title={line?.translation && line.translation !== '//' ? line.translation : undefined}>
      <AnimatePresence initial={false}>
        <motion.div
          key={line ? activeIndex : 'interlude'}
          ref={lineRef}
          className="rf-mini-lyric-line"
          initial={{ ...hidden, y: reducedMotion ? 0 : 10 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          exit={{ ...hidden, y: reducedMotion ? 0 : -10 }}
          transition={{ duration: reducedMotion ? 0.15 : 0.45, ease: LINE_EASE }}
        >
          {!text ? (
            <span className="rf-mini-lyric-interlude" aria-hidden="true">• • •</span>
          ) : line?.words?.length ? line.words.map((word, wordIndex) => (
            <span key={wordIndex} data-lyric-word="" className="rf-lyric-word">
              {word.text}
              <span aria-hidden="true" className="rf-lyric-word-glow"><span className="rf-lyric-word-fill">{word.text}</span></span>
              <span aria-hidden="true" className="rf-lyric-word-fill">{word.text}</span>
            </span>
          )) : (
            <span className="rf-mini-lyric-plain">{line?.text}</span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
