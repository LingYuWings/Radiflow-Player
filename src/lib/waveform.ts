// Phase-align and average adjacent PCM samples, then smooth between frames.
export function updateWaveform(samples: Uint8Array, points: Float32Array, elapsed: number) {
  if (!samples.length || !points.length) return;
  let start = 0;
  for (let index = 1; index < samples.length / 4; index++) {
    if (samples[index - 1] < 128 && samples[index] >= 128) { start = index; break; }
  }
  const span = Math.max(1, Math.floor(samples.length / 2));
  const blend = 1 - Math.exp(-Math.max(0, Math.min(elapsed, .1)) / .045);
  for (let index = 0; index < points.length; index++) {
    const from = start + Math.floor(index * span / points.length);
    const to = Math.min(samples.length, start + Math.max(Math.floor((index + 1) * span / points.length), Math.floor(index * span / points.length) + 1));
    let sum = 0;
    for (let sample = from; sample < to; sample++) sum += (samples[sample] - 128) / 128;
    const value = sum / Math.max(1, to - from);
    points[index] += (value - points[index]) * blend;
  }
}
