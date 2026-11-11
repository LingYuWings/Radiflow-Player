import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibrarySongPayload, Song } from '../types/player';

interface RefreshLibraryOptions {
  forceRefresh?: boolean;
}

// Convert the server payload into the renderer Song shape once so the rest of
// the UI does not depend on transport-only fields.
const toSongs = (tracks: LibrarySongPayload[]): Song[] => tracks.map((track) => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  cover: track.cover,
  duration: track.duration,
  lrc: '',
  file: track.fileUrl,
}));

// Renderer-side library orchestration: load the current folder, allow explicit
// refresh, and expose platform-assisted folder actions through IPC.
export function useLibrary(ipc: any) {
  const [librarySongs, setLibrarySongs] = useState<Song[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [hasLoadedLibrary, setHasLoadedLibrary] = useState(false);
  const [musicFolder, setMusicFolder] = useState<string | null>(null);
  const hasInitializedRef = useRef(false);
  const requestRef = useRef(0);

  // Shared write path for both the initial bootstrap request and later refreshes.
  const applyLibraryPayload = useCallback((tracks: LibrarySongPayload[], folderOverride?: string | null) => {
    setLibrarySongs(toSongs(tracks));
    setMusicFolder(folderOverride ?? null);
  }, []);

  // The force-refresh flag tells the server to bypass its persisted cache and
  // rescan the selected music directory.
  const refreshLibrary = useCallback(async (options: RefreshLibraryOptions = {}) => {
    const requestId = ++requestRef.current;
    setIsLoadingLibrary(true);
    try {
      const requestUrl = options.forceRefresh ? '/api/music?refresh=1' : '/api/music';
      const response = await fetch(requestUrl);
      if (!response.ok) {
        throw new Error(`Library request failed with ${response.status}`);
      }

      const payload = await response.json() as { folder?: string | null; songs?: LibrarySongPayload[] };
      const tracks = Array.isArray(payload.songs) ? payload.songs : [];
      const nextFolder = typeof payload.folder === 'string' ? payload.folder : null;

      if (requestId !== requestRef.current) return;
      applyLibraryPayload(tracks, nextFolder);
      setIsLoadingLibrary(false);
      setHasLoadedLibrary(true);
      if (!options.forceRefresh) {
        const refreshed = await fetch('/api/music?refresh=1');
        if (refreshed.ok) {
          const fresh = await refreshed.json() as { folder?: string; songs?: LibrarySongPayload[] };
          if (requestId === requestRef.current && Array.isArray(fresh.songs)) applyLibraryPayload(fresh.songs, fresh.folder);
        }
      }
    } catch (error) {
      console.error('Failed to fetch library:', error);
    } finally {
      if (requestId === requestRef.current) {
        setIsLoadingLibrary(false);
        setHasLoadedLibrary(true);
      }
    }
  }, [applyLibraryPayload]);

  // Folder picking is delegated to Electron, then mirrored back into the HTTP
  // server's active music directory before refreshing the library payload.
  const selectFolder = useCallback(async () => {
    if (!ipc) return;

    const selectedPath = await ipc.invoke('select-music-folder');
    if (!selectedPath) return;

    try {
      const response = await fetch('/api/settings/music-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath }),
      });

      if (!response.ok) {
        throw new Error(`Music folder update failed with ${response.status}`);
      }

      await refreshLibrary();
    } catch (error) {
      console.error('Failed to update music folder:', error);
    }
  }, [ipc, refreshLibrary]);

  // Opening the current music folder remains a platform capability, not a UI concern.
  const openFolder = useCallback(() => {
    if (!ipc) return;
    ipc.invoke('open-music-folder', musicFolder);
  }, [ipc, musicFolder]);

  // Initialize exactly once even if React mounts effects more than once during development.
  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }

    hasInitializedRef.current = true;
    let isCancelled = false;

    const initializeLibrary = async () => {
      if (!isCancelled) {
        await refreshLibrary();
      }

      if (ipc) {
        ipc.invoke('get-music-folder')
          .then((path: string | null) => {
            if (isCancelled) return;

            setMusicFolder((current) => current ?? path);
          })
          .catch((error: unknown) => {
            console.error('Failed to read music folder:', error);
          });
      }
    };

    void initializeLibrary();

    return () => {
      isCancelled = true;
    };
  }, [ipc, refreshLibrary]);

  return useMemo(() => ({
    librarySongs,
    isLoadingLibrary,
    hasLoadedLibrary,
    musicFolder,
    refreshLibrary,
    selectFolder,
    openFolder,
  }), [hasLoadedLibrary, isLoadingLibrary, librarySongs, musicFolder, openFolder, refreshLibrary, selectFolder]);
}
