/** Absolute audio time makes seeking, pausing and overlapping words deterministic. */
export function lyricWordProgress(time: number, start: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(start)) return 0;
  if (time < start) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, Math.max(0, (time - start) / duration));
}

/** Audio-clock envelope: a soft attack and short afterglow, including on seek. */
export function lyricWordGlow(time: number, start: number, duration: number): number {
  if (![time, start, duration].every(Number.isFinite) || duration <= 0 || time <= start) return 0;
  const elapsed = time - start;
  const attack = Math.min(0.14, duration * 0.3);
  const value = elapsed < attack ? elapsed / attack : 1 - Math.max(0, elapsed - duration) / 0.32;
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}
