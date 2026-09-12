import React, { useRef, useEffect, useCallback } from 'react';
import { LyricLine } from '../utils/lyricsParser';
import { lyricWordProgress, lyricWordGlow } from '../lib/lyricProgress';
import { cn } from '../lib/utils';
import { useAudioClock } from '../hooks/useAudioClock';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { stepLyricScroll } from '../lib/lyricScroll';

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
  const selectLine = useCallback((time: number) => lyrics.findIndex(
    (line, index) => time >= line.startTime &&
      (index === lyrics.length - 1 || time < lyrics[index + 1].startTime)
  ), [lyrics]);
  const activeIndex = useAudioClock(audioRef, currentTime, selectLine);

  useEffect(() => {
    const container = containerRef.current;
    const line = activeLineRef.current;
    if (!container || !line) return;
    let frame = 0;
    let position = container.scrollTop;
    let previousTime = performance.now();
    let settleAfter = previousTime + 750;
    const target = () => Math.min(container.scrollHeight - container.clientHeight, Math.max(0, line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2));
    const follow = (now: number) => {
      const destination = target();
      const next = stepLyricScroll(position, scrollVelocity.current, destination, (now - previousTime) / 1000);
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
        previousTime = performance.now();
        frame = requestAnimationFrame(follow);
      }
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(container);
    const originalText = line.querySelector('.rf-lyric-text');
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

  useEffect(() => {
    const words = lyrics[activeIndex]?.words;
    const line = activeLineRef.current;
    if (!words?.length || !line) return;
    const elements = Array.from(line.querySelectorAll('[data-lyric-word]')) as HTMLElement[];
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
  }, [activeIndex, lyrics, audioRef]);

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
              className={cn('rf-lyric-line origin-left', isActive ? 'rf-lyric-line-current' : index < activeIndex ? 'rf-lyric-line-past' : '', Math.abs(index - activeIndex) > 2 && 'rf-lyric-line-distant')}
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
