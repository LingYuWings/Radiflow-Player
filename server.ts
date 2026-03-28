import express from "express";
import { createHash } from "crypto";
import fs from "fs";
import { parseFile } from "music-metadata";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
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

const getCacheKey = (filePath: string, stats: fs.Stats) => `${filePath}|${stats.mtimeMs}|${stats.size}`;
const getLibraryCacheDirectory = (musicDir: string) => path.join(musicDir, LIBRARY_CACHE_DIRECTORY_NAME);
const getLibraryCacheFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_FILE_NAME);
const getLibraryCoverBundleFilePath = (musicDir: string) => path.join(getLibraryCacheDirectory(musicDir), LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME);
const isRefreshRequested = (value: unknown) => value === '1' || value === 'true';

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
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

async function startServer() {
  const app = express();
  const portFromEnv = Number.parseInt(process.env.PORT ?? '3000', 10);
  const PORT = Number.isFinite(portFromEnv) ? portFromEnv : 3000;

  // Serve music directory
  let musicDir = path.join(process.cwd(), 'music');
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
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
