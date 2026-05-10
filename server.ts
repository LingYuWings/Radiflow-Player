<<<<<<< Updated upstream
import express from "express";
import { createHash } from "crypto";
import fs from "fs";
import type { Server } from "http";
import { parseFile } from "music-metadata";
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
=======
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const READY_PREFIX = 'RADIFLOW_BACKEND_READY ';
const ERROR_PREFIX = 'RADIFLOW_BACKEND_ERROR ';
const IS_WINDOWS = process.platform === 'win32';
const EXECUTABLE_NAME = IS_WINDOWS ? 'radiflow-backend.exe' : 'radiflow-backend';
>>>>>>> Stashed changes

interface StartServerOptions {
  port?: number;
  host?: string;
  mode?: 'development' | 'production';
  staticRoot?: string;
  initialMusicDir?: string;
}

interface StartedServerHandle {
  close: () => void;
}

interface StartedServer {
  port: number;
  host: string;
  url: string;
  server: StartedServerHandle;
}

<<<<<<< Updated upstream
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
=======
interface ReadyPayload {
  host: string;
  port: number;
  url: string;
}

interface ErrorPayload {
  code?: string;
  message?: string;
}

const getProjectRoot = () => (
  path.basename(__dirname) === 'dist-electron'
    ? path.dirname(__dirname)
    : __dirname
);

const getExecutablePath = () => {
  if (process.env.RADIFLOW_BACKEND_BINARY) {
    return process.env.RADIFLOW_BACKEND_BINARY;
  }

  if (path.basename(__dirname) !== 'dist-electron') {
    return null;
  }

  return path.join(__dirname, 'native', EXECUTABLE_NAME);
};

const getDebugExecutablePath = (projectRoot: string) => (
  path.join(projectRoot, 'rust-backend', 'target', 'debug', EXECUTABLE_NAME)
);

const parsePort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getStartupOptions = (options: StartServerOptions) => {
  const projectRoot = getProjectRoot();
  const port = typeof options.port === 'number' && Number.isFinite(options.port)
    ? options.port
    : parsePort(process.env.PORT, 3000);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const mode = options.mode ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const staticRoot = options.staticRoot ?? process.env.STATIC_ROOT ?? projectRoot;
  const initialMusicDir = options.initialMusicDir ?? process.env.MUSIC_DIR ?? path.join(projectRoot, 'music');

  return {
    host,
    initialMusicDir,
    mode,
    port,
    projectRoot,
    staticRoot,
>>>>>>> Stashed changes
  };
};

const buildBackendArgs = (options: ReturnType<typeof getStartupOptions>) => [
  '--port', String(options.port),
  '--host', options.host,
  '--mode', options.mode,
  '--static-root', options.staticRoot,
  '--music-dir', options.initialMusicDir,
];

const waitForCommand = (command: string, args: string[], cwd: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`Command failed with exit code ${code ?? 'null'}: ${command}`));
  });
});

const createSpawnCommand = async (options: ReturnType<typeof getStartupOptions>) => {
  const packagedExecutable = getExecutablePath();
  if (packagedExecutable) {
    return {
      args: buildBackendArgs(options),
      command: packagedExecutable,
    };
  }

  const cargoExecutable = IS_WINDOWS ? 'cargo.exe' : 'cargo';
  await waitForCommand(cargoExecutable, [
    'build',
    '--quiet',
    '--manifest-path',
    path.join(options.projectRoot, 'rust-backend', 'Cargo.toml'),
  ], options.projectRoot);

  return {
    args: buildBackendArgs(options),
    command: getDebugExecutablePath(options.projectRoot),
  };
};

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const startupOptions = getStartupOptions(options);
  const { command, args } = await createSpawnCommand(startupOptions);

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: startupOptions.projectRoot,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const stderrLines: string[] = [];

    const cleanup = () => {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
    };

    const rejectWithPayload = (payload: ErrorPayload) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      const error = new Error(payload.message ?? 'Rust backend failed to start.') as Error & { code?: string };
      if (payload.code) {
        error.code = payload.code;
      }
      reject(error);
    };

<<<<<<< Updated upstream
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
=======
    const handleLine = (line: string, source: 'stdout' | 'stderr') => {
      if (line.startsWith(READY_PREFIX)) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        const payload = JSON.parse(line.slice(READY_PREFIX.length)) as ReadyPayload;
        resolve({
          host: payload.host,
          port: payload.port,
          url: payload.url,
          server: {
            close: () => {
              if (!child.killed) {
                child.kill();
              }
            },
          },
        });
        return;
      }

      if (line.startsWith(ERROR_PREFIX)) {
        try {
          const payload = JSON.parse(line.slice(ERROR_PREFIX.length)) as ErrorPayload;
          rejectWithPayload(payload);
          return;
        } catch {
          rejectWithPayload({ message: line.slice(ERROR_PREFIX.length) });
          return;
        }
      }

      if (source === 'stderr' && line.trim()) {
        stderrLines.push(line.trim());
      }
    };
>>>>>>> Stashed changes

    const consumeChunk = (chunk: Buffer, source: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8');
      if (source === 'stdout') {
        stdoutBuffer += text;
        process.stdout.write(text);
      } else {
        stderrBuffer += text;
        process.stderr.write(text);
      }

      const buffer = source === 'stdout' ? stdoutBuffer : stderrBuffer;
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? '';

      for (const line of lines) {
        handleLine(line, source);
      }

      if (source === 'stdout') {
        stdoutBuffer = remainder;
      } else {
        stderrBuffer = remainder;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => consumeChunk(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => consumeChunk(chunk, 'stderr'));

    child.on('error', (error) => {
      rejectWithPayload({ message: error.message });
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }

      const message = stderrLines.at(-1)
        ?? `Rust backend exited before it reported readiness (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;

      rejectWithPayload({ message });
    });
  });
}

const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFilePath === __filename) {
  startServer().then((startedServer) => {
    const shutdown = () => {
      startedServer.server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
