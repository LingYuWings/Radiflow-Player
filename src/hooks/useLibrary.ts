import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibrarySongPayload, Song } from '../types/player';

interface RefreshLibraryOptions {
  forceRefresh?: boolean;
}

const toSongs = (tracks: LibrarySongPayload[]): Song[] => tracks.map((track) => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  cover: track.cover,
  duration: track.duration,
  lrc: '',
  file: track.fileUrl,
}));

export function useLibrary(ipc: any) {
  const [librarySongs, setLibrarySongs] = useState<Song[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [hasLoadedLibrary, setHasLoadedLibrary] = useState(false);
  const [musicFolder, setMusicFolder] = useState<string | null>(null);
  const hasInitializedRef = useRef(false);

  const applyLibraryPayload = useCallback((tracks: LibrarySongPayload[], folderOverride?: string | null) => {
    setLibrarySongs(toSongs(tracks));
    setMusicFolder(folderOverride ?? null);
  }, []);

  const refreshLibrary = useCallback(async (options: RefreshLibraryOptions = {}) => {
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

      applyLibraryPayload(tracks, nextFolder);
    } catch (error) {
      console.error('Failed to fetch library:', error);
    } finally {
      setIsLoadingLibrary(false);
      setHasLoadedLibrary(true);
    }
  }, [applyLibraryPayload]);

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

  const openFolder = useCallback(() => {
    if (!ipc) return;
    ipc.invoke('open-music-folder', musicFolder);
  }, [ipc, musicFolder]);

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
