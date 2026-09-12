export const VISUALIZER_MODES = ['spectrum', 'waveform', 'mirror', 'off'] as const;
export type VisualizerMode = typeof VISUALIZER_MODES[number];
export function normalizeVisualizerMode(value: unknown): VisualizerMode {
  return VISUALIZER_MODES.includes(value as VisualizerMode) ? value as VisualizerMode : 'spectrum';
}
