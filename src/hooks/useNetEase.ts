import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaylistCollection } from '../components/Library';
import type { LibrarySongPayload, Song } from '../types/player';

interface NetEaseAccountSummary {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
  vipType?: number;
}

interface NetEaseSessionPayload {
  isConfigured: boolean;
  hasCookie: boolean;
  isLoggedIn: boolean;
  account: NetEaseAccountSummary | null;
}

interface NetEasePlaylistSummary {
  id: string;
  name: string;
  cover?: string;
  trackCount: number;
  updatedAt: number;
  category: 'created' | 'followed';
}

interface NetEasePlaylistPayload {
  playlist?: NetEasePlaylistSummary;
  songs?: LibrarySongPayload[];
}

interface NetEaseMutationPayload {
  success?: boolean;
  playlist?: NetEasePlaylistSummary;
  playlistId?: string;
  error?: string;
}

interface NetEaseQrState {
  key: string;
  qrImage: string;
  qrUrl: string;
  statusCode: number | null;
  statusMessage: string;
}

interface PersistedNetEaseSession {
  cookie: string | null;
}

const NETEASE_SESSION_STORAGE_KEY = 'radiflow-player.netease.session';

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? value as Record<string, unknown> : null
);

const toSong = (track: LibrarySongPayload): Song => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  cover: track.cover,
  duration: track.duration,
  lrc: '',
  file: track.fileUrl,
});

const toSessionPayload = (value: unknown): NetEaseSessionPayload => {
  const payload = asRecord(value);
  const account = asRecord(payload?.account);

  return {
    isConfigured: Boolean(payload?.isConfigured),
    hasCookie: Boolean(payload?.hasCookie),
    isLoggedIn: Boolean(payload?.isLoggedIn),
    account: account ? {
      userId: typeof account.userId === 'number' ? account.userId : 0,
      nickname: typeof account.nickname === 'string' ? account.nickname : 'NetEase User',
      avatarUrl: typeof account.avatarUrl === 'string' ? account.avatarUrl : undefined,
      signature: typeof account.signature === 'string' ? account.signature : undefined,
      vipType: typeof account.vipType === 'number' ? account.vipType : undefined,
    } : null,
  };
};

const toPlaylistCollection = (playlist: NetEasePlaylistSummary, songs: Song[] = []): PlaylistCollection => ({
  id: playlist.id,
  name: playlist.name,
  updatedAt: playlist.updatedAt,
  source: 'netease',
  playlistCategory: playlist.category,
  cover: playlist.cover,
  trackCount: playlist.trackCount,
  songs,
});

const readPersistedSession = (): PersistedNetEaseSession | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(NETEASE_SESSION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedNetEaseSession>;
    return {
      cookie: typeof parsed.cookie === 'string' && parsed.cookie.trim() ? parsed.cookie.trim() : null,
    };
  } catch {
    return null;
  }
};

const writePersistedSession = (value: PersistedNetEaseSession | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!value?.cookie) {
    window.localStorage.removeItem(NETEASE_SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(NETEASE_SESSION_STORAGE_KEY, JSON.stringify(value));
};

export function useNetEase() {
  const [session, setSession] = useState<NetEaseSessionPayload>({
    isConfigured: true,
    hasCookie: false,
    isLoggedIn: false,
    account: null,
  });
  const [cookieDraft, setCookieDraft] = useState('');
  const [playlists, setPlaylists] = useState<PlaylistCollection[]>([]);
  const [qrState, setQrState] = useState<NetEaseQrState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(null);
  const qrPollTimeoutRef = useRef<number | null>(null);

  const clearQrPoll = useCallback(() => {
    if (qrPollTimeoutRef.current !== null) {
      window.clearTimeout(qrPollTimeoutRef.current);
      qrPollTimeoutRef.current = null;
    }
  }, []);

  const storePersistedSession = useCallback((cookie: string | null) => {
    writePersistedSession(cookie ? { cookie } : null);
  }, []);

  const fetchCurrentSession = useCallback(async () => {
    const response = await fetch('/api/netease/session');
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const errorMessage = typeof asRecord(payload)?.error === 'string'
        ? String(asRecord(payload)?.error)
        : 'Failed to fetch NetEase session';
      throw new Error(errorMessage);
    }

    return toSessionPayload(payload);
  }, []);

  const updateSession = useCallback(async (body: { cookie?: string | null }, persistedCookie?: string | null) => {
    const response = await fetch('/api/netease/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const errorMessage = typeof asRecord(payload)?.error === 'string'
        ? String(asRecord(payload)?.error)
        : 'Failed to update NetEase session';
      throw new Error(errorMessage);
    }

    const nextSession = toSessionPayload(payload);
    setSession(nextSession);
    storePersistedSession(persistedCookie === undefined ? null : persistedCookie);
    return nextSession;
  }, [storePersistedSession]);

  const refreshPlaylists = useCallback(async () => {
    if (!session.isLoggedIn) {
      setPlaylists([]);
      return [] as PlaylistCollection[];
    }

    setIsLoadingPlaylists(true);
    try {
      const response = await fetch('/api/netease/playlists');
      const payload = await response.json() as { playlists?: NetEasePlaylistSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to fetch NetEase playlists');
      }

      const nextPlaylists = Array.isArray(payload.playlists)
        ? payload.playlists.map((playlist) => toPlaylistCollection(playlist))
        : [];

      setPlaylists((current) => nextPlaylists.map((playlist) => {
        const existing = current.find((entry) => entry.id === playlist.id);
        return existing
          ? { ...playlist, songs: existing.songs }
          : playlist;
      }));
      setStatusMessage(null);
      return nextPlaylists;
    } catch (error) {
      console.error('Failed to refresh NetEase playlists:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to refresh NetEase playlists');
      return [] as PlaylistCollection[];
    } finally {
      setIsLoadingPlaylists(false);
    }
  }, [session.isLoggedIn]);

  const loadPlaylist = useCallback(async (playlistId: string, options: { force?: boolean } = {}) => {
    const cachedPlaylist = playlists.find((playlist) => playlist.id === playlistId);
    if (!options.force && cachedPlaylist && cachedPlaylist.songs.length > 0) {
      return cachedPlaylist;
    }

    setLoadingPlaylistId(playlistId);
    try {
      const response = await fetch(`/api/netease/playlist/${encodeURIComponent(playlistId)}`);
      const payload = await response.json() as NetEasePlaylistPayload & { error?: string };
      if (!response.ok || !payload.playlist) {
        throw new Error(payload.error || 'Failed to fetch NetEase playlist details');
      }

      const nextPlaylist = toPlaylistCollection(
        payload.playlist,
        Array.isArray(payload.songs) ? payload.songs.map(toSong) : []
      );

      setPlaylists((current) => {
        const remaining = current.filter((playlist) => playlist.id !== nextPlaylist.id);
        return [...remaining, nextPlaylist].sort((left, right) => right.updatedAt - left.updatedAt);
      });
      setStatusMessage(null);
      return nextPlaylist;
    } catch (error) {
      console.error('Failed to load NetEase playlist:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load NetEase playlist');
      return null;
    } finally {
      setLoadingPlaylistId(null);
    }
  }, [playlists]);

  const createPlaylist = useCallback(async (name: string, options: { privacy?: string | number | null; type?: string | null } = {}) => {
    if (!session.isLoggedIn) {
      throw new Error('NetEase login is required');
    }

    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error('Missing NetEase playlist name');
    }

    const existingIds = new Set(playlists.map((playlist) => playlist.id));
    const response = await fetch('/api/netease/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: normalizedName,
        privacy: options.privacy ?? undefined,
        type: options.type ?? undefined,
      }),
    });
    const payload = await response.json() as NetEaseMutationPayload;
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create NetEase playlist');
    }

    const refreshedPlaylists = await refreshPlaylists();
    const createdPlaylist = payload.playlist
      ? toPlaylistCollection(payload.playlist)
      : refreshedPlaylists.find((playlist) => !existingIds.has(playlist.id) && playlist.name === normalizedName)
        ?? refreshedPlaylists.find((playlist) => !existingIds.has(playlist.id))
        ?? null;

    if (createdPlaylist) {
      await loadPlaylist(createdPlaylist.id, { force: true });
    }

    setStatusMessage(null);
    return createdPlaylist;
  }, [loadPlaylist, playlists, refreshPlaylists, session.isLoggedIn]);

  const deletePlaylist = useCallback(async (playlistId: string) => {
    if (!session.isLoggedIn) {
      throw new Error('NetEase login is required');
    }

    const response = await fetch(`/api/netease/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE',
    });
    const payload = await response.json() as NetEaseMutationPayload;
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to delete NetEase playlist');
    }

    setPlaylists((current) => current.filter((playlist) => playlist.id !== playlistId));
    await refreshPlaylists();
    setStatusMessage(null);
    return true;
  }, [refreshPlaylists, session.isLoggedIn]);

  const updatePlaylistTracks = useCallback(async (playlistId: string, trackIds: string[], op: 'add' | 'del') => {
    if (!session.isLoggedIn) {
      throw new Error('NetEase login is required');
    }

    const normalizedTrackIds = Array.from(new Set(trackIds.map((trackId) => trackId.trim()).filter(Boolean)));
    if (normalizedTrackIds.length === 0) {
      return playlists.find((playlist) => playlist.id === playlistId) ?? null;
    }

    const response = await fetch(`/api/netease/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, trackIds: normalizedTrackIds }),
    });
    const payload = await response.json() as NetEaseMutationPayload;
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update NetEase playlist tracks');
    }

    const nextPlaylist = await loadPlaylist(playlistId, { force: true });
    await refreshPlaylists();
    setStatusMessage(null);
    return nextPlaylist;
  }, [loadPlaylist, playlists, refreshPlaylists, session.isLoggedIn]);

  const addSongsToPlaylist = useCallback(async (playlistId: string, trackIds: string[]) => {
    return updatePlaylistTracks(playlistId, trackIds, 'add');
  }, [updatePlaylistTracks]);

  const removeSongsFromPlaylist = useCallback(async (playlistId: string, trackIds: string[]) => {
    return updatePlaylistTracks(playlistId, trackIds, 'del');
  }, [updatePlaylistTracks]);

  const loginWithCookie = useCallback(async () => {
    const normalizedCookie = cookieDraft.trim();
    if (!normalizedCookie) {
      setStatusMessage('Missing NetEase login cookie');
      return;
    }

    setIsSavingSession(true);
    try {
      const nextSession = await updateSession({ cookie: normalizedCookie }, normalizedCookie);
      setStatusMessage(nextSession.isLoggedIn ? null : 'NetEase login cookie was stored, but account verification failed');
      setCookieDraft('');
    } catch (error) {
      console.error('Failed to log in to NetEase with cookie:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to log in to NetEase with cookie');
    } finally {
      setIsSavingSession(false);
    }
  }, [cookieDraft, updateSession]);

  const logout = useCallback(async () => {
    setIsSavingSession(true);
    clearQrPoll();
    try {
      const response = await fetch('/api/netease/logout', { method: 'POST' });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const errorMessage = typeof asRecord(payload)?.error === 'string'
          ? String(asRecord(payload)?.error)
          : 'Failed to log out from NetEase';
        throw new Error(errorMessage);
      }

      const nextSession = toSessionPayload(payload);
      setSession(nextSession);
      setPlaylists([]);
      setQrState(null);
      storePersistedSession(null);
      setStatusMessage(null);
    } catch (error) {
      console.error('Failed to log out from NetEase:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to log out from NetEase');
    } finally {
      setIsSavingSession(false);
    }
  }, [clearQrPoll, storePersistedSession]);

  const pollQrLogin = useCallback(async (qrKey: string) => {
    try {
      const response = await fetch(`/api/netease/login/qr/check?key=${encodeURIComponent(qrKey)}`);
      const payload = await response.json() as {
        code?: number;
        message?: string;
        cookie?: string | null;
      };
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to verify NetEase QR login state');
      }

      const code = typeof payload.code === 'number' ? payload.code : null;
      const message = typeof payload.message === 'string' ? payload.message : '';

      setQrState((current) => current ? {
        ...current,
        statusCode: code,
        statusMessage: message,
      } : current);

      if (code === 803) {
        const nextSession = await fetchCurrentSession();
        setSession(nextSession);
        storePersistedSession(payload.cookie?.trim() || null);
        setStatusMessage(null);
        await refreshPlaylists();
        clearQrPoll();
        return;
      }

      if (code === 800) {
        setStatusMessage(message || 'NetEase QR code expired');
        clearQrPoll();
        return;
      }

      qrPollTimeoutRef.current = window.setTimeout(() => {
        void pollQrLogin(qrKey);
      }, 2000);
    } catch (error) {
      console.error('Failed to poll NetEase QR login state:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to verify NetEase QR login state');
      clearQrPoll();
    }
  }, [clearQrPoll, fetchCurrentSession, refreshPlaylists, storePersistedSession]);

  const startQrLogin = useCallback(async () => {
    setIsSavingSession(true);
    clearQrPoll();
    try {
      const response = await fetch('/api/netease/login/qr/start', {
        method: 'POST',
      });
      const payload = await response.json() as { key?: string; qrImage?: string; qrUrl?: string; error?: string };
      if (!response.ok || !payload.key || !payload.qrImage) {
        throw new Error(payload.error || 'Failed to start NetEase QR login');
      }

      setQrState({
        key: payload.key,
        qrImage: payload.qrImage,
        qrUrl: payload.qrUrl || '',
        statusCode: 801,
        statusMessage: '',
      });
      setStatusMessage(null);
      qrPollTimeoutRef.current = window.setTimeout(() => {
        void pollQrLogin(payload.key);
      }, 1500);
    } catch (error) {
      console.error('Failed to start NetEase QR login:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Failed to start NetEase QR login');
    } finally {
      setIsSavingSession(false);
    }
  }, [clearQrPoll, pollQrLogin]);

  useEffect(() => {
    let isCancelled = false;

    const restoreSession = async () => {
      setIsRestoringSession(true);
      const persistedSession = readPersistedSession();

      try {
        const nextSession = persistedSession?.cookie
          ? await updateSession({ cookie: persistedSession.cookie }, persistedSession.cookie)
          : await fetchCurrentSession();

        if (isCancelled) {
          return;
        }

        setSession(nextSession);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error('Failed to restore NetEase session:', error);
        setStatusMessage(error instanceof Error ? error.message : 'Failed to restore NetEase session');
      } finally {
        if (!isCancelled) {
          setIsRestoringSession(false);
        }
      }
    };

    void restoreSession();

    return () => {
      isCancelled = true;
      clearQrPoll();
    };
  }, [clearQrPoll, fetchCurrentSession, updateSession]);

  useEffect(() => {
    if (!session.isLoggedIn) {
      setPlaylists([]);
      return;
    }

    void refreshPlaylists();
  }, [refreshPlaylists, session.isLoggedIn]);

  return {
    session,
    cookieDraft,
    setCookieDraft,
    playlists,
    qrState,
    statusMessage,
    isRestoringSession,
    isSavingSession,
    isLoadingPlaylists,
    loadingPlaylistId,
    loginWithCookie,
    logout,
    refreshPlaylists,
    startQrLogin,
    loadPlaylist,
    createPlaylist,
    deletePlaylist,
    addSongsToPlaylist,
    removeSongsFromPlaylist,
  };
}
