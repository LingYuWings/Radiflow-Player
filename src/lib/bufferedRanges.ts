export type BufferedRange = { start: number; end: number };

export function readBufferedRanges(audio: Pick<HTMLMediaElement, 'buffered' | 'duration'>): BufferedRange[] {
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const result: BufferedRange[] = [];
  try {
    const ranges = audio.buffered;
    for (let i = 0; i < ranges.length; i++) {
      const start = Math.max(0, ranges.start(i));
      const end = Math.min(duration, ranges.end(i));
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) result.push({ start, end });
    }
  } catch { return []; } // A source replacement may invalidate a TimeRanges snapshot.
  return result;
}

export function bufferedTrack(ranges: BufferedRange[], duration: number, progress: number) {
  const layers = [`linear-gradient(to right, #fff 0% ${progress}%, transparent ${progress}% 100%)`];
  if (Number.isFinite(duration) && duration > 0) {
    for (const range of ranges) {
      const start = range.start / duration * 100, end = range.end / duration * 100;
      layers.push(`linear-gradient(to right, transparent 0% ${start}%, #ffffff40 ${start}% ${end}%, transparent ${end}% 100%)`);
    }
  }
  return [...layers, 'linear-gradient(#ffffff2e, #ffffff2e)'].join(', ');
}
