import {
  Check, ChevronLeft, ChevronRight, Disc, FolderOpen, Heart, LayoutGrid, List, ListMusic,
  ListPlus, MoreHorizontal, Music, Pencil, Play, Plus, Search, Trash2, UserRound, X,
} from 'lucide-react';
import {
  useDeferredValue, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type Ref,
} from 'react';
import type { AppLanguage } from '../lib/copy';
import { animatePageArrival } from '../lib/pageMotion';
import {
  ANDROID_LIBRARY_KEY, appendTrackIds, parseAndroidLibrary, resolvePlaylistTracks, type AndroidLibraryCollections,
} from './libraryCollections';
import type { AndroidTrack } from './playback';
import './library.css';

const libraryCopy = {
  'zh-CN': {
    library: '本地音乐库', libraryViews: '音乐库视图', songs: '歌曲', artists: '歌手', albums: '专辑',
    playlists: '歌单', favorites: '收藏', artist: '歌手', album: '专辑', playlist: '歌单',
    import: '导入音乐', importing: '正在导入…', search: '搜索音乐库', searchTracks: '搜索歌曲',
    empty: '音乐库还没有歌曲', noMatches: '没有找到匹配的结果', noPlaylists: '还没有歌单',
    noFavorites: '还没有收藏的歌曲', emptyPlaylist: '这个歌单还没有歌曲', unavailableTracks: '部分歌曲暂时无法播放',
    play: '播放', playAll: '全部播放', playNext: '下一首播放', add: '添加到歌单', addTracks: '添加歌曲',
    newPlaylist: '新建歌单', rename: '重命名歌单', name: '歌单名称', delete: '删除歌单',
    deleteMessage: (name: string) => `删除「${name}」？音乐文件会保留在设备上。`,
    remove: '从歌单移除', favorite: '收藏歌曲', unfavorite: '取消收藏', menu: '歌曲操作',
    back: '返回音乐库', grid: '网格视图', list: '列表视图', layout: '排列方式',
    cancel: '取消', save: '保存', close: '关闭', done: '完成', added: '已添加', storageError: '无法在设备上保存更改',
    unknownArtist: '未知歌手', unknownAlbum: '未知专辑', count: (amount: number) => `${amount} 首歌曲`,
  },
  'en-US': {
    library: 'Local library', libraryViews: 'Library views', songs: 'Songs', artists: 'Artists', albums: 'Albums',
    playlists: 'Playlists', favorites: 'Favorites', artist: 'Artist', album: 'Album', playlist: 'Playlist',
    import: 'Import music', importing: 'Importing…', search: 'Search library', searchTracks: 'Search songs',
    empty: 'Your library is empty', noMatches: 'No matching results', noPlaylists: 'No playlists yet',
    noFavorites: 'No favorites yet', emptyPlaylist: 'This playlist is empty', unavailableTracks: 'Some tracks are temporarily unavailable',
    play: 'Play', playAll: 'Play all', playNext: 'Play next', add: 'Add to playlist', addTracks: 'Add songs',
    newPlaylist: 'New playlist', rename: 'Rename playlist', name: 'Playlist name', delete: 'Delete playlist',
    deleteMessage: (name: string) => `Delete “${name}”? Your music files will stay on this device.`,
    remove: 'Remove from playlist', favorite: 'Favorite track', unfavorite: 'Remove favorite', menu: 'Track actions',
    back: 'Back to library', grid: 'Grid view', list: 'List view', layout: 'Layout',
    cancel: 'Cancel', save: 'Save', close: 'Close', done: 'Done', added: 'Added', storageError: 'Could not save changes to this device',
    unknownArtist: 'Unknown artist', unknownAlbum: 'Unknown album',
    count: (amount: number) => `${amount} ${amount === 1 ? 'song' : 'songs'}`,
  },
} as const;

type LibraryCopy = typeof libraryCopy[AppLanguage];
type LibrarySection = 'songs' | 'artists' | 'albums' | 'playlists' | 'favorites';
type CollectionSection = 'artists' | 'albums' | 'playlists';
type Collection = {
  id: string;
  name: string;
  artist?: string;
  cover?: string;
  count: number;
  tracks: AndroidTrack[];
};

type LibraryOverlay =
  | { type: 'track'; track: AndroidTrack; playlistId?: string }
  | { type: 'addTo'; trackIds: string[] }
  | { type: 'addTracks'; collection: Collection }
  | { type: 'create'; trackIds: string[] }
  | { type: 'rename' | 'delete'; collection: Collection };

const sections: LibrarySection[] = ['songs', 'artists', 'albums', 'playlists', 'favorites'];
const collectionIcons = { artists: UserRound, albums: Disc, playlists: ListMusic };
const normalize = (value?: string) => value?.trim().toLowerCase() ?? '';
const findCover = (tracks: AndroidTrack[]) => tracks.find(track => track.cover)?.cover;
const matches = (query: string, ...fields: (string | undefined)[]) =>
  fields.some(field => normalize(field).includes(query));
const matchesTrack = (query: string, track: AndroidTrack) =>
  matches(query, track.title, track.artist, track.album);
const matchesCollection = (query: string, group: Collection) =>
  matches(query, group.name, group.artist) || group.tracks.some(track => matchesTrack(query, track));

function groupTracks(tracks: AndroidTrack[], section: 'artists' | 'albums', copy: LibraryCopy, language: AppLanguage) {
  const groups = new Map<string, Collection>();
  tracks.forEach(track => {
    const artist = track.artist.trim() || copy.unknownArtist;
    const album = track.album?.trim() || copy.unknownAlbum;
    const name = section === 'artists' ? artist : album;
    const id = JSON.stringify(section === 'artists' ? [normalize(track.artist)] : [normalize(track.artist), normalize(track.album)]);
    const group = groups.get(id);
    if (group) {
      group.tracks.push(track);
      group.count += 1;
      group.cover ||= track.cover;
    } else {
      groups.set(id, { id, name, artist: section === 'albums' ? artist : undefined, cover: track.cover, count: 1, tracks: [track] });
    }
  });
  return Array.from(groups.values()).sort((left, right) =>
    (left.artist ?? '').localeCompare(right.artist ?? '', language) || left.name.localeCompare(right.name, language));
}

function loadCollections() {
  try {
    return parseAndroidLibrary(window.localStorage.getItem(ANDROID_LIBRARY_KEY));
  } catch {
    return parseAndroidLibrary(null);
  }
}

function trackDuration(duration?: number) {
  if (!duration || !Number.isFinite(duration) || duration < 0) return null;
  const seconds = Math.floor(duration);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Artwork({ cover, icon: Icon = Music, className, eager = false }: {
  cover?: string; icon?: typeof Music; className: string; eager?: boolean;
}) {
  return <span aria-hidden="true" className={`rf-android-library-art ${className}`}>
    <Icon />
    {cover && <img key={cover} src={cover} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async"
      onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}

function CollectionGrid({ groups, section, copy, onOpen }: {
  groups: Collection[]; section: CollectionSection; copy: LibraryCopy; onOpen: (id: string) => void;
}) {
  return <ul className="rf-cover-grid rf-android-library-grid">
    {groups.map(group => <li key={group.id}>
      <button type="button" className="rf-cover-card group" data-collection-id={group.id} onClick={() => onOpen(group.id)}>
        <span className="rf-cover-card-art">
          <Artwork cover={group.cover} icon={collectionIcons[section]} className="rf-card-art rf-android-library-tile-art" />
          <span className="rf-cover-card-play" aria-hidden="true"><ChevronRight size={19} /></span>
        </span>
        <span className="rf-android-library-tile-title">{group.name}</span>
        <span className="rf-row-sub">{group.artist ? `${group.artist} · ` : ''}{copy.count(group.count)}</span>
      </button>
    </li>)}
  </ul>;
}

function TrackList({ tracks, activeId, playing, favoriteIds, grid, copy, onPlay, onMenu }: {
  tracks: AndroidTrack[]; activeId: string | null; playing?: boolean; favoriteIds: ReadonlySet<string>;
  grid: boolean; copy: LibraryCopy; onPlay: (id: string) => void; onMenu: (track: AndroidTrack) => void;
}) {
  return <ul className={grid ? 'rf-cover-grid rf-android-library-grid' : 'rf-android-library-rows'}>
    {tracks.map(track => {
      const active = track.id === activeId;
      const favorite = favoriteIds.has(track.id);
      const duration = trackDuration(track.duration);
      const trackLabel = `${copy.play} · ${track.title} · ${track.artist || copy.unknownArtist}`;
      const menu = <button type="button" className="rf-icon-button rf-android-library-icon rf-android-library-track-menu"
        aria-label={`${copy.menu} · ${track.title}`} aria-haspopup="dialog" onClick={() => onMenu(track)}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>;
      if (grid) {
        return <li key={track.id} className="rf-android-library-track-tile" data-active={active}>
          <button type="button" className="rf-cover-card group" aria-label={trackLabel}
            aria-current={active || undefined} onClick={() => onPlay(track.id)}>
            <span className="rf-cover-card-art">
              <Artwork cover={track.cover} className="rf-card-art rf-android-library-tile-art" />
              <span className="rf-cover-card-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
            </span>
            <span className="rf-android-library-tile-title">{track.title}</span>
            <span className="rf-row-sub">{track.artist || copy.unknownArtist}</span>
          </button>
          {menu}
        </li>;
      }
      return <li key={track.id} className={`rf-library-row${active ? ' rf-library-row-active' : ''}`}>
        <button type="button" className="rf-android-library-track" aria-label={trackLabel} aria-current={active || undefined}
          onClick={() => onPlay(track.id)}>
          <Artwork cover={track.cover} className="rf-row-cover" />
          <span className="rf-android-library-track-copy">
            <span className="rf-row-title">{track.title}</span>
            <span className="rf-row-sub">{track.artist || copy.unknownArtist}{track.album ? ` · ${track.album}` : ''}</span>
          </span>
          {active && <span className="rf-now-bars" aria-hidden="true" data-playing={Boolean(playing)}><i /><i /><i /></span>}
          {favorite && <Heart size={13} fill="currentColor" className="rf-android-library-liked" aria-hidden="true" />}
          {duration && <time className="rf-row-duration" aria-hidden="true">{duration}</time>}
        </button>
        {menu}
      </li>;
    })}
  </ul>;
}

function LibraryDialog({ title, identity, close, onDismiss, children }: {
  title: string; identity: LibraryOverlay['type']; close: string; onDismiss: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const element: HTMLDialogElement | null = dialog.current;
    const target = element?.querySelector<HTMLInputElement>('[data-dialog-autofocus]') ?? closeButton.current;
    target?.focus({ preventScroll: true });
  }, [identity]);
  return <dialog className="rf-android-library-sheet" aria-labelledby={titleId} ref={dialog}
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <header>
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="rf-icon-button rf-android-library-icon" aria-label={close} ref={closeButton} onClick={onDismiss}>
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    {children}
  </dialog>;
}

function TrackPicker({ tracks, collection, copy, onAdd }: {
  tracks: AndroidTrack[]; collection: Collection; copy: LibraryCopy; onAdd: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const existing = useMemo(() => new Set(collection.tracks.map(track => track.id)), [collection]);
  const search = normalize(useDeferredValue(query));
  const results = useMemo(() => search ? tracks.filter(track => matchesTrack(search, track)) : tracks, [search, tracks]);
  return <>
    <label className="rf-android-library-search">
      <Search size={17} aria-hidden="true" />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder={copy.searchTracks} aria-label={copy.searchTracks} />
    </label>
    {results.length > 0 ? <ul className="rf-android-library-sheet-list">
      {results.map(track => {
        const added = existing.has(track.id);
        return <li key={track.id}>
          <label className="rf-android-library-sheet-action">
            <Artwork cover={track.cover} className="rf-row-cover" />
            <span className="rf-android-library-track-copy">
              <span className="rf-row-title">{track.title}</span>
              <span className="rf-row-sub">{added ? copy.added : track.artist || copy.unknownArtist}</span>
            </span>
            <input type="checkbox" checked={added || picked.has(track.id)} disabled={added}
              onChange={event => {
                const checked = event.target.checked;
                setPicked(current => {
                  const next = new Set(current);
                  if (checked) next.add(track.id);
                  else next.delete(track.id);
                  return next;
                });
              }} />
          </label>
        </li>;
      })}
    </ul> : <p className="rf-android-library-message">{tracks.length ? copy.noMatches : copy.empty}</p>}
    <footer className="rf-android-library-sheet-footer">
      <button type="button" className="rf-primary-button" disabled={picked.size === 0} onClick={() => onAdd(Array.from(picked))}>
        <Check size={17} aria-hidden="true" />{copy.done}
      </button>
    </footer>
  </>;
}

function PlaylistNameForm({ initialName, copy, onSave, onCancel }: {
  initialName: string; copy: LibraryCopy; onSave: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  return <form className="rf-android-library-name-form" onSubmit={event => {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  }}>
    <label>{copy.name}<input data-dialog-autofocus type="text" value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
    <footer className="rf-android-library-sheet-footer">
      <button type="button" className="rf-ghost-button" onClick={onCancel}>{copy.cancel}</button>
      <button type="submit" className="rf-primary-button" disabled={!name.trim()}>{copy.save}</button>
    </footer>
  </form>;
}

export interface AndroidLibraryHandle {
  handleBack(): boolean;
  openAlbum(album: string, artist?: string): boolean;
}

export interface AndroidLibraryProps {
  tracks: AndroidTrack[];
  activeId: string | null;
  onPlay: (id: string, queue: AndroidTrack[]) => void;
  onImport: () => void;
  importing: boolean;
  language: AppLanguage;
  onQueueNext?: (track: AndroidTrack) => void;
  playing?: boolean;
  ref?: Ref<AndroidLibraryHandle>;
}

export function AndroidLibrary({ tracks, activeId, playing, onPlay, onImport, importing, language, onQueueNext, ref }: AndroidLibraryProps) {
  const copy = libraryCopy[language];
  const [section, setSection] = useState<LibrarySection>('songs');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(false);
  const [overlay, setOverlay] = useState<LibraryOverlay | null>(null);
  const [collections, setCollections] = useState(loadCollections);
  const [storageError, setStorageError] = useState(false);
  const latestCollections = useRef(collections);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const overviewScroll = useRef(0);
  const overviewSelection = useRef<string | null>(null);
  const transitionDirection = useRef<'forward' | 'back' | 'section'>('section');
  const headingId = useId();
  const deferredQuery = normalize(useDeferredValue(query));

  const allTracks = useMemo(() => [...tracks].sort((left, right) =>
    left.title.localeCompare(right.title, language) || left.artist.localeCompare(right.artist, language)), [tracks, language]);
  const tracksById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const favoriteIds = useMemo(() => new Set(collections.favoriteIds), [collections.favoriteIds]);
  const favorites = useMemo(() => resolvePlaylistTracks(collections.favoriteIds, tracksById), [collections.favoriteIds, tracksById]);
  const groups = useMemo(() => ({
    artists: groupTracks(allTracks, 'artists', copy, language),
    albums: groupTracks(allTracks, 'albums', copy, language),
    playlists: collections.playlists.map(playlist => {
      const available = resolvePlaylistTracks(playlist.trackIds, tracksById);
      return {
        id: playlist.id, name: playlist.name, cover: findCover(available), count: playlist.trackIds.length,
        tracks: available,
      } satisfies Collection;
    }),
  }), [allTracks, collections.playlists, copy, language, tracksById]);
  const collectionSection = section === 'songs' || section === 'favorites' ? null : section;
  const sectionGroups: Collection[] = collectionSection ? groups[collectionSection] : [];
  const detail = sectionGroups.find(group => group.id === detailId);
  const sectionTracks = section === 'favorites' ? favorites : allTracks;
  const visibleTracks = useMemo(() => detail?.tracks ?? (deferredQuery
    ? sectionTracks.filter(track => matchesTrack(deferredQuery, track)) : sectionTracks),
    [detail, sectionTracks, deferredQuery]);
  const visibleGroups = sectionGroups.filter(group => matchesCollection(deferredQuery, group));

  function changeCollections(update: (current: AndroidLibraryCollections) => AndroidLibraryCollections) {
    const next = update(latestCollections.current);
    latestCollections.current = next;
    setCollections(next);
    try {
      window.localStorage.setItem(ANDROID_LIBRARY_KEY, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  function openDetail(id: string, restoreOverview = true) {
    if (!detail || !restoreOverview) overviewScroll.current = restoreOverview ? (content.current?.scrollTop ?? 0) : 0;
    overviewSelection.current = id;
    transitionDirection.current = 'forward';
    setDetailId(id);
  }

  function closeDetail() {
    transitionDirection.current = 'back';
    setDetailId(null);
  }

  useImperativeHandle(ref, () => ({
    handleBack() {
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (detail) {
        closeDetail();
        return true;
      }
      return false;
    },
    openAlbum(album, artist) {
      const name = normalize(album);
      const performer = normalize(artist);
      const group = groups.albums.find(item => normalize(item.name) === name && (!performer || normalize(item.artist) === performer));
      if (!group) return false;
      if (section !== 'albums') {
        setSection('albums');
        setQuery('');
      }
      setOverlay(null);
      openDetail(group.id, section === 'albums');
      return true;
    },
  }));

  useLayoutEffect(() => {
    const scroll: HTMLDivElement | null = content.current;
    if (scroll) {
      scroll.scrollTop = transitionDirection.current === 'back' ? overviewScroll.current : 0;
      if (transitionDirection.current === 'back') {
        const opener = Array.from(scroll.querySelectorAll<HTMLButtonElement>('[data-collection-id]'))
          .find(button => button.dataset.collectionId === overviewSelection.current);
        const currentSection = scroll.parentElement?.querySelector<HTMLButtonElement>('nav [aria-pressed="true"]');
        (opener ?? currentSection)?.focus({ preventScroll: true });
      } else if (transitionDirection.current === 'forward') heading.current?.focus({ preventScroll: true });
    }
    transitionDirection.current = 'section';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const animation = animatePageArrival(scroll, reduced);
    return () => animation?.cancel();
  }, [section, detailId]);

  useEffect(() => {
    if (content.current && !detailId) content.current.scrollTop = 0;
  }, [deferredQuery]);

  function selectSection(value: LibrarySection) {
    if (value === section && !detailId) return;
    if (value === section) {
      closeDetail();
      return;
    }
    transitionDirection.current = 'section';
    setSection(value);
    setDetailId(null);
    setQuery('');
  }

  function playVisible(id: string) {
    onPlay(id, visibleTracks);
  }

  function addTracks(id: string, additions: string[]) {
    changeCollections(current => ({
      ...current,
      playlists: current.playlists.map(playlist => playlist.id === id
        ? { ...playlist, trackIds: appendTrackIds(playlist.trackIds, additions) } : playlist),
    }));
    setOverlay(null);
  }

  function createPlaylist(name: string, trackIds: string[]) {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    changeCollections(current => ({
      ...current,
      playlists: [...current.playlists, { id, name, trackIds: appendTrackIds([], trackIds) }],
    }));
    setOverlay(null);
    if (trackIds.length === 0) {
      setSection('playlists');
      setQuery('');
      openDetail(id, section === 'playlists' && !query);
    }
  }

  function removeFromPlaylist(id: string, trackId: string) {
    changeCollections(current => ({
      ...current,
      playlists: current.playlists.map(playlist => playlist.id === id
        ? { ...playlist, trackIds: playlist.trackIds.filter(track => track !== trackId) } : playlist),
    }));
    setOverlay(null);
  }

  const dismiss = () => setOverlay(null);
  const detailLabel = section === 'artists' ? copy.artist : section === 'albums' ? copy.album : copy.playlist;
  const canSearch = !detail && (collectionSection ? sectionGroups.length > 0 : sectionTracks.length > 0);
  const canSetLayout = !collectionSection && sectionTracks.length > 0;
  let emptyMessage: string = copy.empty;
  if (deferredQuery && canSearch) emptyMessage = copy.noMatches;
  else if (section === 'favorites') emptyMessage = copy.noFavorites;
  else if (section === 'playlists') emptyMessage = detail ? copy.emptyPlaylist : copy.noPlaylists;

  let dialogTitle = '';
  let dialogContents: ReactNode;
  if (overlay?.type === 'track') {
    const { track, playlistId } = overlay;
    const favorite = favoriteIds.has(track.id);
    dialogTitle = track.title;
    dialogContents = <>
      <button type="button" className="rf-android-library-sheet-action" onClick={() => {
        changeCollections(current => ({
          ...current,
          favoriteIds: favorite ? current.favoriteIds.filter(id => id !== track.id) : appendTrackIds(current.favoriteIds, [track.id]),
        }));
        dismiss();
      }}><Heart size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />{favorite ? copy.unfavorite : copy.favorite}</button>
      {onQueueNext && <button type="button" className="rf-android-library-sheet-action" onClick={() => {
        onQueueNext(track);
        dismiss();
      }}><ListPlus size={20} aria-hidden="true" />{copy.playNext}</button>}
      <button type="button" className="rf-android-library-sheet-action" onClick={() => setOverlay({ type: 'addTo', trackIds: [track.id] })}>
        <Plus size={20} aria-hidden="true" />{copy.add}
      </button>
      {playlistId && <button type="button" className="rf-android-library-sheet-action" onClick={() => removeFromPlaylist(playlistId, track.id)}>
        <Trash2 size={20} aria-hidden="true" />{copy.remove}
      </button>}
    </>;
  } else if (overlay?.type === 'addTo') {
    const { trackIds } = overlay;
    dialogTitle = copy.add;
    dialogContents = <>
      <button type="button" className="rf-android-library-sheet-action" onClick={() => setOverlay({ type: 'create', trackIds })}>
        <Plus size={20} aria-hidden="true" />{copy.newPlaylist}
      </button>
      <ul className="rf-android-library-sheet-list">
        {collections.playlists.map(playlist => {
          const existing = new Set(playlist.trackIds);
          const added = trackIds.every(id => existing.has(id));
          return <li key={playlist.id}>
            <button type="button" className="rf-android-library-sheet-action" disabled={added} onClick={() => addTracks(playlist.id, trackIds)}>
              <ListMusic size={20} aria-hidden="true" />
              <span className="rf-android-library-track-copy">
                <span className="rf-row-title">{playlist.name}</span>
                <span className="rf-row-sub">{added ? copy.added : copy.count(playlist.trackIds.length)}</span>
              </span>
              {added && <Check size={17} aria-hidden="true" />}
            </button>
          </li>;
        })}
      </ul>
    </>;
  } else if (overlay?.type === 'addTracks') {
    const { collection } = overlay;
    dialogTitle = copy.addTracks;
    dialogContents = <TrackPicker tracks={allTracks} collection={collection} copy={copy} onAdd={ids => addTracks(collection.id, ids)} />;
  } else if (overlay?.type === 'create' || overlay?.type === 'rename') {
    const isNew = overlay.type === 'create';
    dialogTitle = isNew ? copy.newPlaylist : copy.rename;
    dialogContents = <PlaylistNameForm initialName={isNew ? '' : overlay.collection.name} copy={copy} onCancel={dismiss} onSave={name => {
        if (overlay.type === 'create') {
          createPlaylist(name, overlay.trackIds);
        } else {
          changeCollections(current => ({
            ...current,
            playlists: current.playlists.map(playlist => playlist.id === overlay.collection.id ? { ...playlist, name } : playlist),
          }));
          dismiss();
        }
    }} />;
  } else if (overlay?.type === 'delete') {
    dialogTitle = copy.delete;
    dialogContents = <>
      <p className="rf-android-library-message">{copy.deleteMessage(overlay.collection.name)}</p>
      <footer className="rf-android-library-sheet-footer">
        <button type="button" className="rf-ghost-button" onClick={dismiss}>{copy.cancel}</button>
        <button type="button" className="rf-primary-button rf-android-library-destructive" onClick={() => {
          changeCollections(current => ({
            ...current,
            playlists: current.playlists.filter(playlist => playlist.id !== overlay.collection.id),
          }));
          dismiss();
          closeDetail();
        }}>{copy.delete}</button>
      </footer>
    </>;
  }

  return <section className="rf-android-library" aria-labelledby={headingId}>
    <header className="rf-android-library-header">
      <h2 className="rf-page-title" id={headingId}>{copy.library}</h2>
      <button type="button" className="rf-ghost-button" onClick={onImport} disabled={importing} aria-busy={importing}>
        <FolderOpen size={17} aria-hidden="true" />{importing ? copy.importing : copy.import}
      </button>
    </header>
    <nav className="rf-segmented rf-android-library-nav" aria-label={copy.libraryViews}>
      {sections.map(value => <button key={value} type="button" className="rf-segmented-item"
        aria-pressed={section === value} onClick={() => selectSection(value)}>{copy[value]}</button>)}
    </nav>
    {storageError && <p className="rf-android-library-storage-error" role="status">{copy.storageError}</p>}
    {!detail && (canSearch || section === 'playlists') && <div className="rf-android-library-tools">
      {canSearch && <label className="rf-android-library-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder={copy.search} aria-label={copy.search} />
      </label>}
      {canSetLayout && <div className="rf-segmented rf-android-library-layout" role="group" aria-label={copy.layout}>
        <button type="button" className="rf-segmented-item" aria-label={copy.list} aria-pressed={!grid} onClick={() => setGrid(false)}>
          <List size={16} aria-hidden="true" />
        </button>
        <button type="button" className="rf-segmented-item" aria-label={copy.grid} aria-pressed={grid} onClick={() => setGrid(true)}>
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
      </div>}
      {section === 'playlists' && <button type="button" className="rf-ghost-button" aria-haspopup="dialog"
        onClick={() => setOverlay({ type: 'create', trackIds: [] })}><Plus size={17} aria-hidden="true" />{copy.newPlaylist}</button>}
    </div>}
    <div className="rf-android-library-scroll" ref={content}>
      {detail && collectionSection && <div className="rf-android-library-detail">
        <button type="button" className="rf-chrome-button rf-android-library-back" aria-label={copy.back} onClick={closeDetail}>
          <ChevronLeft size={18} aria-hidden="true" />{copy[collectionSection]}
        </button>
        <div className="rf-hero">
          <Artwork cover={detail.cover} icon={collectionIcons[collectionSection]} className="rf-android-library-hero-art" eager />
          <div className="rf-android-library-track-copy">
            <span className="rf-hero-kicker">{detailLabel}</span>
            <h3 className="rf-hero-title" ref={heading} tabIndex={-1}>{detail.name}</h3>
            <span className="rf-row-sub">{detail.artist ? `${detail.artist} · ` : ''}{copy.count(detail.count)}</span>
          </div>
        </div>
        <div className="rf-android-library-detail-actions">
          <button type="button" className="rf-primary-button" disabled={!visibleTracks.length}
            onClick={() => { if (visibleTracks[0]) playVisible(visibleTracks[0].id); }}>
            <Play size={16} fill="currentColor" aria-hidden="true" />{copy.playAll}
          </button>
          {section === 'playlists' ? <>
            <button type="button" className="rf-ghost-button" aria-haspopup="dialog" onClick={() => setOverlay({ type: 'addTracks', collection: detail })}>
              <Plus size={17} aria-hidden="true" />{copy.addTracks}
            </button>
            <button type="button" className="rf-icon-button rf-android-library-icon" aria-label={copy.rename} aria-haspopup="dialog"
              onClick={() => setOverlay({ type: 'rename', collection: detail })}><Pencil size={16} aria-hidden="true" /></button>
            <button type="button" className="rf-icon-button rf-android-library-icon" aria-label={copy.delete} aria-haspopup="dialog"
              onClick={() => setOverlay({ type: 'delete', collection: detail })}><Trash2 size={16} aria-hidden="true" /></button>
          </> : <button type="button" className="rf-ghost-button" aria-haspopup="dialog" disabled={!visibleTracks.length}
            onClick={() => setOverlay({ type: 'addTo', trackIds: visibleTracks.map(track => track.id) })}>
            <ListPlus size={17} aria-hidden="true" />{copy.add}
          </button>}
        </div>
        {detail.count > detail.tracks.length && <p className="rf-android-library-message">{copy.unavailableTracks}</p>}
      </div>}
      {!detail && collectionSection ? (
        visibleGroups.length > 0
          ? <CollectionGrid groups={visibleGroups} copy={copy} section={collectionSection} onOpen={openDetail} />
          : <p className="rf-android-library-empty">{emptyMessage}</p>
      ) : visibleTracks.length > 0 ? (
        <TrackList tracks={visibleTracks} activeId={activeId} playing={playing} favoriteIds={favoriteIds} grid={!detail && grid}
          copy={copy} onPlay={playVisible} onMenu={track => setOverlay({
            type: 'track', track, playlistId: section === 'playlists' ? detail?.id : undefined,
          })} />
      ) : (!detail || detail.count === 0) && <p className="rf-android-library-empty">{emptyMessage}</p>}
    </div>
    {overlay && <LibraryDialog title={dialogTitle} identity={overlay.type} close={copy.close}
      onDismiss={dismiss} children={dialogContents} />}
  </section>;
}
