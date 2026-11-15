import type { AndroidPlaybackState } from './playback';

/** Adapt Media3 snapshots to the same time events used by the desktop lyrics. */
export class AndroidClock extends EventTarget {
  private trackId: string | null = null;
  private position = 0;
  private duration = 0;
  private sampledAt = 0;
  paused = true;
  ended = false;

  get currentTime() {
    const elapsed = this.paused ? 0 : Math.max(0, (performance.now() - this.sampledAt) / 1000);
    return this.duration > 0 ? Math.min(this.duration, this.position + elapsed) : this.position + elapsed;
  }

  update(state: AndroidPlaybackState) {
    const changedTrack = this.trackId !== state.trackId;
    const paused = !state.playing;
    const changedTransport = this.paused !== paused;
    this.trackId = state.trackId;
    this.position = state.position;
    this.duration = state.duration;
    this.sampledAt = performance.now();
    this.paused = paused;
    this.ended = !!state.trackId && paused && state.duration > 0 && state.position >= state.duration;
    if (changedTrack) this.dispatchEvent(new Event('loadedmetadata'));
    if (changedTransport) this.dispatchEvent(new Event(paused ? 'pause' : 'play'));
    this.dispatchEvent(new Event('timeupdate'));
  }
}
