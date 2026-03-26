import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, CirclePlay, Disc, Music, Play, Plus, Search, Trash2, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { AppLanguage } from '../lib/copy';

interface Song {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  lrc: string;
  file?: File | string;
}

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

const getArtistName = (song: Song) => song.artist?.trim() || 'Unknown Artist';

const getAlbumName = (song: Song) => song.album?.trim() || 'Unknown Album';

const getSongCover = (songs: Song[]) => songs.find((song) => song.cover)?.cover;

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
        <img src={cover} alt={title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
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

const SongCard: React.FC<{
  song: Song;
  index: number;
  addLabel: string;
  onPlay: () => void;
  onAdd: () => void;
}> = ({ song, index, addLabel, onPlay, onAdd }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.02 }}
    className="group relative flex flex-col gap-3"
  >
    <button type="button" className="text-left" onClick={onPlay}>
      <div className="aspect-square rounded-3xl overflow-hidden bg-white/5 relative shadow-xl group-hover:shadow-2xl transition-all duration-500 border border-white/5">
        {song.cover ? (
          <img src={song.cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={40} className="text-white/10 group-hover:scale-110 transition-transform duration-700" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-black shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <Play size={20} fill="currentColor" className="ml-1" />
          </div>
        </div>
      </div>
    </button>

    <div className="flex items-start justify-between gap-3 px-1 min-w-0">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-white truncate">{song.title}</h3>
        <p className="text-xs text-white/40 truncate">{song.artist}</p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 mt-0.5 w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white/65 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center"
        title={addLabel}
      >
        <Plus size={16} />
      </button>
    </div>
  </motion.div>
);

const CollectionCard: React.FC<{
  title: string;
  subtitle: string;
  cover?: string;
  icon: React.ReactNode;
  index: number;
  onOpen: () => void;
}> = ({ title, subtitle, cover, icon, index, onOpen }) => (
  <motion.button
    type="button"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.02 }}
    className="group flex flex-col gap-3 text-left"
    onClick={onOpen}
  >
    <div className="aspect-square rounded-3xl overflow-hidden bg-white/5 relative shadow-xl group-hover:shadow-2xl transition-all duration-500 border border-white/5">
      {cover ? (
        <img src={cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          {icon}
        </div>
      )}
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent opacity-60" />
    </div>
    <div className="min-w-0 px-1">
      <h3 className="text-sm font-bold text-white truncate">{title}</h3>
      <p className="text-xs text-white/45 truncate">{subtitle}</p>
    </div>
  </motion.button>
);

const SongListItem: React.FC<{
  song: Song;
  secondaryText: string;
  index: number;
  addLabel: string;
  isActive?: boolean;
  onPlay: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}> = ({ song, secondaryText, index, addLabel, isActive = false, onPlay, onAdd, onRemove }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: index * 0.03 }}
    className={cn(
      'group w-full flex items-center gap-4 p-4 rounded-2xl transition-all text-left',
      isActive ? 'bg-white/10 border border-white/10' : 'hover:bg-white/5 border border-transparent'
    )}
  >
    <button type="button" className="flex flex-1 min-w-0 items-center gap-4 text-left" onClick={onPlay}>
      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
        {song.cover ? (
          <img src={song.cover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <Music size={16} />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className={cn('font-medium truncate', isActive ? 'text-white' : 'text-white/80')}>{song.title}</h3>
        <p className="text-xs text-white/40 truncate">{secondaryText}</p>
      </div>

      <div className="shrink-0 text-white/30 group-hover:text-white/60 transition-colors">
        <Play size={16} fill="currentColor" className="ml-0.5" />
      </div>
    </button>

    <div className="flex items-center gap-2 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center"
          title={addLabel}
        >
          <Plus size={16} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white/50 hover:text-red-300 hover:bg-white/10 transition-all flex items-center justify-center"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  </motion.div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div className="min-h-80 rounded-4xl border border-white/10 bg-black/15 backdrop-blur-2xl flex flex-col items-center justify-center gap-4 text-center text-white/35 px-6">
    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">{icon}</div>
    <div>
      <p className="text-xl font-bold text-white/70">{title}</p>
      {subtitle && <p className="text-sm text-white/35 mt-2">{subtitle}</p>}
    </div>
  </div>
);

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
  const [searchQuery, setSearchQuery] = useState('');

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
    return sourceSongs.filter((song) => matchesQuery(song, searchQuery));
  }, [activeArtistGroup, activeAlbumGroup, searchQuery]);

  const visibleArtists = useMemo(() => {
    if (!searchQuery.trim()) return artistGroups;
    return artistGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        group.songs.some((song) => matchesQuery(song, searchQuery))
    );
  }, [artistGroups, searchQuery]);

  const visibleAlbums = useMemo(() => {
    if (!searchQuery.trim()) return albumGroups;
    return albumGroups.filter(
      (group) =>
        group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        group.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
        group.songs.some((song) => matchesQuery(song, searchQuery))
    );
  }, [albumGroups, searchQuery]);

  const filteredAllSongs = useMemo(() => allSongs.filter((song) => matchesQuery(song, searchQuery)), [allSongs, searchQuery]);
  const filteredPlaylistSongs = useMemo(
    () => (displayedPlaylist?.songs || []).filter((song) => matchesQuery(song, searchQuery)),
    [displayedPlaylist, searchQuery]
  );
  const visiblePlaylists = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const filtered = keyword
      ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(keyword))
      : playlists;

    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, 'zh-CN'));
  }, [playlists, searchQuery]);
  const searchResults = useMemo(
    () => (searchQuery.trim() ? allSongs.filter((song) => matchesQuery(song, searchQuery)) : []),
    [allSongs, searchQuery]
  );

  const pageTitle = (() => {
    if (section === 'playlists') return displayedPlaylist?.name || copy.playlists;
    if (section === 'all') return copy.allSongs;
    if (section === 'artists') return activeArtistGroup?.name || copy.artists;
    if (section === 'albums') return activeAlbumGroup?.name || copy.albums;
    return copy.searchResults;
  })();

  const pageSubtitle = (() => {
    if (section === 'playlists') {
      return displayedPlaylist ? copy.songs(displayedPlaylist.songs.length) : copy.playlistsCount(playlists.length);
    }
    if (section === 'all') return copy.allSongsSubtitle;
    if (section === 'artists') {
      return activeArtistGroup ? copy.songs(activeArtistGroup.songs.length) : copy.artistsSubtitle;
    }
    if (section === 'albums') {
      return activeAlbumGroup ? `${activeAlbumGroup.artist} · ${copy.songs(activeAlbumGroup.songs.length)}` : copy.albumsSubtitle;
    }
    return copy.searchResultsSubtitle;
  })();

  const searchPlaceholder = (() => {
    if (section === 'playlists') return displayedPlaylist ? copy.searchPlaylist : copy.searchPlaylists;
    if (section === 'artists') return activeArtistGroup ? copy.searchSongs : copy.searchArtists;
    if (section === 'albums') return activeAlbumGroup ? copy.searchSongs : copy.searchAlbums;
    if (section === 'search') return copy.searchLibrary;
    return copy.searchSongs;
  })();

  const renderTopBar = (showBack = false, onBack?: () => void, actionSlot?: React.ReactNode) => (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-2">
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
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white uppercase truncate">{pageTitle}</h1>
        </div>
        <p className="text-white/40 font-mono text-xs tracking-widest uppercase">{pageSubtitle}</p>
      </div>
      {actionSlot}
    </div>
  );

  const renderSearchBox = () => (
    <div className="relative mb-8 group w-full">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-white/60 transition-colors" size={18} />
      <input
        type="text"
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-white placeholder:text-white/20 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all backdrop-blur-md"
      />
    </div>
  );

  const renderPlaylistSection = () => {
    if (!displayedPlaylist) {
      return (
        <>
          {renderTopBar()}
          {renderSearchBox()}
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
                  transition={{ delay: index * 0.03 }}
                  onClick={() => onOpenPlaylist(playlist.id)}
                  className="group relative w-full overflow-hidden rounded-4xl border border-white/10 bg-black/15 px-5 py-5 text-left backdrop-blur-2xl transition-all hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/6 hover:shadow-2xl"
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

        <div className="group mb-8 rounded-4xl border border-white/10 bg-black/15 p-5 md:p-6 backdrop-blur-2xl transition-all hover:border-white/15 hover:bg-white/4 hover:shadow-2xl">
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
          <div className="space-y-2 pb-4">
            {filteredPlaylistSongs.map((song, index) => {
              const originalIndex = displayedPlaylist.songs.findIndex((item) => item.file === song.file && item.title === song.title && item.artist === song.artist);
              return (
                <SongListItem
                  key={`${song.title}-${song.artist}-${index}`}
                  song={song}
                  index={index}
                  secondaryText={song.album || song.artist}
                  addLabel={copy.addToPlaylist}
                  isActive={currentPlaybackPlaylistId === displayedPlaylist.id && currentPlaybackIndex === originalIndex}
                  onPlay={() => onPlaySongs(displayedPlaylist.songs, originalIndex, displayedPlaylist.id)}
                  onRemove={() => onRemoveSongFromPlaylist(originalIndex)}
                />
              );
            })}
          </div>
        )}
      </>
    );
  };

  const renderAllSongsSection = () => (
    <>
      {renderTopBar()}
      {renderSearchBox()}
      {filteredAllSongs.length === 0 ? (
        <EmptyState icon={<Music size={28} />} title={copy.emptySongs} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-6 pb-4">
          {filteredAllSongs.map((song, index) => (
            <SongCard
              key={`${song.title}-${song.artist}-${index}`}
              song={song}
              index={index}
              addLabel={copy.addToPlaylist}
              onPlay={() => onPlaySongs(filteredAllSongs, index, null)}
              onAdd={() => onAddSongToPlaylist(song)}
            />
          ))}
        </div>
      )}
    </>
  );

  const renderArtistSection = () => {
    if (activeArtistGroup) {
      return (
        <>
          {renderTopBar(true, () => setDetailState(null), (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onAddSongsToPlaylist(activeArtistGroup.songs)}
                className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white/75 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                {copy.addArtistSongs}
              </button>
            </div>
          ))}
          {renderSearchBox()}
          {detailSongs.length === 0 ? (
            <EmptyState icon={<User size={28} />} title={copy.emptySongs} />
          ) : (
            <div className="space-y-2 pb-4">
              {detailSongs.map((song, index) => (
                <SongListItem
                  key={`${song.title}-${song.artist}-${index}`}
                  song={song}
                  index={index}
                  secondaryText={`${copy.artistSongsLabel}: ${getAlbumName(song)}`}
                  addLabel={copy.addToPlaylist}
                  onPlay={() => onPlaySongs(detailSongs, index, null)}
                  onAdd={() => onAddSongToPlaylist(song)}
                />
              ))}
            </div>
          )}
        </>
      );
    }

    return (
      <>
        {renderTopBar()}
        {renderSearchBox()}
        {visibleArtists.length === 0 ? (
          <EmptyState icon={<User size={28} />} title={copy.emptyArtists} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-6 pb-4">
            {visibleArtists.map((group, index) => (
              <CollectionCard
                key={group.key}
                title={group.name}
                subtitle={copy.artistSubtitle(group.songs.length)}
                cover={group.cover}
                icon={<User size={40} />}
                index={index}
                onOpen={() => setDetailState({ type: 'artist', key: group.key })}
              />
            ))}
          </div>
        )}
      </>
    );
  };

  const renderAlbumSection = () => {
    if (activeAlbumGroup) {
      return (
        <>
          {renderTopBar(true, () => setDetailState(null), (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onAddSongsToPlaylist(activeAlbumGroup.songs)}
                className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white/75 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                {copy.addAlbumSongs}
              </button>
            </div>
          ))}
          {renderSearchBox()}
          {detailSongs.length === 0 ? (
            <EmptyState icon={<Disc size={28} />} title={copy.emptySongs} />
          ) : (
            <div className="space-y-2 pb-4">
              {detailSongs.map((song, index) => (
                <SongListItem
                  key={`${song.title}-${song.artist}-${index}`}
                  song={song}
                  index={index}
                  secondaryText={`${copy.albumSongsLabel}: ${getArtistName(song)}`}
                  addLabel={copy.addToPlaylist}
                  onPlay={() => onPlaySongs(detailSongs, index, null)}
                  onAdd={() => onAddSongToPlaylist(song)}
                />
              ))}
            </div>
          )}
        </>
      );
    }

    return (
      <>
        {renderTopBar()}
        {renderSearchBox()}
        {visibleAlbums.length === 0 ? (
          <EmptyState icon={<Disc size={28} />} title={copy.emptyAlbums} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-6 pb-4">
            {visibleAlbums.map((group, index) => (
              <CollectionCard
                key={group.key}
                title={group.name}
                subtitle={copy.albumSubtitle(group.artist)}
                cover={group.cover}
                icon={<Disc size={40} />}
                index={index}
                onOpen={() => setDetailState({ type: 'album', key: group.key })}
              />
            ))}
          </div>
        )}
      </>
    );
  };

  const renderSearchSection = () => (
    <>
      {renderTopBar()}
      {renderSearchBox()}
      {!searchQuery.trim() ? (
        <EmptyState icon={<Search size={28} />} title={copy.emptySearch} subtitle={copy.searchResultsSubtitle} />
      ) : searchResults.length === 0 ? (
        <EmptyState icon={<Search size={28} />} title={copy.noSearchResults} />
      ) : (
        <div className="space-y-2 pb-4">
          {searchResults.map((song, index) => (
            <SongListItem
              key={`${song.title}-${song.artist}-${index}`}
              song={song}
              index={index}
              secondaryText={`${song.artist}${song.album ? ` · ${song.album}` : ''}`}
              addLabel={copy.addToPlaylist}
              onPlay={() => onPlaySongs(searchResults, index, null)}
              onAdd={() => onAddSongToPlaylist(song)}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="h-full w-full flex flex-col p-6 md:p-8 overflow-y-auto scrollbar-hide">
      {isLoading ? (
        <div className="min-h-80 rounded-4xl border border-white/10 bg-black/15 backdrop-blur-2xl flex flex-col items-center justify-center gap-4 text-white/35">
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
  );
};
