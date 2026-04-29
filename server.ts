import express from "express";
import { createHash } from "crypto";
import fs from "fs";
import type { Server } from "http";
import { parseFile } from "music-metadata";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync, gzipSync } from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg']);
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

let lyricDatabaseState: { musicDir: string; database: DatabaseSync } | null = null;

const getCacheKey = (filePath: string, stats: fs.Stats) => `${filePath}|${stats.mtimeMs}|${stats.size}`;
const getLibraryCacheDirectory = (musicDir: string) => path.join(musicDir, LIBRARY_CACHE_DIRECTORY_NAME);
const getLibraryCacheFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_FILE_NAME);
const getLibraryCoverBundleFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME);
const getLyricCacheDirectory = (musicDir: string) => path.join(musicDir, LYRIC_CACHE_DIRECTORY_NAME);
const getLyricCacheIndexFilePath = (musicDir: string) => path.join(getLyricCacheDirectory(musicDir), LYRIC_CACHE_INDEX_FILE_NAME);
const getLyricCacheDatabaseFilePath = (musicDir: string) => path.join(getLyricCacheDirectory(musicDir), LYRIC_CACHE_DB_FILE_NAME);
const isRefreshRequested = (value: unknown) => value === '1' || value === 'true';

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const normalizeLyricLookupPart = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

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

  if (typeof candidate.lrc === 'string') {
    payload.lrc = candidate.lrc;
  }

  if (typeof candidate.lyric === 'string') {
    payload.lyric = candidate.lyric;
  }

  if (typeof candidate.tlyric === 'string') {
    payload.tlyric = candidate.tlyric;
  }

  if (typeof candidate.trans === 'string') {
    payload.trans = candidate.trans;
  }

  if (typeof candidate.yrc === 'string') {
    payload.yrc = candidate.yrc;
  }

  return payload;
};

const hasUsableLyrics = (payload: PersistedLyricData) => Boolean(
  payload.yrc?.trim() || payload.lrc?.trim() || payload.lyric?.trim()
);

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
      saved_at TEXT NOT NULL
    );
  `);

  lyricDatabaseState = { musicDir, database };
  return database;
};

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
    SELECT title, artist, song_id, lrc, lyric, tlyric, trans, yrc, saved_at
    FROM lyric_cache
    WHERE association_key = ?
    LIMIT 1
  `);

  for (const key of getLyricAssociationKeys(association)) {
    const row = statement.get(key) as PersistedLyricDatabaseRow | undefined;
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
      saved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const persistCoverBundle = (musicDir: string, coverAssets: Map<string, PersistedCoverAsset>) => {
  ensureDirectory(getLibraryCacheDirectory(musicDir));

  const payload: PersistedCoverBundle = {
    version: LIBRARY_CACHE_VERSION,
    folder: musicDir,
    generatedAt: new Date().toISOString(),
    assets: Object.fromEntries(coverAssets),
  };

  const bundleFilePath = getLibraryCoverBundleFilePath(musicDir);
  const tempBundleFilePath = `${bundleFilePath}.tmp`;
  fs.writeFileSync(tempBundleFilePath, gzipSync(JSON.stringify(payload)));
  fs.renameSync(tempBundleFilePath, bundleFilePath);

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

const persistLibraryCache = (musicDir: string, songs: LibrarySongPayload[]): PersistedLibraryCache => {
  ensureDirectory(getLibraryCacheDirectory(musicDir));

  const payload: PersistedLibraryCache = {
    version: LIBRARY_CACHE_VERSION,
    folder: musicDir,
    generatedAt: new Date().toISOString(),
    songs,
  };

  const cacheFilePath = getLibraryCacheFilePath(musicDir);
  const tempCacheFilePath = `${cacheFilePath}.tmp`;
  fs.writeFileSync(tempCacheFilePath, JSON.stringify(payload), 'utf8');
  fs.renameSync(tempCacheFilePath, cacheFilePath);

  return payload;
};

async function readLibrarySongs(musicDir: string): Promise<LibrarySongPayload[]> {
  const previousCoverBundle = getPersistedCoverBundle(musicDir);
  const nextCoverAssets = new Map<string, PersistedCoverAsset>();
  const files = fs.readdirSync(musicDir)
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const songs = await Promise.all(files.map(async (filename) => {
    const fullPath = path.join(musicDir, filename);
    const stats = fs.statSync(fullPath);
    const cacheKey = getCacheKey(fullPath, stats);
    const cachedTrack = metadataCache.get(cacheKey);

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
        filename,
        fileUrl: `/music/${encodeURIComponent(filename)}`,
        title: filename.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
      };

      metadataCache.set(cacheKey, payload);
      return payload;
    }
  }));

  const activeFiles = new Set(files.map((filename) => path.join(musicDir, filename)));
  Array.from(metadataCache.keys()).forEach((cacheKey) => {
    const separatorIndex = cacheKey.indexOf('|');
    const filePath = separatorIndex >= 0 ? cacheKey.slice(0, separatorIndex) : cacheKey;
    if (!activeFiles.has(filePath) && filePath.startsWith(musicDir)) {
      metadataCache.delete(cacheKey);
    }
  });

  persistCoverBundle(musicDir, nextCoverAssets);

  return songs;
}

async function getLibraryPayload(musicDir: string, forceRefresh = false): Promise<PersistedLibraryCache> {
  if (!forceRefresh) {
    const cachedPayload = readPersistedLibraryCache(musicDir);
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const songs = await readLibrarySongs(musicDir);
  return persistLibraryCache(musicDir, songs);
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
  let hasPrimedLibraryCache = false;

  if (!fs.existsSync(musicDir)) {
    ensureDirectory(musicDir);
  }
  
  // Middleware to serve music from dynamic path
  app.use('/music', (req, res, next) => {
    express.static(musicDir)(req, res, next);
  });

  // API to list music files
  app.get("/api/music", async (req, res) => {
    try {
      const shouldForceRefresh = isRefreshRequested(req.query.refresh) || !hasPrimedLibraryCache;
      const payload = await getLibraryPayload(musicDir, shouldForceRefresh);
      hasPrimedLibraryCache = true;

      res.json({
        folder: payload.folder,
        songs: payload.songs,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to list music files" });
    }
  });

  // API to update music directory
  app.post("/api/settings/music-dir", express.json(), async (req, res) => {
    const { path: newPath } = req.body;
    if (typeof newPath === 'string' && fs.existsSync(newPath)) {
      musicDir = newPath;
      hasPrimedLibraryCache = false;

      try {
        const payload = await getLibraryPayload(musicDir, true);
        hasPrimedLibraryCache = true;
        res.json({ success: true, path: musicDir, songsCount: payload.songs.length });
      } catch {
        res.status(500).json({ error: "Failed to refresh music cache" });
      }
    } else {
      res.status(400).json({ error: "Invalid path" });
    }
  });

  // API to get current music directory
  app.get("/api/settings/music-dir", (req, res) => {
    res.json({ path: musicDir });
  });

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

  app.get('/api/lyrics', async (req, res) => {
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const fileUrl = typeof req.query.file === 'string' ? req.query.file : undefined;
    const manualLyricPayload = getManualLyricPayload(musicDir, fileUrl);

    if (!title || !artist) {
      res.status(400).json({ code: 400, error: 'Missing title or artist' });
      return;
    }

    const cachedPayload = getStoredLyricPayload(musicDir, { title, artist, fileUrl });
    if (cachedPayload) {
      res.json({
        code: 200,
        data: cachedPayload.data,
        source: 'local',
      });
      return;
    }

    try {
      const searchResponse = await fetch(`https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(`${title} ${artist}`)}`);
      const searchData = await searchResponse.json() as {
        code?: number;
        data?: unknown[] | { list?: unknown[] };
      };
      const results = Array.isArray(searchData.data)
        ? searchData.data
        : Array.isArray(searchData.data?.list)
          ? searchData.data.list
          : [];

      if (searchData.code !== 200 || results.length === 0) {
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

      const firstSong = results[0] as Record<string, unknown>;
      const songId = firstSong.id ?? firstSong.songid ?? firstSong.songmid;
      if (typeof songId !== 'string' && typeof songId !== 'number') {
        res.status(404).json({ code: 404, error: 'Could not find song ID' });
        return;
      }

      const lyricResponse = await fetch(`https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`);
      const lyricResponseData = await lyricResponse.json() as {
        code?: number;
        data?: unknown;
      };
      const lyricPayload = sanitizeLyricPayload(lyricResponseData.data);

      if (lyricResponseData.code !== 200 || !hasUsableLyrics(lyricPayload)) {
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

      persistLyricPayloadToDatabase(musicDir, { title, artist, fileUrl }, lyricPayload, String(songId));

      res.json({
        code: 200,
        data: lyricPayload,
        source: 'remote',
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

  // Proxy for vkeys API to avoid CORS
  app.get("/api/proxy/search", async (req, res) => {
    const { word } = req.query;
    try {
      const response = await fetch(`https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(word as string)}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from search API" });
    }
  });

  app.get("/api/proxy/lyric", async (req, res) => {
    const { id } = req.query;
    try {
      const response = await fetch(`https://api.vkeys.cn/v2/music/tencent/lyric?id=${id}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from lyric API" });
    }
  });

  // Vite middleware for development
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
