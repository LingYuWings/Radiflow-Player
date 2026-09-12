import React, { createContext, useContext, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ChevronLeft, CirclePlay, Disc, Heart, LayoutGrid, List, ListPlus, Music, Play, Plus, Search, Trash2, User, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { AppLanguage } from '../lib/copy';
import { NETEASE_STREAM_PATH_PREFIX, createSongIdentity, getNetEaseSongIdFromSong, type LibrarySongPayload, type Song } from '../types/player';

const PlaybackContext = createContext<{ currentSong: Song | null; onQueueNext?: (song: Song) => void; language: AppLanguage }>({ currentSong: null, language: 'zh-CN' });
const QueueNextAction = ({ song }: { song: Song }) => {
  const { currentSong, onQueueNext, language } = useContext(PlaybackContext);
  const current = currentSong && createSongIdentity(currentSong) === createSongIdentity(song);
  const label = language === 'zh-CN' ? '下一首播放' : 'Play next';
  return <>{current && <span className="text-[10px] text-white/80" title={language === 'zh-CN' ? '当前歌曲' : 'Current track'}><Music size={13} /></span>}{onQueueNext && <button className="rf-icon-button" onClick={() => onQueueNext(song)} title={label} aria-label={`${label} ${song.title}`}><ListPlus size={16} /></button>}</>;
};

export interface PlaylistCollection {
  id: string;
  name: string;
  updatedAt: number;
  songs: Song[];
  source?: 'local' | 'netease';
  playlistCategory?: 'created' | 'followed';
  cover?: string;
  trackCount?: number;
}

export type LibrarySection = 'playlists' | 'all' | 'artists' | 'albums' | 'search' | 'favoriteSongs' | 'favoriteAlbums';

export interface LibrarySearchNavigationRequest {
  id: number;
  keyword: string;
  mode: 'artist' | 'album';
  autoOpen?: boolean;
  preferredName?: string;
  preferredArtist?: string;
}

interface LibraryProps {
  currentSong?: Song | null;
  onQueueNext?: (song: Song) => void;
  songs: Song[];
  playlists: PlaylistCollection[];
  isLoading: boolean;
  language: AppLanguage;
  section: LibrarySection;
  displayedPlaylist: PlaylistCollection | null;
  isPlaylistDetailLoading: boolean;
  currentPlaybackPlaylistId: string | null;
  currentPlaybackIndex: number;
  onBackToPlaylistsOverview: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onPlaySongs: (songs: Song[], index: number, sourcePlaylistId?: string | null) => void;
  onAddSongToPlaylist: (song: Song) => void;
  onAddSongsToPlaylist: (songs: Song[]) => void;
  onPlaySelectedPlaylist: () => void;
  onRemoveSongFromPlaylist: (song: Song, index: number) => void;
  searchNavigationRequest: LibrarySearchNavigationRequest | null;
  onSearchNavigationHandled: (requestId: number) => void;
  onRequestSearchNavigation: (request: Omit<LibrarySearchNavigationRequest, 'id'>) => void;
}

interface NetEaseSearchHintItem {
  id: string;
  name: string;
  kind: 'artist' | 'playlist' | 'album';
  subtitle?: string;
  cover?: string;
}

interface NetEaseSearchAlbumItem {
  id: string;
  name: string;
  artist?: string;
  cover?: string;
}

interface NetEaseSearchResponse {
  songs?: LibrarySongPayload[];
  artists?: NetEaseSearchHintItem[];
  albums?: NetEaseSearchAlbumItem[];
  total?: number;
  error?: string;
}

interface NetEaseSearchDefaultResponse {
  keyword?: string;
  displayKeyword?: string;
  error?: string;
}

interface NetEaseHotSearchResponse {
  items?: Array<{ keyword: string; score?: number }>;
  error?: string;
}

interface NetEaseFavoriteAlbumItem extends NetEaseSearchAlbumItem {
  songCount?: number;
  savedAt?: string;
}

interface NetEaseFavoritesResponse {
  songs?: Array<{
    id: string;
    title: string;
    artist: string;
    album?: string;
    cover?: string;
    duration?: number;
    fileUrl: string;
    savedAt?: string;
  }>;
  albums?: NetEaseFavoriteAlbumItem[];
  error?: string;
}

interface OnlineSearchHistoryEntry {
  keyword: string;
  mode: OnlineSearchMode;
  updatedAt: number;
}

interface NetEaseCollectionDetailPayload {
  id: string;
  type: 'artist' | 'album';
  name: string;
  artist?: string;
  cover?: string;
  songCount?: number;
  songs?: LibrarySongPayload[];
}

interface NetEaseCollectionDetailResponse {
  collection?: NetEaseCollectionDetailPayload;
  error?: string;
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

type NetEaseDetailState = {
  id: string;
  type: 'artist' | 'album';
  name: string;
  artist?: string;
  cover?: string;
  songCount?: number;
} | null;

type AllSongsViewMode = 'grid' | 'list';
type FavoriteSongsViewMode = 'grid' | 'list';
type PlaylistCategoryFilter = 'created' | 'followed';
type OnlineSearchMode = 'song' | 'album' | 'artist';

interface PlayableSongPayload {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  fileUrl: string;
}

const getArtistName = (song: Song) => song.artist?.trim() || 'Unknown Artist';

const getAlbumName = (song: Song) => song.album?.trim() || 'Unknown Album';

const getSongCover = (songs: Song[]) => songs.find((song) => song.cover)?.cover;

const toSearchSong = (track: PlayableSongPayload): Song => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  cover: track.cover,
  duration: track.duration,
  lrc: '',
  file: track.fileUrl,
});

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
  containIntrinsicSize: 'auto 80px',
  height: 80,
};

const SONG_GRID_CLASS_NAME = 'grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5';
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
const ONLINE_SEARCH_HISTORY_STORAGE_KEY = 'radiflow-player.netease-search-history';

const normalizeLookupText = (value?: string | null) => value?.trim().toLowerCase() || '';

const getBestArtistSearchMatch = (
  items: NetEaseSearchHintItem[],
  request: LibrarySearchNavigationRequest
) => {
  const preferredName = normalizeLookupText(request.preferredName || request.keyword);
  if (!preferredName) {
    return items[0] ?? null;
  }

  return items.find((item) => normalizeLookupText(item.name) === preferredName) ?? items[0] ?? null;
};

const getBestAlbumSearchMatch = (
  items: NetEaseSearchAlbumItem[],
  request: LibrarySearchNavigationRequest
) => {
  const preferredName = normalizeLookupText(request.preferredName || request.keyword);
  const preferredArtist = normalizeLookupText(request.preferredArtist);

  if (!preferredName && !preferredArtist) {
    return items[0] ?? null;
  }

  const exactNameAndArtistMatch = items.find((item) => (
    normalizeLookupText(item.name) === preferredName
    && (!preferredArtist || normalizeLookupText(item.artist) === preferredArtist)
  ));
  if (exactNameAndArtistMatch) {
    return exactNameAndArtistMatch;
  }

  const exactNameMatch = items.find((item) => normalizeLookupText(item.name) === preferredName);
  if (exactNameMatch) {
    return exactNameMatch;
  }

  if (preferredArtist) {
    const artistMatch = items.find((item) => normalizeLookupText(item.artist) === preferredArtist);
    if (artistMatch) {
      return artistMatch;
    }
  }

  return items[0] ?? null;
};

const matchesQuery = (song: Song, query: string) => {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;

  return [song.title, song.artist, song.album]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(keyword));
};

const sortSongs = (left: Song, right: Song) => left.title.localeCompare(right.title, 'zh-CN');

const getPlaylistCategory = (playlist: PlaylistCollection): PlaylistCategoryFilter => (
  playlist.playlistCategory === 'followed' ? 'followed' : 'created'
);

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
    favoriteSongs: '收藏歌曲',
    favoriteAlbums: '收藏专辑',
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
    searchFavoriteSongs: '搜索收藏歌曲...',
    searchFavoriteAlbums: '搜索收藏专辑...',
    searchLibrary: '搜索整个媒体库...',
    searchOnline: '搜索网易云歌曲...',
    emptyPlaylist: '当前播放列表还没有歌曲',
    emptyPlaylists: '还没有创建播放列表',
    emptySongs: '没有找到歌曲',
    emptyArtists: '没有找到歌手',
    emptyAlbums: '没有找到专辑',
    emptyFavoriteSongs: '还没有收藏歌曲',
    emptyFavoriteAlbums: '还没有收藏专辑',
    emptySearch: '输入关键词开始搜索',
    noSearchResults: '没有匹配的搜索结果',
    searchingOnline: '正在搜索网易云...',
    loadingDetail: '正在加载详情...',
    loadingPlaylist: '正在加载歌单...',
    defaultKeyword: '默认搜索',
    hotSearches: '热搜',
    searchHistory: '搜索记录',
    clearSearch: '清空搜索',
    removeHistoryItem: '删除记录',
    searchSuggestions: '建议',
    relatedMatches: '相关匹配',
    searchBySong: '按歌名',
    searchByAlbum: '按专辑',
    searchByArtist: '按歌手',
    artistSubtitle: (count: number) => `${count} 首歌`,
    albumSubtitle: (artist: string) => artist,
    back: '返回',
    searchResults: '搜索结果',
    searchResultsSubtitle: '按标题、歌手或专辑名称查找',
    allSongsSubtitle: '浏览全部本地歌曲',
    artistsSubtitle: '按歌手浏览并管理歌曲',
    albumsSubtitle: '按专辑浏览并管理歌曲',
    favoriteSongsSubtitle: '直接播放你收藏的网易云歌曲',
    favoriteAlbumsSubtitle: '快速打开你收藏的网易云专辑',
    playlistSubtitle: '将常听歌曲组织到独立列表中',
    createdPlaylists: '创建的',
    followedPlaylists: '关注的',
    artistSongsLabel: '专辑',
    albumSongsLabel: '歌手',
    lastUpdated: '最近更新',
    addToFavorites: '收藏',
    removeFromFavorites: '取消收藏',
  },
  'en-US': {
    playlists: 'Playlists',
    allSongs: 'All Songs',
    artists: 'Artists',
    albums: 'Albums',
    search: 'Search',
    favoriteSongs: 'Favorite Songs',
    favoriteAlbums: 'Favorite Albums',
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
    searchFavoriteSongs: 'Search favorite songs...',
    searchFavoriteAlbums: 'Search favorite albums...',
    searchLibrary: 'Search the library...',
    searchOnline: 'Search NetEase tracks...',
    emptyPlaylist: 'This playlist is empty',
    emptyPlaylists: 'No playlists yet',
    emptySongs: 'No songs found',
    emptyArtists: 'No artists found',
    emptyAlbums: 'No albums found',
    emptyFavoriteSongs: 'No favorite songs yet',
    emptyFavoriteAlbums: 'No favorite albums yet',
    emptySearch: 'Type a keyword to search the library',
    noSearchResults: 'No matching results',
    searchingOnline: 'Searching NetEase...',
    loadingDetail: 'Loading details...',
    loadingPlaylist: 'Loading playlist...',
    defaultKeyword: 'Default Search',
    hotSearches: 'Hot Searches',
    searchHistory: 'Search History',
    clearSearch: 'Clear Search',
    removeHistoryItem: 'Remove History Item',
    searchSuggestions: 'Suggestions',
    relatedMatches: 'Related Matches',
    searchBySong: 'Songs',
    searchByAlbum: 'Albums',
    searchByArtist: 'Artists',
    artistSubtitle: (count: number) => `${count} tracks`,
    albumSubtitle: (artist: string) => artist,
    back: 'Back',
    searchResults: 'Search',
    searchResultsSubtitle: 'Find tracks by title, artist, or album',
    allSongsSubtitle: 'Browse every local track',
    artistsSubtitle: 'Browse artists and manage their songs',
    albumsSubtitle: 'Browse albums and manage their songs',
    favoriteSongsSubtitle: 'Play the NetEase tracks you saved locally',
    favoriteAlbumsSubtitle: 'Open the NetEase albums you saved locally',
    playlistSubtitle: 'Organize the tracks you want to keep together',
    createdPlaylists: 'Created',
    followedPlaylists: 'Followed',
    artistSongsLabel: 'Album',
    albumSongsLabel: 'Artist',
    lastUpdated: 'Updated',
    addToFavorites: 'Favorite',
    removeFromFavorites: 'Unfavorite',
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
  onToggleFavorite?: () => void;
  isFavorite?: boolean;
  favoriteLabel?: string;
  unfavoriteLabel?: string;
  onNavigateToArtist?: () => void;
}> = ({
  song,
  index,
  addLabel,
  animated = true,
  onPlay,
  onAdd,
  onToggleFavorite,
  isFavorite = false,
  favoriteLabel,
  unfavoriteLabel,
  onNavigateToArtist,
}) => (
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
        {onNavigateToArtist ? (
          <button
            type="button"
            onClick={onNavigateToArtist}
            className="mt-0.5 truncate text-left text-[11px] text-white/40 transition-colors hover:text-white"
            title={song.artist}
          >
            {song.artist}
          </button>
        ) : (
          <p className="mt-0.5 text-[11px] text-white/40 truncate">{song.artist}</p>
        )}
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        <QueueNextAction song={song} />
        {onToggleFavorite && (
          <button
            type="button"
            onClick={onToggleFavorite}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full border transition-all',
              isFavorite
                ? 'border-white/15 bg-white/10 text-rose-300 hover:text-rose-200'
                : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
            )}
            title={isFavorite ? (unfavoriteLabel || favoriteLabel || '') : (favoriteLabel || unfavoriteLabel || '')}
          >
            <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}

        <button
          type="button"
          onClick={onAdd}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/65 transition-all hover:bg-white/10 hover:text-white"
          title={addLabel}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  </motion.div>
);

const SongCard = memo(SongCardComponent);

const CollectionCardComponent: React.FC<{
  title: string;
  subtitle: string;
  cover?: string;
  icon: React.ReactNode;
  index: number;
  artworkLayoutId?: string;
  onOpen: () => void;
  isFavorite?: boolean;
  favoriteLabel?: string;
  unfavoriteLabel?: string;
  onToggleFavorite?: () => void;
}> = ({
  title,
  subtitle,
  cover,
  icon,
  index,
  artworkLayoutId,
  onOpen,
  isFavorite = false,
  favoriteLabel,
  unfavoriteLabel,
  onToggleFavorite,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: Math.min(index * 0.02, 0.35) }}
    className="group relative flex flex-col gap-2.5 text-left"
    style={gridItemRenderStyle}
  >
    <button type="button" onClick={onOpen} className="text-left">
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
    </button>

    {onToggleFavorite && (
      <button
        type="button"
        onClick={onToggleFavorite}
        className={cn(
          'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-black/38 text-white/70 backdrop-blur-xl transition-all',
          isFavorite
            ? 'border-white/25 text-rose-300 hover:text-rose-200'
            : 'border-white/10 hover:bg-black/52 hover:text-white'
        )}
        title={isFavorite ? (unfavoriteLabel || favoriteLabel || '') : (favoriteLabel || unfavoriteLabel || '')}
      >
        <Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    )}
  </motion.div>
);

const CollectionCard = memo(CollectionCardComponent);

const SongListItemComponent: React.FC<{
  song: Song;
  index: number;
  addLabel: string;
  animated?: boolean;
  isActive?: boolean;
  onPlay: () => void;
  onAdd?: () => void;
  onToggleFavorite?: () => void;
  isFavorite?: boolean;
  favoriteLabel?: string;
  unfavoriteLabel?: string;
  onRemove?: () => void;
  onNavigateToArtist?: () => void;
}> = ({
  song,
  index,
  addLabel,
  animated = true,
  isActive = false,
  onPlay,
  onAdd,
  onToggleFavorite,
  isFavorite = false,
  favoriteLabel,
  unfavoriteLabel,
  onRemove,
  onNavigateToArtist,
}) => (
  <motion.div
    initial={animated ? { opacity: 0, x: 20 } : false}
    animate={{ opacity: 1, x: 0 }}
    transition={animated ? { delay: Math.min(index * 0.03, 0.4) } : undefined}
    className={cn(
      'rf-library-row group w-full grid items-center gap-3 rounded-2xl px-4 py-3 transition-all',
      'grid-cols-[3rem_minmax(0,1.8fr)_minmax(0,1.2fr)_4.25rem_auto]',
      isActive ? 'bg-white/10 border border-white/10' : 'hover:bg-white/5 border border-transparent'
    )}
    style={listItemRenderStyle}
    tabIndex={0}
    aria-label={song.title}
    onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button')) onPlay(); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter') { event.preventDefault(); onPlay(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
        (sibling as HTMLElement | null)?.focus();
      }
    }}
  >
    <button
      type="button"
      onClick={onPlay}
      className="relative h-12 w-12 overflow-hidden rounded-xl bg-white/5 shadow-lg transition-transform hover:scale-[1.02]"
      title="Play"
    >
      {song.cover ? (
        <img src={song.cover} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/20">
          <Music size={16} />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <Play size={14} fill="currentColor" className="ml-0.5" />
        </div>
      </div>
    </button>

    <div className="min-w-0">
      <p className={cn('truncate text-sm font-semibold', isActive ? 'text-white' : 'text-white/85')}>{song.title}</p>
    </div>

    <div className="min-w-0">
      {onNavigateToArtist ? (
        <button
          type="button"
          onClick={onNavigateToArtist}
          className="truncate text-left text-sm text-white/55 transition-colors hover:text-white"
          title={song.artist}
        >
          {song.artist}
        </button>
      ) : (
        <p className="truncate text-sm text-white/55">{song.artist}</p>
      )}
    </div>

    <div className="text-right text-xs font-mono tracking-[0.16em] text-white/42">
      {formatSongDuration(song.duration)}
    </div>

    <div className="flex items-center justify-end gap-2">
      <QueueNextAction song={song} />
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
          title={addLabel}
        >
          <Plus size={16} />
        </button>
      )}

      {onToggleFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full border transition-all',
            isFavorite
              ? 'border-white/15 bg-white/10 text-rose-300 hover:text-rose-200'
              : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
          )}
          title={isFavorite ? (unfavoriteLabel || favoriteLabel || '') : (favoriteLabel || unfavoriteLabel || '')}
        >
          <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
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
    </div>
  </motion.div>
);

const SongListItem = memo((props: React.ComponentProps<typeof SongListItemComponent>) => {
  const { currentSong } = useContext(PlaybackContext);
  return <SongListItemComponent {...props} isActive={props.isActive || Boolean(currentSong && createSongIdentity(currentSong) === createSongIdentity(props.song))} />;
});

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
    endIndex: enabled ? Math.min(itemCount, itemsPerRow * 12) : itemCount,
    paddingTop: 0,
    paddingBottom: enabled ? Math.max(0, Math.ceil(itemCount / itemsPerRow) - 12) * rowHeight : 0,
  });

  const updateWindow = useCallback(() => {
    if (!enabled || itemCount === 0) {
      setWindowState({
        startIndex: 0,
        endIndex: itemCount,
        paddingTop: 0,
        paddingBottom: 0,
      });
      return;
    }
    // Keep the bounded initial window until DOM measurements are available.
    if (!wrapperRef.current || !scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;
    const wrapper = wrapperRef.current;
    // Preserve the virtual window while the home page is paint-skipped.
    if (scrollContainer.closest('[inert]') || !scrollContainer.getClientRects().length || scrollContainer.clientHeight === 0) return;
    const wrapperTop = wrapper.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
    const visibleTop = Math.max(0, scrollContainer.scrollTop - wrapperTop);
    const visibleBottom = visibleTop + scrollContainer.clientHeight;
    const totalRows = Math.ceil(itemCount / itemsPerRow);
    const startRow = Math.min(Math.max(0, totalRows - 1), Math.max(0, Math.floor(visibleTop / rowHeight) - overscanRows));
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
    let pendingFrame = 0;
    const handleScroll = () => {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        updateWindow();
      });
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelAnimationFrame(pendingFrame);
        scrollContainer.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleScroll);
      };
    }

    const observer = new ResizeObserver(handleScroll);
    observer.observe(scrollContainer);
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    return () => {
      cancelAnimationFrame(pendingFrame);
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
  favoriteLabel?: string;
  getIsActive?: (song: Song, index: number) => boolean;
  getIsFavorite?: (song: Song, index: number) => boolean;
  getKey: (song: Song, index: number) => string;
  onAddSong?: (song: Song, index: number) => void;
  onNavigateToArtist?: (song: Song, index: number) => void;
  onPlaySong: (song: Song, index: number) => void;
  onToggleFavoriteSong?: (song: Song, index: number) => void;
  onRemoveSong?: (song: Song, index: number) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  songs: Song[];
  unfavoriteLabel?: string;
  virtualizationThreshold?: number;
}

const VirtualSongList: React.FC<VirtualSongListProps> = ({
  addLabel,
  disableItemAnimation = false,
  favoriteLabel,
  getIsActive,
  getIsFavorite,
  getKey,
  onAddSong,
  onNavigateToArtist,
  onPlaySong,
  onToggleFavoriteSong,
  onRemoveSong,
  scrollContainerRef,
  songs,
  unfavoriteLabel,
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
              isFavorite={getIsFavorite?.(song, index) ?? false}
              favoriteLabel={favoriteLabel}
              unfavoriteLabel={unfavoriteLabel}
              onPlay={() => onPlaySong(song, index)}
              onAdd={onAddSong ? () => onAddSong(song, index) : undefined}
              onToggleFavorite={onToggleFavoriteSong ? () => onToggleFavoriteSong(song, index) : undefined}
              onRemove={onRemoveSong ? () => onRemoveSong(song, index) : undefined}
              onNavigateToArtist={onNavigateToArtist ? () => onNavigateToArtist(song, index) : undefined}
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
  favoriteLabel?: string;
  getKey: (song: Song, index: number) => string;
  getIsFavorite?: (song: Song, index: number) => boolean;
  onAddSong: (song: Song, index: number) => void;
  onNavigateToArtist?: (song: Song, index: number) => void;
  onPlaySong: (song: Song, index: number) => void;
  onToggleFavoriteSong?: (song: Song, index: number) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  songs: Song[];
  unfavoriteLabel?: string;
}

const VirtualSongGrid: React.FC<VirtualSongGridProps> = ({
  addLabel,
  favoriteLabel,
  getKey,
  getIsFavorite,
  onAddSong,
  onNavigateToArtist,
  onPlaySong,
  onToggleFavoriteSong,
  scrollContainerRef,
  songs,
  unfavoriteLabel,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridMetrics, setGridMetrics] = useState({ columns: 4, rowHeight: 260 });

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const updateContainerWidth = () => {
      const grid = gridRef.current;
      const first = grid?.firstElementChild as HTMLElement | null;
      if (!grid || !first || grid.clientWidth === 0) return;
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length;
      const rowHeight = first.getBoundingClientRect().height + (Number.parseFloat(style.rowGap) || 0);
      if (rowHeight > 0) setGridMetrics((previous) => previous.columns === columns && Math.abs(previous.rowHeight - rowHeight) < 0.5 ? previous : { columns, rowHeight });
    };
    updateContainerWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateContainerWidth);
      return () => window.removeEventListener('resize', updateContainerWidth);
    }

    const observer = new ResizeObserver(() => updateContainerWidth());
    observer.observe(scrollContainer);
    if (gridRef.current) observer.observe(gridRef.current);

    return () => observer.disconnect();
  }, [scrollContainerRef]);

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
      <div ref={gridRef} className={SONG_GRID_CLASS_NAME}>
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
              onToggleFavorite={onToggleFavoriteSong ? () => onToggleFavoriteSong(song, index) : undefined}
              isFavorite={getIsFavorite?.(song, index) ?? false}
              favoriteLabel={favoriteLabel}
              unfavoriteLabel={unfavoriteLabel}
              onNavigateToArtist={onNavigateToArtist ? () => onNavigateToArtist(song, index) : undefined}
            />
          );
        })}
      </div>
      {shouldVirtualize && paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
    </div>
  );
};

export const Library: React.FC<LibraryProps> = ({
  currentSong = null,
  onQueueNext,
  songs,
  playlists,
  isLoading,
  isPlaylistDetailLoading,
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
  searchNavigationRequest,
  onSearchNavigationHandled,
  onRequestSearchNavigation,
}) => {
  const copy = collectionCopy[language];
  const [detailState, setDetailState] = useState<DetailState>(null);
  const [allSongsViewMode, setAllSongsViewMode] = useState<AllSongsViewMode>('grid');
  const [favoriteSongsViewMode, setFavoriteSongsViewMode] = useState<FavoriteSongsViewMode>('list');
  const [playlistCategoryFilter, setPlaylistCategoryFilter] = useState<PlaylistCategoryFilter>('created');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<OnlineSearchMode>('song');
  const [onlineSearchResults, setOnlineSearchResults] = useState<Song[]>([]);
  const [onlineArtistResults, setOnlineArtistResults] = useState<NetEaseSearchHintItem[]>([]);
  const [onlineAlbumResults, setOnlineAlbumResults] = useState<NetEaseSearchAlbumItem[]>([]);
  const [onlineFavoriteSongs, setOnlineFavoriteSongs] = useState<Song[]>([]);
  const [onlineFavoriteAlbums, setOnlineFavoriteAlbums] = useState<NetEaseFavoriteAlbumItem[]>([]);
  const [searchHistory, setSearchHistory] = useState<OnlineSearchHistoryEntry[]>([]);
  const [hasLoadedSearchHistory, setHasLoadedSearchHistory] = useState(false);
  const [onlineDetailState, setOnlineDetailState] = useState<NetEaseDetailState>(null);
  const [onlineDetailSongs, setOnlineDetailSongs] = useState<Song[]>([]);
  const [isOnlineDetailLoading, setIsOnlineDetailLoading] = useState(false);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState({ key: '', offset: 0 });
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [hotSearchKeywords, setHotSearchKeywords] = useState<string[]>([]);
  const [scrollUiState, setScrollUiState] = useState({
    headerCollapseProgress: 0,
    showTopEdgeBlur: false,
    showBottomEdgeBlur: false,
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const playlistDetailScrollRef = useRef<HTMLDivElement>(null);
  const artistOverlayScrollRef = useRef<HTMLDivElement>(null);
  const albumOverlayScrollRef = useRef<HTMLDivElement>(null);
  const onlineDetailOverlayScrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollStateRef = useRef(scrollUiState);
  const viewScrollMemoryRef = useRef<Record<string, number>>({});
  const previousViewKeyRef = useRef<string | null>(null);
  const onlineDetailRequestKeyRef = useRef<string | null>(null);
  const lastAppliedSearchNavigationIdRef = useRef<number | null>(null);
  const [pendingAutoOpenSearchNavigation, setPendingAutoOpenSearchNavigation] = useState<LibrarySearchNavigationRequest | null>(null);

  useEffect(() => {
    setDetailState(null);
    setOnlineDetailState(null);
    setOnlineDetailSongs([]);
    setIsOnlineDetailLoading(false);
    onlineDetailRequestKeyRef.current = null;
    setPendingAutoOpenSearchNavigation(null);
    setSearchQuery('');
    setSearchMode('song');
    setOnlineSearchResults([]);
    setOnlineArtistResults([]);
    setOnlineAlbumResults([]);
  }, [section]);

  const favoriteSongIds = useMemo(
    () => new Set(onlineFavoriteSongs
      .map((track) => getNetEaseSongIdFromSong(track))
      .filter((trackId): trackId is string => Boolean(trackId))),
    [onlineFavoriteSongs]
  );

  const favoriteAlbumIds = useMemo(
    () => new Set(onlineFavoriteAlbums.map((album) => album.id)),
    [onlineFavoriteAlbums]
  );

  const rememberSearchHistory = useCallback((keyword: string, mode: OnlineSearchMode) => {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      return;
    }

    const normalizedKeyword = trimmedKeyword.toLowerCase();
    setSearchHistory((current) => ([
      { keyword: trimmedKeyword, mode, updatedAt: Date.now() },
      ...current.filter((entry) => !(entry.mode === mode && entry.keyword.trim().toLowerCase() === normalizedKeyword)),
    ].slice(0, 10)));
  }, []);

  const applySearchHistoryEntry = useCallback((entry: OnlineSearchHistoryEntry) => {
    setSearchMode(entry.mode);
    setSearchQuery(entry.keyword);
  }, []);

  const removeSearchHistoryEntry = useCallback((entry: OnlineSearchHistoryEntry) => {
    setSearchHistory((current) => current.filter((item) => !(item.mode === entry.mode && item.keyword === entry.keyword)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const rawHistory = window.localStorage.getItem(ONLINE_SEARCH_HISTORY_STORAGE_KEY);
      if (!rawHistory) {
        setSearchHistory([]);
        return;
      }

      const parsedHistory = JSON.parse(rawHistory) as unknown;
      if (!Array.isArray(parsedHistory)) {
        setSearchHistory([]);
        return;
      }

      setSearchHistory(parsedHistory
        .map((entry) => {
          const payload = entry && typeof entry === 'object' ? entry as Partial<OnlineSearchHistoryEntry> : null;
          if (!payload || typeof payload.keyword !== 'string' || (payload.mode !== 'song' && payload.mode !== 'album' && payload.mode !== 'artist')) {
            return null;
          }

          return {
            keyword: payload.keyword.trim(),
            mode: payload.mode,
            updatedAt: typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now(),
          } satisfies OnlineSearchHistoryEntry;
        })
        .filter((entry): entry is OnlineSearchHistoryEntry => Boolean(entry) && Boolean(entry.keyword))
        .slice(0, 10));
    } catch {
      setSearchHistory([]);
    } finally {
      setHasLoadedSearchHistory(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedSearchHistory) {
      return;
    }

    window.localStorage.setItem(ONLINE_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
  }, [hasLoadedSearchHistory, searchHistory]);

  useEffect(() => {
    if (section !== 'search') {
      return;
    }

    let isCancelled = false;

    const loadSearchLanding = async () => {
      try {
        const hotResponse = await fetch('/api/netease/search/hot/detail');
        const hotPayload = await hotResponse.json() as NetEaseHotSearchResponse;

        if (isCancelled) {
          return;
        }

        if (hotResponse.ok) {
          setHotSearchKeywords(
            Array.isArray(hotPayload.items)
              ? hotPayload.items.map((entry) => entry.keyword).filter(Boolean).slice(0, 12)
              : []
          );
        }
      } catch {
        if (!isCancelled) {
          setHotSearchKeywords([]);
        }
      }
    };

    void loadSearchLanding();

    return () => {
      isCancelled = true;
    };
  }, [section]);

  const loadNetEaseFavorites = useCallback(async () => {
    setIsLoadingFavorites(true);

    try {
      const response = await fetch('/api/netease/favorites');
      const payload = await response.json() as NetEaseFavoritesResponse;

      if (!response.ok) {
        setOnlineFavoriteSongs([]);
        setOnlineFavoriteAlbums([]);
        return;
      }

      setOnlineFavoriteSongs(
        Array.isArray(payload.songs)
          ? payload.songs.map(toSearchSong)
          : []
      );
      setOnlineFavoriteAlbums(
        Array.isArray(payload.albums)
          ? payload.albums
          : []
      );
    } catch {
      setOnlineFavoriteSongs([]);
      setOnlineFavoriteAlbums([]);
    } finally {
      setIsLoadingFavorites(false);
    }
  }, []);

  useEffect(() => {
    const needsFavorites = section === 'search'
      || section === 'favoriteSongs'
      || section === 'favoriteAlbums'
      || displayedPlaylist?.source === 'netease';

    if (!needsFavorites) {
      return;
    }

    void loadNetEaseFavorites();
  }, [displayedPlaylist?.source, loadNetEaseFavorites, section]);

  useEffect(() => {
    if (section !== 'search') {
      return;
    }

    const keyword = deferredSearchQuery.trim();
    const searchKey = `${keyword}::${searchMode}`;
    const offset = searchPage.key === searchKey ? searchPage.offset : 0;
    setSearchError(false);
    if (!keyword) {
      setOnlineSearchResults([]);
      setOnlineArtistResults([]);
      setOnlineAlbumResults([]);
      setIsSearchingOnline(false);
      setSearchTotal(0);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    const loadSearchResults = async () => {
      setIsSearchingOnline(true);

      try {
        const searchResult = await fetch(
          `/api/netease/search?keywords=${encodeURIComponent(keyword)}&type=${searchMode === 'album' ? 10 : searchMode === 'artist' ? 100 : 1}&limit=30&offset=${offset}`,
          { signal: controller.signal }
        );

        if (isCancelled) {
          return;
        }

        const payload = await searchResult.json() as NetEaseSearchResponse;
        if (isCancelled) return;
        if (!searchResult.ok) throw new Error(payload.error || 'Search failed');
        const primarySongs = searchResult.ok && Array.isArray(payload.songs)
          ? payload.songs.map(toSearchSong)
          : [];
        const primaryArtists = searchResult.ok && Array.isArray(payload.artists)
          ? payload.artists.filter((item): item is NetEaseSearchHintItem => item.kind === 'artist')
          : [];
        const primaryAlbums = searchResult.ok && Array.isArray(payload.albums)
          ? payload.albums
          : [];

        const unique = <T,>(items: T[], key: (item: T) => unknown) => [...new Map(items.map((item) => [key(item), item])).values()];
        setOnlineSearchResults((old) => unique(offset ? [...old, ...primarySongs] : primarySongs, (item) => item.file));
        setOnlineArtistResults((old) => unique(offset ? [...old, ...primaryArtists] : primaryArtists, (item) => item.id));
        setOnlineAlbumResults((old) => unique(offset ? [...old, ...primaryAlbums] : primaryAlbums, (item) => item.id));
        setSearchTotal(primarySongs.length + primaryArtists.length + primaryAlbums.length ? payload.total || 0 : offset);

        if (searchResult.ok) {
          rememberSearchHistory(keyword, searchMode);
        }
      } catch (error) {
        if (!isCancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          setSearchError(true);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingOnline(false);
        }
      }
    };

    if (!offset) { setOnlineSearchResults([]); setOnlineArtistResults([]); setOnlineAlbumResults([]); }
    setIsSearchingOnline(true);
    const debounce = window.setTimeout(() => { void loadSearchResults(); }, 350);

    return () => {
      isCancelled = true;
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [deferredSearchQuery, searchMode, section, searchRetry, searchPage]);

  const toggleSongFavorite = useCallback(async (song: Song) => {
    const songId = getNetEaseSongIdFromSong(song);
    if (!songId) {
      return;
    }

    if (favoriteSongIds.has(songId)) {
      const response = await fetch(`/api/netease/favorites/song/${encodeURIComponent(songId)}`, { method: 'DELETE' });
      if (!response.ok) {
        return;
      }
      setOnlineFavoriteSongs((current) => current.filter((entry) => getNetEaseSongIdFromSong(entry) !== songId));
      return;
    }

    const fileUrl = typeof song.file === 'string' ? song.file : `${NETEASE_STREAM_PATH_PREFIX}${encodeURIComponent(songId)}`;
    const response = await fetch('/api/netease/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'song',
        item: {
          id: songId,
          title: song.title,
          artist: song.artist,
          album: song.album,
          cover: song.cover,
          duration: song.duration,
          fileUrl,
        },
      }),
    });

    if (!response.ok) {
      return;
    }

    setOnlineFavoriteSongs((current) => [
      toSearchSong({
        title: song.title,
        artist: song.artist,
        album: song.album,
        cover: song.cover,
        duration: song.duration,
        fileUrl,
      }),
      ...current.filter((entry) => getNetEaseSongIdFromSong(entry) !== songId),
    ]);
  }, [favoriteSongIds]);

  const toggleAlbumFavorite = useCallback(async (album: {
    id: string;
    name: string;
    artist?: string;
    cover?: string;
    songCount?: number;
  }) => {
    if (!album.id) {
      return;
    }

    if (favoriteAlbumIds.has(album.id)) {
      const response = await fetch(`/api/netease/favorites/album/${encodeURIComponent(album.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        return;
      }
      setOnlineFavoriteAlbums((current) => current.filter((entry) => entry.id !== album.id));
      return;
    }

    const response = await fetch('/api/netease/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'album',
        item: album,
      }),
    });

    if (!response.ok) {
      return;
    }

    setOnlineFavoriteAlbums((current) => [
      {
        id: album.id,
        name: album.name,
        artist: album.artist,
        cover: album.cover,
        songCount: album.songCount,
      },
      ...current.filter((entry) => entry.id !== album.id),
    ]);
  }, [favoriteAlbumIds]);

  const closeOnlineDetail = useCallback(() => {
    onlineDetailRequestKeyRef.current = null;
    setOnlineDetailState(null);
    setOnlineDetailSongs([]);
    setIsOnlineDetailLoading(false);
  }, []);

  const requestArtistNavigation = useCallback((artistName?: string) => {
    const keyword = artistName?.trim();
    if (!keyword) {
      return;
    }

    onRequestSearchNavigation({
      keyword,
      mode: 'artist',
      autoOpen: true,
      preferredName: keyword,
    });
  }, [onRequestSearchNavigation]);

  const openOnlineDetail = useCallback(async (detail: NonNullable<NetEaseDetailState>) => {
    const requestKey = `${detail.type}:${detail.id}`;
    onlineDetailRequestKeyRef.current = requestKey;
    setOnlineDetailState(detail);
    setOnlineDetailSongs([]);
    setIsOnlineDetailLoading(true);

    try {
      const response = await fetch(`/api/netease/${detail.type}/${encodeURIComponent(detail.id)}`);
      const payload = await response.json() as NetEaseCollectionDetailResponse;

      if (onlineDetailRequestKeyRef.current !== requestKey) {
        return;
      }

      if (!response.ok || !payload.collection) {
        setOnlineDetailSongs([]);
        return;
      }

      setOnlineDetailState((current) => {
        if (!current || current.id !== detail.id || current.type !== detail.type) {
          return current;
        }

        return {
          ...current,
          name: payload.collection?.name || current.name,
          artist: payload.collection?.artist || current.artist,
          cover: payload.collection?.cover || current.cover,
          songCount: payload.collection?.songCount ?? current.songCount,
        };
      });
      setOnlineDetailSongs(
        Array.isArray(payload.collection.songs)
          ? payload.collection.songs.map(toSearchSong)
          : []
      );
    } catch {
      if (onlineDetailRequestKeyRef.current === requestKey) {
        setOnlineDetailSongs([]);
      }
    } finally {
      if (onlineDetailRequestKeyRef.current === requestKey) {
        onlineDetailRequestKeyRef.current = null;
        setIsOnlineDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (section !== 'search' || !searchNavigationRequest) {
      return;
    }

    if (lastAppliedSearchNavigationIdRef.current === searchNavigationRequest.id) {
      return;
    }

    lastAppliedSearchNavigationIdRef.current = searchNavigationRequest.id;
    closeOnlineDetail();
    setSearchMode(searchNavigationRequest.mode);
    setSearchQuery(searchNavigationRequest.keyword);
    setPendingAutoOpenSearchNavigation(searchNavigationRequest.autoOpen ? searchNavigationRequest : null);
    onSearchNavigationHandled(searchNavigationRequest.id);
  }, [closeOnlineDetail, onSearchNavigationHandled, searchNavigationRequest, section]);

  useEffect(() => {
    if (section !== 'search' || !pendingAutoOpenSearchNavigation || isSearchingOnline) {
      return;
    }

    const currentKeyword = normalizeLookupText(deferredSearchQuery);
    const requestKeyword = normalizeLookupText(pendingAutoOpenSearchNavigation.keyword);
    if (requestKeyword && currentKeyword !== requestKeyword) {
      return;
    }

    const request = pendingAutoOpenSearchNavigation;
    setPendingAutoOpenSearchNavigation(null);

    if (request.mode === 'artist') {
      const matchedArtist = getBestArtistSearchMatch(onlineArtistResults, request);
      if (matchedArtist) {
        void openOnlineDetail({
          id: matchedArtist.id,
          type: 'artist',
          name: matchedArtist.name,
          cover: matchedArtist.cover,
        });
      }
      return;
    }

    const matchedAlbum = getBestAlbumSearchMatch(onlineAlbumResults, request);
    if (matchedAlbum) {
      void openOnlineDetail({
        id: matchedAlbum.id,
        type: 'album',
        name: matchedAlbum.name,
        artist: matchedAlbum.artist,
        cover: matchedAlbum.cover,
      });
    }
  }, [deferredSearchQuery, isSearchingOnline, onlineAlbumResults, onlineArtistResults, openOnlineDetail, pendingAutoOpenSearchNavigation, section]);

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

  const filteredFavoriteSongs = useMemo(
    () => onlineFavoriteSongs.filter((track) => matchesQuery(track, deferredSearchQuery)),
    [deferredSearchQuery, onlineFavoriteSongs]
  );

  const filteredFavoriteAlbums = useMemo(() => {
    const keyword = deferredSearchQuery.trim().toLowerCase();
    if (!keyword) {
      return onlineFavoriteAlbums;
    }

    return onlineFavoriteAlbums.filter((album) => (
      album.name.toLowerCase().includes(keyword)
      || (album.artist || '').toLowerCase().includes(keyword)
    ));
  }, [deferredSearchQuery, onlineFavoriteAlbums]);

  const filteredAllSongs = useMemo(() => allSongs.filter((song) => matchesQuery(song, deferredSearchQuery)), [allSongs, deferredSearchQuery]);
  const filteredPlaylistSongs = useMemo(
    () => (displayedPlaylist?.songs || []).filter((song) => matchesQuery(song, deferredSearchQuery)),
    [displayedPlaylist, deferredSearchQuery]
  );
  const visiblePlaylists = useMemo(() => {
    const categoryFiltered = playlists.filter((playlist) => getPlaylistCategory(playlist) === playlistCategoryFilter);
    const keyword = deferredSearchQuery.trim().toLowerCase();
    const filtered = keyword
      ? categoryFiltered.filter((playlist) => playlist.name.toLowerCase().includes(keyword))
      : categoryFiltered;

    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, 'zh-CN'));
  }, [playlists, deferredSearchQuery, playlistCategoryFilter]);
  const searchResults = onlineSearchResults;

  const pageTitle = (() => {
    if (section === 'playlists') return displayedPlaylist?.name || copy.playlists;
    if (section === 'all') return copy.allSongs;
    if (section === 'artists') return copy.artists;
    if (section === 'albums') return copy.albums;
    if (section === 'favoriteSongs') return copy.favoriteSongs;
    if (section === 'favoriteAlbums') return copy.favoriteAlbums;
    return copy.searchResults;
  })();

  const pageSubtitle = (() => {
    if (section === 'playlists') {
      return displayedPlaylist ? copy.songs(displayedPlaylist.songs.length) : copy.playlistsCount(visiblePlaylists.length);
    }
    if (section === 'all') return copy.allSongsSubtitle;
    if (section === 'artists') return copy.artistsSubtitle;
    if (section === 'albums') return copy.albumsSubtitle;
    if (section === 'favoriteSongs') return copy.favoriteSongsSubtitle;
    if (section === 'favoriteAlbums') return copy.favoriteAlbumsSubtitle;
    return copy.searchResultsSubtitle;
  })();

  const searchPlaceholder = (() => {
    if (section === 'playlists') return displayedPlaylist ? copy.searchPlaylist : copy.searchPlaylists;
    if (section === 'artists') return copy.searchArtists;
    if (section === 'albums') return copy.searchAlbums;
    if (section === 'favoriteSongs') return copy.searchFavoriteSongs;
    if (section === 'favoriteAlbums') return copy.searchFavoriteAlbums;
    if (section === 'search') return copy.searchOnline;
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

    if (section === 'favoriteSongs') {
      return `favorites:songs:${favoriteSongsViewMode}:${deferredSearchQuery.trim().toLowerCase()}`;
    }

    if (section === 'favoriteAlbums') {
      return `favorites:albums:${deferredSearchQuery.trim().toLowerCase()}`;
    }

    return `search:results:${searchMode}:${deferredSearchQuery.trim().toLowerCase()}`;
  }, [allSongsViewMode, deferredSearchQuery, displayedPlaylist, favoriteSongsViewMode, searchMode, section]);

  const shouldShowContentEdgeBlur = !isLoading && (
    section === 'all'
    || section === 'artists'
    || section === 'albums'
    || section === 'favoriteSongs'
    || section === 'favoriteAlbums'
  );
  const shouldShowLoadingState = isLoading && songs.length === 0;
  const { headerCollapseProgress, showTopEdgeBlur, showBottomEdgeBlur } = scrollUiState;

  const updateScrollMetrics = useCallback((node: HTMLDivElement | null) => {
    if (!node || node.closest('[inert]')) return;

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
    filteredFavoriteAlbums.length,
    filteredFavoriteSongs.length,
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
        aria-label={section === 'search' ? (language === 'zh-CN' ? '搜索网易云音乐' : 'Search NetEase music') : (language === 'zh-CN' ? '筛选当前曲库' : 'Filter library')}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        className={cn(
          'w-full bg-white/5 border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all backdrop-blur-md customizable-backdrop-soft',
          headerCollapseProgress > 0.35 ? 'rounded-[1.1rem] py-3 pl-12 pr-12' : 'rounded-2xl py-4 pl-12 pr-14'
        )}
      />

      {searchQuery && (
        <button
          type="button"
          onClick={() => setSearchQuery('')}
          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/45 transition-all hover:bg-white/10 hover:text-white"
          title={copy.clearSearch}
          aria-label={copy.clearSearch}
        >
          <X size={15} />
        </button>
      )}
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

  const renderPlaylistCategoryToggle = () => (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => setPlaylistCategoryFilter('created')}
        className={cn(
          'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
          playlistCategoryFilter === 'created'
            ? 'bg-white text-black border-white shadow-lg'
            : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
        )}
      >
        <User size={16} />
        <span>{copy.createdPlaylists}</span>
      </button>
      <button
        type="button"
        onClick={() => setPlaylistCategoryFilter('followed')}
        className={cn(
          'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
          playlistCategoryFilter === 'followed'
            ? 'bg-white text-black border-white shadow-lg'
            : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
        )}
      >
        <Disc size={16} />
        <span>{copy.followedPlaylists}</span>
      </button>
    </div>
  );

  const renderPlaylistDetailBackBar = (songCount: number) => (
    <div className="shrink-0 pb-4 md:pb-5">
      <div className="flex items-center justify-between gap-3 px-1 py-1 md:px-0">
        <button
          type="button"
          onClick={onBackToPlaylistsOverview}
          className="h-10 shrink-0 rounded-full border border-white/10 bg-white/5 px-4 text-white/70 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2"
        >
          <ChevronLeft size={18} />
          <span className="text-sm font-semibold">{copy.back}</span>
        </button>

        <span className="rounded-full border border-white/8 bg-white/4 px-3 py-1 text-[11px] font-semibold text-white/55">
          {copy.songs(songCount)}
        </span>
      </div>
    </div>
  );

  const renderPlaylistSongsPanel = (content: React.ReactNode, showSearchBox = true) => (
    <div className="relative z-10 min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-white/8 bg-black/22 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.018)]">
      <div ref={playlistDetailScrollRef} className="h-full overflow-y-auto px-3 py-3 scrollbar-hide md:px-4 md:py-4">
        {showSearchBox && (
          <div className="pb-4">
            {renderSearchBox()}
          </div>
        )}
        {content}
      </div>
    </div>
  );

  const renderPlaylistSection = () => {
    if (isPlaylistDetailLoading && !displayedPlaylist) {
      return (
        <div className="min-h-80 rounded-4xl border border-white/10 bg-black/15 backdrop-blur-2xl customizable-backdrop-medium flex flex-col items-center justify-center gap-4 text-white/35">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="font-mono text-xs tracking-widest uppercase">{copy.loadingPlaylist}</p>
        </div>
      );
    }

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
                      cover={playlist.cover || playlist.songs[0]?.cover}
                      title={playlist.name}
                      sizeClassName="h-20 w-20 shrink-0 md:h-24 md:w-24"
                      iconSize={24}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="mb-3 text-xs font-mono uppercase tracking-[0.22em] text-white/28">{copy.playlists}</p>
                      <h2 className="text-2xl font-black tracking-tight text-white truncate">{playlist.name}</h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                          {copy.songs(playlist.trackCount ?? playlist.songs.length)}
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

    const playlistCover = displayedPlaylist.cover || displayedPlaylist.songs[0]?.cover;
    const updatedLabel = formatPlaylistUpdatedAt(displayedPlaylist.updatedAt, language);

    if (isPlaylistDetailLoading) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="group mb-6 rounded-4xl border border-white/10 bg-black/15 p-5 md:p-6 backdrop-blur-2xl customizable-backdrop-medium transition-all">
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
                    {copy.songs(displayedPlaylist.trackCount ?? displayedPlaylist.songs.length)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/55">
                    {copy.lastUpdated}: {updatedLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {renderPlaylistSongsPanel((
            <div className="min-h-80 flex flex-col items-center justify-center gap-4 text-white/35">
              <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
              <p className="font-mono text-xs tracking-widest uppercase">{copy.loadingPlaylist}</p>
            </div>
          ), false)}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="group mb-6 rounded-4xl border border-white/10 bg-black/15 p-5 md:p-6 backdrop-blur-2xl customizable-backdrop-medium transition-all hover:border-white/15 hover:bg-white/4 hover:shadow-2xl">
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

        {renderPlaylistSongsPanel(
          filteredPlaylistSongs.length === 0 ? (
            <EmptyState icon={<Music size={28} />} title={copy.emptyPlaylist} />
          ) : (
            (() => {
              const canRemoveSongs = displayedPlaylist.source === 'local'
                || (displayedPlaylist.source === 'netease' && displayedPlaylist.playlistCategory === 'created');

              return (
                <VirtualSongList
                  songs={filteredPlaylistSongs}
                  scrollContainerRef={playlistDetailScrollRef}
                  addLabel={copy.addToPlaylist}
                  favoriteLabel={copy.addToFavorites}
                  getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
                  getIsActive={(song) => {
                    const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
                    return currentPlaybackPlaylistId === displayedPlaylist.id && currentPlaybackIndex === originalIndex;
                  }}
                  getIsFavorite={(song) => favoriteSongIds.has(getNetEaseSongIdFromSong(song) || '')}
                  onPlaySong={(song) => {
                    const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
                    onPlaySongs(displayedPlaylist.songs, originalIndex, displayedPlaylist.id);
                  }}
                  onToggleFavoriteSong={displayedPlaylist.source === 'netease' ? (song) => { void toggleSongFavorite(song); } : undefined}
                  onNavigateToArtist={displayedPlaylist.source === 'netease' ? (song) => requestArtistNavigation(song.artist) : undefined}
                  onRemoveSong={canRemoveSongs
                    ? (song) => {
                      const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
                      onRemoveSongFromPlaylist(song, originalIndex);
                    }
                    : undefined}
                  unfavoriteLabel={copy.removeFromFavorites}
                />
              );
            })()
          )
        )}
      </div>
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

  const renderFavoriteSongsSection = () => (
    <>
      {isLoadingFavorites ? (
        <EmptyState icon={<Heart size={28} />} title={copy.loadingDetail} />
      ) : filteredFavoriteSongs.length === 0 ? (
        <EmptyState icon={<Heart size={28} />} title={copy.emptyFavoriteSongs} subtitle={copy.favoriteSongsSubtitle} />
      ) : favoriteSongsViewMode === 'grid' ? (
        <VirtualSongGrid
          songs={filteredFavoriteSongs}
          scrollContainerRef={scrollContainerRef}
          addLabel={copy.addToPlaylist}
          favoriteLabel={copy.addToFavorites}
          getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
          getIsFavorite={(song) => favoriteSongIds.has(getNetEaseSongIdFromSong(song) || '')}
          onPlaySong={(_, index) => onPlaySongs(filteredFavoriteSongs, index, null)}
          onAddSong={(song) => onAddSongToPlaylist(song)}
          onToggleFavoriteSong={(song) => { void toggleSongFavorite(song); }}
          onNavigateToArtist={(song) => requestArtistNavigation(song.artist)}
          unfavoriteLabel={copy.removeFromFavorites}
        />
      ) : (
        <VirtualSongList
          songs={filteredFavoriteSongs}
          scrollContainerRef={scrollContainerRef}
          addLabel={copy.addToPlaylist}
          favoriteLabel={copy.addToFavorites}
          getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
          getIsFavorite={(song) => favoriteSongIds.has(getNetEaseSongIdFromSong(song) || '')}
          onPlaySong={(_, index) => onPlaySongs(filteredFavoriteSongs, index, null)}
          onAddSong={(song) => onAddSongToPlaylist(song)}
          onToggleFavoriteSong={(song) => { void toggleSongFavorite(song); }}
          onNavigateToArtist={(song) => requestArtistNavigation(song.artist)}
          unfavoriteLabel={copy.removeFromFavorites}
        />
      )}
    </>
  );

  const renderFavoriteAlbumsSection = () => (
    <>
      {isLoadingFavorites ? (
        <EmptyState icon={<Disc size={28} />} title={copy.loadingDetail} />
      ) : filteredFavoriteAlbums.length === 0 ? (
        <EmptyState icon={<Disc size={28} />} title={copy.emptyFavoriteAlbums} subtitle={copy.favoriteAlbumsSubtitle} />
      ) : (
        <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5 pb-4">
          {filteredFavoriteAlbums.map((album, index) => (
            <CollectionCard
              key={album.id}
              title={album.name}
              subtitle={album.artist || copy.searchByAlbum}
              cover={album.cover}
              icon={<Disc size={40} />}
              index={index}
              artworkLayoutId={`search-album-${album.id}`}
              isFavorite={favoriteAlbumIds.has(album.id)}
              favoriteLabel={copy.addToFavorites}
              unfavoriteLabel={copy.removeFromFavorites}
              onToggleFavorite={() => { void toggleAlbumFavorite(album); }}
              onOpen={() => {
                void openOnlineDetail({
                  id: album.id,
                  type: 'album',
                  name: album.name,
                  artist: album.artist,
                  cover: album.cover,
                  songCount: album.songCount,
                });
              }}
            />
          ))}
        </div>
      )}
    </>
  );

  const renderSearchSection = () => {
    const trimmedQuery = searchQuery.trim();
    const hasPrimaryResults = searchMode === 'song'
      ? searchResults.length > 0
      : searchMode === 'artist'
        ? onlineArtistResults.length > 0
        : onlineAlbumResults.length > 0;

    const renderSearchModeToggle = () => (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-1 inline-grid grid-cols-3 gap-1">
        {([
          { id: 'song', label: copy.searchBySong },
          { id: 'album', label: copy.searchByAlbum },
          { id: 'artist', label: copy.searchByArtist },
        ] as const).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSearchMode(item.id)}
            className={cn(
              'rounded-2xl px-4 py-2 text-sm font-semibold transition-all',
              searchMode === item.id
                ? 'bg-white text-black'
                : 'text-white/65 hover:text-white hover:bg-white/10'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    );

    const renderPrimaryResults = () => {
      if (searchMode === 'song') {
        return (
          <VirtualSongList
            songs={searchResults}
            scrollContainerRef={scrollContainerRef}
            addLabel={copy.addToPlaylist}
            favoriteLabel={copy.addToFavorites}
            getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
            getIsFavorite={(song) => favoriteSongIds.has(getNetEaseSongIdFromSong(song) || '')}
            onPlaySong={(_, index) => onPlaySongs(searchResults, index, null)}
            onAddSong={(song) => onAddSongToPlaylist(song)}
            onToggleFavoriteSong={(song) => { void toggleSongFavorite(song); }}
            onNavigateToArtist={(song) => requestArtistNavigation(song.artist)}
            unfavoriteLabel={copy.removeFromFavorites}
          />
        );
      }

      if (searchMode === 'artist') {
        return (
          <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5 pb-4">
            {onlineArtistResults.map((item, index) => (
              <CollectionCard
                key={item.id}
                title={item.name}
                subtitle={item.subtitle || copy.searchByArtist}
                cover={item.cover}
                icon={<User size={40} />}
                index={index}
                artworkLayoutId={`search-artist-${item.id}`}
                onOpen={() => {
                  void openOnlineDetail({
                    id: item.id,
                    type: 'artist',
                    name: item.name,
                    cover: item.cover,
                  });
                }}
              />
            ))}
          </div>
        );
      }

      return (
        <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 xl:gap-5 pb-4">
          {onlineAlbumResults.map((item, index) => (
            <CollectionCard
              key={item.id}
              title={item.name}
              subtitle={item.artist || copy.searchByAlbum}
              cover={item.cover}
              icon={<Disc size={40} />}
              index={index}
              artworkLayoutId={`search-album-${item.id}`}
              isFavorite={favoriteAlbumIds.has(item.id)}
              favoriteLabel={copy.addToFavorites}
              unfavoriteLabel={copy.removeFromFavorites}
              onToggleFavorite={() => { void toggleAlbumFavorite(item); }}
              onOpen={() => {
                void openOnlineDetail({
                  id: item.id,
                  type: 'album',
                  name: item.name,
                  artist: item.artist,
                  cover: item.cover,
                });
              }}
            />
          ))}
        </div>
      );
    };

    const renderSearchHistory = () => (
      searchHistory.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <p className="w-full text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.searchHistory}</p>
          {searchHistory.map((entry) => (
            <div key={`${entry.mode}:${entry.keyword}`} className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/5 pr-1 text-white/80">
              <button
                type="button"
                onClick={() => applySearchHistoryEntry(entry)}
                className="max-w-[16rem] truncate px-3 py-1.5 text-sm transition-all hover:text-white"
                title={entry.keyword}
              >
                <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                  {entry.mode === 'song' ? copy.searchBySong : entry.mode === 'album' ? copy.searchByAlbum : copy.searchByArtist}
                </span>
                <span>{entry.keyword}</span>
              </button>
              <button
                type="button"
                onClick={() => removeSearchHistoryEntry(entry)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/35 transition-all hover:bg-white/10 hover:text-white"
                title={copy.removeHistoryItem}
                aria-label={copy.removeHistoryItem}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null
    );

    return (
      <>
        <div className="mb-6">{renderSearchModeToggle()}</div>

        {!trimmedQuery ? (
          <div className="space-y-6">
            {(searchHistory.length > 0 || hotSearchKeywords.length > 0) && (
              <div className="rounded-4xl border border-white/10 bg-black/15 p-5 md:p-6 backdrop-blur-2xl customizable-backdrop-medium">
                {renderSearchHistory()}

                {hotSearchKeywords.length > 0 && (
                  <div className={cn('flex flex-wrap gap-2', searchHistory.length > 0 ? 'mt-5 pt-5 border-t border-white/8' : '')}>
                    <p className="w-full text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.hotSearches}</p>
                    {hotSearchKeywords.map((keyword) => (
                      <button
                        key={keyword}
                        type="button"
                        onClick={() => {
                          setSearchMode('song');
                          setSearchQuery(keyword);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-all hover:bg-white/10 hover:text-white"
                      >
                        {keyword}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <EmptyState icon={<Search size={28} />} title={copy.emptySearch} subtitle={copy.searchResultsSubtitle} />
          </div>
        ) : searchError ? (
          <div className="rf-glass rounded-3xl p-8 text-center" role="status"><p className="text-white/85">{language === 'zh-CN' ? '搜索暂时不可用，请检查网络连接' : 'Search unavailable. Check your connection.'}</p><button className="mt-4 rounded-xl bg-white/15 px-5 py-2" onClick={() => setSearchRetry((value) => value + 1)}>{language === 'zh-CN' ? '重新搜索' : 'Retry search'}</button></div>
        ) : isSearchingOnline && !hasPrimaryResults ? (
          <EmptyState icon={<Search size={28} />} title={copy.searchingOnline} />
        ) : (
          <div className="space-y-6">
            {!hasPrimaryResults ? (
              <EmptyState icon={<Search size={28} />} title={copy.noSearchResults} />
            ) : (
              renderPrimaryResults()
            )}
            {hasPrimaryResults && searchTotal > (onlineSearchResults.length + onlineArtistResults.length + onlineAlbumResults.length) && <div className="flex justify-center py-4"><button className="rf-glass rounded-2xl px-6 py-3 text-sm text-white/85 disabled:opacity-50" disabled={isSearchingOnline} onClick={() => setSearchPage({ key: `${deferredSearchQuery.trim()}::${searchMode}`, offset: (searchPage.key === `${deferredSearchQuery.trim()}::${searchMode}` ? searchPage.offset : 0) + 30 })}>{isSearchingOnline ? (language === 'zh-CN' ? '正在加载…' : 'Loading…') : (language === 'zh-CN' ? '加载更多结果' : 'Load more results')}</button></div>}
          </div>
        )}
      </>
    );
  };

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

  const renderOnlineDetailOverlay = () => {
    const overlayBackground = onlineDetailState
      ? (onlineDetailState.cover || getSongCover(onlineDetailSongs))
      : undefined;
    const isAlbumDetail = onlineDetailState?.type === 'album';
    const detailCount = onlineDetailSongs.length || onlineDetailState?.songCount || 0;
    const detailSubtitle = isAlbumDetail
      ? (onlineDetailState?.artist || (isOnlineDetailLoading ? copy.loadingDetail : copy.searchByAlbum))
      : ((isOnlineDetailLoading && detailCount === 0) ? copy.loadingDetail : copy.artistSubtitle(detailCount));

    return (
      <AnimatePresence>
        {onlineDetailState && (
        <motion.div
          key={`online-detail-overlay-${onlineDetailState.type}-${onlineDetailState.id}`}
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
            aria-label="Close NetEase detail overlay"
            onClick={closeOnlineDetail}
            className="absolute inset-0"
          />

          <motion.div
            layoutId={`search-${onlineDetailState.type}-${onlineDetailState.id}`}
            transition={SHARED_ARTWORK_TRANSITION}
            className="pointer-events-none absolute left-10 top-[6.4rem] z-50 aspect-square w-[min(14rem,calc(100vw-5rem))] overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 shadow-[0_26px_70px_rgba(0,0,0,0.38)] transform-gpu will-change-transform md:left-14 md:top-[7.2rem] md:w-[14rem]"
          >
            {onlineDetailState.cover ? (
              <img
                src={onlineDetailState.cover}
                alt={onlineDetailState.name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">
                {isAlbumDetail ? <Disc size={72} /> : <User size={72} />}
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
                  onClick={closeOnlineDetail}
                  className="h-11 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/75 transition-all hover:bg-white/10 hover:text-white flex items-center gap-2 shrink-0"
                >
                  <ChevronLeft size={18} />
                  <span>{copy.back}</span>
                </button>

                {isAlbumDetail && onlineDetailState && (
                  <button
                    type="button"
                    onClick={() => { void toggleAlbumFavorite(onlineDetailState); }}
                    className={cn(
                      'rounded-full border px-4 py-3 text-sm font-semibold transition-all flex items-center gap-2',
                      favoriteAlbumIds.has(onlineDetailState.id)
                        ? 'border-white/15 bg-white/10 text-rose-300 hover:text-rose-200'
                        : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                    )}
                  >
                    <Heart size={16} fill={favoriteAlbumIds.has(onlineDetailState.id) ? 'currentColor' : 'none'} />
                    <span>{favoriteAlbumIds.has(onlineDetailState.id) ? copy.removeFromFavorites : copy.addToFavorites}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col items-start gap-5 lg:flex-row lg:items-end">
                <div className="aspect-square w-full max-w-[14rem] shrink-0 opacity-0" aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono uppercase tracking-[0.24em] text-white/35">
                    {isAlbumDetail ? copy.albums : copy.artists}
                  </p>
                  <h2 className="mt-2 truncate text-3xl font-black tracking-tight text-white md:text-5xl">
                    {onlineDetailState.name}
                  </h2>
                  <p className="mt-2 text-sm text-white/60">{detailSubtitle}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold text-white/65">
                      {copy.songs(detailCount)}
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
              <div ref={onlineDetailOverlayScrollRef} className="h-full overflow-y-auto px-3 py-3 scrollbar-hide md:px-4 md:py-4">
                {isOnlineDetailLoading ? (
                  <EmptyState icon={isAlbumDetail ? <Disc size={28} /> : <User size={28} />} title={copy.loadingDetail} />
                ) : onlineDetailSongs.length === 0 ? (
                  <EmptyState icon={isAlbumDetail ? <Disc size={28} /> : <User size={28} />} title={copy.emptySongs} />
                ) : (
                  <VirtualSongList
                    songs={onlineDetailSongs}
                    scrollContainerRef={onlineDetailOverlayScrollRef}
                    addLabel={copy.addToPlaylist}
                    disableItemAnimation={true}
                    favoriteLabel={copy.addToFavorites}
                    getKey={(song, index) => `${song.title}-${song.artist}-${index}`}
                    getIsFavorite={(song) => favoriteSongIds.has(getNetEaseSongIdFromSong(song) || '')}
                    onPlaySong={(_, index) => onPlaySongs(onlineDetailSongs, index, null)}
                    onAddSong={(song) => onAddSongToPlaylist(song)}
                    onToggleFavoriteSong={(song) => { void toggleSongFavorite(song); }}
                    onNavigateToArtist={(song) => requestArtistNavigation(song.artist)}
                    unfavoriteLabel={copy.removeFromFavorites}
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
      return renderPlaylistDetailBackBar(displayedPlaylist.trackCount ?? displayedPlaylist.songs.length);
    }

    if (section === 'playlists') {
      return renderHeaderBlock(false, undefined, renderPlaylistCategoryToggle());
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

    if (section === 'favoriteSongs') {
      return renderHeaderBlock(false, undefined, (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setFavoriteSongsViewMode('grid')}
            className={cn(
              'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
              favoriteSongsViewMode === 'grid'
                ? 'bg-white text-black border-white shadow-lg'
                : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white'
            )}
          >
            <LayoutGrid size={16} />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setFavoriteSongsViewMode('list')}
            className={cn(
              'rounded-2xl px-4 py-3 border text-sm font-semibold transition-all flex items-center gap-2',
              favoriteSongsViewMode === 'list'
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
    <PlaybackContext.Provider value={{ currentSong, onQueueNext, language }}><LayoutGroup>
      <div className="relative flex h-full w-full flex-col overflow-hidden px-5 py-5 md:px-6 md:py-6">
        {renderSectionHeader()}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.85rem] bg-black/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.022)] transform-[translateZ(0)] isolate">
          <div
            ref={scrollContainerRef}
            onScroll={(event) => scheduleScrollMetricsUpdate(event.currentTarget)}
            className="h-full w-full overflow-y-auto rf-scroll px-1.5 py-1.5 md:px-2 md:py-2"
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
              ) : section === 'favoriteSongs' ? (
                renderFavoriteSongsSection()
              ) : section === 'favoriteAlbums' ? (
                renderFavoriteAlbumsSection()
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
        {renderOnlineDetailOverlay()}
      </div>
    </LayoutGroup></PlaybackContext.Provider>
  );
};
