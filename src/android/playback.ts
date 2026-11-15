import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlaybackError } from '../lib/audioPlayback';

export interface AndroidTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  albumId?: string;
}

export type AndroidRepeat = 'off' | 'all' | 'one';

export interface AndroidPlaybackState {
  trackId: string | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  hasPrevious: boolean;
  hasNext: boolean;
  queue?: AndroidTrack[];
  shuffle?: boolean;
  repeat?: AndroidRepeat;
  volume?: number;
  eqEnabled?: boolean;
  eqGains?: number[];
  visualizer?: number[];
  waveform?: number[];
  error?: PlaybackError;
  onlineQueue?: AndroidTrack[];
}

export const emptyAndroidPlayback: AndroidPlaybackState = {
  trackId: null, playing: false, buffering: false, position: 0, duration: 0,
  hasPrevious: false, hasNext: false,
};

interface AndroidPlayback {
  library(): Promise<{ tracks: AndroidTrack[] }>;
  importTracks(): Promise<{ tracks: AndroidTrack[] }>;
  state(options?: { includeQueue?: boolean }): Promise<AndroidPlaybackState>;
  playTrack(options: { id: string }): Promise<AndroidPlaybackState>;
  playTracks(options: { id: string; queue: AndroidTrack[]; position?: number; autoplay?: boolean }): Promise<AndroidPlaybackState>;
  configurePlayback(options: {
    shuffle?: boolean; repeat?: AndroidRepeat; volume?: number; eqEnabled?: boolean; eqGains?: number[];
    visualizer?: 'spectrum' | 'waveform' | 'mirror' | 'off';
  }): Promise<AndroidPlaybackState>;
  editQueue(options:
    | { action: 'clear' }
    | { action: 'remove'; from: number }
    | { action: 'move'; from: number; to: number }
    | { action: 'enqueue'; track: AndroidTrack; next?: boolean }
  ): Promise<AndroidPlaybackState>;
  searchNetEase(options: { keywords: string }): Promise<{ tracks: AndroidTrack[] }>;
  playNetEase(options: { id: string; queue: AndroidTrack[] }): Promise<AndroidPlaybackState>;
  playQueuedTrack(options: { id: string }): Promise<AndroidPlaybackState>;
  toggle(): Promise<AndroidPlaybackState>;
  skip(options: { direction: 'previous' | 'next' }): Promise<AndroidPlaybackState>;
  seek(options: { position: number }): Promise<AndroidPlaybackState>;
  addListener(event: 'playbackChanged', listener: (state: AndroidPlaybackState) => void): Promise<PluginListenerHandle>;
}

export const androidPlayback = registerPlugin<AndroidPlayback>('RadiFlowPlayback');
