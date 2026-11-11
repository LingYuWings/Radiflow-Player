export interface WaveformState { gain: number }
// Display-only gain and peak-preserving downsampling; never changes audio gain.
export function updateWaveform(samples: Uint8Array, points: Float32Array, elapsed: number, state: WaveformState = { gain: 1 }) {
  if (!samples.length || !points.length) return;
  let peak = 0;
  for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index] - 128) / 128);
  const quiet = peak <= 2 / 128;
  const dt = Math.max(0, Math.min(elapsed, .1));
  const targetGain = quiet ? 1 : Math.min(6, Math.max(1, .85 / peak));
  // Reduce gain quickly on loud passages, raise it gently on quiet passages.
  state.gain += (targetGain - state.gain) * (1 - Math.exp(-dt / (targetGain < state.gain ? .025 : .18)));
  let start = 0;
  for (let index = 1; index < samples.length / 4; index++) {
    if (samples[index - 1] < 128 && samples[index] >= 128) { start = index; break; }
  }
  const span = Math.max(1, Math.floor(samples.length / 2));
  const blend = 1 - Math.exp(-dt / (quiet ? .06 : .018));
  for (let index = 0; index < points.length; index++) {
    const from = start + Math.floor(index * span / points.length);
    const to = Math.min(samples.length, start + Math.max(Math.floor((index + 1) * span / points.length), Math.floor(index * span / points.length) + 1));
    let strongest = 0;
    for (let sample = from; sample < to; sample++) {
      const value = (samples[sample] - 128) / 128;
      if (Math.abs(value) > Math.abs(strongest)) strongest = value;
    }
    const value = quiet ? 0 : Math.max(-.95, Math.min(.95, strongest * state.gain));
    points[index] += (value - points[index]) * blend;
  }
}
