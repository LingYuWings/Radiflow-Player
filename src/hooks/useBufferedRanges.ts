import { useEffect, useState, type RefObject } from 'react';
import { readBufferedRanges, type BufferedRange } from '../lib/bufferedRanges';

export function useBufferedRanges(audioRef?: RefObject<HTMLAudioElement | null>) {
  const [ranges, setRanges] = useState<BufferedRange[]>([]);
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    let previous = '';
    const update = () => {
      const next = readBufferedRanges(audio);
      const key = JSON.stringify(next);
      if (key !== previous) { previous = key; setRanges(next); }
    };
    const reset = () => { previous = '[]'; setRanges([]); };
    const events = ['progress', 'loadedmetadata', 'durationchange', 'seeking', 'seeked', 'canplay'] as const;
    events.forEach(event => audio.addEventListener(event, update));
    audio.addEventListener('emptied', reset);
    audio.addEventListener('loadstart', reset);
    update();
    return () => {
      events.forEach(event => audio.removeEventListener(event, update));
      audio.removeEventListener('emptied', reset);
      audio.removeEventListener('loadstart', reset);
    };
  }, [audioRef]);
  return ranges;
}
