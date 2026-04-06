import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ChevronLeft, CirclePlay, Disc, LayoutGrid, List, Music, Play, Plus, Search, Trash2, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { AppLanguage } from '../lib/copy';
import type { Song } from '../types/player';

export interface PlaylistCollection {
  id: string;
  name: string;
  updatedAt: number;
  songs: Song[];
}

export type LibrarySection = 'playlists' | 'all' | 'artists' | 'albums' | 'search';

interface LibraryProps {
  songs: Song[];
  playlists: PlaylistCollection[];
  isLoading: boolean;
  language: AppLanguage;
  section: LibrarySection;
  displayedPlaylist: PlaylistCollection | null;
  currentPlaybackPlaylistId: string | null;
  currentPlaybackIndex: number;
  onBackToPlaylistsOverview: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onPlaySongs: (songs: Song[], index: number, sourcePlaylistId?: string | null) => void;
  onAddSongToPlaylist: (song: Song) => void;
  onAddSongsToPlaylist: (songs: Song[]) => void;
  onPlaySelectedPlaylist: () => void;
  onRemoveSongFromPlaylist: (index: number) => void;
}

interface ArtistGroup {
  key: string;
  name: string;
  cover?: string;
  songs: Song[];
}

interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  cover?: string;
  songs: Song[];
}

type DetailState =
  | { type: 'artist'; key: string }
  | { type: 'album'; key: string }
  | null;

type AllSongsViewMode = 'grid' | 'list';

const getArtistName = (song: Song) => song.artist?.trim() || 'Unknown Artist';

const getAlbumName = (song: Song) => song.album?.trim() || 'Unknown Album';

const getSongCover = (songs: Song[]) => songs.find((song) => song.cover)?.cover;

const formatSongDuration = (duration?: number) => {
  if (!Number.isFinite(duration) || !duration || duration <= 0) return '--:--';

  const totalSeconds = Math.max(0, Math.floor(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const areSongsEqual = (left: Song, right: Song) => (
  left.title === right.title
  && left.artist === right.artist
  && left.album === right.album
  && left.cover === right.cover
  && left.duration === right.duration
  && left.file === right.file
  && left.lrc === right.lrc
);

const gridItemRenderStyle: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '240px 320px',
};

const listItemRenderStyle: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '76px 760px',
};

const SONG_GRID_CLASS_NAME = 'grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5';
const SONG_LIST_ROW_HEIGHT = 88;
const SONG_GRID_CARD_EXTRA_HEIGHT = 84;
const VIRTUALIZATION_OVERSCAN_ROWS = 4;
const LIST_VIRTUALIZATION_THRESHOLD = 80;
const GRID_VIRTUALIZATION_THRESHOLD = 120;
const OVERLAY_EASE = [0.22, 1, 0.36, 1] as const;
const OVERLAY_PANEL_TRANSITION = { duration: 0.36, ease: OVERLAY_EASE };
const OVERLAY_CONTENT_TRANSITION = { duration: 0.28, ease: OVERLAY_EASE };
const OVERLAY_RETURN_DELAY = 0.18;
const SHARED_ARTWORK_TRANSITION = { layout: { duration: 0.34, ease: OVERLAY_EASE } };

const matchesQuery = (song: Song, query: string) => {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;

  return [song.title, song.artist, song.album]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(keyword));
};

const sortSongs = (left: Song, right: Song) => left.title.localeCompare(right.title, 'zh-CN');

const formatPlaylistUpdatedAt = (updatedAt: number, language: AppLanguage) => {
  if (!updatedAt) {
    return language === 'zh-CN' ? '刚刚创建' : 'Just created';
  }

  const diff = Date.now() - updatedAt;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return language === 'zh-CN' ? '刚刚更新' : 'Updated just now';
  }

  if (diff < hour) {
    const value = Math.max(1, Math.floor(diff / minute));
    return language === 'zh-CN' ? `${value} 分钟前` : `${value} min ago`;
  }

  if (diff < day) {
    const value = Math.max(1, Math.floor(diff / hour));
    return language === 'zh-CN' ? `${value} 小时前` : `${value} hr ago`;
  }

  if (diff < day * 7) {
    const value = Math.max(1, Math.floor(diff / day));
    return language === 'zh-CN' ? `${value} 天前` : `${value} day${value === 1 ? '' : 's'} ago`;
  }

  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(updatedAt);
};

const collectionCopy = {
  'zh-CN': {
    playlists: '播放列表',
    allSongs: '所有歌曲',
    artists: '歌手',
    albums: '专辑',
    search: '搜索',
    explore: '管理你的音乐与播放列表',
    currentTarget: '当前添加目标',
    playPlaylist: '播放此列表',
    openPlaylist: '打开播放列表',
    addToPlaylist: '添加到播放列表',
    addAllSongs: '添加全部歌曲',
    addArtistSongs: '添加歌手全部歌曲',
    addAlbumSongs: '添加专辑全部歌曲',
    songs: (count: number) => `${count} 首歌曲`,
    playlistsCount: (count: number) => `${count} 个播放列表`,
    searchPlaylists: '搜索播放列表...',
    searchPlaylist: '搜索当前播放列表...',
    searchSongs: '搜索歌曲、歌手、专辑...',
    searchArtists: '搜索歌手...',
    searchAlbums: '搜索专辑...',
    searchLibrary: '搜索整个媒体库...',
    emptyPlaylist: '当前播放列表还没有歌曲',
    emptyPlaylists: '还没有创建播放列表',
    emptySongs: '没有找到歌曲',
    emptyArtists: '没有找到歌手',
    emptyAlbums: '没有找到专辑',
    emptySearch: '输入关键词开始搜索',
    noSearchResults: '没有匹配的搜索结果',
    artistSubtitle: (count: number) => `${count} 首歌`,
    albumSubtitle: (artist: string) => artist,
    back: '返回',
    searchResults: '搜索结果',
    searchResultsSubtitle: '按标题、歌手或专辑名称查找',
    allSongsSubtitle: '浏览全部本地歌曲',
    artistsSubtitle: '按歌手浏览并管理歌曲',
    albumsSubtitle: '按专辑浏览并管理歌曲',
    playlistSubtitle: '将常听歌曲组织到独立列表中',
    artistSongsLabel: '专辑',
    albumSongsLabel: '歌手',
    lastUpdated: '最近更新',
  },
  'en-US': {
    playlists: 'Playlists',
    allSongs: 'All Songs',
    artists: 'Artists',
    albums: 'Albums',
    search: 'Search',
    explore: 'Manage your music and playlists',
    currentTarget: 'Current add target',
    playPlaylist: 'Play Playlist',
    openPlaylist: 'Open Playlist',
    addToPlaylist: 'Add to Playlist',
    addAllSongs: 'Add All Songs',
    addArtistSongs: 'Add All Artist Songs',
    addAlbumSongs: 'Add All Album Songs',
    songs: (count: number) => `${count} tracks`,
    playlistsCount: (count: number) => `${count} playlists`,
    searchPlaylists: 'Search playlists...',
    searchPlaylist: 'Search this playlist...',
    searchSongs: 'Search songs, artists, albums...',
    searchArtists: 'Search artists...',
    searchAlbums: 'Search albums...',
    searchLibrary: 'Search the library...',
    emptyPlaylist: 'This playlist is empty',
    emptyPlaylists: 'No playlists yet',
    emptySongs: 'No songs found',
    emptyArtists: 'No artists found',
    emptyAlbums: 'No albums found',
    emptySearch: 'Type a keyword to search the library',
    noSearchResults: 'No matching results',
    artistSubtitle: (count: number) => `${count} tracks`,
    albumSubtitle: (artist: string) => artist,
    back: 'Back',
    searchResults: 'Search',
    searchResultsSubtitle: 'Find tracks by title, artist, or album',
    allSongsSubtitle: 'Browse every local track',
    artistsSubtitle: 'Browse artists and manage their songs',
    albumsSubtitle: 'Browse albums and manage their songs',
    playlistSubtitle: 'Organize the tracks you want to keep together',
    artistSongsLabel: 'Album',
    albumSongsLabel: 'Artist',
    lastUpdated: 'Updated',
  },
} as const;

const PlaylistArtwork: React.FC<{
  cover?: string;
  title: string;
  sizeClassName: string;
  iconSize: number;
}> = ({ cover, title, sizeClassName, iconSize }) => (
  <div className={cn('relative overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-white/8 via-white/3 to-transparent shadow-2xl', sizeClassName)}>
    {cover ? (
      <>
        <img src={cover} alt={title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent" />
      </>
    ) : (
      <div className="absolute inset-0 bg-radial-[circle_at_20%_20%] from-white/10 via-white/3 to-transparent">
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/45 to-transparent" />
        <div className="relative flex h-full w-full items-center justify-center">
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-xl">
            <Music size={iconSize} className="text-white/35" />
          </div>
        </div>
      </div>
    )}
  </div>
);

const SongCardComponent: React.FC<{
  song: Song;
  index: number;
  addLabel: string;
  animated?: boolean;
  onPlay: () => void;
  onAdd: () => void;
}> = ({ song, index, addLabel, animated = true, onPlay, onAdd }) => (
  <motion.div
    initial={animated ? { opacity: 0, y: 20 } : false}
    animate={{ opacity: 1, y: 0 }}
    transition={animated ? { delay: Math.min(index * 0.02, 0.35) } : undefined}
    className="group relative flex flex-col gap-2.5"
    style={gridItemRenderStyle}
  >
    <button type="button" className="text-left" onClick={onPlay}>
      <div className="aspect-square rounded-[1.35rem] overflow-hidden bg-white/5 relative shadow-xl group-hover:shadow-2xl transition-all duration-500 border border-white/5">
        {song.cover ? (
          <img src={song.cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={32} className="text-white/10 group-hover:scale-110 transition-transform duration-700" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-black shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </div>
        </div>
      </div>
    </button>

    <div className="flex items-start justify-between gap-2 px-0.5 min-w-0">
      <div className="min-w-0">
        <h3 className="text-[13px] leading-tight font-bold text-white truncate">{song.title}</h3>
        <p className="mt-0.5 text-[11px] text-white/40 truncate">{song.artist}</p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 mt-0.5 w-8 h-8 rounded-full border border-white/10 bg-white/5 text-white/65 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center"
        title={addLabel}
      >
        <Plus size={14} />
      </button>
    </div>
  </motion.div>
);

const SongCard = memo(SongCardComponent, (prev, next) => (
  prev.index === next.index
  && prev.addLabel === next.addLabel
  && prev.animated === next.animated
  && areSongsEqual(prev.song, next.song)
));

const CollectionCardComponent: React.FC<{
  title: string;
  subtitle: string;
  cover?: string;
  icon: React.ReactNode;
  index: number;
  artworkLayoutId?: string;
  onOpen: () => void;
}> = ({ title, subtitle, cover, icon, index, artworkLayoutId, onOpen }) => (
  <motion.button
    type="button"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: Math.min(index * 0.02, 0.35) }}
    className="group flex flex-col gap-2.5 text-left"
    onClick={onOpen}
    style={gridItemRenderStyle}
  >
    <motion.div
      layoutId={artworkLayoutId}
        transition={artworkLayoutId ? SHARED_ARTWORK_TRANSITION : undefined}
      className="aspect-square rounded-[1.35rem] overflow-hidden bg-white/5 relative shadow-xl group-hover:shadow-2xl transition-all duration-500 border border-white/5"
    >
      {cover ? (
        <img src={cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          {icon}
        </div>
      )}
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent opacity-60" />
    </motion.div>
    <div className="min-w-0 px-0.5">
      <h3 className="text-[13px] leading-tight font-bold text-white truncate">{title}</h3>
      <p className="mt-0.5 text-[11px] text-white/45 truncate">{subtitle}</p>
    </div>
  </motion.button>
);

const CollectionCard = memo(CollectionCardComponent, (prev, next) => (
  prev.index === next.index
  && prev.title === next.title
  && prev.subtitle === next.subtitle
  && prev.cover === next.cover
  && prev.artworkLayoutId === next.artworkLayoutId
));

const SongListItemComponent: React.FC<{
  song: Song;
  index: number;
  addLabel: string;
  animated?: boolean;
  isActive?: boolean;
  onPlay: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}> = ({ song, index, addLabel, animated = true, isActive = false, onPlay, onAdd, onRemove }) => (
  <motion.div
    initial={animated ? { opacity: 0, x: 20 } : false}
    animate={{ opacity: 1, x: 0 }}
    transition={animated ? { delay: Math.min(index * 0.03, 0.4) } : undefined}
    className={cn(
      'group w-full grid items-center gap-3 rounded-2xl px-4 py-3 transition-all',
      onRemove
        ? 'grid-cols-[3rem_minmax(0,1.8fr)_minmax(0,1.2fr)_4.25rem_2.75rem_2.75rem_2.75rem]'
        : 'grid-cols-[3rem_minmax(0,1.8fr)_minmax(0,1.2fr)_4.25rem_2.75rem_2.75rem]',
      isActive ? 'bg-white/10 border border-white/10' : 'hover:bg-white/5 border border-transparent'
    )}
    style={listItemRenderStyle}
  >
    <div className="relative h-12 w-12 overflow-hidden rounded-xl bg-white/5 shadow-lg">
      {song.cover ? (
        <img src={song.cover} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/20">
          <Music size={16} />
        </div>
      )}
    </div>

    <div className="min-w-0">
      <p className={cn('truncate text-sm font-semibold', isActive ? 'text-white' : 'text-white/85')}>{song.title}</p>
    </div>

    <div className="min-w-0">
      <p className="truncate text-sm text-white/55">{song.artist}</p>
    </div>

    <div className="text-right text-xs font-mono tracking-[0.16em] text-white/42">
      {formatSongDuration(song.duration)}
    </div>

    {onAdd ? (
      <button
        type="button"
        onClick={onAdd}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
        title={addLabel}
      >
        <Plus size={16} />
      </button>
    ) : (
      <div />
    )}

    <button
      type="button"
      onClick={onPlay}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full border transition-all',
        isActive
          ? 'border-white bg-white text-black'
          : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
      )}
      title="Play"
    >
      <Play size={16} fill="currentColor" className="ml-0.5" />
    </button>

    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/45 transition-all hover:bg-white/10 hover:text-red-300"
        title="Remove"
      >
        <Trash2 size={15} />
      </button>
    )}
  </motion.div>
);

const SongListItem = memo(SongListItemComponent, (prev, next) => (
  prev.index === next.index
  && prev.addLabel === next.addLabel
  && prev.animated === next.animated
  && prev.isActive === next.isActive
  && Boolean(prev.onAdd) === Boolean(next.onAdd)
  && Boolean(prev.onRemove) === Boolean(next.onRemove)
  && areSongsEqual(prev.song, next.song)
));

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div className="min-h-80 rounded-4xl border border-white/10 bg-black/15 backdrop-blur-2xl customizable-backdrop-medium flex flex-col items-center justify-center gap-4 text-center text-white/35 px-6">
    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">{icon}</div>
    <div>
      <p className="text-xl font-bold text-white/70">{title}</p>
      {subtitle && <p className="text-sm text-white/35 mt-2">{subtitle}</p>}
    </div>
  </div>
);

interface VirtualWindowOptions {
  enabled: boolean;
  itemCount: number;
  itemsPerRow?: number;
  overscanRows?: number;
  rowHeight: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

const useVirtualWindow = ({
  enabled,
  itemCount,
  itemsPerRow = 1,
  overscanRows = VIRTUALIZATION_OVERSCAN_ROWS,
  rowHeight,
  scrollContainerRef,
}: VirtualWindowOptions) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [windowState, setWindowState] = useState({
    startIndex: 0,
    endIndex: itemCount,
    paddingTop: 0,
    paddingBottom: 0,
  });

  const updateWindow = useCallback(() => {
    if (!enabled || itemCount === 0 || !wrapperRef.current || !scrollContainerRef.current) {
      setWindowState({
        startIndex: 0,
        endIndex: itemCount,
        paddingTop: 0,
        paddingBottom: 0,
      });
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const wrapper = wrapperRef.current;
    const wrapperTop = wrapper.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
    const visibleTop = Math.max(0, scrollContainer.scrollTop - wrapperTop);
    const visibleBottom = visibleTop + scrollContainer.clientHeight;
    const totalRows = Math.ceil(itemCount / itemsPerRow);
    const startRow = Math.max(0, Math.floor(visibleTop / rowHeight) - overscanRows);
    const endRow = Math.min(totalRows, Math.ceil(visibleBottom / rowHeight) + overscanRows);
    const startIndex = Math.min(itemCount, startRow * itemsPerRow);
    const endIndex = Math.min(itemCount, Math.max(startIndex + itemsPerRow, endRow * itemsPerRow));
    const paddingTop = startRow * rowHeight;
    const paddingBottom = Math.max(0, (totalRows - endRow) * rowHeight);

    setWindowState((current) => (
      current.startIndex === startIndex
      && current.endIndex === endIndex
      && current.paddingTop === paddingTop
      && current.paddingBottom === paddingBottom
        ? current
        : { startIndex, endIndex, paddingTop, paddingBottom }
    ));
  }, [enabled, itemCount, itemsPerRow, overscanRows, rowHeight, scrollContainerRef]);

  useEffect(() => {
    updateWindow();

    if (!enabled || !scrollContainerRef.current) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const handleScroll = () => updateWindow();

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleScroll);
      };
    }

    const observer = new ResizeObserver(() => updateWindow());
    observer.observe(scrollContainer);
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      observer.disconnect();
    };
  }, [enabled, scrollContainerRef, updateWindow]);

  return {
    wrapperRef,
    ...windowState,
  };
};

interface VirtualSongListProps {
  addLabel: string;
  disableItemAnimation?: boolean;
  getIsActive?: (song: Song, index: number) => boolean;
  getKey: (song: Song, index: number) => string;
  onAddSong?: (song: Song, index: number) => void;
  onPlaySong: (song: Song, index: number) => void;
  onRemoveSong?: (song: Song, index: number) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  songs: Song[];
  virtualizationThreshold?: number;
}

const VirtualSongList: React.FC<VirtualSongListProps> = ({
  addLabel,
  disableItemAnimation = false,
  getIsActive,
  getKey,
  onAddSong,
  onPlaySong,
  onRemoveSong,
  scrollContainerRef,
  songs,
  virtualizationThreshold = LIST_VIRTUALIZATION_THRESHOLD,
}) => {
  const shouldVirtualize = songs.length > virtualizationThreshold;
  const { wrapperRef, startIndex, endIndex, paddingTop, paddingBottom } = useVirtualWindow({
    enabled: shouldVirtualize,
    itemCount: songs.length,
    rowHeight: SONG_LIST_ROW_HEIGHT,
    scrollContainerRef,
  });

  const visibleSongs = shouldVirtualize ? songs.slice(startIndex, endIndex) : songs;

  return (
    <div ref={wrapperRef} className="pb-4">
      {shouldVirtualize && paddingTop > 0 && <div style={{ height: paddingTop }} />}
      <div className="space-y-2">
        {visibleSongs.map((song, offset) => {
          const index = shouldVirtualize ? startIndex + offset : offset;

          return (
            <SongListItem
              key={getKey(song, index)}
              song={song}
              index={index}
              addLabel={addLabel}
              animated={!disableItemAnimation && !shouldVirtualize}
              isActive={getIsActive?.(song, index) ?? false}
              onPlay={() => onPlaySong(song, index)}
              onAdd={onAddSong ? () => onAddSong(song, index) : undefined}
              onRemove={onRemoveSong ? () => onRemoveSong(song, index) : undefined}
            />
          );
        })}
      </div>
      {shouldVirtualize && paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
    </div>
  );
};

interface VirtualSongGridProps {
  addLabel: string;
  getKey: (song: Song, index: number) => string;
  onAddSong: (song: Song, index: number) => void;
  onPlaySong: (song: Song, index: number) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  songs: Song[];
}

const VirtualSongGrid: React.FC<VirtualSongGridProps> = ({
  addLabel,
  getKey,
  onAddSong,
  onPlaySong,
  scrollContainerRef,
  songs,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const updateContainerWidth = () => setContainerWidth(scrollContainer.clientWidth);
    updateContainerWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateContainerWidth);
      return () => window.removeEventListener('resize', updateContainerWidth);
    }

    const observer = new ResizeObserver(() => updateContainerWidth());
    observer.observe(scrollContainer);

    return () => observer.disconnect();
  }, [scrollContainerRef]);

  const gridMetrics = useMemo(() => {
    const effectiveWidth = containerWidth || 1200;
    const columns = effectiveWidth >= 1536 ? 6 : effectiveWidth >= 1280 ? 5 : 4;
    const gap = effectiveWidth >= 1280 ? 20 : 16;
    const columnWidth = Math.max(160, (effectiveWidth - gap * (columns - 1)) / columns);

    return {
      columns,
      rowHeight: columnWidth + SONG_GRID_CARD_EXTRA_HEIGHT,
    };
  }, [containerWidth]);

  const shouldVirtualize = songs.length > GRID_VIRTUALIZATION_THRESHOLD;
  const { wrapperRef, startIndex, endIndex, paddingTop, paddingBottom } = useVirtualWindow({
    enabled: shouldVirtualize,
    itemCount: songs.length,
    itemsPerRow: gridMetrics.columns,
    rowHeight: gridMetrics.rowHeight,
    scrollContainerRef,
  });

  const visibleSongs = shouldVirtualize ? songs.slice(startIndex, endIndex) : songs;

  return (
    <div ref={wrapperRef} className="pb-4">
      {shouldVirtualize && paddingTop > 0 && <div style={{ height: paddingTop }} />}
      <div className={SONG_GRID_CLASS_NAME}>
        {visibleSongs.map((song, offset) => {
          const index = shouldVirtualize ? startIndex + offset : offset;

          return (
            <SongCard
              key={getKey(song, index)}
              song={song}
              index={index}
              addLabel={addLabel}
              animated={!shouldVirtualize}
              onPlay={() => onPlaySong(song, index)}
              onAdd={() => onAddSong(song, index)}
            />
          );
        })}
      </div>
      {shouldVirtualize && paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
    </div>
  );
};

export const Library: React.FC<LibraryProps> = ({
  songs,
  playlists,
  isLoading,
  language,
  section,
  displayedPlaylist,
  currentPlaybackPlaylistId,
  currentPlaybackIndex,
  onBackToPlaylistsOverview,
  onOpenPlaylist,
  onPlaySongs,
  onAddSongToPlaylist,
  onAddSongsToPlaylist,
  onPlaySelectedPlaylist,
  onRemoveSongFromPlaylist,
}) => {
  const copy = collectionCopy[language];
  const [detailState, setDetailState] = useState<DetailState>(null);
  const [allSongsViewMode, setAllSongsViewMode] = useState<AllSongsViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollUiState, setScrollUiState] = useState({
    headerCollapseProgress: 0,
    showTopEdgeBlur: false,
    showBottomEdgeBlur: false,
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const artistOverlayScrollRef = useRef<HTMLDivElement>(null);
  const albumOverlayScrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollStateRef = useRef(scrollUiState);
  const viewScrollMemoryRef = useRef<Record<string, number>>({});
  const previousViewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setDetailState(null);
    setSearchQuery('');
  }, [section]);

  const allSongs = useMemo(() => [...songs].sort(sortSongs), [songs]);

  const artistGroups = useMemo<ArtistGroup[]>(() => {
    const groups = new Map<string, ArtistGroup>();

    songs.forEach((song) => {
      const artist = getArtistName(song);
      const key = artist.toLowerCase();
      const current = groups.get(key);

      if (current) {
        current.songs.push(song);
        if (!current.cover && song.cover) {
          current.cover = song.cover;
        }
      } else {
        groups.set(key, {
          key,
          name: artist,
          cover: song.cover,
          songs: [song],
        });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({ ...group, songs: [...group.songs].sort(sortSongs), cover: group.cover || getSongCover(group.songs) }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [songs]);

  const albumGroups = useMemo<AlbumGroup[]>(() => {
    const groups = new Map<string, AlbumGroup>();

    songs.forEach((song) => {
      const artist = getArtistName(song);
      const album = getAlbumName(song);
      const key = `${artist.toLowerCase()}::${album.toLowerCase()}`;
      const current = groups.get(key);

      if (current) {
        current.songs.push(song);
        if (!current.cover && song.cover) {
          current.cover = song.cover;
        }
      } else {
        groups.set(key, {
          key,
          name: album,
          artist,
          cover: song.cover,
          songs: [song],
        });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({ ...group, songs: [...group.songs].sort(sortSongs), cover: group.cover || getSongCover(group.songs) }))
      .sort((left, right) => {
        const artistCompare = left.artist.localeCompare(right.artist, 'zh-CN');
        return artistCompare !== 0 ? artistCompare : left.name.localeCompare(right.name, 'zh-CN');
      });
  }, [songs]);

  const activeArtistGroup = useMemo(
    () => (detailState?.type === 'artist' ? artistGroups.find((group) => group.key === detailState.key) ?? null : null),
    [artistGroups, detailState]
  );

  const activeAlbumGroup = useMemo(
    () => (detailState?.type === 'album' ? albumGroups.find((group) => group.key === detailState.key) ?? null : null),
    [albumGroups, detailState]
  );

  const detailSongs = useMemo(() => {
    const sourceSongs = activeArtistGroup?.songs || activeAlbumGroup?.songs || [];
    return sourceSongs.filter((song) => matchesQuery(song, deferredSearchQuery));
  }, [activeArtistGroup, activeAlbumGroup, deferredSearchQuery]);

  const visibleArtists = useMemo(() => {
    if (!deferredSearchQuery.trim()) return artistGroups;
    return artistGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
        group.songs.some((song) => matchesQuery(song, deferredSearchQuery))
    );
  }, [artistGroups, deferredSearchQuery]);

  const visibleAlbums = useMemo(() => {
    if (!deferredSearchQuery.trim()) return albumGroups;
    return albumGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
        group.artist.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
        group.songs.some((song) => matchesQuery(song, deferredSearchQuery))
    );
  }, [albumGroups, deferredSearchQuery]);

  const filteredAllSongs = useMemo(() => allSongs.filter((song) => matchesQuery(song, deferredSearchQuery)), [allSongs, deferredSearchQuery]);
  const filteredPlaylistSongs = useMemo(
    () => (displayedPlaylist?.songs || []).filter((song) => matchesQuery(song, deferredSearchQuery)),
    [displayedPlaylist, deferredSearchQuery]
  );
  const visiblePlaylists = useMemo(() => {
    const keyword = deferredSearchQuery.trim().toLowerCase();
    const filtered = keyword
      ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(keyword))
      : playlists;

    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, 'zh-CN'));
  }, [playlists, deferredSearchQuery]);
  const searchResults = useMemo(
    () => (deferredSearchQuery.trim() ? allSongs.filter((song) => matchesQuery(song, deferredSearchQuery)) : []),
    [allSongs, deferredSearchQuery]
  );

  const pageTitle = (() => {
    if (section === 'playlists') return displayedPlaylist?.name || copy.playlists;
    if (section === 'all') return copy.allSongs;
    if (section === 'artists') return copy.artists;
    if (section === 'albums') return copy.albums;
    return copy.searchResults;
  })();

  const pageSubtitle = (() => {
    if (section === 'playlists') {
      return displayedPlaylist ? copy.songs(displayedPlaylist.songs.length) : copy.playlistsCount(playlists.length);
    }
    if (section === 'all') return copy.allSongsSubtitle;
    if (section === 'artists') return copy.artistsSubtitle;
    if (section === 'albums') return copy.albumsSubtitle;
    return copy.searchResultsSubtitle;
  })();

  const searchPlaceholder = (() => {
    if (section === 'playlists') return displayedPlaylist ? copy.searchPlaylist : copy.searchPlaylists;
    if (section === 'artists') return copy.searchArtists;
    if (section === 'albums') return copy.searchAlbums;
    if (section === 'search') return copy.searchLibrary;
    return copy.searchSongs;
  })();

  const currentViewKey = useMemo(() => {
    if (section === 'playlists') {
      return displayedPlaylist ? `playlists:detail:${displayedPlaylist.id}` : 'playlists:overview';
    }

    if (section === 'artists') {
      return 'artists:overview';
    }

    if (section === 'albums') {
      return 'albums:overview';
    }

    if (section === 'all') {
      return `all:songs:${allSongsViewMode}`;
    }

    return 'search:results';
  }, [allSongsViewMode, displayedPlaylist, section]);

  const shouldShowContentEdgeBlur = !isLoading && (section === 'all' || section === 'artists' || section === 'albums');
  const shouldShowLoadingState = isLoading && songs.length === 0;
  const { headerCollapseProgress, showTopEdgeBlur, showBottomEdgeBlur } = scrollUiState;

  const updateScrollMetrics = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const nextMaxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nextState = {
      headerCollapseProgress: Math.round(Math.min(node.scrollTop / 120, 1) * 12) / 12,
      showTopEdgeBlur: shouldShowContentEdgeBlur && node.scrollTop > 12,
      showBottomEdgeBlur: shouldShowContentEdgeBlur && nextMaxScrollTop - node.scrollTop > 12,
    };

    const previousState = scrollStateRef.current;
    if (
      previousState.headerCollapseProgress === nextState.headerCollapseProgress
      && previousState.showTopEdgeBlur === nextState.showTopEdgeBlur
      && previousState.showBottomEdgeBlur === nextState.showBottomEdgeBlur
    ) {
      return;
    }

    scrollStateRef.current = nextState;
    setScrollUiState(nextState);
  }, [shouldShowContentEdgeBlur]);

  const scheduleScrollMetricsUpdate = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateScrollMetrics(node);
    });
  }, [updateScrollMetrics]);

  useEffect(() => {
    const scrollNode = scrollContainerRef.current;
    if (!scrollNode) return;

    const previousViewKey = previousViewKeyRef.current;
    if (previousViewKey && previousViewKey !== currentViewKey) {
      viewScrollMemoryRef.current[previousViewKey] = scrollNode.scrollTop;
    }

    previousViewKeyRef.current = currentViewKey;

    const restoreScrollTop = viewScrollMemoryRef.current[currentViewKey] ?? 0;
    const frameId = window.requestAnimationFrame(() => {
      scrollNode.scrollTo({ top: restoreScrollTop, behavior: 'auto' });

      const resetState = {
        headerCollapseProgress: Math.round(Math.min(restoreScrollTop / 120, 1) * 12) / 12,
        showTopEdgeBlur: shouldShowContentEdgeBlur && restoreScrollTop > 12,
        showBottomEdgeBlur: shouldShowContentEdgeBlur,
      };

      scrollStateRef.current = resetState;
      setScrollUiState(resetState);
      scheduleScrollMetricsUpdate(scrollNode);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [currentViewKey, scheduleScrollMetricsUpdate, shouldShowContentEdgeBlur]);

  useEffect(() => {
    const scrollNode = scrollContainerRef.current;
    if (!scrollNode) return;

    const frameId = window.requestAnimationFrame(() => {
      updateScrollMetrics(scrollNode);
    });

    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(frameId);
    }

    const observer = new ResizeObserver(() => {
      scheduleScrollMetricsUpdate(scrollNode);
    });

    observer.observe(scrollNode);
    Array.from(scrollNode.children).forEach((child) => observer.observe(child as Element));

    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [
    currentViewKey,
    detailSongs.length,
    detailState?.key,
    detailState?.type,
    displayedPlaylist?.id,
    filteredAllSongs.length,
    filteredPlaylistSongs.length,
    deferredSearchQuery,
    searchResults.length,
    section,
    songs.length,
    updateScrollMetrics,
    visibleAlbums.length,
    visibleArtists.length,
    scheduleScrollMetricsUpdate,
  ]);

  const renderTopBar = (showBack = false, onBack?: () => void, actionSlot?: React.ReactNode) => (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3" style={{ marginBottom: `${8 - headerCollapseProgress * 4}px` }}>
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-10 rounded-full border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 px-4 shrink-0"
            >
              <ChevronLeft size={18} />
              <span className="text-sm font-semibold">{copy.back}</span>
            </button>
          )}
          <motion.h1
            className="text-4xl md:text-5xl font-black tracking-tighter text-white uppercase truncate"
            style={{ scale: 1 - headerCollapseProgress * 0.18, transformOrigin: 'left top' }}
          >
            {pageTitle}
          </motion.h1>
        </div>
        <motion.p
          className="text-white/40 font-mono text-xs tracking-widest uppercase"
          style={{
            opacity: 1 - headerCollapseProgress * 0.35,
            scale: 1 - headerCollapseProgress * 0.06,
            transformOrigin: 'left top',
          }}
        >
          {pageSubtitle}
        </motion.p>
      </div>
      {actionSlot}
    </div>
  );

  const renderSearchBox = () => (
    <div className="relative group w-full">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-white/60 transition-colors" size={18} />
      <input
        type="text"
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        className={cn(
          'w-full bg-white/5 border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all backdrop-blur-md customizable-backdrop-soft',
          headerCollapseProgress > 0.35 ? 'rounded-[1.1rem] py-3 pl-12 pr-5' : 'rounded-2xl py-4 pl-12 pr-6'
        )}
      />
    </div>
  );

  const renderHeaderBlock = (showBack = false, onBack?: () => void, actionSlot?: React.ReactNode) => (
    <div className="shrink-0 pb-4 md:pb-5">
      <div className="flex flex-col gap-4">
        {renderTopBar(showBack, onBack, actionSlot)}
        {renderSearchBox()}
      </div>
    </div>
  );

  const renderPlaylistSection = () => {
    if (!displayedPlaylist) {
      return (
        <>
          {visiblePlaylists.length === 0 ? (
            <EmptyState icon={<Music size={28} />} title={copy.emptyPlaylists} subtitle={copy.playlistSubtitle} />
          ) : (
            <div className="space-y-3 pb-4">
              {visiblePlaylists.map((playlist, index) => (
                <motion.button
                  key={playlist.id}
                  type="button"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.35) }}
                  onClick={() => onOpenPlaylist(playlist.id)}
                  className="group relative w-full overflow-hidden rounded-4xl border border-white/10 bg-black/15 px-5 py-5 text-left backdrop-blur-2xl customizable-backdrop-medium transition-all hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/6 hover:shadow-2xl"
                >
                  <div className="absolute inset-0 bg-linear-to-r from-white/4 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="relative flex items-center gap-5">
                    <PlaylistArtwork
                      cover={playlist.songs[0]?.cover}
                      title={playlist.name}
                      sizeClassName="h-20 w-20 shrink-0 md:h-24 md:w-24"
                      iconSize={24}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="mb-3 text-xs font-mono uppercase tracking-[0.22em] text-white/28">{copy.playlists}</p>
                      <h2 className="text-2xl font-black tracking-tight text-white truncate">{playlist.name}</h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                          {copy.songs(playlist.songs.length)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/55">
                          {copy.lastUpdated}: {formatPlaylistUpdatedAt(playlist.updatedAt, language)}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-3">
                      <div className="hidden md:block text-right">
                        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/28">{copy.lastUpdated}</p>
                        <p className="mt-1 text-sm text-white/50">{formatPlaylistUpdatedAt(playlist.updatedAt, language)}</p>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/55 transition-all duration-300 group-hover:translate-x-0.5 group-hover:bg-white/10 group-hover:text-white">
                        <ChevronLeft size={18} className="rotate-180" />
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </>
      );
    }

    const playlistCover = displayedPlaylist.songs[0]?.cover;
    const updatedLabel = formatPlaylistUpdatedAt(displayedPlaylist.updatedAt, language);

    return (
      <>
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onBackToPlaylistsOverview}
                className="h-10 rounded-full border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 px-4 shrink-0"
              >
                <ChevronLeft size={18} />
                <span className="text-sm font-semibold">{copy.back}</span>
              </button>
              <p className="mt-3 text-white/40 font-mono text-xs tracking-widest uppercase">{copy.songs(displayedPlaylist.songs.length)}</p>
            </div>
          </div>
        </div>

        <div className="group mb-8 rounded-4xl border border-white/10 bg-black/15 p-5 md:p-6 backdrop-blur-2xl customizable-backdrop-medium transition-all hover:border-white/15 hover:bg-white/4 hover:shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5 md:gap-6">
            <PlaylistArtwork
              cover={playlistCover}
              title={displayedPlaylist.name}
              sizeClassName="h-32 w-32 shrink-0 md:h-36 md:w-36"
              iconSize={34}
            />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono uppercase tracking-[0.22em] text-white/35 mb-3">{copy.playlists}</p>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight text-white truncate">{displayedPlaylist.name}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                  {copy.songs(displayedPlaylist.songs.length)}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/55">
                  {copy.lastUpdated}: {updatedLabel}
                </span>
              </div>
            </div>

            <div className="md:self-stretch flex items-center md:justify-end">
              <button
                type="button"
                onClick={onPlaySelectedPlaylist}
                disabled={displayedPlaylist.songs.length === 0}
                className="min-w-42 rounded-3xl px-5 py-4 bg-white text-black text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_20px_55px_rgba(255,255,255,0.16)] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:translate-y-0 flex items-center justify-center gap-2 shadow-xl"
              >
                <CirclePlay size={18} />
                {copy.playPlaylist}
              </button>
            </div>
          </div>
        </div>

        {renderSearchBox()}
        {filteredPlaylistSongs.length === 0 ? (
          <EmptyState icon={<Music size={28} />} title={copy.emptyPlaylist} />
        ) : (
          <VirtualSongList
            songs={filteredPlaylistSongs}
            scrollContainerRef={scrollContainerRef}
            addLabel={copy.addToPlaylist}
            getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
            getIsActive={(song) => {
              const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
              return currentPlaybackPlaylistId === displayedPlaylist.id && currentPlaybackIndex === originalIndex;
            }}
            onPlaySong={(song) => {
              const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
              onPlaySongs(displayedPlaylist.songs, originalIndex, displayedPlaylist.id);
            }}
            onRemoveSong={(song) => {
              const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
              onRemoveSongFromPlaylist(originalIndex);
            }}
          />
        )}
      </>
    );
  };

  const renderAllSongsSection = () => (
    <>
      {filteredAllSongs.length === 0 ? (
        <EmptyState icon={<Music size={28} />} title={copy.emptySongs} />
      ) : allSongsViewMode === 'list' ? (
        <VirtualSongList
          songs={filteredAllSongs}
          scrollContainerRef={scrollContainerRef}
          addLabel={copy.addToPlaylist}
          getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
          onPlaySong={(_, index) => onPlaySongs(filteredAllSongs, index, null)}
          onAddSong={(song) => onAddSongToPlaylist(song)}
        />
      ) : (
        <VirtualSongGrid
          songs={filteredAllSongs}
          scrollContainerRef={scrollContainerRef}
          addLabel={copy.addToPlaylist}
          getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
          onPlaySong={(_, index) => onPlaySongs(filteredAllSongs, index, null)}
          onAddSong={(song) => onAddSongToPlaylist(song)}
        />
      )}
    </>
  );

  const renderArtistSection = () => (
    <>
      {visibleArtists.length === 0 ? (
        <EmptyState icon={<User size={28} />} title={copy.emptyArtists} />
      ) : (
        <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5 pb-4">
          {visibleArtists.map((group, index) => (
            <CollectionCard
              key={group.key}
              title={group.name}
              subtitle={copy.artistSubtitle(group.songs.length)}
              cover={group.cover}
              icon={<User size={40} />}
              index={index}
              artworkLayoutId={`artist-artwork-${group.key}`}
              onOpen={() => setDetailState({ type: 'artist', key: group.key })}
            />
          ))}
        </div>
      )}
    </>
  );

  const renderAlbumSection = () => (
    <>
      {visibleAlbums.length === 0 ? (
        <EmptyState icon={<Disc size={28} />} title={copy.emptyAlbums} />
      ) : (
        <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5 pb-4">
          {visibleAlbums.map((group, index) => (
            <CollectionCard
              key={group.key}
              title={group.name}
              subtitle={copy.albumSubtitle(group.artist)}
              cover={group.cover}
              icon={<Disc size={40} />}
              index={index}
              artworkLayoutId={`album-artwork-${group.key}`}
              onOpen={() => setDetailState({ type: 'album', key: group.key })}
            />
          ))}
        </div>
      )}
    </>
  );

  const renderSearchSection = () => (
    <>
      {!searchQuery.trim() ? (
        <EmptyState icon={<Search size={28} />} title={copy.emptySearch} subtitle={copy.searchResultsSubtitle} />
      ) : searchResults.length === 0 ? (
        <EmptyState icon={<Search size={28} />} title={copy.noSearchResults} />
      ) : (
        <VirtualSongList
          songs={searchResults}
          scrollContainerRef={scrollContainerRef}
          addLabel={copy.addToPlaylist}
          getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
          onPlaySong={(_, index) => onPlaySongs(searchResults, index, null)}
          onAddSong={(song) => onAddSongToPlaylist(song)}
        />
      )}
    </>
  );

  const renderAlbumOverlay = () => {
    const overlayBackground = activeAlbumGroup
      ? (activeAlbumGroup.cover || getSongCover(activeAlbumGroup.songs))
      : undefined;

    return (
      <AnimatePresence>
        {section === 'albums' && activeAlbumGroup && (
        <motion.div
          key={`album-overlay-${activeAlbumGroup.key}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.26 } }}
          exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY + 0.1, duration: 0.24 } }}
          className="absolute inset-0 z-40 p-4 md:p-6"
        >
          {overlayBackground && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-[-60px] bg-cover bg-center blur-[50px] brightness-[0.55]"
                style={{ backgroundImage: `url(${overlayBackground})` }}
              />
            </div>
          )}
          <div className="absolute inset-0 bg-black/28 backdrop-blur-xl customizable-backdrop-medium" />
          <button
            type="button"
            aria-label="Close album overlay"
            onClick={() => setDetailState(null)}
            className="absolute inset-0"
          />

          <motion.div
            layoutId={`album-artwork-${activeAlbumGroup.key}`}
            transition={SHARED_ARTWORK_TRANSITION}
            className="pointer-events-none absolute left-10 top-[6.4rem] z-50 aspect-square w-[min(14rem,calc(100vw-5rem))] overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 shadow-[0_26px_70px_rgba(0,0,0,0.38)] transform-gpu will-change-transform md:left-14 md:top-[7.2rem] md:w-[14rem]"
          >
            {activeAlbumGroup.cover ? (
              <img
                src={activeAlbumGroup.cover}
                alt={activeAlbumGroup.name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">
                <Disc size={72} />
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.985, y: 34 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY, duration: 0.22, ease: OVERLAY_EASE } }}
            transition={OVERLAY_PANEL_TRANSITION}
            className="relative flex h-full flex-col gap-6 overflow-visible rounded-[2.1rem] border border-white/10 bg-black/32 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-3xl customizable-backdrop-strong md:p-8"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2.1rem]">
              {overlayBackground && (
                <div
                  className="absolute inset-0 scale-110 bg-cover bg-center opacity-18 blur-[76px]"
                  style={{ backgroundImage: `url(${overlayBackground})` }}
                />
              )}
              <div className="absolute inset-0 bg-linear-to-br from-white/10 via-black/12 to-black/36" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY, duration: 0.18, ease: OVERLAY_EASE } }}
              transition={{ delay: 0.04, ...OVERLAY_CONTENT_TRANSITION }}
              className="relative flex flex-col gap-5"
            >
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setDetailState(null)}
                  className="h-11 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/75 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2"
                >
                  <ChevronLeft size={18} />
                  <span>{copy.back}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onAddSongsToPlaylist(activeAlbumGroup.songs)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2"
                >
                  <Plus size={16} />
                  <span>{copy.addAlbumSongs}</span>
                </button>
              </div>

              <div className="flex flex-col items-start gap-5 lg:flex-row lg:items-end">
                <div className="aspect-square w-full max-w-[14rem] shrink-0 opacity-0" aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono uppercase tracking-[0.24em] text-white/35">{copy.albums}</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{activeAlbumGroup.name}</h2>
                  <p className="mt-1 text-sm text-white/60">{activeAlbumGroup.artist}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                      {copy.songs(activeAlbumGroup.songs.length)}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.995 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
              transition={{ delay: 0.12, ...OVERLAY_CONTENT_TRANSITION }}
              className="relative z-10 min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-white/8 bg-black/22 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.018)]"
            >
              <div ref={albumOverlayScrollRef} className="h-full overflow-y-auto px-3 py-3 scrollbar-hide md:px-4 md:py-4">
                {detailSongs.length === 0 ? (
                  <EmptyState icon={<Disc size={28} />} title={copy.emptySongs} />
                ) : (
                  <VirtualSongList
                    songs={detailSongs}
                    scrollContainerRef={albumOverlayScrollRef}
                    addLabel={copy.addToPlaylist}
                    disableItemAnimation={true}
                    getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
                    onPlaySong={(_, index) => onPlaySongs(detailSongs, index, null)}
                    onAddSong={(song) => onAddSongToPlaylist(song)}
                    virtualizationThreshold={18}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    );
  };

  const renderArtistOverlay = () => {
    const overlayBackground = activeArtistGroup
      ? (activeArtistGroup.cover || getSongCover(activeArtistGroup.songs))
      : undefined;

    return (
      <AnimatePresence>
        {section === 'artists' && activeArtistGroup && (
        <motion.div
          key={`artist-overlay-${activeArtistGroup.key}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.26 } }}
          exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY + 0.1, duration: 0.24 } }}
          className="absolute inset-0 z-40 p-4 md:p-6"
        >
          {overlayBackground && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-[-60px] bg-cover bg-center blur-[50px] brightness-[0.55]"
                style={{ backgroundImage: `url(${overlayBackground})` }}
              />
            </div>
          )}
          <div className="absolute inset-0 bg-black/28 backdrop-blur-xl customizable-backdrop-medium" />
          <button
            type="button"
            aria-label="Close artist overlay"
            onClick={() => setDetailState(null)}
            className="absolute inset-0"
          />

          <motion.div
            layoutId={`artist-artwork-${activeArtistGroup.key}`}
            transition={SHARED_ARTWORK_TRANSITION}
            className="pointer-events-none absolute left-10 top-[6.4rem] z-50 aspect-square w-[min(14rem,calc(100vw-5rem))] overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 shadow-[0_26px_70px_rgba(0,0,0,0.38)] transform-gpu will-change-transform md:left-14 md:top-[7.2rem] md:w-[14rem]"
          >
            {activeArtistGroup.cover ? (
              <img
                src={activeArtistGroup.cover}
                alt={activeArtistGroup.name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">
                <User size={72} />
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.985, y: 34 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY, duration: 0.22, ease: OVERLAY_EASE } }}
            transition={OVERLAY_PANEL_TRANSITION}
            className="relative flex h-full flex-col gap-6 overflow-visible rounded-[2.1rem] border border-white/10 bg-black/32 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-3xl customizable-backdrop-strong md:p-8"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2.1rem]">
              {overlayBackground && (
                <div
                  className="absolute inset-0 scale-110 bg-cover bg-center opacity-18 blur-[76px]"
                  style={{ backgroundImage: `url(${overlayBackground})` }}
                />
              )}
              <div className="absolute inset-0 bg-linear-to-br from-white/10 via-black/12 to-black/36" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { delay: OVERLAY_RETURN_DELAY, duration: 0.18, ease: OVERLAY_EASE } }}
              transition={{ delay: 0.04, ...OVERLAY_CONTENT_TRANSITION }}
              className="relative flex flex-col gap-5"
            >
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setDetailState(null)}
                  className="h-11 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/75 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2 shrink-0"
                >
                  <ChevronLeft size={18} />
                  <span>{copy.back}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onAddSongsToPlaylist(activeArtistGroup.songs)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2"
                >
                  <Plus size={16} />
                  <span>{copy.addArtistSongs}</span>
                </button>
              </div>

              <div className="flex flex-col items-start gap-5 lg:flex-row lg:items-end">
                <div className="aspect-square w-full max-w-[14rem] shrink-0 opacity-0" aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono uppercase tracking-[0.24em] text-white/35">{copy.artists}</p>
                  <h2 className="mt-2 truncate text-3xl font-black tracking-tight text-white md:text-5xl">{activeArtistGroup.name}</h2>
                  <p className="mt-2 text-sm text-white/60">{copy.artistSubtitle(activeArtistGroup.songs.length)}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                      {copy.songs(activeArtistGroup.songs.length)}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.995 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
              transition={{ delay: 0.12, ...OVERLAY_CONTENT_TRANSITION }}
              className="relative z-10 min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-white/8 bg-black/22 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.018)]"
            >
              <div ref={artistOverlayScrollRef} className="h-full overflow-y-auto px-3 py-3 scrollbar-hide md:px-4 md:py-4">
                {detailSongs.length === 0 ? (
                  <EmptyState icon={<User size={28} />} title={copy.emptySongs} />
                ) : (
                  <VirtualSongList
                    songs={detailSongs}
                    scrollContainerRef={artistOverlayScrollRef}
                    addLabel={copy.addToPlaylist}
                    disableItemAnimation={true}
                    getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
                    onPlaySong={(_, index) => onPlaySongs(detailSongs, index, null)}
                    onAddSong={(song) => onAddSongToPlaylist(song)}
                    virtualizationThreshold={18}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    );
  };

  const renderSectionHeader = () => {
    if (section === 'playlists' && displayedPlaylist) {
      return null;
    }

    if (section === 'all') {
      return renderHeaderBlock(false, undefined, (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setAllSongsViewMode('grid')}
            className={cn(
              'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
              allSongsViewMode === 'grid'
                ? 'bg-white text-black border-white shadow-lg'
                : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
            )}
          >
            <LayoutGrid size={16} />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setAllSongsViewMode('list')}
            className={cn(
              'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
              allSongsViewMode === 'list'
                ? 'bg-white text-black border-white shadow-lg'
                : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
            )}
          >
            <List size={16} />
            <span>List</span>
          </button>
        </div>
      ));
    }

    return renderHeaderBlock();
  };

  return (
    <LayoutGroup>
      <div className="relative flex h-full w-full flex-col overflow-hidden px-5 py-5 md:px-6 md:py-6">
        {renderSectionHeader()}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.85rem] bg-black/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.022)] transform-[translateZ(0)] isolate">
          <div
            ref={scrollContainerRef}
            onScroll={(event) => scheduleScrollMetricsUpdate(event.currentTarget)}
            className="h-full w-full overflow-y-auto scrollbar-hide px-1.5 py-1.5 md:px-2 md:py-2"
          >
            <div className="min-h-full">
              {shouldShowLoadingState ? (
                <div className="min-h-80 rounded-4xl border border-white/10 bg-black/15 backdrop-blur-2xl customizable-backdrop-medium flex flex-col items-center justify-center gap-4 text-white/35">
                  <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="font-mono text-xs tracking-widest uppercase">Loading Library...</p>
                </div>
              ) : section === 'playlists' ? (
                renderPlaylistSection()
              ) : section === 'all' ? (
                renderAllSongsSection()
              ) : section === 'artists' ? (
                renderArtistSection()
              ) : section === 'albums' ? (
                renderAlbumSection()
              ) : (
                renderSearchSection()
              )}
            </div>
          </div>

          {!shouldShowLoadingState && (showTopEdgeBlur || showBottomEdgeBlur) && (
            <>
              {showTopEdgeBlur && (
                <div
                  className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-18 rounded-t-[1.85rem] bg-linear-to-b from-black/72 via-black/38 via-50% to-transparent backdrop-blur-lg"
                  style={{
                    maskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 0.84) 34%, rgba(0, 0, 0, 0.42) 64%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 0.84) 34%, rgba(0, 0, 0, 0.42) 64%, transparent 100%)',
                  }}
                />
              )}
              {showBottomEdgeBlur && (
                <div
                  className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-18 rounded-b-[1.85rem] bg-linear-to-t from-black/76 via-black/36 via-50% to-transparent backdrop-blur-lg"
                  style={{
                    maskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 0.84) 34%, rgba(0, 0, 0, 0.42) 64%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 0.84) 34%, rgba(0, 0, 0, 0.42) 64%, transparent 100%)',
                  }}
                />
              )}
            </>
          )}

          <div className="pointer-events-none absolute inset-0 rounded-[1.85rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]" />
        </div>

        {renderArtistOverlay()}
        {renderAlbumOverlay()}
      </div>
    </LayoutGroup>
  );
};
