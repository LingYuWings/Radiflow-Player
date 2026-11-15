import { registerPlugin } from '@capacitor/core';
import type { LibrarySongPayload } from '../types/player';
import type { AndroidTrack } from './playback';
import { mergeLyrics, parseLRC, parseYRC } from '../utils/lyricsParser';

const nativeNetEase = registerPlugin<{
  request(options: { path: string; method?: 'GET' | 'POST' | 'DELETE'; body?: object }): Promise<{ status: number; data: unknown }>;
}>('AndroidNetEase');

export async function netease<T>(path: string, method?: 'POST' | 'DELETE', body?: object): Promise<T> {
  const response = await nativeNetEase.request({ path, method, body });
  if (response.status < 200 || response.status >= 300) {
    const error = response.data as { error?: string; code?: string } | undefined;
    throw new Error(error?.error || error?.code || 'HTTP ' + response.status);
  }
  return response.data as T;
}

export interface OnlineSong extends LibrarySongPayload {
  albumId?: string;
}

export interface OnlineItem {
  id: string;
  name: string;
  cover?: string;
  artist?: string;
  subtitle?: string;
}

export interface OnlinePlaylist extends OnlineItem {
  category: 'created' | 'followed';
  trackCount: number;
}

export interface OnlineCollection extends OnlineItem {
  songs: OnlineSong[];
  albums?: OnlineItem[];
}

export interface OnlineSession {
  isLoggedIn: boolean;
  account?: { nickname: string; avatarUrl?: string; userId: number } | null;
}

export function toOnlineTracks(songs: OnlineSong[] = []): AndroidTrack[] {
  const tracks = new Map<string, AndroidTrack>();
  for (const song of songs) {
    if (!/^netease:\d+$/.test(song.filename) || tracks.has(song.filename)) continue;
    tracks.set(song.filename, {
      id: song.filename, title: song.title, artist: song.artist,
      album: song.album, albumId: song.albumId,
      cover: song.cover?.replace(/^http:/i, 'https:'), duration: song.duration,
    });
  }
  return [...tracks.values()];
}

interface LyricResponse {
  data?: { lrc?: string; lyric?: string; tlyric?: string; ytlrc?: string; trans?: string; yrc?: string } | null;
}

export async function loadTrackLyrics(track: AndroidTrack) {
  const suffix = track.id.startsWith('netease:')
    ? '/' + encodeURIComponent(track.id.slice(8))
    : '?' + new URLSearchParams({ title: track.title, artist: track.artist });
  const { data } = await netease<LyricResponse>('/api/netease/lyric' + suffix);
  if (!data) return [];
  const timed = data.yrc ? parseYRC(data.yrc) : [];
  const primary = timed.length ? timed : parseLRC(data.lrc || data.lyric || '');
  const translation = data.ytlrc || data.tlyric || data.trans;
  return translation ? mergeLyrics(primary, parseLRC(translation)) : primary;
}
