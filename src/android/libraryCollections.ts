import type { AndroidTrack } from './playback';

export interface AndroidPlaylist {
  id: string;
  name: string;
  trackIds: string[];
}

export interface AndroidLibraryCollections {
  playlists: AndroidPlaylist[];
  favoriteIds: string[];
}

export const ANDROID_LIBRARY_KEY = 'radiflow-player.android-library';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseTrackIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
}

export function parseAndroidLibrary(raw: string | null): AndroidLibraryCollections {
  const playlists: AndroidPlaylist[] = [];
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value)) return { playlists, favoriteIds: [] };
    const seenIds = new Set<string>();
    if (Array.isArray(value.playlists)) {
      for (const entry of value.playlists) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() ||
          typeof entry.name !== 'string' || !entry.name.trim() || seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        playlists.push({ id: entry.id, name: entry.name.trim(), trackIds: parseTrackIds(entry.trackIds) });
      }
    }
    return { playlists, favoriteIds: parseTrackIds(value.favoriteIds) };
  } catch {
    return { playlists, favoriteIds: [] };
  }
}

export function appendTrackIds(trackIds: string[], additions: string[]): string[] {
  return Array.from(new Set([...trackIds, ...additions]));
}

export function resolvePlaylistTracks(trackIds: string[], tracks: ReadonlyMap<string, AndroidTrack>): AndroidTrack[] {
  const available: AndroidTrack[] = [];
  for (const id of trackIds) {
    const track = tracks.get(id);
    if (track) available.push(track);
  }
  return available;
}
