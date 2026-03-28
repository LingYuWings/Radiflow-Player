import type { AppLanguage } from '../lib/copy';
import type { LibrarySection, PlaylistCollection } from '../components/Library';
import type { LoopMode } from '../components/PlayerControls';

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

export type AppSection = LibrarySection | 'settings';

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
  volume: number;
  loopMode: LoopMode;
  isShuffle: boolean;
}

export interface StoredPlaybackSession {
  version: number;
  queueSongKeys: string[];
  currentSongKey: string;
  currentTime: number;
  isPlaying: boolean;
  currentPlaybackPlaylistId: string | null;
  view: 'player' | 'library';
  showLyrics: boolean;
  showPlaylist: boolean;
}

export type PlaylistModalState =
  | { type: 'create-playlist'; pendingSongKeys: string[]; openPlaylistsAfterCreate: boolean }
  | { type: 'rename-playlist'; playlistId: string }
  | { type: 'delete-playlist'; playlistId: string; playlistName: string }
  | { type: 'pick-playlist'; pendingSongKeys: string[] }
  | null;

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

export const rebuildPlaylistCollections = (playlists: StoredPlaylist[], songs: Song[]): PlaylistCollection[] => {
  const songMap = new Map(songs.map((track) => [createSongIdentity(track), track]));

  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    updatedAt: playlist.updatedAt,
    songs: playlist.songKeys.map((songKey) => songMap.get(songKey)).filter((track): track is Song => Boolean(track)),
  }));
};
