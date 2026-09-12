import express from "express";
import { createHash } from "crypto";
import fs from "fs";
import type { Server } from "http";
import { parseFile } from "music-metadata";
import { createRequire } from "module";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync, gzip } from "zlib";
import { promisify } from 'node:util';
import { mapConcurrent } from './src/lib/mapConcurrent';
const gzipAsync = promisify(gzip);
const libraryScans = new Map<string, Promise<PersistedLibraryCache>>();

// Local HTTP service for the Electron shell. It owns library scanning, cover and
// lyric persistence, and the API surface consumed by the React renderer.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
type NetEaseRequestHandler = (payload: any) => Promise<{ status: number; body: unknown; cookie: string[] }>;
type NetEaseApiModule = typeof import('@neteasecloudmusicapienhanced/api') & {
  user_playlist_create?: NetEaseRequestHandler;
  user_playlist_collect?: NetEaseRequestHandler;
  cloudsearch?: NetEaseRequestHandler;
  album?: NetEaseRequestHandler;
  artist_album?: NetEaseRequestHandler;
  artists?: NetEaseRequestHandler;
  artist_songs?: NetEaseRequestHandler;
  search_default?: NetEaseRequestHandler;
  search_hot?: NetEaseRequestHandler;
  search_hot_detail?: NetEaseRequestHandler;
  search_suggest?: NetEaseRequestHandler;
  search_multimatch?: NetEaseRequestHandler;
  playlist_create?: NetEaseRequestHandler;
  playlist_delete?: NetEaseRequestHandler;
  playlist_tracks?: NetEaseRequestHandler;
};

const neteaseApi = require('@neteasecloudmusicapienhanced/api') as NetEaseApiModule;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg']);

// In-memory caches avoid reparsing metadata or rereading bundled cover payloads
// on every request. Durable cache files live inside the selected music folder.
const metadataCache = new Map<string, LibrarySongPayload>();
const coverBundleMemoryCache = new Map<string, PersistedCoverBundle>();
const LIBRARY_CACHE_DIRECTORY_NAME = 'local';
const LIBRARY_CACHE_FILE_NAME = 'library-cache.json';
const LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME = 'cover-cache.json.gz';
const LEGACY_LIBRARY_CACHE_IMAGE_DIRECTORY_NAME = 'image';
const LIBRARY_CACHE_VERSION = 1;
const LYRIC_CACHE_DIRECTORY_NAME = 'lyric';
const LYRIC_CACHE_INDEX_FILE_NAME = 'index.json';
const LYRIC_CACHE_VERSION = 1;
const LYRIC_CACHE_DB_FILE_NAME = 'lyrics.db';
const MANUAL_LYRIC_EXTENSIONS = new Set(['.lrc', '.yrc', '.txt']);

interface LibrarySongPayload {
  mtimeMs?: number;
  size?: number;
  filename: string;
  fileUrl: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
}

interface PersistedLibraryCache {
  version: number;
  folder: string;
  generatedAt: string;
  songs: LibrarySongPayload[];
}

interface PersistedCoverAsset {
  mimeType: string;
  data: string;
}

interface PersistedCoverBundle {
  version: number;
  folder: string;
  generatedAt: string;
  assets: Record<string, PersistedCoverAsset>;
}

interface PersistedLyricData {
  lrc?: string;
  lyric?: string;
  tlyric?: string;
  trans?: string;
  yrc?: string;
  ytlrc?: string;
}

interface PersistedLyricFile {
  version: number;
  title: string;
  artist: string;
  songId: string | null;
  savedAt: string;
  data: PersistedLyricData;
}

interface PersistedLyricIndexEntry {
  cacheFile: string;
  title: string;
  artist: string;
  savedAt: string;
}

interface PersistedLyricIndex {
  version: number;
  folder: string;
  generatedAt: string;
  entries: Record<string, PersistedLyricIndexEntry>;
}

interface PersistedLyricDatabaseRow {
  title: string;
  artist: string;
  song_id: string | null;
  lrc: string | null;
  lyric: string | null;
  tlyric: string | null;
  trans: string | null;
  yrc: string | null;
  ytlrc: string | null;
  saved_at: string;
}

type NetEaseFavoriteKind = 'song' | 'album';

interface NetEaseFavoriteSongPayload {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  fileUrl: string;
}

interface NetEaseFavoriteAlbumPayload {
  id: string;
  name: string;
  artist?: string;
  cover?: string;
  songCount?: number;
}

interface PersistedNetEaseFavoriteRow {
  type: NetEaseFavoriteKind;
  item_id: string;
  payload_json: string;
  saved_at: string;
}

interface StartServerOptions {
  port?: number;
  host?: string;
  mode?: 'development' | 'production';
  staticRoot?: string;
  initialMusicDir?: string;
}

interface StartedServer {
  port: number;
  host: string;
  url: string;
  server: Server;
}

interface NetEaseAccountSummary {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
  vipType?: number;
}

type NetEasePlaylistCategory = 'created' | 'followed';

interface NetEasePlaylistSummary {
  id: string;
  name: string;
  cover?: string;
  trackCount: number;
  updatedAt: number;
  category: NetEasePlaylistCategory;
  description?: string;
}

interface NetEaseSessionState {
  cookie: string | null;
  account: NetEaseAccountSummary | null;
}

let lyricDatabaseState: { musicDir: string; database: DatabaseSync } | null = null;

const getCacheKey = (filePath: string, stats: fs.Stats) => `${filePath}|${stats.mtimeMs}|${stats.size}`;
const getLibraryCacheDirectory = (musicDir: string) => path.join(musicDir, LIBRARY_CACHE_DIRECTORY_NAME);
const getLibraryCacheFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_FILE_NAME);
const getLibraryCoverBundleFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME);
const getLyricCacheDirectory = (musicDir: string) => path.join(musicDir, LYRIC_CACHE_DIRECTORY_NAME);
const getLyricCacheIndexFilePath = (musicDir: string) => path.join(getLyricCacheDirectory(musicDir), LYRIC_CACHE_INDEX_FILE_NAME);
const getLyricCacheDatabaseFilePath = (musicDir: string) => path.join(getLyricCacheDirectory(musicDir), LYRIC_CACHE_DB_FILE_NAME);
const isRefreshRequested = (value: unknown) => value === '1' || value === 'true';
const NETEASE_STREAM_PATH_PREFIX = '/api/netease/song/stream/';
const NETEASE_FAVORITE_TYPES = new Set<NetEaseFavoriteKind>(['song', 'album']);
const DEFAULT_NETEASE_AUDIO_LEVEL = 'exhigh';
const NETEASE_AUDIO_LEVEL_PRIORITY = ['jymaster', 'sky', 'dolby', 'jyeffect', 'hires', 'lossless', 'exhigh', 'higher', 'standard'] as const;
const NETEASE_FALLBACK_BITRATES = [320000, 192000, 128000] as const;
const NETEASE_SONG_DETAIL_BATCH_SIZE = 500;
const NETEASE_STREAM_RESPONSE_HEADERS = ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified'] as const;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? value as Record<string, unknown> : null
);

const getStringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const getNumberValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
};

const getBooleanValue = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return null;
};

const isNetEaseFavoriteType = (value: unknown): value is NetEaseFavoriteKind => (
  typeof value === 'string' && NETEASE_FAVORITE_TYPES.has(value as NetEaseFavoriteKind)
);

const sanitizeNetEaseFavoriteSongPayload = (value: unknown): NetEaseFavoriteSongPayload | null => {
  const payload = asRecord(value);
  const id = getStringValue(payload?.id)?.trim();
  const title = getStringValue(payload?.title)?.trim();
  const artist = getStringValue(payload?.artist)?.trim();

  if (!id || !title || !artist) {
    return null;
  }

  const fileUrl = getStringValue(payload?.fileUrl)?.trim() || `${NETEASE_STREAM_PATH_PREFIX}${encodeURIComponent(id)}`;

  return {
    id,
    title,
    artist,
    album: getStringValue(payload?.album)?.trim() || undefined,
    cover: getStringValue(payload?.cover)?.trim() || undefined,
    duration: getNumberValue(payload?.duration) ?? undefined,
    fileUrl,
  };
};

const sanitizeNetEaseFavoriteAlbumPayload = (value: unknown): NetEaseFavoriteAlbumPayload | null => {
  const payload = asRecord(value);
  const id = getStringValue(payload?.id)?.trim();
  const name = getStringValue(payload?.name)?.trim();

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    artist: getStringValue(payload?.artist)?.trim() || undefined,
    cover: getStringValue(payload?.cover)?.trim() || undefined,
    songCount: getNumberValue(payload?.songCount) ?? undefined,
  };
};

const sanitizeNetEaseCookie = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const getNetEaseRequestCookie = (cookie: string | null) => {
  if (!cookie) {
    return null;
  }

  if (/(^|;\s*)os=/.test(cookie)) {
    return cookie;
  }

  return `${cookie}; os=pc`;
};

const normalizeNetEaseAudioLevel = (value: unknown) => {
  if (typeof value !== 'string') {
    return DEFAULT_NETEASE_AUDIO_LEVEL;
  }

  const normalizedValue = value.trim().toLowerCase();
  return NETEASE_AUDIO_LEVEL_PRIORITY.includes(normalizedValue as typeof NETEASE_AUDIO_LEVEL_PRIORITY[number])
    ? normalizedValue
    : DEFAULT_NETEASE_AUDIO_LEVEL;
};

const getNetEaseAudioLevelsToTry = (requestedLevel: unknown) => {
  const normalizedLevel = normalizeNetEaseAudioLevel(requestedLevel) as typeof NETEASE_AUDIO_LEVEL_PRIORITY[number];
  const startIndex = NETEASE_AUDIO_LEVEL_PRIORITY.indexOf(normalizedLevel);
  return NETEASE_AUDIO_LEVEL_PRIORITY.slice(startIndex);
};

const getNetEaseSongIdFromFileUrl = (fileUrl?: string) => {
  if (!fileUrl || !fileUrl.startsWith(NETEASE_STREAM_PATH_PREFIX)) {
    return null;
  }

  const relativePath = fileUrl.slice(NETEASE_STREAM_PATH_PREFIX.length);
  const songId = relativePath.split('?')[0];
  if (!songId) {
    return null;
  }

  try {
    return decodeURIComponent(songId);
  } catch {
    return songId;
  }
};

const getNetEaseSizedImageUrl = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const separator = value.includes('?') ? '&' : '?';
  return `${value}${separator}param=320y320`;
};

const getNetEaseArtistName = (value: unknown) => {
  const artists = Array.isArray(value) ? value : [];
  const names = artists
    .map((entry) => getStringValue(asRecord(entry)?.name))
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .map((entry) => entry.trim());

  return names.length > 0 ? names.join(' / ') : 'Unknown Artist';
};

const toNetEaseAccountSummary = (value: unknown): NetEaseAccountSummary | null => {
  const payload = asRecord(value);
  const data = asRecord(payload?.data);
  const profile = asRecord(payload?.profile) ?? asRecord(data?.profile);
  const account = asRecord(payload?.account) ?? asRecord(data?.account);
  const userId = getNumberValue(profile?.userId ?? profile?.id ?? account?.id ?? account?.userId);

  if (!userId) {
    return null;
  }

  return {
    userId,
    nickname: getStringValue(profile?.nickname)?.trim() || `User ${userId}`,
    avatarUrl: getStringValue(profile?.avatarUrl) || undefined,
    signature: getStringValue(profile?.signature) || undefined,
    vipType: getNumberValue(profile?.vipType ?? account?.vipType) || undefined,
  };
};

const getNetEasePlaylistCategory = (
  playlist: Record<string, unknown> | null,
  currentUserId?: number | null,
): NetEasePlaylistCategory => {
  const creator = asRecord(playlist?.creator);
  const creatorUserId = getNumberValue(creator?.userId ?? creator?.id ?? playlist?.userId);

  if (currentUserId && creatorUserId) {
    return creatorUserId === currentUserId ? 'created' : 'followed';
  }

  if (typeof playlist?.subscribed === 'boolean') {
    return playlist.subscribed ? 'followed' : 'created';
  }

  return 'created';
};

const toNetEasePlaylistSummary = (
  value: unknown,
  options?: { category?: NetEasePlaylistCategory; currentUserId?: number | null },
): NetEasePlaylistSummary | null => {
  const playlist = asRecord(value);
  const id = getStringValue(playlist?.id);
  const name = getStringValue(playlist?.name)?.trim();

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    cover: getNetEaseSizedImageUrl(getStringValue(playlist?.coverImgUrl) || getStringValue(playlist?.picUrl)),
    trackCount: getNumberValue(playlist?.trackCount) || 0,
    updatedAt: getNumberValue(playlist?.updateTime) || Date.now(),
    category: options?.category ?? getNetEasePlaylistCategory(playlist, options?.currentUserId),
    description: getStringValue(playlist?.description) || undefined,
  };
};

const toNetEaseSongPayload = (value: unknown): LibrarySongPayload | null => {
  const track = asRecord(value);
  const songId = getStringValue(track?.id);
  const title = getStringValue(track?.name)?.trim();

  if (!songId || !title) {
    return null;
  }

  const album = asRecord(track?.al) ?? asRecord(track?.album);
  const durationMs = getNumberValue(track?.dt ?? track?.duration);

  return {
    filename: `netease:${songId}`,
    fileUrl: `${NETEASE_STREAM_PATH_PREFIX}${encodeURIComponent(songId)}`,
    title,
    artist: getNetEaseArtistName(track?.ar ?? track?.artists),
    album: getStringValue(album?.name) || undefined,
    cover: getNetEaseSizedImageUrl(getStringValue(album?.picUrl) || getStringValue(track?.picUrl)),
    duration: durationMs ? durationMs / 1000 : undefined,
  };
};

const toNetEaseLyricPayload = (value: unknown): PersistedLyricData => {
  const payload = asRecord(value);
  const ytlrc = getStringValue(asRecord(payload?.ytlrc)?.lyric);
  const translatedLyric = ytlrc || getStringValue(asRecord(payload?.tlyric)?.lyric);

  return sanitizeLyricPayload({
    lrc: getStringValue(asRecord(payload?.lrc)?.lyric) || getStringValue(asRecord(payload?.klyric)?.lyric),
    lyric: getStringValue(asRecord(payload?.lrc)?.lyric) || getStringValue(asRecord(payload?.klyric)?.lyric),
    tlyric: translatedLyric,
    trans: translatedLyric,
    yrc: getStringValue(asRecord(payload?.yrc)?.lyric),
    ytlrc,
  });
};

const getNetEasePlaylistEntries = (value: unknown) => {
  const payload = asRecord(value);
  return Array.isArray(payload?.playlist)
    ? payload.playlist
    : Array.isArray(asRecord(payload?.data)?.playlist)
      ? asRecord(payload?.data)?.playlist as unknown[]
      : [];
};

const getNetEaseSearchSongEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result) ?? asRecord(asRecord(payload?.data)?.result);
  return Array.isArray(result?.songs) ? result.songs : [];
};

const getNetEaseSearchAlbumEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result) ?? asRecord(asRecord(payload?.data)?.result);
  return Array.isArray(result?.albums) ? result.albums : [];
};

const getNetEaseSearchArtistEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result) ?? asRecord(asRecord(payload?.data)?.result);
  return Array.isArray(result?.artists) ? result.artists : [];
};

const getNetEaseCollectionSongEntries = (value: unknown, keys: string[] = ['songs']) => {
  const payload = asRecord(value);
  const data = asRecord(payload?.data);
  const result = asRecord(payload?.result) ?? asRecord(data?.result);

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key] as unknown[];
    }

    if (Array.isArray(data?.[key])) {
      return data[key] as unknown[];
    }

    if (Array.isArray(result?.[key])) {
      return result[key] as unknown[];
    }
  }

  return [] as unknown[];
};

const getNetEaseAlbumDetailRecord = (value: unknown) => {
  const payload = asRecord(value);
  return asRecord(payload?.album) ?? asRecord(asRecord(payload?.data)?.album);
};

const getNetEaseArtistDetailRecord = (value: unknown) => {
  const payload = asRecord(value);
  return asRecord(payload?.artist) ?? asRecord(asRecord(payload?.data)?.artist);
};

const getNetEaseArtistAlbumEntries = (value: unknown) => {
  const payload = asRecord(value);
  const data = asRecord(payload?.data);
  return Array.isArray(payload?.hotAlbums)
    ? payload.hotAlbums
    : Array.isArray(payload?.artistAlbums)
      ? payload.artistAlbums
      : Array.isArray(data?.hotAlbums)
        ? data.hotAlbums
        : Array.isArray(data?.artistAlbums)
          ? data.artistAlbums
          : [];
};

const isNetEaseArtistOwnedAlbum = (value: unknown, artistId: string) => {
  const album = asRecord(value);
  if (!album) {
    return false;
  }

  const albumType = getStringValue(album.type)?.trim() || '';
  if (albumType.includes('合集')) {
    return false;
  }

  const albumArtistId = getStringValue(asRecord(album.artist)?.id)?.trim();
  return !albumArtistId || albumArtistId === artistId;
};

const isNetEaseTrackLedByArtist = (value: unknown, artistId: string) => {
  const track = asRecord(value);
  if (!track) {
    return false;
  }

  const artistEntries = Array.isArray(track.ar)
    ? track.ar
    : Array.isArray(track.artists)
      ? track.artists
      : [];
  const primaryArtist = artistEntries
    .map((entry) => asRecord(entry))
    .find((entry): entry is Record<string, unknown> => Boolean(entry));

  return getStringValue(primaryArtist?.id)?.trim() === artistId;
};

const getNetEaseSearchDefaultSuggestion = (value: unknown) => {
  const payload = asRecord(value);
  const data = asRecord(payload?.data);
  return {
    keyword: getStringValue(data?.realkeyword) || getStringValue(data?.showKeyword) || '',
    displayKeyword: getStringValue(data?.showKeyword) || getStringValue(asRecord(data?.styleKeyword)?.keyWord) || '',
  };
};

const getNetEaseHotSearchEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result);

  if (Array.isArray(payload?.data)) {
    return payload.data as unknown[];
  }

  return Array.isArray(result?.hots) ? result.hots : [];
};

const toNetEaseSearchHintItem = (value: unknown, kind: 'song' | 'artist' | 'playlist' | 'keyword') => {
  const record = asRecord(value);
  const name = getStringValue(record?.name ?? record?.keyword ?? record?.searchWord)?.trim();
  if (!name) {
    return null;
  }

  const subtitle = kind === 'song'
    ? getNetEaseArtistName(record?.artists ?? record?.ar)
    : kind === 'playlist'
      ? (() => {
        const trackCount = getNumberValue(record?.trackCount) || 0;
        return trackCount > 0 ? `${trackCount} tracks` : '';
      })()
      : '';

  return {
    id: getStringValue(record?.id ?? record?.userId) || `${kind}:${name}`,
    name,
    kind,
    subtitle: subtitle || undefined,
    cover: getNetEaseSizedImageUrl(getStringValue(record?.coverImgUrl) || getStringValue(record?.picUrl) || getStringValue(record?.img1v1Url)),
  };
};

const toNetEaseSearchAlbumItem = (value: unknown) => {
  const record = asRecord(value);
  const id = getStringValue(record?.id ?? record?.idStr);
  const name = getStringValue(record?.name)?.trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    artist: getNetEaseArtistName(record?.artists ?? record?.artist),
    cover: getNetEaseSizedImageUrl(
      getStringValue(record?.picUrl)
      || getStringValue(record?.blurPicUrl)
    ),
  };
};

const getNetEaseSearchSuggestEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result) ?? asRecord(asRecord(payload?.data)?.result);

  return {
    songs: (Array.isArray(result?.songs) ? result.songs : [])
      .map((entry) => toNetEaseSearchHintItem(entry, 'song'))
      .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry)),
    artists: (Array.isArray(result?.artists) ? result.artists : [])
      .map((entry) => toNetEaseSearchHintItem(entry, 'artist'))
      .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry)),
    playlists: (Array.isArray(result?.playlists) ? result.playlists : [])
      .map((entry) => toNetEaseSearchHintItem(entry, 'playlist'))
      .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry)),
  };
};

const getNetEaseMultimatchEntries = (value: unknown) => {
  const payload = asRecord(value);
  const result = asRecord(payload?.result) ?? asRecord(asRecord(payload?.data)?.result);
  if (!result) {
    return [] as Array<NonNullable<ReturnType<typeof toNetEaseSearchHintItem>>>;
  }

  const toItems = (entryValue: unknown, kind: 'song' | 'artist' | 'playlist') => {
    if (Array.isArray(entryValue)) {
      return entryValue
        .map((entry) => toNetEaseSearchHintItem(entry, kind))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry));
    }

    const record = asRecord(entryValue);
    if (!record) {
      return [] as Array<NonNullable<ReturnType<typeof toNetEaseSearchHintItem>>>;
    }

    if (Array.isArray(record?.data)) {
      return record.data
        .map((entry) => toNetEaseSearchHintItem(entry, kind))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry));
    }

    const item = toNetEaseSearchHintItem(record, kind);
    return item ? [item] : [];
  };

  return Object.entries(result).flatMap(([key, entryValue]) => {
    if (key === 'orders') {
      return [];
    }

    if (key.toLowerCase().includes('artist')) {
      return toItems(entryValue, 'artist');
    }

    if (key.toLowerCase().includes('playlist')) {
      return toItems(entryValue, 'playlist');
    }

    if (key.toLowerCase().includes('song')) {
      return toItems(entryValue, 'song');
    }

    return [];
  });
};

const getNetEaseSongEntries = (value: unknown) => {
  const payload = asRecord(value);
  return Array.isArray(payload?.songs)
    ? payload.songs
    : Array.isArray(asRecord(payload?.data)?.songs)
      ? asRecord(payload?.data)?.songs as unknown[]
      : [];
};

const getNetEaseTrackIds = (value: unknown) => {
  const playlist = asRecord(value);
  return Array.isArray(playlist?.trackIds)
    ? playlist.trackIds
      .map((entry) => getStringValue(asRecord(entry)?.id))
      .filter((entry): entry is string => Boolean(entry))
    : [];
};

const getNetEaseSongUrlFromResponse = (value: unknown) => {
  const payload = asRecord(value);
  const data = payload?.data;

  if (Array.isArray(data)) {
    return getStringValue(asRecord(data[0])?.url);
  }

  return getStringValue(asRecord(data)?.url);
};

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

// Association keys let the server resolve the same lyric entry by song identity
// or by file name fallback without duplicating the lyric payload itself.
const normalizeLyricLookupPart = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const getNetEaseLyricSearchScore = (value: unknown, title: string, artist: string) => {
  const candidate = asRecord(value);
  const normalizedTitle = normalizeLyricLookupPart(title);
  const normalizedArtist = normalizeLyricLookupPart(artist);
  const candidateTitle = normalizeLyricLookupPart(getStringValue(candidate?.name) || '');
  const candidateArtist = normalizeLyricLookupPart(getNetEaseArtistName(candidate?.ar ?? candidate?.artists));

  let score = 0;

  if (candidateTitle === normalizedTitle) {
    score += 6;
  } else if (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)) {
    score += 3;
  }

  if (candidateArtist === normalizedArtist) {
    score += 6;
  } else if (candidateArtist.includes(normalizedArtist) || normalizedArtist.includes(candidateArtist)) {
    score += 3;
  }

  return score;
};

const getBestNetEaseLyricSearchMatch = (entries: unknown[], title: string, artist: string) => entries
  .map((entry, index) => ({
    entry,
    index,
    score: getNetEaseLyricSearchScore(entry, title, artist),
  }))
  .sort((left, right) => right.score - left.score || left.index - right.index)
  .map(({ entry }) => entry)
  .find((entry) => Boolean(getStringValue(asRecord(entry)?.id))) || null;

const resolveLyricFileNameFromUrl = (fileUrl?: string) => {
  if (!fileUrl || !fileUrl.startsWith('/music/')) {
    return null;
  }

  try {
    return decodeURIComponent(fileUrl.slice('/music/'.length));
  } catch {
    return null;
  }
};

const getLyricAssociationKeys = ({
  title,
  artist,
  fileUrl,
}: {
  title: string;
  artist: string;
  fileUrl?: string;
}) => {
  const keys = new Set<string>();
  const normalizedTitle = normalizeLyricLookupPart(title);
  const normalizedArtist = normalizeLyricLookupPart(artist);
  const fileName = resolveLyricFileNameFromUrl(fileUrl);

  if (normalizedTitle && normalizedArtist) {
    keys.add(`track:${normalizedTitle}::${normalizedArtist}`);
  }

  if (fileName) {
    keys.add(`file:${fileName.toLowerCase()}`);
  }

  return Array.from(keys);
};

const sanitizeLyricPayload = (value: unknown): PersistedLyricData => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const payload: PersistedLyricData = {};
  const ytlrc = typeof candidate.ytlrc === 'string' ? candidate.ytlrc : undefined;

  if (typeof candidate.lrc === 'string') {
    payload.lrc = candidate.lrc;
  }

  if (typeof candidate.lyric === 'string') {
    payload.lyric = candidate.lyric;
  }

  if (ytlrc) {
    payload.ytlrc = ytlrc;
  }

  if (typeof candidate.tlyric === 'string' || ytlrc) {
    payload.tlyric = ytlrc ?? (candidate.tlyric as string);
  }

  if (typeof candidate.trans === 'string' || ytlrc) {
    payload.trans = ytlrc ?? (candidate.trans as string);
  }

  if (typeof candidate.yrc === 'string') {
    payload.yrc = candidate.yrc;
  }

  return payload;
};

const hasUsableLyrics = (payload: PersistedLyricData) => Boolean(
  payload.yrc?.trim() || payload.lrc?.trim() || payload.lyric?.trim()
);

// Manual lyric files are a user-authored fallback. They are only consulted when
// no remote/cache hit exists, and they are never written back as remote cache.
const getManualLyricPayload = (musicDir: string, fileUrl?: string): PersistedLyricData | null => {
  const musicFileName = resolveLyricFileNameFromUrl(fileUrl);
  if (!musicFileName) {
    return null;
  }

  const lyricDirectory = getLyricCacheDirectory(musicDir);
  if (!fs.existsSync(lyricDirectory)) {
    return null;
  }

  const expectedBaseName = path.parse(musicFileName).name.toLowerCase();
  const matchedLyricFile = fs.readdirSync(lyricDirectory).find((entry) => {
    const parsedEntry = path.parse(entry);
    return parsedEntry.name.toLowerCase() === expectedBaseName
      && MANUAL_LYRIC_EXTENSIONS.has(parsedEntry.ext.toLowerCase());
  });

  if (!matchedLyricFile) {
    return null;
  }

  try {
    const lyricFilePath = path.join(lyricDirectory, matchedLyricFile);
    const lyricText = fs.readFileSync(lyricFilePath, 'utf8').trim();
    if (!lyricText) {
      return null;
    }

    return path.extname(matchedLyricFile).toLowerCase() === '.yrc'
      ? { yrc: lyricText }
      : { lrc: lyricText };
  } catch {
    return null;
  }
};

const getLyricDatabase = (musicDir: string) => {
  if (lyricDatabaseState?.musicDir === musicDir) {
    return lyricDatabaseState.database;
  }

  if (lyricDatabaseState) {
    lyricDatabaseState.database.close();
    lyricDatabaseState = null;
  }

  ensureDirectory(getLyricCacheDirectory(musicDir));

  const database = new DatabaseSync(getLyricCacheDatabaseFilePath(musicDir));
  database.exec(`
    CREATE TABLE IF NOT EXISTS lyric_cache (
      association_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      file_name TEXT,
      song_id TEXT,
      lrc TEXT,
      lyric TEXT,
      tlyric TEXT,
      trans TEXT,
      yrc TEXT,
      ytlrc TEXT,
      saved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS netease_favorites (
      type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY(type, item_id)
    );
  `);

  try {
    database.exec('ALTER TABLE lyric_cache ADD COLUMN ytlrc TEXT');
  } catch {
    // Existing installs already have the table; duplicate-column errors can be ignored.
  }

  lyricDatabaseState = { musicDir, database };
  return database;
};

const getPersistedNetEaseFavorites = (musicDir: string) => {
  const database = getLyricDatabase(musicDir);
  const rows = database.prepare(`
    SELECT type, item_id, payload_json, saved_at
    FROM netease_favorites
    ORDER BY saved_at DESC, item_id DESC
  `).all() as unknown as PersistedNetEaseFavoriteRow[];

  const songs: Array<NetEaseFavoriteSongPayload & { savedAt: string }> = [];
  const albums: Array<NetEaseFavoriteAlbumPayload & { savedAt: string }> = [];

  rows.forEach((row) => {
    try {
      const parsedPayload = JSON.parse(row.payload_json) as unknown;

      if (row.type === 'song') {
        const songPayload = sanitizeNetEaseFavoriteSongPayload(parsedPayload);
        if (songPayload) {
          songs.push({ ...songPayload, savedAt: row.saved_at });
        }
        return;
      }

      if (row.type === 'album') {
        const albumPayload = sanitizeNetEaseFavoriteAlbumPayload(parsedPayload);
        if (albumPayload) {
          albums.push({ ...albumPayload, savedAt: row.saved_at });
        }
      }
    } catch {
      // Ignore malformed rows left by interrupted writes or manual edits.
    }
  });

  return { songs, albums };
};

const persistNetEaseFavorite = (
  musicDir: string,
  type: NetEaseFavoriteKind,
  payload: NetEaseFavoriteSongPayload | NetEaseFavoriteAlbumPayload,
) => {
  const database = getLyricDatabase(musicDir);
  const savedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO netease_favorites (type, item_id, payload_json, saved_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(type, item_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      saved_at = excluded.saved_at
  `).run(type, payload.id, JSON.stringify(payload), savedAt);

  return savedAt;
};

const removeNetEaseFavorite = (musicDir: string, type: NetEaseFavoriteKind, itemId: string) => {
  const database = getLyricDatabase(musicDir);
  database.prepare(`
    DELETE FROM netease_favorites
    WHERE type = ? AND item_id = ?
  `).run(type, itemId);
};

// Legacy JSON lyric files still read as a migration source, but the active cache
// path is the SQLite database described in the project instructions.
const getLyricCacheFileName = (title: string, artist: string, songId?: string | null) => {
  const digest = createHash('sha1')
    .update(normalizeLyricLookupPart(title))
    .update('::')
    .update(normalizeLyricLookupPart(artist))
    .update('::')
    .update(songId ?? '')
    .digest('hex');

  return `${digest}.json`;
};

const readPersistedLyricIndex = (musicDir: string): PersistedLyricIndex | null => {
  try {
    const indexFilePath = getLyricCacheIndexFilePath(musicDir);
    if (!fs.existsSync(indexFilePath)) {
      return null;
    }

    const rawIndex = fs.readFileSync(indexFilePath, 'utf8');
    const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedLyricIndex>;

    if (parsedIndex.version !== LYRIC_CACHE_VERSION || parsedIndex.folder !== musicDir || !parsedIndex.entries || typeof parsedIndex.entries !== 'object') {
      return null;
    }

    return {
      version: LYRIC_CACHE_VERSION,
      folder: musicDir,
      generatedAt: typeof parsedIndex.generatedAt === 'string' ? parsedIndex.generatedAt : new Date(0).toISOString(),
      entries: parsedIndex.entries as Record<string, PersistedLyricIndexEntry>,
    };
  } catch {
    return null;
  }
};

const persistLyricIndex = (musicDir: string, entries: Record<string, PersistedLyricIndexEntry>) => {
  ensureDirectory(getLyricCacheDirectory(musicDir));

  const payload: PersistedLyricIndex = {
    version: LYRIC_CACHE_VERSION,
    folder: musicDir,
    generatedAt: new Date().toISOString(),
    entries,
  };

  const indexFilePath = getLyricCacheIndexFilePath(musicDir);
  const tempIndexFilePath = `${indexFilePath}.tmp`;
  fs.writeFileSync(tempIndexFilePath, JSON.stringify(payload), 'utf8');
  fs.renameSync(tempIndexFilePath, indexFilePath);

  return payload;
};

const readPersistedLyricFile = (musicDir: string, cacheFile: string): PersistedLyricFile | null => {
  try {
    const lyricFilePath = path.join(getLyricCacheDirectory(musicDir), cacheFile);
    if (!fs.existsSync(lyricFilePath)) {
      return null;
    }

    const rawPayload = fs.readFileSync(lyricFilePath, 'utf8');
    const parsedPayload = JSON.parse(rawPayload) as Partial<PersistedLyricFile>;
    const lyricData = sanitizeLyricPayload(parsedPayload.data);

    if (parsedPayload.version !== LYRIC_CACHE_VERSION || !hasUsableLyrics(lyricData)) {
      return null;
    }

    return {
      version: LYRIC_CACHE_VERSION,
      title: typeof parsedPayload.title === 'string' ? parsedPayload.title : '',
      artist: typeof parsedPayload.artist === 'string' ? parsedPayload.artist : '',
      songId: typeof parsedPayload.songId === 'string' ? parsedPayload.songId : null,
      savedAt: typeof parsedPayload.savedAt === 'string' ? parsedPayload.savedAt : new Date(0).toISOString(),
      data: lyricData,
    };
  } catch {
    return null;
  }
};

const getPersistedLyricPayload = (
  musicDir: string,
  association: { title: string; artist: string; fileUrl?: string },
) => {
  const lyricIndex = readPersistedLyricIndex(musicDir);
  if (!lyricIndex) {
    return null;
  }

  for (const key of getLyricAssociationKeys(association)) {
    const entry = lyricIndex.entries[key];
    if (!entry) {
      continue;
    }

    const payload = readPersistedLyricFile(musicDir, entry.cacheFile);
    if (payload) {
      return payload;
    }
  }

  return null;
};

const persistLyricPayload = (
  musicDir: string,
  association: { title: string; artist: string; fileUrl?: string },
  payloadData: PersistedLyricData,
  songId?: string | null,
) => {
  ensureDirectory(getLyricCacheDirectory(musicDir));

  const cacheFile = getLyricCacheFileName(association.title, association.artist, songId);
  const payload: PersistedLyricFile = {
    version: LYRIC_CACHE_VERSION,
    title: association.title,
    artist: association.artist,
    songId: songId ?? null,
    savedAt: new Date().toISOString(),
    data: payloadData,
  };

  const lyricFilePath = path.join(getLyricCacheDirectory(musicDir), cacheFile);
  const tempLyricFilePath = `${lyricFilePath}.tmp`;
  fs.writeFileSync(tempLyricFilePath, JSON.stringify(payload), 'utf8');
  fs.renameSync(tempLyricFilePath, lyricFilePath);

  const existingIndex = readPersistedLyricIndex(musicDir);
  const nextEntries: Record<string, PersistedLyricIndexEntry> = {
    ...(existingIndex?.entries ?? {}),
  };

  for (const key of getLyricAssociationKeys(association)) {
    nextEntries[key] = {
      cacheFile,
      title: association.title,
      artist: association.artist,
      savedAt: payload.savedAt,
    };
  }

  persistLyricIndex(musicDir, nextEntries);
  return payload;
};

const getPersistedLyricPayloadFromDatabase = (
  musicDir: string,
  association: { title: string; artist: string; fileUrl?: string },
) => {
  const database = getLyricDatabase(musicDir);
  const statement = database.prepare(`
    SELECT title, artist, song_id, lrc, lyric, tlyric, trans, yrc, ytlrc, saved_at
    FROM lyric_cache
    WHERE association_key = ?
    LIMIT 1
  `);

  for (const key of getLyricAssociationKeys(association)) {
    const row = statement.get(key) as unknown as PersistedLyricDatabaseRow | undefined;
    if (!row) {
      continue;
    }

    const lyricData = sanitizeLyricPayload(row);
    if (!hasUsableLyrics(lyricData)) {
      continue;
    }

    return {
      version: LYRIC_CACHE_VERSION,
      title: row.title,
      artist: row.artist,
      songId: row.song_id,
      savedAt: row.saved_at,
      data: lyricData,
    } satisfies PersistedLyricFile;
  }

  return null;
};

const persistLyricPayloadToDatabase = (
  musicDir: string,
  association: { title: string; artist: string; fileUrl?: string },
  payloadData: PersistedLyricData,
  songId?: string | null,
) => {
  const database = getLyricDatabase(musicDir);
  const fileName = resolveLyricFileNameFromUrl(association.fileUrl);
  const savedAt = new Date().toISOString();
  const statement = database.prepare(`
    INSERT INTO lyric_cache (
      association_key,
      title,
      artist,
      file_name,
      song_id,
      lrc,
      lyric,
      tlyric,
      trans,
      yrc,
      ytlrc,
      saved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(association_key) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      file_name = excluded.file_name,
      song_id = excluded.song_id,
      lrc = excluded.lrc,
      lyric = excluded.lyric,
      tlyric = excluded.tlyric,
      trans = excluded.trans,
      yrc = excluded.yrc,
      ytlrc = excluded.ytlrc,
      saved_at = excluded.saved_at
  `);

  for (const key of getLyricAssociationKeys(association)) {
    statement.run(
      key,
      association.title,
      association.artist,
      fileName ?? null,
      songId ?? null,
      payloadData.lrc ?? null,
      payloadData.lyric ?? null,
      payloadData.tlyric ?? null,
      payloadData.trans ?? null,
      payloadData.yrc ?? null,
      payloadData.ytlrc ?? null,
      savedAt,
    );
  }

  return {
    version: LYRIC_CACHE_VERSION,
    title: association.title,
    artist: association.artist,
    songId: songId ?? null,
    savedAt,
    data: payloadData,
  } satisfies PersistedLyricFile;
};

const getStoredLyricPayload = (
  musicDir: string,
  association: { title: string; artist: string; fileUrl?: string },
) => {
  // Preferred lookup order: SQLite cache first, then legacy JSON migration path.
  const databasePayload = getPersistedLyricPayloadFromDatabase(musicDir, association);
  if (databasePayload) {
    return databasePayload;
  }

  const legacyPayload = getPersistedLyricPayload(musicDir, association);
  if (!legacyPayload) {
    return null;
  }

  persistLyricPayloadToDatabase(musicDir, association, legacyPayload.data, legacyPayload.songId);
  return legacyPayload;
};

const shouldRefreshCachedNetEaseLyrics = (payload: PersistedLyricFile) => Boolean(
  payload.songId
  && payload.data.yrc?.trim()
  && !payload.data.ytlrc?.trim()
);

const getCoverFileExtension = (mimeType?: string) => {
  const normalizedMimeType = mimeType?.toLowerCase() ?? '';

  if (normalizedMimeType.includes('jpeg') || normalizedMimeType.includes('jpg')) {
    return 'jpg';
  }

  if (normalizedMimeType.includes('png')) {
    return 'png';
  }

  if (normalizedMimeType.includes('webp')) {
    return 'webp';
  }

  if (normalizedMimeType.includes('gif')) {
    return 'gif';
  }

  const slashIndex = normalizedMimeType.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < normalizedMimeType.length - 1) {
    return normalizedMimeType.slice(slashIndex + 1).replace(/[^a-z0-9]/g, '') || 'bin';
  }

  return 'bin';
};

const getCoverAssetId = (data: Uint8Array, mimeType?: string) => {
  const digest = createHash('sha1')
    .update(Buffer.from(data))
    .update(mimeType ?? '')
    .digest('hex');

  return `${digest}.${getCoverFileExtension(mimeType)}`;
};

const getCoverAssetIdFromUrl = (coverUrl?: string) => {
  if (!coverUrl) {
    return null;
  }

  const segments = coverUrl.split('/');
  const lastSegment = segments.at(-1);
  return lastSegment ? decodeURIComponent(lastSegment) : null;
};

const getCoverAssetUrl = (assetId: string) => `/api/library/cover/${encodeURIComponent(assetId)}`;

// Old unpacked cover files are removed once the compressed cover bundle exists,
// keeping the on-disk cache single-sourced and cheaper to ship around.
const cleanupLegacyCoverDirectory = (musicDir: string) => {
  const legacyDirectory = path.join(getLibraryCacheDirectory(musicDir), LEGACY_LIBRARY_CACHE_IMAGE_DIRECTORY_NAME);
  if (fs.existsSync(legacyDirectory)) {
    fs.rmSync(legacyDirectory, { recursive: true, force: true });
  }
};

const readPersistedCoverBundle = (musicDir: string): PersistedCoverBundle | null => {
  try {
    const bundleFilePath = getLibraryCoverBundleFilePath(musicDir);
    if (!fs.existsSync(bundleFilePath)) {
      return null;
    }

    const compressedBundle = fs.readFileSync(bundleFilePath);
    const parsedBundle = JSON.parse(gunzipSync(compressedBundle).toString('utf8')) as Partial<PersistedCoverBundle>;

    if (parsedBundle.version !== LIBRARY_CACHE_VERSION || parsedBundle.folder !== musicDir || !parsedBundle.assets || typeof parsedBundle.assets !== 'object') {
      return null;
    }

    return {
      version: LIBRARY_CACHE_VERSION,
      folder: musicDir,
      generatedAt: typeof parsedBundle.generatedAt === 'string' ? parsedBundle.generatedAt : new Date(0).toISOString(),
      assets: parsedBundle.assets as Record<string, PersistedCoverAsset>,
    };
  } catch {
    return null;
  }
};

const getPersistedCoverBundle = (musicDir: string) => {
  const cachedBundle = coverBundleMemoryCache.get(musicDir);
  if (cachedBundle) {
    return cachedBundle;
  }

  const persistedBundle = readPersistedCoverBundle(musicDir);
  if (persistedBundle) {
    coverBundleMemoryCache.set(musicDir, persistedBundle);
  }

  return persistedBundle;
};

const persistCoverBundle = async (musicDir: string, coverAssets: Map<string, PersistedCoverAsset>) => {
  ensureDirectory(getLibraryCacheDirectory(musicDir));

  const payload: PersistedCoverBundle = {
    version: LIBRARY_CACHE_VERSION,
    folder: musicDir,
    generatedAt: new Date().toISOString(),
    assets: Object.fromEntries(coverAssets),
  };

  const bundleFilePath = getLibraryCoverBundleFilePath(musicDir);
  const tempBundleFilePath = `${bundleFilePath}.tmp`;
  await fs.promises.writeFile(tempBundleFilePath, await gzipAsync(JSON.stringify(payload)));
  await fs.promises.rename(tempBundleFilePath, bundleFilePath);

  coverBundleMemoryCache.set(musicDir, payload);
  cleanupLegacyCoverDirectory(musicDir);

  return payload;
};

const readPersistedLibraryCache = (musicDir: string): PersistedLibraryCache | null => {
  try {
    const cacheFilePath = getLibraryCacheFilePath(musicDir);
    if (!fs.existsSync(cacheFilePath)) {
      return null;
    }

    const rawCache = fs.readFileSync(cacheFilePath, 'utf8');
    const parsedCache = JSON.parse(rawCache) as Partial<PersistedLibraryCache>;

    if (parsedCache.version !== LIBRARY_CACHE_VERSION || parsedCache.folder !== musicDir || !Array.isArray(parsedCache.songs)) {
      return null;
    }

    return {
      version: LIBRARY_CACHE_VERSION,
      folder: musicDir,
      generatedAt: typeof parsedCache.generatedAt === 'string' ? parsedCache.generatedAt : new Date(0).toISOString(),
      songs: parsedCache.songs,
    };
  } catch {
    return null;
  }
};

const persistLibraryCache = async (musicDir: string, songs: LibrarySongPayload[]): Promise<PersistedLibraryCache> => {
  ensureDirectory(getLibraryCacheDirectory(musicDir));

  const payload: PersistedLibraryCache = {
    version: LIBRARY_CACHE_VERSION,
    folder: musicDir,
    generatedAt: new Date().toISOString(),
    songs,
  };

  const cacheFilePath = getLibraryCacheFilePath(musicDir);
  const tempCacheFilePath = `${cacheFilePath}.tmp`;
  await fs.promises.writeFile(tempCacheFilePath, JSON.stringify(payload), 'utf8');
  await fs.promises.rename(tempCacheFilePath, cacheFilePath);

  return payload;
};

// A full scan is intentionally non-recursive. The app treats the selected music
// folder as the library root and keeps scan cost predictable for desktop use.
async function readLibrarySongs(musicDir: string): Promise<LibrarySongPayload[]> {
  const previousCoverBundle = getPersistedCoverBundle(musicDir);
  const previousTracks = new Map((readPersistedLibraryCache(musicDir)?.songs || []).map((song) => [song.filename, song]));
  const nextCoverAssets = new Map<string, PersistedCoverAsset>();
  const files = (await fs.promises.readdir(musicDir))
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const results = await mapConcurrent(files, 4, async (filename) => {
    const fullPath = path.join(musicDir, filename);
    const stats = await fs.promises.stat(fullPath).catch(() => null);
    if (!stats?.isFile()) return null;
    const cacheKey = getCacheKey(fullPath, stats);
    const previous = previousTracks.get(filename);
    const cachedTrack = metadataCache.get(cacheKey) || (previous?.mtimeMs === stats.mtimeMs && previous?.size === stats.size ? previous : undefined);

    if (cachedTrack) {
      const cachedCoverAssetId = getCoverAssetIdFromUrl(cachedTrack.cover);
      if (!cachedCoverAssetId) {
        return cachedTrack;
      }

      const cachedCoverAsset = previousCoverBundle?.assets[cachedCoverAssetId];
      if (cachedCoverAsset) {
        nextCoverAssets.set(cachedCoverAssetId, cachedCoverAsset);
        return cachedTrack;
      }
    }

    try {
      const metadata = await parseFile(fullPath, { duration: true });
      const common = metadata.common;
      const picture = common.picture?.[0];

      let coverUrl: string | undefined;
      if (picture) {
        const coverAssetId = getCoverAssetId(picture.data, picture.format);
        coverUrl = getCoverAssetUrl(coverAssetId);

        if (!nextCoverAssets.has(coverAssetId)) {
          nextCoverAssets.set(coverAssetId, {
            mimeType: picture.format || 'application/octet-stream',
            data: Buffer.from(picture.data).toString('base64'),
          });
        }
      }

      const payload: LibrarySongPayload = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        filename,
        fileUrl: `/music/${encodeURIComponent(filename)}`,
        title: common.title || filename.replace(/\.[^/.]+$/, ''),
        artist: common.artist || 'Unknown Artist',
        album: common.album,
        cover: coverUrl,
        duration: typeof metadata.format.duration === 'number' && Number.isFinite(metadata.format.duration)
          ? metadata.format.duration
          : undefined,
      };

      metadataCache.set(cacheKey, payload);
      return payload;
    } catch {
      const payload: LibrarySongPayload = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        filename,
        fileUrl: `/music/${encodeURIComponent(filename)}`,
        title: filename.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
      };

      metadataCache.set(cacheKey, payload);
      return payload;
    }
  });
  const songs = results.filter((track): track is LibrarySongPayload => track !== null);

  const activeFiles = new Set(files.map((filename) => path.join(musicDir, filename)));
  Array.from(metadataCache.keys()).forEach((cacheKey) => {
    const separatorIndex = cacheKey.indexOf('|');
    const filePath = separatorIndex >= 0 ? cacheKey.slice(0, separatorIndex) : cacheKey;
    if (!activeFiles.has(filePath) && filePath.startsWith(musicDir)) {
      metadataCache.delete(cacheKey);
    }
  });

  const previousAssets = previousCoverBundle?.assets;
  if (!previousAssets || nextCoverAssets.size !== Object.keys(previousAssets).length || [...nextCoverAssets.keys()].some((id) => !previousAssets[id])) {
    await persistCoverBundle(musicDir, nextCoverAssets);
  }

  return songs;
}

// Library requests reuse the persisted cache unless the renderer explicitly asks
// for a refresh or the server has not yet primed the cache for this session.
async function getLibraryPayload(musicDir: string, forceRefresh = false): Promise<PersistedLibraryCache> {
  if (!forceRefresh) {
    const cachedPayload = readPersistedLibraryCache(musicDir);
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const pending = libraryScans.get(musicDir);
  if (pending) return pending;
  const scan = readLibrarySongs(musicDir).then((songs) => persistLibraryCache(musicDir, songs));
  libraryScans.set(musicDir, scan);
  try { return await scan; } finally { libraryScans.delete(musicDir); }
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const app = express();
  const portFromEnv = Number.parseInt(process.env.PORT ?? '3000', 10);
  const requestedPort = typeof options.port === 'number' && Number.isFinite(options.port)
    ? options.port
    : portFromEnv;
  const PORT = Number.isFinite(requestedPort) ? requestedPort : 3000;
  const host = options.host ?? '0.0.0.0';
  const mode = options.mode ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const staticRoot = options.staticRoot ?? process.cwd();

  // Serve music directory
  let musicDir = options.initialMusicDir ?? path.join(process.cwd(), 'music');
  let neteaseSession: NetEaseSessionState = {
    cookie: sanitizeNetEaseCookie(process.env.NETEASE_API_COOKIE),
    account: null,
  };

  const neteaseRequestHandlers: Record<string, NetEaseRequestHandler | undefined> = {
    '/login/status': neteaseApi.login_status,
    '/user/account': neteaseApi.user_account,
    '/logout': neteaseApi.logout,
    '/login/qr/key': neteaseApi.login_qr_key,
    '/login/qr/create': neteaseApi.login_qr_create,
    '/login/qr/check': neteaseApi.login_qr_check,
    '/user/playlist': neteaseApi.user_playlist,
    '/user/playlist/create': neteaseApi.user_playlist_create,
    '/user/playlist/collect': neteaseApi.user_playlist_collect,
    '/playlist/create': neteaseApi.playlist_create,
    '/playlist/delete': neteaseApi.playlist_delete,
    '/playlist/tracks': neteaseApi.playlist_tracks,
    '/playlist/detail': neteaseApi.playlist_detail,
    '/playlist/track/all': neteaseApi.playlist_track_all,
    '/album': neteaseApi.album,
    '/artist/album': neteaseApi.artist_album,
    '/artists': neteaseApi.artists,
    '/artist/songs': neteaseApi.artist_songs,
    '/search': neteaseApi.search,
    '/cloudsearch': neteaseApi.cloudsearch,
    '/search/default': neteaseApi.search_default,
    '/search/hot': neteaseApi.search_hot,
    '/search/hot/detail': neteaseApi.search_hot_detail,
    '/search/suggest': neteaseApi.search_suggest,
    '/search/multimatch': neteaseApi.search_multimatch,
    '/song/detail': neteaseApi.song_detail,
    '/song/url/v1': neteaseApi.song_url_v1,
    '/song/url': neteaseApi.song_url,
    '/lyric/new': neteaseApi.lyric_new,
    '/lyric': neteaseApi.lyric,
  } as const;

  const getNetEaseSessionPayload = () => ({
    isConfigured: true,
    hasCookie: Boolean(neteaseSession.cookie),
    isLoggedIn: Boolean(neteaseSession.account),
    account: neteaseSession.account,
  });

  const requestNetEase = async (
    endpoint: string,
    params: Record<string, string | number | boolean | null | undefined> = {},
    options: { includeCookie?: boolean; includeTimestamp?: boolean; randomCNIP?: boolean } = {}
  ) => {
    const handler = neteaseRequestHandlers[endpoint];
    if (!handler) {
      throw new Error(`Unsupported NetEase endpoint: ${endpoint}`);
    }

    const requestPayload = Object.fromEntries(
      Object.entries({
        ...params,
        ...(options.includeTimestamp ? { timestamp: Date.now() } : {}),
        ...(options.randomCNIP ? { randomCNIP: true } : {}),
        ...(options.includeCookie !== false ? { cookie: getNetEaseRequestCookie(neteaseSession.cookie) } : {}),
      }).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );

    const result = await handler(requestPayload);
    return {
      status: result.status,
      body: result.body,
      cookies: result.cookie,
    };
  };

  const refreshNetEaseAccount = async () => {
    if (!neteaseSession.cookie) {
      neteaseSession.account = null;
      return null;
    }

    try {
      const statusResult = await requestNetEase('/login/status');
      let nextAccount = toNetEaseAccountSummary(statusResult.body);

      if (!nextAccount) {
        const accountResult = await requestNetEase('/user/account');
        nextAccount = toNetEaseAccountSummary(accountResult.body);
      }

      neteaseSession.account = nextAccount;
      return nextAccount;
    } catch {
      neteaseSession.account = null;
      return null;
    }
  };

  const getNetEaseAccountOrNull = async () => {
    if (neteaseSession.account) {
      return neteaseSession.account;
    }

    return refreshNetEaseAccount();
  };

  const fetchNetEaseLyricPayload = async (songId: string) => {
    const lyricResult = await requestNetEase('/lyric/new', {
      id: songId,
    }, { includeCookie: false });
    let lyricPayload = toNetEaseLyricPayload(lyricResult.body);

    if (!hasUsableLyrics(lyricPayload)) {
      const fallbackLyricResult = await requestNetEase('/lyric', {
        id: songId,
      }, { includeCookie: false });
      lyricPayload = toNetEaseLyricPayload(fallbackLyricResult.body);
    }

    return hasUsableLyrics(lyricPayload) ? lyricPayload : null;
  };

  const fetchNetEaseSongsByTrackIds = async (trackIds: string[]) => {
    const songsById = new Map<string, LibrarySongPayload>();

    for (let index = 0; index < trackIds.length; index += NETEASE_SONG_DETAIL_BATCH_SIZE) {
      const batchIds = trackIds.slice(index, index + NETEASE_SONG_DETAIL_BATCH_SIZE);
      if (batchIds.length === 0) {
        continue;
      }

      const detailResult = await requestNetEase('/song/detail', {
        ids: batchIds.join(','),
      }, { includeTimestamp: true });

      for (const entry of getNetEaseSongEntries(detailResult.body)) {
        const songPayload = toNetEaseSongPayload(entry);
        if (!songPayload) {
          continue;
        }

        songsById.set(songPayload.filename.replace('netease:', ''), songPayload);
      }
    }

    return trackIds
      .map((trackId) => songsById.get(trackId))
      .filter((entry): entry is LibrarySongPayload => Boolean(entry));
  };

  const resolveNetEaseStreamUrl = async (songId: string, level: string) => {
    for (const candidateLevel of getNetEaseAudioLevelsToTry(level)) {
      const primaryResult = await requestNetEase('/song/url/v1', {
        id: songId,
        level: candidateLevel,
        unblock: true,
        randomCNIP: true,
      });
      const primaryUrl = getNetEaseSongUrlFromResponse(primaryResult.body);
      if (primaryUrl) {
        return primaryUrl;
      }
    }

    for (const bitrate of NETEASE_FALLBACK_BITRATES) {
      const fallbackResult = await requestNetEase('/song/url', {
        id: songId,
        br: bitrate,
        randomCNIP: true,
      });
      const fallbackUrl = getNetEaseSongUrlFromResponse(fallbackResult.body);
      if (fallbackUrl) {
        return fallbackUrl;
      }
    }

    return null;
  };

  if (!fs.existsSync(musicDir)) {
    ensureDirectory(musicDir);
  }
  
  // The renderer always streams audio through this route so changing the music
  // folder only requires updating server state, not rewriting client URLs.
  app.use('/music', (req, res, next) => {
    express.static(musicDir)(req, res, next);
  });

  app.get('/api/netease/session', async (req, res) => {
    if (neteaseSession.cookie && !neteaseSession.account) {
      await refreshNetEaseAccount();
    }

    res.json(getNetEaseSessionPayload());
  });

  app.post('/api/netease/session', express.json(), async (req, res) => {
    const { cookie } = req.body as {
      cookie?: string | null;
    };

    if (cookie !== undefined) {
      if (cookie !== null && typeof cookie !== 'string') {
        res.status(400).json({ error: 'Invalid NetEase cookie payload' });
        return;
      }

      neteaseSession.cookie = sanitizeNetEaseCookie(cookie);
    }

    if (!neteaseSession.cookie) {
      neteaseSession.account = null;
    } else {
      await refreshNetEaseAccount();
    }

    res.json(getNetEaseSessionPayload());
  });

  app.post('/api/netease/logout', async (req, res) => {
    try {
      if (neteaseSession.cookie) {
        await requestNetEase('/logout');
      }
    } catch {
      // Best-effort upstream logout. Local session is cleared regardless.
    }

    neteaseSession.cookie = null;
    neteaseSession.account = null;
    res.json(getNetEaseSessionPayload());
  });

  app.post('/api/netease/login/qr/start', async (req, res) => {
    try {
      const keyResult = await requestNetEase('/login/qr/key', {}, { includeCookie: false });
      const qrKey = getStringValue(asRecord(asRecord(keyResult.body)?.data)?.unikey)
        || getStringValue(asRecord(asRecord(keyResult.body)?.data)?.key);

      if (!qrKey) {
        res.status(502).json({ error: 'Failed to create NetEase QR login key' });
        return;
      }

      const qrResult = await requestNetEase('/login/qr/create', {
        key: qrKey,
        qrimg: true,
      }, { includeCookie: false });
      const qrData = asRecord(asRecord(qrResult.body)?.data);

      res.json({
        key: qrKey,
        qrUrl: getStringValue(qrData?.qrurl) || '',
        qrImage: getStringValue(qrData?.qrimg) || '',
      });
    } catch (error) {
      res.status(502).json({ error: 'Failed to start NetEase QR login' });
    }
  });

  app.get('/api/netease/login/qr/check', async (req, res) => {
    const qrKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (!qrKey) {
      res.status(400).json({ error: 'Missing QR login key' });
      return;
    }

    try {
      const qrResult = await requestNetEase('/login/qr/check', {
        key: qrKey,
      }, { includeCookie: false });
      const body = asRecord(qrResult.body);
      const code = getNumberValue(body?.code) || 500;
      const cookie = sanitizeNetEaseCookie(body?.cookie);

      if (code === 803 && cookie) {
        neteaseSession.cookie = cookie;
        await refreshNetEaseAccount();
      }

      res.json({
        code,
        message: getStringValue(body?.message) || '',
        hasCookie: Boolean(cookie),
        isLoggedIn: Boolean(code === 803 && neteaseSession.account),
        account: neteaseSession.account,
        cookie: code === 803 ? cookie : null,
      });
    } catch (error) {
      res.status(502).json({ error: 'Failed to verify NetEase QR login state' });
    }
  });

  app.get('/api/netease/search/default', async (_req, res) => {
    try {
      const result = await requestNetEase('/search/default', {}, { includeCookie: false });
      res.json(getNetEaseSearchDefaultSuggestion(result.body));
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase default search keyword' });
    }
  });

  app.get('/api/netease/search/hot', async (_req, res) => {
    try {
      const result = await requestNetEase('/search/hot', {}, { includeCookie: false });
      const items = getNetEaseHotSearchEntries(result.body)
        .map((entry) => toNetEaseSearchHintItem(entry, 'keyword'))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry));
      res.json({ items });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase hot searches' });
    }
  });

  app.get('/api/netease/search/hot/detail', async (_req, res) => {
    try {
      const result = await requestNetEase('/search/hot/detail', {}, { includeCookie: false });
      const items = getNetEaseHotSearchEntries(result.body)
        .map((entry) => toNetEaseSearchHintItem(entry, 'keyword'))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry));
      res.json({ items });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase hot search details' });
    }
  });

  app.get('/api/netease/search/suggest', async (req, res) => {
    const keywords = typeof req.query.keywords === 'string' ? req.query.keywords.trim() : '';
    if (!keywords) {
      res.status(400).json({ error: 'Missing NetEase search keywords' });
      return;
    }

    try {
      const result = await requestNetEase('/search/suggest', {
        keywords,
        type: typeof req.query.type === 'string' ? req.query.type.trim() : undefined,
      }, { includeCookie: false });
      res.json(getNetEaseSearchSuggestEntries(result.body));
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase search suggestions' });
    }
  });

  app.get('/api/netease/search/multimatch', async (req, res) => {
    const keywords = typeof req.query.keywords === 'string' ? req.query.keywords.trim() : '';
    if (!keywords) {
      res.status(400).json({ error: 'Missing NetEase search keywords' });
      return;
    }

    try {
      const result = await requestNetEase('/search/multimatch', {
        keywords,
      }, { includeCookie: false });
      res.json({ items: getNetEaseMultimatchEntries(result.body) });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase multi-match suggestions' });
    }
  });

  app.get('/api/netease/search', async (req, res) => {
    const keywords = typeof req.query.keywords === 'string' ? req.query.keywords.trim() : '';
    if (!keywords) {
      res.status(400).json({ error: 'Missing NetEase search keywords' });
      return;
    }

    try {
      const searchType = getNumberValue(req.query.type) || 1;
      const result = await requestNetEase('/cloudsearch', {
        keywords,
        type: searchType,
        limit: getNumberValue(req.query.limit) || 30,
        offset: getNumberValue(req.query.offset) || 0,
      }, { includeCookie: false });
      const songs = getNetEaseSearchSongEntries(result.body)
        .map((entry) => toNetEaseSongPayload(entry))
        .filter((entry): entry is LibrarySongPayload => Boolean(entry));
      const artists = getNetEaseSearchArtistEntries(result.body)
        .map((entry) => toNetEaseSearchHintItem(entry, 'artist'))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchHintItem>> => Boolean(entry));
      const albums = getNetEaseSearchAlbumEntries(result.body)
        .map((entry) => toNetEaseSearchAlbumItem(entry))
        .filter((entry): entry is NonNullable<ReturnType<typeof toNetEaseSearchAlbumItem>> => Boolean(entry));
      const resultPayload = asRecord(asRecord(result.body)?.result) ?? asRecord(asRecord(asRecord(result.body)?.data)?.result);
      res.json({
        songs,
        artists,
        albums,
        total: searchType === 10
          ? getNumberValue(resultPayload?.albumCount) || albums.length
          : searchType === 100
            ? getNumberValue(resultPayload?.artistCount) || artists.length
            : getNumberValue(resultPayload?.songCount) || songs.length,
      });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase search results' });
    }
  });

  app.get('/api/netease/album/:id', async (req, res) => {
    const albumId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!albumId) {
      res.status(400).json({ error: 'Missing NetEase album id' });
      return;
    }

    try {
      const result = await requestNetEase('/album', { id: albumId }, { includeCookie: false });
      const albumRecord = getNetEaseAlbumDetailRecord(result.body);
      const songs = getNetEaseCollectionSongEntries(result.body)
        .map((entry) => toNetEaseSongPayload(entry))
        .filter((entry): entry is LibrarySongPayload => Boolean(entry));
      const albumName = getStringValue(albumRecord?.name)?.trim();

      if (!albumName) {
        res.status(502).json({ error: 'Failed to resolve NetEase album detail' });
        return;
      }

      res.json({
        collection: {
          id: albumId,
          type: 'album',
          name: albumName,
          artist: getNetEaseArtistName(albumRecord?.artists ?? albumRecord?.artist ?? albumRecord?.ar),
          cover: getNetEaseSizedImageUrl(
            getStringValue(albumRecord?.picUrl)
            || getStringValue(albumRecord?.blurPicUrl)
            || getStringValue(albumRecord?.pic)
          ),
          songCount: getNumberValue(albumRecord?.size) || songs.length,
          songs,
        },
      });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase album detail' });
    }
  });

  app.get('/api/netease/artist/:id', async (req, res) => {
    const artistId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!artistId) {
      res.status(400).json({ error: 'Missing NetEase artist id' });
      return;
    }

    try {
      const artistResult = await requestNetEase('/artists', { id: artistId }, {
        includeCookie: false,
        includeTimestamp: true,
        randomCNIP: true,
      });
      const artistRecord = getNetEaseArtistDetailRecord(artistResult.body);
      const artistName = getStringValue(artistRecord?.name)?.trim();

      if (!artistName) {
        res.status(502).json({ error: 'Failed to resolve NetEase artist detail' });
        return;
      }

      const albumsById = new Map<string, Record<string, unknown>>();
      const artistAlbumPageSize = 100;

      for (let offset = 0; offset < 2000; offset += artistAlbumPageSize) {
        const albumsResult = await requestNetEase('/artist/album', {
          id: artistId,
          limit: artistAlbumPageSize,
          offset,
        }, {
          includeCookie: false,
          includeTimestamp: true,
          randomCNIP: true,
        });
        const albumEntries = getNetEaseArtistAlbumEntries(albumsResult.body)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .filter((entry) => isNetEaseArtistOwnedAlbum(entry, artistId));

        albumEntries.forEach((entry) => {
          const albumId = getStringValue(entry.id);
          if (albumId && !albumsById.has(albumId)) {
            albumsById.set(albumId, entry);
          }
        });

        const payload = asRecord(albumsResult.body);
        const hasMore = getBooleanValue(payload?.more ?? asRecord(payload?.data)?.more);
        if (albumEntries.length === 0 || hasMore === false || albumEntries.length < artistAlbumPageSize) {
          break;
        }
      }

      const songsById = new Map<string, LibrarySongPayload>();
      const artistAlbumEntries = Array.from(albumsById.values());

      for (let index = 0; index < artistAlbumEntries.length; index += 2) {
        const albumBatch = artistAlbumEntries.slice(index, index + 2);
        const batchResults = await Promise.all(albumBatch.map(async (entry) => {
          const albumId = getStringValue(entry.id);
          if (!albumId) {
            return [] as LibrarySongPayload[];
          }

          try {
            const albumResult = await requestNetEase('/album', { id: albumId }, {
              includeCookie: false,
              includeTimestamp: true,
              randomCNIP: true,
            });
            return getNetEaseCollectionSongEntries(albumResult.body)
              .filter((albumSong) => isNetEaseTrackLedByArtist(albumSong, artistId))
              .map((albumSong) => toNetEaseSongPayload(albumSong))
              .filter((albumSong): albumSong is LibrarySongPayload => Boolean(albumSong));
          } catch {
            return [] as LibrarySongPayload[];
          }
        }));

        batchResults.flat().forEach((entry) => {
          songsById.set(entry.filename, entry);
        });
      }

      if (songsById.size === 0) {
        getNetEaseCollectionSongEntries(artistResult.body, ['songs', 'hotSongs'])
          .map((entry) => toNetEaseSongPayload(entry))
          .filter((entry): entry is LibrarySongPayload => Boolean(entry))
          .forEach((entry) => {
            songsById.set(entry.filename, entry);
          });
      }

      const songs = Array.from(songsById.values()).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));

      res.json({
        collection: {
          id: artistId,
          type: 'artist',
          name: artistName,
          cover: getNetEaseSizedImageUrl(
            getStringValue(artistRecord?.picUrl)
            || getStringValue(artistRecord?.img1v1Url)
            || getStringValue(artistRecord?.cover)
          ),
          songCount: songs.length,
          songs,
        },
      });
    } catch {
      res.status(502).json({ error: 'Failed to fetch NetEase artist detail' });
    }
  });

  app.get('/api/netease/favorites', async (_req, res) => {
    try {
      res.json(getPersistedNetEaseFavorites(musicDir));
    } catch {
      res.status(500).json({ error: 'Failed to load NetEase favorites' });
    }
  });

  app.post('/api/netease/favorites', express.json(), async (req, res) => {
    const type = req.body?.type;
    if (!isNetEaseFavoriteType(type)) {
      res.status(400).json({ error: 'Invalid NetEase favorite type' });
      return;
    }

    const payload = type === 'song'
      ? sanitizeNetEaseFavoriteSongPayload(req.body?.item)
      : sanitizeNetEaseFavoriteAlbumPayload(req.body?.item);

    if (!payload) {
      res.status(400).json({ error: 'Invalid NetEase favorite payload' });
      return;
    }

    try {
      const savedAt = persistNetEaseFavorite(musicDir, type, payload);
      res.json({ ok: true, savedAt });
    } catch {
      res.status(500).json({ error: 'Failed to save NetEase favorite' });
    }
  });

  app.delete('/api/netease/favorites/:type/:id', async (req, res) => {
    const favoriteType = req.params.type;
    const itemId = typeof req.params.id === 'string' ? req.params.id.trim() : '';

    if (!isNetEaseFavoriteType(favoriteType) || !itemId) {
      res.status(400).json({ error: 'Invalid NetEase favorite target' });
      return;
    }

    try {
      removeNetEaseFavorite(musicDir, favoriteType, itemId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete NetEase favorite' });
    }
  });

  app.get('/api/netease/playlists', async (req, res) => {
    const account = await getNetEaseAccountOrNull();
    if (!account) {
      res.status(401).json({ error: 'NetEase login is required' });
      return;
    }

    try {
      const playlistParams = {
        uid: account.userId,
        limit: 1000,
      };

      const [createdResponse, followedResponse, combinedResponse] = await Promise.all([
        requestNetEase('/user/playlist/create', playlistParams, { includeTimestamp: true }).catch(() => null),
        requestNetEase('/user/playlist/collect', playlistParams, { includeTimestamp: true }).catch(() => null),
        requestNetEase('/user/playlist', playlistParams, { includeTimestamp: true }).catch(() => null),
      ]);

      const playlistEntries = [
        { response: combinedResponse, category: undefined },
        { response: followedResponse, category: 'followed' as const },
        { response: createdResponse, category: 'created' as const },
      ].flatMap(({ response, category }) => (
        response
          ? getNetEasePlaylistEntries(response.body)
            .map((entry) => toNetEasePlaylistSummary(entry, { category, currentUserId: account.userId }))
            .filter((entry): entry is NetEasePlaylistSummary => Boolean(entry))
          : []
      ));

      const playlists = [...new Map(
        playlistEntries
        .map((entry) => [entry.id, entry])
      ).values()].sort((left, right) => right.updatedAt - left.updatedAt);

      res.json({ playlists });
    } catch (error) {
      res.status(502).json({ error: 'Failed to fetch NetEase playlists' });
    }
  });

  app.post('/api/netease/playlists', express.json(), async (req, res) => {
    const account = await getNetEaseAccountOrNull();
    if (!account) {
      res.status(401).json({ error: 'NetEase login is required' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Missing NetEase playlist name' });
      return;
    }

    try {
      const result = await requestNetEase('/playlist/create', {
        name,
        privacy: typeof req.body?.privacy === 'string' ? req.body.privacy.trim() : undefined,
        type: typeof req.body?.type === 'string' ? req.body.type.trim() : undefined,
      }, { includeTimestamp: true });
      const playlist = toNetEasePlaylistSummary(
        asRecord(result.body)?.playlist ?? asRecord(asRecord(result.body)?.data)?.playlist,
        { currentUserId: account.userId, category: 'created' },
      );

      res.json({ playlist });
    } catch {
      res.status(502).json({ error: 'Failed to create NetEase playlist' });
    }
  });

  app.delete('/api/netease/playlists/:id', async (req, res) => {
    const account = await getNetEaseAccountOrNull();
    if (!account) {
      res.status(401).json({ error: 'NetEase login is required' });
      return;
    }

    const playlistId = req.params.id?.trim();
    if (!playlistId) {
      res.status(400).json({ error: 'Missing NetEase playlist id' });
      return;
    }

    try {
      await requestNetEase('/playlist/delete', {
        id: playlistId,
      }, { includeTimestamp: true });
      res.json({ success: true });
    } catch {
      res.status(502).json({ error: 'Failed to delete NetEase playlist' });
    }
  });

  app.post('/api/netease/playlists/:id/tracks', express.json(), async (req, res) => {
    const account = await getNetEaseAccountOrNull();
    if (!account) {
      res.status(401).json({ error: 'NetEase login is required' });
      return;
    }

    const playlistId = req.params.id?.trim();
    const op = req.body?.op === 'del' ? 'del' : 'add';
    const trackIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map((entry: unknown) => getStringValue(entry)).filter((entry): entry is string => Boolean(entry?.trim()))
      : [];

    if (!playlistId) {
      res.status(400).json({ error: 'Missing NetEase playlist id' });
      return;
    }

    if (trackIds.length === 0) {
      res.status(400).json({ error: 'Missing NetEase track ids' });
      return;
    }

    try {
      await requestNetEase('/playlist/tracks', {
        op,
        pid: playlistId,
        tracks: trackIds.join(','),
      }, { includeTimestamp: true });

      res.json({ success: true, op, trackIds });
    } catch {
      res.status(502).json({ error: `Failed to ${op === 'del' ? 'remove songs from' : 'add songs to'} NetEase playlist` });
    }
  });

  app.get('/api/netease/playlist/:id', async (req, res) => {
    const account = await getNetEaseAccountOrNull();
    if (!account) {
      res.status(401).json({ error: 'NetEase login is required' });
      return;
    }

    const playlistId = req.params.id?.trim();
    if (!playlistId) {
      res.status(400).json({ error: 'Missing NetEase playlist id' });
      return;
    }

    try {
      const detailResult = await requestNetEase('/playlist/detail', {
        id: playlistId,
        s: 0,
      }, { includeTimestamp: true });
      const detailPayload = asRecord(detailResult.body);
      const detailPlaylist = asRecord(detailPayload?.playlist) ?? asRecord(asRecord(detailPayload?.data)?.playlist);
      const detailTrackIds = getNetEaseTrackIds(detailPlaylist);
      const playlist = toNetEasePlaylistSummary(detailPlaylist, { currentUserId: account.userId }) || {
        id: playlistId,
        name: 'NetEase Playlist',
        trackCount: 0,
        updatedAt: Date.now(),
        category: 'created' as const,
      };

      const songsResult = await requestNetEase('/playlist/track/all', {
        id: playlistId,
        limit: playlist.trackCount > 0 ? playlist.trackCount : 1000,
        offset: 0,
      }, { includeTimestamp: true });
      const songsPayload = asRecord(songsResult.body);
      const songEntries = getNetEaseSongEntries(songsResult.body).length > 0
        ? getNetEaseSongEntries(songsResult.body)
        : Array.isArray(asRecord(songsPayload?.playlist)?.tracks)
          ? asRecord(songsPayload?.playlist)?.tracks as unknown[]
          : [];
      let songs = songEntries
        .map((entry) => toNetEaseSongPayload(entry))
        .filter((entry): entry is LibrarySongPayload => Boolean(entry));

      if (songs.length === 0 && detailTrackIds.length > 0) {
        songs = await fetchNetEaseSongsByTrackIds(detailTrackIds);
      }

      res.json({
        playlist: {
          ...playlist,
          trackCount: songs.length || playlist.trackCount,
        },
        songs,
      });
    } catch (error) {
      res.status(502).json({ error: 'Failed to fetch NetEase playlist details' });
    }
  });

  app.get('/api/netease/song/stream/:id', async (req, res) => {
    const songId = req.params.id?.trim();
    if (!songId) {
      res.status(400).json({ error: 'Missing NetEase song id' });
      return;
    }

    const level = typeof req.query.level === 'string' && req.query.level.trim()
      ? req.query.level.trim()
      : DEFAULT_NETEASE_AUDIO_LEVEL;

    try {
      const songUrl = await resolveNetEaseStreamUrl(songId, level);
      if (!songUrl) {
        res.status(404).json({ error: 'NetEase song url is unavailable' });
        return;
      }

      const abortController = new AbortController();
      req.on('aborted', () => abortController.abort());

      const upstreamResponse = await fetch(songUrl, {
        headers: {
          accept: typeof req.headers.accept === 'string' ? req.headers.accept : 'audio/*,*/*;q=0.8',
          ...(typeof req.headers.range === 'string' ? { range: req.headers.range } : {}),
          ...(typeof req.headers['user-agent'] === 'string' ? { 'user-agent': req.headers['user-agent'] } : {}),
        },
        signal: abortController.signal,
      });

      if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
        res.status(upstreamResponse.status).json({ error: 'NetEase audio stream is unavailable' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.status(upstreamResponse.status);

      NETEASE_STREAM_RESPONSE_HEADERS.forEach((headerName) => {
        const headerValue = upstreamResponse.headers.get(headerName);
        if (headerValue) {
          res.setHeader(headerName, headerValue);
        }
      });

      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      const proxyStream = Readable.fromWeb(upstreamResponse.body as any);
      proxyStream.on('error', (streamError) => {
        if (streamError instanceof Error && streamError.name === 'AbortError') {
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        if (!res.headersSent) {
          res.status(502).json({ error: 'Failed to proxy NetEase audio stream' });
          return;
        }

        res.destroy(streamError instanceof Error ? streamError : undefined);
      });
      proxyStream.pipe(res);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (!res.headersSent) {
          res.end();
        }
        return;
      }

      res.status(502).json({ error: 'Failed to resolve NetEase song url' });
    }
  });

  // Library endpoint: returns cached or freshly scanned metadata for the current folder.
  app.get("/api/music", async (req, res) => {
    try {
      const shouldForceRefresh = isRefreshRequested(req.query.refresh);
      const payload = await getLibraryPayload(musicDir, shouldForceRefresh);

      res.json({
        folder: payload.folder,
        songs: payload.songs,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to list music files" });
    }
  });

  // Changing the music directory invalidates the primed cache immediately so the
  // next library response always reflects the newly selected folder.
  app.post("/api/settings/music-dir", express.json(), async (req, res) => {
    const { path: newPath } = req.body;
    if (typeof newPath === 'string' && fs.existsSync(newPath)) {
      musicDir = newPath;

      try {
        const payload = await getLibraryPayload(musicDir, true);
        res.json({ success: true, path: musicDir, songsCount: payload.songs.length });
      } catch {
        res.status(500).json({ error: "Failed to refresh music cache" });
      }
    } else {
      res.status(400).json({ error: "Invalid path" });
    }
  });

  // Lightweight settings endpoint used by the renderer to restore shell state.
  app.get("/api/settings/music-dir", (req, res) => {
    res.json({ path: musicDir });
  });

  // Cover art is served by asset id so the library payload can keep stable URLs
  // while the underlying binary data stays in the compressed bundle cache.
  app.get("/api/library/cover/:coverId", (req, res) => {
    const coverBundle = getPersistedCoverBundle(musicDir);
    const coverAsset = coverBundle?.assets[req.params.coverId];

    if (!coverAsset) {
      res.status(404).json({ error: "Cover not found" });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(coverAsset.mimeType);
    res.send(Buffer.from(coverAsset.data, 'base64'));
  });

  // Lyric resolution order is strict by design:
  // 1. SQLite remote cache
  // 2. remote provider fetch
  // 3. same-name manual lyric file fallback
  app.get('/api/lyrics', async (req, res) => {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const fileUrl = typeof req.query.file === 'string' ? req.query.file : undefined;
    const neteaseSongId = getNetEaseSongIdFromFileUrl(fileUrl);
    const manualLyricPayload = getManualLyricPayload(musicDir, fileUrl);

    if (neteaseSongId) {
      try {
        const lyricPayload = await fetchNetEaseLyricPayload(neteaseSongId);

        if (lyricPayload) {
          res.json({
            code: 200,
            data: lyricPayload,
            source: 'netease',
          });
          return;
        }
      } catch {
        // Remote NetEase lyrics are a best-effort enhancement. Fall through to
        // the existing local cache/provider/manual resolution for local tracks.
      }
    }

    if (!title || !artist) {
      res.status(400).json({ code: 400, error: 'Missing title or artist' });
      return;
    }

    const cachedPayload = getStoredLyricPayload(musicDir, { title, artist, fileUrl });
    if (cachedPayload) {
      if (shouldRefreshCachedNetEaseLyrics(cachedPayload)) {
        try {
          const refreshedPayload = await fetchNetEaseLyricPayload(cachedPayload.songId!);
          if (refreshedPayload) {
            persistLyricPayloadToDatabase(musicDir, { title, artist, fileUrl }, refreshedPayload, cachedPayload.songId);
            res.json({
              code: 200,
              data: refreshedPayload,
              source: 'local-refreshed',
            });
            return;
          }
        } catch {
          // Keep serving the cached payload if the refresh probe fails.
        }
      }

      res.json({
        code: 200,
        data: cachedPayload.data,
        source: 'local',
      });
      return;
    }

    try {
      const searchResult = await requestNetEase('/search', {
        keywords: `${title} ${artist}`,
        type: 1,
        limit: 10,
      }, { includeCookie: false });
      const results = getNetEaseSearchSongEntries(searchResult.body);

      if (results.length === 0) {
        if (manualLyricPayload) {
          res.json({
            code: 200,
            data: manualLyricPayload,
            source: 'manual',
          });
          return;
        }

        res.status(404).json({ code: 404, error: 'Song not found in search results' });
        return;
      }

      const matchedSong = getBestNetEaseLyricSearchMatch(results, title, artist);
      const songId = getStringValue(asRecord(matchedSong)?.id);
      if (!songId) {
        res.status(404).json({ code: 404, error: 'Could not find song ID' });
        return;
      }

      const lyricPayload = await fetchNetEaseLyricPayload(songId);
      if (!lyricPayload) {
        if (manualLyricPayload) {
          res.json({
            code: 200,
            data: manualLyricPayload,
            source: 'manual',
          });
          return;
        }

        res.status(404).json({ code: 404, error: 'Lyrics not found in API response' });
        return;
      }

      persistLyricPayloadToDatabase(musicDir, { title, artist, fileUrl }, lyricPayload, songId);

      res.json({
        code: 200,
        data: lyricPayload,
        source: 'netease-search',
      });
    } catch {
      if (manualLyricPayload) {
        res.json({
          code: 200,
          data: manualLyricPayload,
          source: 'manual',
        });
        return;
      }

      res.status(500).json({ code: 500, error: 'Failed to fetch lyrics' });
    }
  });

  // Legacy proxy endpoints kept for compatibility with older client code paths.
  app.get("/api/proxy/search", async (req, res) => {
    const { word } = req.query;
    try {
      const response = await requestNetEase('/search', {
        keywords: String(word ?? ''),
        type: 1,
        limit: 10,
      }, { includeCookie: false });
      res.json(response.body);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from search API" });
    }
  });

  app.get("/api/proxy/lyric", async (req, res) => {
    const { id } = req.query;
    try {
      const songId = typeof id === 'string' ? id.trim() : '';
      if (!songId) {
        res.status(400).json({ error: 'Missing song id' });
        return;
      }

      const lyricPayload = await fetchNetEaseLyricPayload(songId);
      if (!lyricPayload) {
        res.status(404).json({ code: 404, error: 'Lyrics not found in API response' });
        return;
      }

      res.json({
        code: 200,
        data: lyricPayload,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from lyric API" });
    }
  });

  // Development and production share the same API surface. Only the renderer
  // asset source changes between Vite middleware and built static files.
  if (mode !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(staticRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return await new Promise((resolve, reject) => {
    const server = app.listen(PORT, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : PORT;
      const resolvedUrlHost = host === '0.0.0.0' ? '127.0.0.1' : host;

      console.log(`Server running on http://${resolvedUrlHost}:${resolvedPort}`);
      resolve({
        port: resolvedPort,
        host,
        url: `http://${resolvedUrlHost}:${resolvedPort}`,
        server,
      });
    });

    server.on('error', reject);
  });
}

const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFilePath === __filename) {
  startServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
