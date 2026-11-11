import React, { useRef, useEffect, useCallback } from 'react';
import { LyricLine } from '../utils/lyricsParser';
import { lyricWordProgress } from '../lib/lyricProgress';
import { findActiveLyricIndex, useLyricWordPaint } from '../hooks/useLyricWordPaint';
import { cn } from '../lib/utils';
import { useAudioClock } from '../hooks/useAudioClock';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { stepAnchoredLyricScroll } from '../lib/lyricScroll';

interface LyricsViewProps {
  lyrics: LyricLine[];
  currentTime: number;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  onSeek?: (time: number) => void;
}

export const LyricsView: React.FC<LyricsViewProps> = ({ lyrics, currentTime, audioRef, onSeek }) => {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const scrollVelocity = useRef(0);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  const selectLine = useCallback((time: number) => findActiveLyricIndex(lyrics, time), [lyrics]);
  const activeIndex = useAudioClock(audioRef, currentTime, selectLine);

  useEffect(() => {
    const container = containerRef.current;
    const line = activeLineRef.current;
    if (!container || !line) return;
    let frame = 0;
    let position = container.scrollTop;
    let previousTime = performance.now();
    let settleAfter = previousTime + 750;
    const originalText = line.querySelector<HTMLElement>('.rf-lyric-text');
    // The original text is the anchor, not the expanding bilingual block.
    const target = () => Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
      line.offsetTop + (originalText ? originalText.offsetTop + originalText.offsetHeight / 2 : line.offsetHeight / 2) - container.clientHeight / 2));
    let previousTarget = target();
    const follow = (now: number) => {
      const destination = target();
      const next = stepAnchoredLyricScroll(position, scrollVelocity.current, previousTarget, destination, (now - previousTime) / 1000);
      previousTarget = destination;
      previousTime = now;
      position = next.position;
      scrollVelocity.current = next.velocity;
      container.scrollTop = position;
      if (now < settleAfter || Math.abs(destination - position) > 0.3 || Math.abs(next.velocity) > 3) {
        frame = requestAnimationFrame(follow);
      } else {
        container.scrollTop = destination;
        scrollVelocity.current = 0;
        frame = 0;
      }
    };
    const center = () => {
      if (reducedMotion) { container.scrollTop = target(); scrollVelocity.current = 0; return; }
      settleAfter = performance.now() + 750;
      if (!frame) {
        position = container.scrollTop;
        previousTarget = target();
        previousTime = performance.now();
        frame = requestAnimationFrame(follow);
      }
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(container);
    if (originalText) observer.observe(originalText);
    const stopFollowing = () => { cancelAnimationFrame(frame); frame = 0; scrollVelocity.current = 0; };
    container.addEventListener('wheel', stopFollowing, { passive: true });
    container.addEventListener('touchstart', stopFollowing, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('wheel', stopFollowing);
      container.removeEventListener('touchstart', stopFollowing);
    };
  }, [activeIndex, lyrics, reducedMotion]);

  useLyricWordPaint(activeLineRef, lyrics[activeIndex], audioRef, timeRef);

  return (
    <div ref={containerRef} className="rf-lyric-surface relative h-full overflow-y-auto px-8 py-[40vh] scrollbar-hide mask-fade-edges">
      <div className="flex flex-col gap-4">
        {lyrics.map((line, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={index}
              ref={isActive ? activeLineRef : null}
              role={onSeek ? 'button' : undefined}
              tabIndex={onSeek ? 0 : undefined}
              aria-label={line.text}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSeek?.(line.startTime)}
              onKeyDown={(event) => {
                if (onSeek && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault(); event.stopPropagation(); onSeek(line.startTime);
                }
              }}
              className={cn('relative rf-lyric-line origin-left', isActive ? 'rf-lyric-line-current' : index < activeIndex ? 'rf-lyric-line-past' : '', Math.abs(index - activeIndex) > 2 && 'rf-lyric-line-distant')}
            >
              <div className="rf-lyric-text text-3xl md:text-5xl font-bold tracking-tight leading-tight">
                {line.words?.length ? line.words.map((word, wordIndex) => (
                  <span key={wordIndex} data-lyric-word={isActive ? '' : undefined} className="rf-lyric-word" style={isActive ? {
                    '--lyric-fill': `${lyricWordProgress(currentTime, word.startTime, word.duration) * 100}%`,
                  } as React.CSSProperties : undefined}>
                    {word.text}
                    {isActive && <>
                    <span aria-hidden="true" className="rf-lyric-word-glow"><span className="rf-lyric-word-fill">{word.text}</span></span>
                    <span aria-hidden="true" className="rf-lyric-word-fill">{word.text}</span>
                    </>}
                  </span>
                )) : line.text}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {isActive && line.translation && line.translation !== '//' && (
                  <motion.div
                    key={`${index}:${line.translation}`}
                    initial={{ opacity: 0, height: 0, y: reducedMotion ? 0 : 10 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: reducedMotion ? 0 : -10 }}
                    transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="overflow-hidden pointer-events-none"
                  >
                    <div className="rf-lyric-translation text-xl md:text-3xl pt-4 font-medium leading-relaxed">
                      {line.translation}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
