import type { AppLanguage } from '../lib/copy';
import type { LibrarySection, PlaylistCollection } from '../components/Library';
import type { LoopMode } from '../components/PlayerControls';

// Shared renderer-domain types. These describe UI models and persisted state,
// not the raw on-disk schema used by the server.
export interface Song {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  lrc: string;
  file?: File | string;
}

export interface LibrarySongPayload {
  filename: string;
  fileUrl: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
}

export const EMPTY_SONG: Song = {
  title: 'No Song Selected',
  artist: 'Upload an audio file to start',
  cover: undefined,
  lrc: '',
};

export type AppSection = LibrarySection | 'settings' | 'eq';

export interface StoredPlaylist {
  id: string;
  name: string;
  songKeys: string[];
  updatedAt: number;
}

export interface StoredPreferences {
  version: number;
  language: AppLanguage;
  effect: 'blur' | 'streamer';
  backgroundSource?: 'default' | 'custom' | 'transparent';
  customBackgroundImage?: string | null;
  customBackgroundBlur?: number;
  transparentBackgroundBlur?: number;
  volume: number;
  eqEnabled?: boolean;
  eqGains?: number[];
  loopMode: LoopMode;
  isShuffle: boolean;
}

export interface StoredPlaybackSession {
  version: number;
  queueSongKeys: string[];
  queueSnapshot?: Song[];
  currentSongKey: string;
  currentTime: number;
  isPlaying: boolean;
  currentPlaybackPlaylistId: string | null;
  view: 'player' | 'library';
  showLyrics: boolean;
  showPlaylist: boolean;
}

export type PlaylistModalScope = 'local' | 'netease';

export type PlaylistModalState =
  | {
    type: 'create-playlist';
    scope: PlaylistModalScope;
    pendingSongKeys: string[];
    pendingSongIds: string[];
    openPlaylistsAfterCreate: boolean;
    allowScopeSelection: boolean;
  }
  | { type: 'rename-playlist'; playlistId: string; scope: PlaylistModalScope }
  | { type: 'delete-playlist'; playlistId: string; playlistName: string; scope: PlaylistModalScope }
  | { type: 'pick-playlist'; scope: PlaylistModalScope; pendingSongKeys: string[]; pendingSongIds: string[] }
  | null;

export const NETEASE_STREAM_PATH_PREFIX = '/api/netease/song/stream/';

// Song identity is stable across queue, playlist, and session persistence. Local
// File objects fall back to name+size because they do not yet have a URL.
export const createSongIdentity = (song: Song) => {
  const fileIdentity = typeof song.file === 'string'
    ? song.file
    : song.file
      ? `${song.file.name}-${song.file.size}`
      : '';

  return `${song.title}::${song.artist}::${song.album || ''}::${fileIdentity}`;
};

export const getPersistedSongKey = (song: Song) => {
  if (typeof song.file !== 'string') {
    return null;
  }

  return createSongIdentity(song);
};

export const getNetEaseSongIdFromSong = (song: Song) => {
  if (typeof song.file !== 'string' || !song.file.startsWith(NETEASE_STREAM_PATH_PREFIX)) {
    return null;
  }

  const songId = song.file.slice(NETEASE_STREAM_PATH_PREFIX.length).trim();
  return songId ? decodeURIComponent(songId) : null;
};

// Rehydrate stored playlist definitions by resolving saved song keys against the
// current library snapshot.
export const rebuildPlaylistCollections = (playlists: StoredPlaylist[], songs: Song[]): PlaylistCollection[] => {
  const songMap = new Map(songs.map((track) => [createSongIdentity(track), track]));

  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    updatedAt: playlist.updatedAt,
    source: 'local',
    playlistCategory: 'created',
    songs: playlist.songKeys.map((songKey) => songMap.get(songKey)).filter((track): track is Song => Boolean(track)),
  }));
};
