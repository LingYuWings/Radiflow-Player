import React, { useRef, useEffect } from 'react';
import { LyricLine } from '../utils/lyricsParser';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface LyricsViewProps {
  lyrics: LyricLine[];
  currentTime: number;
  onSeek?: (time: number) => void;
}

export const LyricsView: React.FC<LyricsViewProps> = ({ lyrics, currentTime, onSeek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const activeIndex = lyrics.findIndex(
    (line, i) => currentTime >= line.startTime && (i === lyrics.length - 1 || currentTime < lyrics[i + 1].startTime)
  );

  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeLine = activeLineRef.current;
      
      const targetScroll = activeLine.offsetTop - container.offsetHeight / 2 + activeLine.offsetHeight / 2;
      
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    }
  }, [activeIndex]);

  return (
    <div 
      ref={containerRef}
      className="h-full overflow-y-auto px-8 py-[40vh] scrollbar-hide mask-fade-edges"
    >
      <div className="flex flex-col gap-4">
        {lyrics.map((line, index) => {
          const isActive = index === activeIndex;
          const isPast = index < activeIndex;
          
          return (
            <div
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => onSeek?.(line.startTime)}
              className={cn(
                "cursor-pointer transition-all duration-700 origin-left py-4",
                isActive ? "opacity-100 scale-105 blur-none py-12 translate-y-0" : "opacity-30 scale-100 hover:opacity-50 blur-[6px] translate-y-[8px]",
                isPast && !isActive && "opacity-20"
              )}
            >
              <div className="text-3xl md:text-5xl font-bold tracking-tight leading-tight flex flex-wrap gap-x-2">
                {line.words ? (
                  line.words.map((word, wIdx) => {
                    const isWordActive = currentTime >= word.startTime && currentTime < word.startTime + word.duration;
                    const isWordPast = currentTime >= word.startTime + word.duration;
                    
                    return (
                      <motion.span 
                        key={wIdx}
                        className="relative inline-block text-white/40"
                        animate={{ 
                          y: (isWordActive || isWordPast) ? 0 : 4 
                        }}
                        transition={isWordActive ? { 
                          duration: word.duration, 
                          ease: "linear" 
                        } : { 
                          duration: 0.3 
                        }}
                      >
                        {word.text}
                        {isActive && (isWordActive || isWordPast) && (
                          <motion.span 
                            className="absolute inset-0 text-white overflow-hidden whitespace-nowrap select-none pointer-events-none"
                            initial={isWordActive ? { width: 0, filter: "drop-shadow(0 0 0px rgba(255,255,255,0))" } : { width: '100%', filter: "drop-shadow(0 0 8px rgba(255,255,255,0.3))" }}
                            animate={isWordActive ? { 
                              width: '100%', 
                              filter: "drop-shadow(0 0 12px rgba(255,255,255,0.6))" 
                            } : { 
                              width: '100%',
                              filter: "drop-shadow(0 0 8px rgba(255,255,255,0.3))"
                            }}
                            transition={isWordActive ? { 
                              width: { duration: word.duration, ease: "linear" },
                              filter: { duration: 0.3 }
                            } : { duration: 0.3 }}
                          >
                            {word.text}
                          </motion.span>
                        )}
                      </motion.span>
                    );
                  })
                ) : (
                  <span className="text-white">{line.text}</span>
                )}
              </div>
              <AnimatePresence mode="wait">
                {isActive && line.translation && line.translation !== '//' && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0, y: 10 }}
                    animate={{ opacity: 0.8, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="text-xl md:text-3xl mt-4 font-medium leading-relaxed text-white/70">
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
