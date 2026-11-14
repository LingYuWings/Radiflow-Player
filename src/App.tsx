import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Captions, CircleHelp, Disc, Heart, ListMusic, Maximize2, Minimize2, Music, Pencil, Plus, Search, Settings2, SlidersHorizontal, Trash2, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Background } from './components/Background';
import { EQView } from './components/EQView';
import { Library, LibrarySearchNavigationRequest, LibrarySection, PlaylistCollection } from './components/Library';
import { useLibrary } from './hooks/useLibrary';
import { useLyrics } from './hooks/useLyrics';
import { useNetEase } from './hooks/useNetEase';
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync';
import { LyricsView } from './components/LyricsView';
import { ConnectedMiniPlayer as MiniPlayer } from './components/PlaybackFeedback';
import { PlayerControls, LoopMode } from './components/PlayerControls';
import { Playlist } from './components/Playlist';
import { SettingsView } from './components/SettingsView';
import { normalizeVisualizerMode, VisualizerMode } from './lib/visualizer';
import { AppLogo } from './components/AppLogo';
import { WindowChrome } from './components/WindowChrome';
import { OnboardingGuide, type GuidePanel, type GuideSurface } from './components/OnboardingGuide';
import { PlaybackErrorDialog } from './components/PlaybackErrorDialog';
import { getEQCopy, getSettingsCopy, AppLanguage } from './lib/copy';
import { cn } from './lib/utils';
import { createAudioPlayback, type PlaybackError } from './lib/audioPlayback';
import { createPlaybackFeedback, hasPlaybackIntent } from './lib/playbackFeedback';
import { cardEnter, runViewTransition } from './lib/viewTransition';
import {
  AppSection,
  createSongIdentity,
  EMPTY_SONG,
  getNetEaseSongIdFromSong,
  getPersistedSongKey,
  PlaylistModalState,
  PlaylistModalScope,
  rebuildPlaylistCollections,
  Song,
  StoredPlaybackSession,
  StoredPlaylist,
  StoredPreferences,
} from './types/player';

// App is the renderer orchestration center: it owns global playback state,
// shell IPC integration, persistence, and the library/player view handoff.
const ipc = (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const APP_NAME = 'RadiFlow Player';
const APP_VERSION = '0.6.2';
const PLAYLIST_STORAGE_KEY = 'apple-music-style-player.playlists';
const PREFERENCES_STORAGE_KEY = 'apple-music-style-player.preferences';
const PREFERENCES_STORAGE_VERSION = 4;
const BACKGROUND_IMAGE_STORAGE_KEY = 'radiflow-player.background-image';
const PLAYBACK_PROGRESS_STORAGE_KEY = 'radiflow-player.playback-progress';
const PLAYBACK_SESSION_STORAGE_KEY = 'apple-music-style-player.playback-session';
const PLAYBACK_SESSION_STORAGE_VERSION = 1;
const GUIDE_COMPLETED_STORAGE_KEY = 'radiflow-player.guide-v1-completed';
const DEFAULT_CUSTOM_BACKGROUND_BLUR = 72;
const DEFAULT_TRANSPARENT_BACKGROUND_BLUR = 72;
const MAX_CUSTOM_BACKGROUND_DIMENSION = 1920;
const CUSTOM_BACKGROUND_OUTPUT_QUALITY = 0.84;

// EQ definitions stay static so the UI, audio graph, and persisted gain array all
// describe the same band order.
const EQ_BANDS = [
  { frequency: 31, label: '31 Hz' },
  { frequency: 62, label: '62 Hz' },
  { frequency: 125, label: '125 Hz' },
  { frequency: 250, label: '250 Hz' },
  { frequency: 500, label: '500 Hz' },
  { frequency: 1000, label: '1 kHz' },
  { frequency: 2000, label: '2 kHz' },
  { frequency: 4000, label: '4 kHz' },
  { frequency: 8000, label: '8 kHz' },
  { frequency: 16000, label: '16 kHz' },
] as const;
const DEFAULT_EQ_GAINS = EQ_BANDS.map(() => 0);
const clampEQGain = (value: number) => Math.max(-12, Math.min(12, value));
const sanitizeEQGains = (value: unknown) => EQ_BANDS.map((_, index) => {
  const candidate = Array.isArray(value) ? value[index] : 0;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? clampEQGain(candidate) : 0;
});
const isOverlaySection = (section: AppSection): section is 'settings' | 'eq' => section === 'settings' || section === 'eq';
const isLocalLibrarySection = (section: LibrarySection): section is Exclude<LibrarySection, 'search' | 'favoriteSongs' | 'favoriteAlbums'> => (
  section !== 'search' && section !== 'favoriteSongs' && section !== 'favoriteAlbums'
);
const isNetEaseLibrarySection = (section: LibrarySection): section is Extract<LibrarySection, 'playlists' | 'search' | 'favoriteSongs' | 'favoriteAlbums'> => (
  section === 'playlists' || section === 'search' || section === 'favoriteSongs' || section === 'favoriteAlbums'
);

// Custom background images are recompressed before persistence so they remain fast
// to load from localStorage and do not bloat the stored preferences payload.
const compressBackgroundImageFile = (file: File) => new Promise<string>((resolve, reject) => {
  if (!file.type.startsWith('image/')) {
    reject(new Error('Selected file is not an image.'));
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, MAX_CUSTOM_BACKGROUND_DIMENSION / Math.max(image.width, image.height));
    const nextWidth = Math.max(1, Math.round(image.width * scale));
    const nextHeight = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nextWidth;
    canvas.height = nextHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to create image canvas.'));
      return;
    }

    context.drawImage(image, 0, 0, nextWidth, nextHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', CUSTOM_BACKGROUND_OUTPUT_QUALITY);
    URL.revokeObjectURL(objectUrl);
    resolve(dataUrl);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Failed to load image file.'));
  };
  image.src = objectUrl;
});

const sanitizeStoredQueueSnapshot = (value: unknown): Song[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const candidate = entry as Partial<Song>;
    if (
      typeof candidate.title !== 'string'
      || typeof candidate.artist !== 'string'
      || typeof candidate.lrc !== 'string'
      || typeof candidate.file !== 'string'
    ) {
      return null;
    }

    return {
      title: candidate.title,
      artist: candidate.artist,
      album: typeof candidate.album === 'string' ? candidate.album : undefined,
      cover: typeof candidate.cover === 'string' ? candidate.cover : undefined,
      duration: typeof candidate.duration === 'number' && Number.isFinite(candidate.duration) ? candidate.duration : undefined,
      lrc: candidate.lrc,
      file: candidate.file,
    } as Song;
  }).filter((entry): entry is Song => Boolean(entry));
};

const serializePlaybackSessionSong = (track: Song): Song | null => {
  if (typeof track.file !== 'string') {
    return null;
  }

  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    cover: track.cover,
    duration: track.duration,
    lrc: track.lrc,
    file: track.file,
  };
};

const DIALOG_TRANSITION = { type: 'tween' as const, duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

export default function App() {
  // Playback, view, and persistence state are centralized here because most user
  // actions cut across multiple surfaces at once.
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackFeedback] = useState(createPlaybackFeedback);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [effect, setEffect] = useState<'blur' | 'streamer'>('streamer');
  const [backgroundSource, setBackgroundSource] = useState<'default' | 'custom' | 'transparent'>('default');
  const [customBackgroundImage, setCustomBackgroundImage] = useState<string | null>(null);
  const [customBackgroundBlur, setCustomBackgroundBlur] = useState(DEFAULT_CUSTOM_BACKGROUND_BLUR);
  const [transparentBackgroundBlur, setTransparentBackgroundBlur] = useState(DEFAULT_TRANSPARENT_BACKGROUND_BLUR);
  const [supportsTransparentBackground, setSupportsTransparentBackground] = useState<boolean | null>(null);
  const [isTransparentWindowModeEnabled, setIsTransparentWindowModeEnabled] = useState(false);
  const [transparentModeDialogState, setTransparentModeDialogState] = useState<{
    nextSource: 'default' | 'custom' | 'transparent';
    nextTransparentWindowMode: boolean;
  } | null>(null);
  const [song, setSong] = useState<Song>(EMPTY_SONG);
  const [playbackQueue, setPlaybackQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [loopMode, setLoopMode] = useState<LoopMode>('none');
  const [isShuffle, setIsShuffle] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showDockQueue, setShowDockQueue] = useState(false);
  const [showGuide, setShowGuide] = useState(() => {
    try { return window.localStorage.getItem(GUIDE_COMPLETED_STORAGE_KEY) !== '1'; }
    catch { return true; }
  });
  const guideOriginRef = useRef<{ view: 'player' | 'library'; section: AppSection; showLyrics: boolean; showPlaylist: boolean; isFullScreen: boolean } | null>(null);
  const [queueUndo, setQueueUndo] = useState<{ songs: Song[]; index: number; time: number; playing: boolean; source: string | null } | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [view, setView] = useState<'player' | 'library'>('library');
  const viewRef = useRef(view);
  viewRef.current = view;
  const [currentSection, setCurrentSection] = useState<AppSection>('playlists');
  const [lastLibrarySection, setLastLibrarySection] = useState<LibrarySection>('playlists');
  const [librarySourceMode, setLibrarySourceMode] = useState<'local' | 'netease'>('netease');
  const [language, setLanguage] = useState<AppLanguage>('zh-CN');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [playlistDefinitions, setPlaylistDefinitions] = useState<StoredPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [openedPlaylistId, setOpenedPlaylistId] = useState<string | null>(null);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(null);
  const [playlistModalState, setPlaylistModalState] = useState<PlaylistModalState>(null);
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [hasLoadedPlaylists, setHasLoadedPlaylists] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);
  const [hasLoadedPlaybackSession, setHasLoadedPlaybackSession] = useState(false);
  const [hasRestoredPlaybackSession, setHasRestoredPlaybackSession] = useState(false);
  const [pendingPlaybackSession, setPendingPlaybackSession] = useState<StoredPlaybackSession | null>(null);
  const [currentPlaybackPlaylistId, setCurrentPlaybackPlaylistId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<{ track: string; error: PlaybackError } | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [eqEnabled, setEQEnabled] = useState(false);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('spectrum');
  const [eqGains, setEQGains] = useState<number[]>(DEFAULT_EQ_GAINS);
  const [searchNavigationRequest, setSearchNavigationRequest] = useState<LibrarySearchNavigationRequest | null>(null);

  // Audio graph refs are intentionally imperative. They survive renders and should
  // not trigger UI updates on their own.
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackRef = useRef<ReturnType<typeof createAudioPlayback> | null>(null);
  const playbackTrackRef = useRef('');
  const audioObjectUrlRef = useRef<string | null>(null);
  const persistedBackgroundRef = useRef<string | null>(null);
  const preferencesOverrideRef = useRef<StoredPreferences | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const lastLibrarySectionBySourceRef = useRef<{ local: LibrarySection; netease: LibrarySection }>({
    local: 'playlists',
    netease: 'playlists',
  });
  const pendingNetEasePlaylistRequestRef = useRef<string | null>(null);
  const searchNavigationRequestIdRef = useRef(0);
  const hasActiveSong = currentIndex >= 0 && playbackQueue.length > 0 && song.title !== EMPTY_SONG.title;

  const {
    librarySongs,
    isLoadingLibrary,
    hasLoadedLibrary,
    musicFolder,
    refreshLibrary,
    selectFolder,
    openFolder,
  } = useLibrary(ipc);
  const {
    session: neteaseSession,
    cookieDraft: neteaseCookieDraft,
    setCookieDraft: setNetEaseCookieDraft,
    playlists: neteasePlaylists,
    qrState: neteaseQrState,
    statusMessage: neteaseStatusMessage,
    isRestoringSession: isRestoringNetEaseSession,
    isSavingSession: isSavingNetEaseSession,
    isLoadingPlaylists: isLoadingNetEasePlaylists,
    loginWithCookie: loginNetEaseWithCookie,
    logout: logoutNetEase,
    refreshPlaylists: refreshNetEasePlaylists,
    startQrLogin: startNetEaseQrLogin,
    loadPlaylist: loadNetEasePlaylist,
    createPlaylist: createNetEasePlaylist,
    deletePlaylist: deleteNetEasePlaylist,
    addSongsToPlaylist: addNetEaseSongsToPlaylist,
    removeSongsFromPlaylist: removeNetEaseSongsFromPlaylist,
  } = useNetEase();
  const { lyrics, isLoadingLyrics } = useLyrics({
    enabled: hasActiveSong,
    title: song.title,
    artist: song.artist,
    fileUrl: typeof song.file === 'string' ? song.file : undefined,
  });

  const handleManualLibraryRefresh = () => {
    void refreshLibrary({ forceRefresh: true });
  };

  // Transparent shell mode requires a relaunch. Persist a snapshot first so a
  // failed restart can restore the previous renderer preferences.
  const persistPreferencesSnapshot = (nextBackgroundSource: 'default' | 'custom' | 'transparent') => {
    if (typeof window === 'undefined') return null;

    const previousRawPreferences = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    const nextPreferences: StoredPreferences = {
      version: PREFERENCES_STORAGE_VERSION,
      language,
      effect,
      backgroundSource: nextBackgroundSource,
      customBackgroundImage: undefined,
      customBackgroundBlur,
      transparentBackgroundBlur,
      volume,
      eqEnabled,
      visualizerMode,
      eqGains,
      loopMode,
      isShuffle,
    };

    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
    preferencesOverrideRef.current = nextPreferences;
    return previousRawPreferences;
  };

  const handleSelectCustomBackground = async (file: File | null) => {
    if (!file) return;

    try {
      const compressedImage = await compressBackgroundImageFile(file);
      setCustomBackgroundImage(compressedImage);
      setBackgroundSource('custom');
    } catch (error) {
      console.error('Failed to prepare custom background:', error);
    }
  };

  const handleRemoveCustomBackground = () => {
    setCustomBackgroundImage(null);
    setBackgroundSource('default');
  };

  const isCustomBackgroundActive = backgroundSource === 'custom' && Boolean(customBackgroundImage);
  const isTransparentBackgroundActive = backgroundSource === 'transparent';
  const isPersonalizedBackgroundActive = isCustomBackgroundActive || isTransparentBackgroundActive;
  const transparentBackgroundMaterial = transparentBackgroundBlur <= 0
    ? 'none'
    : transparentBackgroundBlur < 44
      ? 'mica'
      : 'acrylic';
  const appShellStyle = ({
    '--rf-card-blur': `${isTransparentBackgroundActive ? transparentBackgroundBlur : customBackgroundBlur}px`,
  } as React.CSSProperties);

  const settingsCopy = useMemo(() => getSettingsCopy(language), [language]);
  const eqCopy = useMemo(() => getEQCopy(language), [language]);
  const eqBands = useMemo(() => EQ_BANDS.map((band, index) => ({
    ...band,
    gain: eqGains[index] ?? 0,
  })), [eqGains]);
  const neteaseQrStatusText = useMemo(() => {
    if (!neteaseQrState) {
      return null;
    }

    switch (neteaseQrState.statusCode) {
      case 800:
        return language === 'zh-CN' ? '二维码已过期，请重新生成。' : 'The QR code expired. Generate a new one.';
      case 801:
        return language === 'zh-CN' ? '请使用网易云音乐 App 扫码登录。' : 'Scan the QR code with the NetEase Cloud Music app.';
      case 802:
        return language === 'zh-CN' ? '已扫码，请在手机上确认登录。' : 'Scanned. Confirm the login on your phone.';
      case 803:
        return language === 'zh-CN' ? '网易云登录成功。' : 'NetEase login succeeded.';
      default:
        return neteaseQrState.statusMessage || settingsCopy.neteaseQrHint;
    }
  }, [language, neteaseQrState, settingsCopy.neteaseQrHint]);
  const neteaseStatusText = useMemo(() => {
    if (isRestoringNetEaseSession) {
      return language === 'zh-CN' ? '正在恢复网易云会话' : 'Restoring NetEase session';
    }

    if (neteaseSession.isLoggedIn && neteaseSession.account) {
      return language === 'zh-CN'
        ? `已登录：${neteaseSession.account.nickname}`
        : `Signed in as ${neteaseSession.account.nickname}`;
    }

    if (neteaseSession.isConfigured) {
      return language === 'zh-CN' ? '等待登录网易云' : 'Waiting for NetEase login';
    }

    return language === 'zh-CN' ? '尚未连接网易云' : 'NetEase is not connected';
  }, [isRestoringNetEaseSession, language, neteaseSession.account, neteaseSession.isConfigured, neteaseSession.isLoggedIn]);
  const neteaseStatusDetail = useMemo(() => {
    if (neteaseStatusMessage) {
      return neteaseStatusMessage;
    }

    if (isLoadingNetEasePlaylists) {
      return language === 'zh-CN' ? '正在同步云歌单…' : 'Syncing cloud playlists...';
    }

    if (neteaseSession.isLoggedIn) {
      return language === 'zh-CN'
        ? `已同步 ${neteasePlaylists.length} 个云歌单`
        : `Synced ${neteasePlaylists.length} cloud playlist${neteasePlaylists.length === 1 ? '' : 's'}`;
    }

    return neteaseQrStatusText || settingsCopy.neteaseDescription;
  }, [isLoadingNetEasePlaylists, language, neteasePlaylists.length, neteaseQrStatusText, neteaseSession.isLoggedIn, neteaseStatusMessage, settingsCopy.neteaseDescription]);
  const uiText = useMemo(() => {
    if (language === 'zh-CN') {
      return {
        brandTitle: '音乐中心',
        brandSubtitle: '播放列表与媒体库',
        playlists: '播放列表',
        playlistOverview: '播放列表总览',
        allSongs: '所有歌曲',
        artists: '歌手',
        albums: '专辑',
        search: '搜索',
        favoriteSongs: '收藏歌曲',
        favoriteAlbums: '收藏专辑',
        settings: '设置',
        eq: '均衡器',
        createPlaylist: '新建播放列表',
        playlistPrefix: '播放列表',
        neteasePlaylistPrefix: '云歌单',
        songsCount: (count: number) => `${count} 首歌曲`,
        playlistsCount: (count: number) => `${count} 个播放列表`,
        activeTarget: '当前目标',
        viewingPlaylist: '当前查看',
        playbackSource: '播放来源',
        nowPlaying: '正在播放',
        noPlaybackTitle: '暂无播放',
        noPlaybackSubtitle: '从媒体库或播放列表中选择音乐后，即可在这里查看播放器。',
        openPlayerHint: '打开播放器',
        createPlaylistTitle: '新建播放列表',
        createPlaylistDescription: '请输入播放列表名称。',
        playlistNamePlaceholder: '例如：通勤、夜间、收藏',
        choosePlaylistTitle: '选择播放列表',
        choosePlaylistDescription: '选择要添加到的播放列表。',
        createAndAdd: '创建并添加',
        addToSelectedPlaylist: '添加到此列表',
        cancel: '取消',
        renamePlaylist: '重命名',
        renamePlaylistTitle: '重命名播放列表',
        renamePlaylistDescription: '修改播放列表名称。',
        save: '保存',
        deletePlaylist: '删除',
        deletePlaylistTitle: '删除播放列表',
        deletePlaylistDescription: '删除后将无法恢复，但不会中断当前已经开始的播放。',
        deleteConfirm: '确认删除',
        renameSuccess: '播放列表已重命名',
        deleteSuccess: '播放列表已删除',
        addSuccess: (playlistName: string, count: number) => `已添加到 ${playlistName} · ${count} 首歌曲`,
        addNoop: '这些歌曲已存在于目标播放列表',
        playlistDeletedFallback: '已删除的播放列表',
        localScope: '本地',
        neteaseScope: '网易云',
        neteasePlaylistLoginRequired: '登录网易云后才能管理在线歌单。',
        playlistEmpty: '还没有歌单，点 + 新建一个',
        sidebarLibraryLabel: '音乐库',
        songCountLabel: '首',
        neteaseNoPlaylists: '这个账号还没有歌单。',
        sidebarNavLabel: '媒体库导航',
        neteasePlaylistCreateFailed: '创建网易云歌单失败。',
        mixedPlaylistUnsupported: '本地歌曲和在线歌曲暂时不能混合添加到同一个歌单。',
        openSettings: '打开设置',
        openEQ: '打开均衡器',
        settingsTransparentUnsupported: '当前系统不支持系统级毛玻璃透明背景',
        transparentModeEnableTitle: '启用透明背景',
        transparentModeEnableDescription: '透明背景仍属于实验性功能。确认后应用会立即重新启动，并切换到透明窗口模式。',
        transparentModeDisableTitle: '退出透明背景',
        transparentModeDisableDescription: '退出透明背景同样需要重新启动窗口，才能恢复常规背景渲染。',
        transparentModeRestartConfirm: '重启并应用',
        transparentModeRestartFailed: '重启失败，当前背景模式未变更。',
      };
    }

    return {
      brandTitle: 'Music Hub',
      brandSubtitle: 'Playlists and library',
      playlists: 'Playlists',
      playlistOverview: 'Playlist Overview',
      allSongs: 'All Songs',
      artists: 'Artists',
      albums: 'Albums',
      search: 'Search',
      favoriteSongs: 'Favorite Songs',
      favoriteAlbums: 'Favorite Albums',
      settings: 'Settings',
      eq: 'Equalizer',
      createPlaylist: 'New Playlist',
      playlistPrefix: 'Playlist',
      neteasePlaylistPrefix: 'Cloud Playlist',
      songsCount: (count: number) => `${count} track${count === 1 ? '' : 's'}`,
      playlistsCount: (count: number) => `${count} playlist${count === 1 ? '' : 's'}`,
      activeTarget: 'Target',
      viewingPlaylist: 'Viewing',
      playbackSource: 'Queue Source',
      nowPlaying: 'Now Playing',
      noPlaybackTitle: 'Nothing Playing',
      noPlaybackSubtitle: 'Choose a track from the library or a playlist to start the player view.',
      openPlayerHint: 'Open Player',
      createPlaylistTitle: 'Create Playlist',
      createPlaylistDescription: 'Enter a name for the playlist.',
      playlistNamePlaceholder: 'For example: Commute, Nights, Favorites',
      choosePlaylistTitle: 'Choose Playlist',
      choosePlaylistDescription: 'Pick the playlist that should receive these songs.',
      createAndAdd: 'Create and Add',
      addToSelectedPlaylist: 'Add to This Playlist',
      cancel: 'Cancel',
      renamePlaylist: 'Rename',
      renamePlaylistTitle: 'Rename Playlist',
      renamePlaylistDescription: 'Update the playlist name.',
      save: 'Save',
      deletePlaylist: 'Delete',
      deletePlaylistTitle: 'Delete Playlist',
      deletePlaylistDescription: 'This cannot be undone, but any queue already playing will continue.',
      deleteConfirm: 'Delete Playlist',
      renameSuccess: 'Playlist renamed',
      deleteSuccess: 'Playlist deleted',
      addSuccess: (playlistName: string, count: number) => `Added ${count} track${count === 1 ? '' : 's'} to ${playlistName}`,
      addNoop: 'Those tracks are already in the target playlist',
      playlistDeletedFallback: 'Deleted playlist',
      localScope: 'Local',
      neteaseScope: 'NetEase',
      neteasePlaylistLoginRequired: 'Sign in to NetEase before managing online playlists.',
      playlistEmpty: 'No playlists yet — tap + to create one.',
      sidebarLibraryLabel: 'Library',
      songCountLabel: 'songs',
      neteaseNoPlaylists: 'This account has no playlists yet.',
      sidebarNavLabel: 'Library navigation',
      neteasePlaylistCreateFailed: 'Failed to create NetEase playlist.',
      mixedPlaylistUnsupported: 'Local tracks and online tracks cannot be added together yet.',
      openSettings: 'Open Settings',
      openEQ: 'Open Equalizer',
      settingsTransparentUnsupported: 'System glass transparency is not supported on this machine',
      transparentModeEnableTitle: 'Enable Transparent Background',
      transparentModeEnableDescription: 'Transparent background is still experimental. Confirming will restart the app immediately and switch to transparent window mode.',
      transparentModeDisableTitle: 'Exit Transparent Background',
      transparentModeDisableDescription: 'Leaving transparent background also requires a restart so the window can return to the standard background renderer.',
      transparentModeRestartConfirm: 'Restart and Apply',
      transparentModeRestartFailed: 'Failed to restart the app. The current background mode was kept.',
    };
  }, [language]);

  const closeTransparentModeDialog = () => {
    setTransparentModeDialogState(null);
  };

  const confirmTransparentModeChange = async () => {
    if (!transparentModeDialogState) return;

    const { nextSource, nextTransparentWindowMode } = transparentModeDialogState;
    closeTransparentModeDialog();

    if (!ipc) {
      setBackgroundSource(nextSource);
      return;
    }

    const previousRawPreferences = persistPreferencesSnapshot(nextSource);

    try {
      await ipc.invoke('window:restart-with-shell-mode', nextTransparentWindowMode);
    } catch {
      preferencesOverrideRef.current = null;
      if (typeof window !== 'undefined') {
        if (previousRawPreferences === null) {
          window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
        } else {
          window.localStorage.setItem(PREFERENCES_STORAGE_KEY, previousRawPreferences);
        }
      }

      setToastMessage(uiText.transparentModeRestartFailed);
    }
  };

  const handleBackgroundSourceChange = (source: 'default' | 'custom' | 'transparent') => {
    if (source === 'transparent' && supportsTransparentBackground === false) {
      setToastMessage(uiText.settingsTransparentUnsupported);
      return;
    }

    const shouldEnterTransparentWindowMode = source === 'transparent' && !isTransparentWindowModeEnabled;
    const shouldExitTransparentWindowMode = source !== 'transparent' && isTransparentWindowModeEnabled;

    if (shouldEnterTransparentWindowMode || shouldExitTransparentWindowMode) {
      setTransparentModeDialogState({
        nextSource: source,
        nextTransparentWindowMode: source === 'transparent',
      });
      return;
    }

    setBackgroundSource(source);
  };

  const handleEQGainChange = (bandIndex: number, gain: number) => {
    setEQGains((current) => current.map((value, index) => (
      index === bandIndex ? clampEQGain(gain) : value
    )));
  };

  const handleEQReset = () => {
    setEQGains([...DEFAULT_EQ_GAINS]);
  };

  // Playlists are rehydrated against the current library snapshot so missing songs
  // naturally disappear from derived playlist collections after rescans.
  const savedPlaylists = useMemo(
    () => rebuildPlaylistCollections(playlistDefinitions, librarySongs),
    [playlistDefinitions, librarySongs]
  );
  const allPlaylists = useMemo(
    () => [...savedPlaylists, ...neteasePlaylists],
    [neteasePlaylists, savedPlaylists]
  );
  const editableNetEasePlaylists = useMemo(
    () => neteasePlaylists.filter((playlist) => playlist.playlistCategory === 'created'),
    [neteasePlaylists]
  );
  const localSidebarItems = useMemo<Array<{ id: LibrarySection; label: string; icon: React.ReactNode }>>(() => [
    { id: 'playlists', label: uiText.playlists, icon: <ListMusic size={18} /> },
    { id: 'all', label: uiText.allSongs, icon: <Music size={18} /> },
    { id: 'artists', label: uiText.artists, icon: <User size={18} /> },
    { id: 'albums', label: uiText.albums, icon: <Disc size={18} /> },
  ], [uiText.allSongs, uiText.albums, uiText.artists, uiText.playlists]);
  const neteaseSidebarItems = useMemo<Array<{ id: LibrarySection; label: string; icon: React.ReactNode }>>(() => [
    { id: 'playlists', label: uiText.playlists, icon: <ListMusic size={18} /> },
    { id: 'favoriteSongs', label: uiText.favoriteSongs, icon: <Heart size={18} /> },
    { id: 'favoriteAlbums', label: uiText.favoriteAlbums, icon: <Disc size={18} /> },
    { id: 'search', label: uiText.search, icon: <Search size={18} /> },
  ], [uiText.favoriteAlbums, uiText.favoriteSongs, uiText.playlists, uiText.search]);
  const sidebarItems = librarySourceMode === 'netease' ? neteaseSidebarItems : localSidebarItems;
  const visibleLibraryPlaylists = useMemo(
    () => librarySourceMode === 'netease' ? neteasePlaylists : savedPlaylists,
    [librarySourceMode, neteasePlaylists, savedPlaylists]
  );

  const selectedPlaylist = useMemo(
    () => savedPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? savedPlaylists[0] ?? null,
    [savedPlaylists, selectedPlaylistId]
  );

  const displayedPlaylist = useMemo(
    () => visibleLibraryPlaylists.find((playlist) => playlist.id === openedPlaylistId) ?? null,
    [openedPlaylistId, visibleLibraryPlaylists]
  );

  // Large NetEase playlists arrive page by page. A queue started from such a
  // playlist and left untouched (same song objects, same order) grows with it;
  // an edited, shuffled-in or restored queue is never rewritten.
  useEffect(() => {
    if (!currentPlaybackPlaylistId) return;
    const source = neteasePlaylists.find((playlist) => playlist.id === currentPlaybackPlaylistId);
    if (!source || source.songs.length <= playbackQueue.length || playbackQueue.length === 0) return;
    if (!playbackQueue.every((track, index) => track === source.songs[index])) return;
    setPlaybackQueue(source.songs.slice());
  }, [currentPlaybackPlaylistId, neteasePlaylists, playbackQueue]);

  const getDefaultPlaylistName = (scope: PlaylistModalScope) => (
    scope === 'netease'
      ? `${uiText.neteasePlaylistPrefix} ${editableNetEasePlaylists.length + 1}`
      : `${uiText.playlistPrefix} ${playlistDefinitions.length + 1}`
  );

  const openCreatePlaylistModalForScope = (
    scope: PlaylistModalScope,
    {
      pendingSongKeys = [],
      pendingSongIds = [],
      openPlaylistsAfterCreate,
      allowScopeSelection,
    }: {
      pendingSongKeys?: string[];
      pendingSongIds?: string[];
      openPlaylistsAfterCreate: boolean;
      allowScopeSelection: boolean;
    }
  ) => {
    setPlaylistNameDraft(getDefaultPlaylistName(scope));
    setPlaylistModalState({
      type: 'create-playlist',
      scope,
      pendingSongKeys,
      pendingSongIds,
      openPlaylistsAfterCreate,
      allowScopeSelection,
    });
  };

  const openRenamePlaylistModal = (playlistId: string) => {
    const playlist = playlistDefinitions.find((entry) => entry.id === playlistId);
    if (!playlist) return;

    setPlaylistNameDraft(playlist.name);
    setPlaylistModalState({ type: 'rename-playlist', playlistId, scope: 'local' });
  };

  const openDeletePlaylistModal = (playlistId: string, scope: PlaylistModalScope = 'local') => {
    const playlist = scope === 'netease'
      ? neteasePlaylists.find((entry) => entry.id === playlistId)
      : playlistDefinitions.find((entry) => entry.id === playlistId);
    if (!playlist) return;

    setPlaylistModalState({
      type: 'delete-playlist',
      playlistId,
      playlistName: playlist.name,
      scope,
    });
  };

  const updateCreatePlaylistModalScope = (scope: PlaylistModalScope) => {
    setPlaylistModalState((current) => {
      if (!current || current.type !== 'create-playlist' || !current.allowScopeSelection || current.scope === scope) {
        return current;
      }

      const currentDefaultName = getDefaultPlaylistName(current.scope);
      const nextDefaultName = getDefaultPlaylistName(scope);
      setPlaylistNameDraft((draft) => {
        const normalizedDraft = draft.trim();
        return !normalizedDraft || normalizedDraft === currentDefaultName ? nextDefaultName : draft;
      });

      return {
        ...current,
        scope,
      };
    });
  };

  const closePlaylistModal = () => {
    setPlaylistModalState(null);
    setPlaylistNameDraft('');
  };

  const showToast = (message: string) => {
    setToastMessage(message);
  };

  // Lazily create the Web Audio graph on first interaction. This keeps startup cheap
  // and avoids autoplay restrictions until the user explicitly plays something.
  const initAudioContext = () => {
    if (!audioContextRef.current && audioRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const context = new AudioContextClass();
      const analyserNode = context.createAnalyser();
      analyserNode.fftSize = 256;

      const eqFilters = EQ_BANDS.map(({ frequency }, index) => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        filter.gain.value = eqEnabled ? eqGains[index] ?? 0 : 0;
        return filter;
      });

      const source = context.createMediaElementSource(audioRef.current);
      let previousNode: AudioNode = source;
      eqFilters.forEach((filter) => {
        previousNode.connect(filter);
        previousNode = filter;
      });
      previousNode.connect(analyserNode);
      analyserNode.connect(context.destination);

      audioContextRef.current = context;
      sourceRef.current = source;
      eqFiltersRef.current = eqFilters;
      setAnalyser(analyserNode);
    }

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  // EQ changes only retune existing filters; the graph topology is created once.
  useEffect(() => {
    const context = audioContextRef.current;
    const filters = eqFiltersRef.current;
    if (!context || filters.length === 0) {
      return;
    }

    filters.forEach((filter, index) => {
      const nextGain = eqEnabled ? clampEQGain(eqGains[index] ?? 0) : 0;
      filter.gain.setTargetAtTime(nextGain, context.currentTime, 0.015);
    });
  }, [eqEnabled, eqGains]);

  const loadPlaybackTrack = (track: Song, autoplay: boolean, time = 0) => {
    const url = typeof track.file === 'string' ? track.file : track.file ? URL.createObjectURL(track.file) : '';
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    audioObjectUrlRef.current = track.file && typeof track.file !== 'string' ? url : null;
    playbackTrackRef.current = track.title;
    setPlaybackError(null);
    if (!url) {
      playbackRef.current?.clear();
      if (autoplay) setPlaybackError({ track: track.title, error: { code: 'MEDIA_SOURCE_MISSING' } });
      return;
    }
    if (autoplay) initAudioContext();
    playbackRef.current?.load(url, autoplay, time);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let previousIntent = false;
    const controller = createAudioPlayback(audio, (status, error) => {
      playbackFeedback.setStatus(status);
      if (error && playbackTrackRef.current) {
        setPlaybackError({ track: playbackTrackRef.current, error });
      }
      const intent = hasPlaybackIntent(status);
      if (intent !== previousIntent) {
        previousIntent = intent;
        setIsPlaying(intent);
      }
    });
    playbackRef.current = controller;
    return () => {
      controller.dispose();
      playbackFeedback.cancelPending();
      playbackRef.current = null;
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    };
  }, []);

  // Restore persisted queue entries after both the local library and cloud session load.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasLoadedPlaybackSession || hasRestoredPlaybackSession || !hasLoadedLibrary || isRestoringNetEaseSession) return;

    if (!pendingPlaybackSession) {
      setHasRestoredPlaybackSession(true);
      return;
    }

    const sessionToRestore = pendingPlaybackSession;
    const songMap = new Map(librarySongs.map((track) => [createSongIdentity(track), track]));
    const snapshotSongMap = new Map((sessionToRestore.queueSnapshot ?? []).map((track) => [createSongIdentity(track), track]));
    const restoredQueue = sessionToRestore.queueSongKeys
      .map((songKey) => songMap.get(songKey) ?? snapshotSongMap.get(songKey))
      .filter((track): track is Song => Boolean(track));
    const restoredIndex = restoredQueue.findIndex((track) => createSongIdentity(track) === sessionToRestore.currentSongKey);

    if (restoredQueue.length === 0 || restoredIndex < 0) {
      window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
      setPendingPlaybackSession(null);
      setHasRestoredPlaybackSession(true);
      return;
    }

    const restoredSong = restoredQueue[restoredIndex];
    const restoredTime = Math.max(0, sessionToRestore.currentTime);
    setPlaybackQueue(restoredQueue);
    setCurrentPlaybackPlaylistId(sessionToRestore.currentPlaybackPlaylistId);
    setCurrentIndex(restoredIndex);
    setSong(restoredSong);
    setCurrentTime(restoredTime);
    setDuration(0);
    // Startup always opens the home library; restoring a track never autoplays.
    setView('library');
    setCurrentSection('playlists');
    setIsPlaying(false);
    setShowLyrics(sessionToRestore.showLyrics);
    setShowPlaylist(sessionToRestore.showPlaylist);
    setHasRestoredPlaybackSession(true);
    setPendingPlaybackSession(null);

    loadPlaybackTrack(restoredSong, false, restoredTime);
  }, [hasLoadedLibrary, hasLoadedPlaybackSession, hasRestoredPlaybackSession, isRestoringNetEaseSession, librarySongs, pendingPlaybackSession]);

  // Audio element events remain the source of truth for time and duration, then
  // React state mirrors them into the visible control surfaces.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const handleEnded = () => {
      if (loopMode === 'one') {
        audio.currentTime = 0;
        void playbackRef.current?.play();
      } else {
        handleNext();
      }
    };

    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [loopMode, playbackQueue, currentIndex, isShuffle]);

  // Window maximize state is owned by the native shell, so the renderer asks for the
  // current value once and then subscribes to future shell-originated changes.
  useEffect(() => {
    if (!ipc) return;

    ipc.invoke('window:is-maximized').then((value: boolean) => {
      setIsWindowMaximized(Boolean(value));
    }).catch((error: unknown) => {
      console.error('Failed to read maximized state:', error);
    });

    const handleWindowState = (_event: unknown, value: boolean) => {
      setIsWindowMaximized(Boolean(value));
    };

    ipc.on('window:maximized-state-changed', handleWindowState);
    return () => {
      ipc.removeListener('window:maximized-state-changed', handleWindowState);
    };
  }, []);

  // Restore playlist definitions from localStorage once and normalize any malformed
  // entries before they enter live state.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawPlaylists = window.localStorage.getItem(PLAYLIST_STORAGE_KEY);
      if (!rawPlaylists) return;

      const parsed = JSON.parse(rawPlaylists);
      if (!Array.isArray(parsed)) return;

      const hydrated = parsed
        .filter((entry): entry is StoredPlaylist => Boolean(entry) && typeof entry.id === 'string' && typeof entry.name === 'string' && Array.isArray(entry.songKeys))
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          songKeys: entry.songKeys.filter((songKey) => typeof songKey === 'string'),
          updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        }));

      setPlaylistDefinitions(hydrated);
    } catch (error) {
      console.error('Failed to restore playlists:', error);
    } finally {
      setHasLoadedPlaylists(true);
    }
  }, []);

  // Preferences accept older schema versions so upgrades preserve user state whenever
  // the stored payload is still understandable.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawPreferences = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (!rawPreferences) return;

      const parsed = JSON.parse(rawPreferences) as Partial<StoredPreferences>;
      if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== PREFERENCES_STORAGE_VERSION) return;

      if (parsed.language === 'zh-CN' || parsed.language === 'en-US') {
        setLanguage(parsed.language);
      }

      if (parsed.effect === 'blur' || parsed.effect === 'streamer') {
        setEffect(parsed.effect);
      }

      if (parsed.backgroundSource === 'default' || parsed.backgroundSource === 'custom' || parsed.backgroundSource === 'transparent') {
        setBackgroundSource(parsed.backgroundSource);
      }

      const savedBackground = window.localStorage.getItem(BACKGROUND_IMAGE_STORAGE_KEY);
      setCustomBackgroundImage(savedBackground ?? (typeof parsed.customBackgroundImage === 'string' ? parsed.customBackgroundImage : null));

      if (typeof parsed.customBackgroundBlur === 'number' && Number.isFinite(parsed.customBackgroundBlur)) {
        setCustomBackgroundBlur(Math.min(120, Math.max(0, parsed.customBackgroundBlur)));
      }

      if (typeof parsed.transparentBackgroundBlur === 'number' && Number.isFinite(parsed.transparentBackgroundBlur)) {
        setTransparentBackgroundBlur(Math.min(120, Math.max(0, parsed.transparentBackgroundBlur)));
      }

      if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) {
        setVolume(Math.min(1, Math.max(0, parsed.volume)));
      }

      setVisualizerMode(normalizeVisualizerMode(parsed.visualizerMode));
      if (typeof parsed.eqEnabled === 'boolean') {
        setEQEnabled(parsed.eqEnabled);
      }

      if (Array.isArray(parsed.eqGains)) {
        setEQGains(sanitizeEQGains(parsed.eqGains));
      }

      if (parsed.loopMode === 'none' || parsed.loopMode === 'all' || parsed.loopMode === 'one') {
        setLoopMode(parsed.loopMode);
      }

      if (typeof parsed.isShuffle === 'boolean') {
        setIsShuffle(parsed.isShuffle);
      }
    } catch (error) {
      console.error('Failed to restore preferences:', error);
    } finally {
      setHasLoadedPreferences(true);
    }
  }, []);

  // Queue/session persistence is intentionally separate from preferences so transport
  // state can evolve independently of the wider UI configuration.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let nextSession: StoredPlaybackSession | null = null;

    try {
      const rawPlaybackSession = window.localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
      if (rawPlaybackSession) {
        const parsed = JSON.parse(rawPlaybackSession) as Partial<StoredPlaybackSession>;
        const hasValidSchema = parsed.version === PLAYBACK_SESSION_STORAGE_VERSION
          && Array.isArray(parsed.queueSongKeys)
          && typeof parsed.currentSongKey === 'string'
          && typeof parsed.currentTime === 'number'
          && Number.isFinite(parsed.currentTime)
          && typeof parsed.isPlaying === 'boolean'
          && (parsed.currentPlaybackPlaylistId === null || typeof parsed.currentPlaybackPlaylistId === 'string')
          && (parsed.view === 'player' || parsed.view === 'library')
          && typeof parsed.showLyrics === 'boolean'
          && typeof parsed.showPlaylist === 'boolean';

        if (hasValidSchema) {
          nextSession = {
            version: PLAYBACK_SESSION_STORAGE_VERSION,
            queueSongKeys: parsed.queueSongKeys.filter((songKey): songKey is string => typeof songKey === 'string'),
            queueSnapshot: sanitizeStoredQueueSnapshot(parsed.queueSnapshot),
            currentSongKey: parsed.currentSongKey,
            currentTime: Math.max(0, parsed.currentTime),
            isPlaying: parsed.isPlaying,
            currentPlaybackPlaylistId: parsed.currentPlaybackPlaylistId ?? null,
            view: parsed.view,
            showLyrics: parsed.showLyrics,
            showPlaylist: parsed.showPlaylist,
          };
        } else {
          window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
        }
      }
      const rawProgress = window.localStorage.getItem(PLAYBACK_PROGRESS_STORAGE_KEY);
      if (nextSession && rawProgress) {
        try {
          const progress = JSON.parse(rawProgress);
          if (progress.currentSongKey === nextSession.currentSongKey
            && Number.isFinite(progress.currentTime) && typeof progress.isPlaying === 'boolean') {
            nextSession.currentTime = Math.max(0, progress.currentTime);
            nextSession.isPlaying = progress.isPlaying;
          }
        } catch { /* Keep the full session if the small progress record is corrupt. */ }
      }
    } catch (error) {
      console.error('Failed to restore playback session:', error);
      window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
    } finally {
      setPendingPlaybackSession(nextSession);
      setHasLoadedPlaybackSession(true);
      setHasRestoredPlaybackSession(!nextSession);
    }
  }, []);

  // Only mirror playlists back into storage after the initial hydration pass, or an
  // empty default state would overwrite valid saved data.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasLoadedPlaylists) return;

    window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlistDefinitions));
  }, [hasLoadedPlaylists, playlistDefinitions]);

  // Migrate legacy inline images once. Sliders never serialize the image again.
  useEffect(() => {
    if (!hasLoadedPreferences) return;
    try {
      if (customBackgroundImage) window.localStorage.setItem(BACKGROUND_IMAGE_STORAGE_KEY, customBackgroundImage);
      else window.localStorage.removeItem(BACKGROUND_IMAGE_STORAGE_KEY);
      persistedBackgroundRef.current = customBackgroundImage;
    } catch (error) {
      console.error('Failed to persist background image:', error);
    }
  }, [hasLoadedPreferences, customBackgroundImage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasLoadedPreferences) return;

    const preferences: StoredPreferences = {
      version: PREFERENCES_STORAGE_VERSION,
      language,
      effect,
      backgroundSource,
      customBackgroundImage: undefined,
      customBackgroundBlur,
      transparentBackgroundBlur,
      volume,
      eqEnabled,
      visualizerMode,
      eqGains,
      loopMode,
      isShuffle,
    };

    const save = () => {
      try {
        // Retain the legacy image in preferences if its migration did not fit in storage.
        const next = preferencesOverrideRef.current || preferences;
        window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(persistedBackgroundRef.current === customBackgroundImage ? next : { ...next, customBackgroundImage }));
      } catch (error) { console.error('Failed to persist preferences:', error); }
    };
    const timer = window.setTimeout(save, 250);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
    };
  }, [hasLoadedPreferences, language, effect, backgroundSource, customBackgroundImage, customBackgroundBlur, transparentBackgroundBlur, volume, eqEnabled, visualizerMode, eqGains, loopMode, isShuffle]);

  // Reconcile renderer preference state with the native shell. If the stored shell
  // mode differs from the desired background source, the app relaunches to match.
  useEffect(() => {
    if (!ipc || !hasLoadedPreferences) return;

    ipc.invoke('window:get-shell-state')
      .then(async (result: { supported?: boolean; transparentWindow?: boolean } | null) => {
        const supportsTransparentWindow = Boolean(result?.supported);
        const isTransparentWindowEnabled = Boolean(result?.transparentWindow);
        const shouldUseTransparentWindow = backgroundSource === 'transparent';

        setSupportsTransparentBackground(supportsTransparentWindow);

        if (isTransparentWindowEnabled !== shouldUseTransparentWindow) {
          await ipc.invoke('window:restart-with-shell-mode', shouldUseTransparentWindow);
          return;
        }

        setIsTransparentWindowModeEnabled(isTransparentWindowEnabled);
      })
      .catch(() => {
        setSupportsTransparentBackground(false);
        setIsTransparentWindowModeEnabled(false);
      });
  }, [backgroundSource, hasLoadedPreferences]);

  useEffect(() => {
    if (backgroundSource === 'transparent' && supportsTransparentBackground === false) {
      setBackgroundSource('default');
    }
  }, [backgroundSource, supportsTransparentBackground]);

  useEffect(() => {
    if (!ipc) return;

    // Background material only matters while the transparent shell is active.
    const backgroundMaterial = backgroundSource === 'transparent' && isTransparentWindowModeEnabled
      ? transparentBackgroundMaterial
      : 'none';
    ipc.invoke('window:set-background-material', backgroundMaterial).catch(() => undefined);
  }, [backgroundSource, isTransparentWindowModeEnabled, transparentBackgroundMaterial]);

  const storedQueue = useMemo(() => {
    const queueSongKeys = playbackQueue.map(getPersistedSongKey).filter((key): key is string => Boolean(key));
    const queueSnapshot = playbackQueue.map(serializePlaybackSessionSong).filter((track): track is Song => Boolean(track));
    return { queueSongKeys, queueKeySet: new Set(queueSongKeys), queueSnapshot, queueJson: '' };
  }, [playbackQueue]);
  // Serialized lazily, once per queue change, never per play/pause/view change.
  const getStoredQueueJson = useCallback(() => {
    if (!storedQueue.queueJson) {
      storedQueue.queueJson = JSON.stringify({ queueSongKeys: storedQueue.queueSongKeys, queueSnapshot: storedQueue.queueSnapshot });
    }
    return storedQueue.queueJson;
  }, [storedQueue]);
  const pendingSessionWriteRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const flush = () => {
      const write = pendingSessionWriteRef.current;
      pendingSessionWriteRef.current = null;
      write?.();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasLoadedPlaybackSession || !hasRestoredPlaybackSession) return;

    // Persist only stable song keys so the session can be restored after a reload
    // without depending entirely on the current in-memory library snapshot.
    const currentSongKey = hasActiveSong ? getPersistedSongKey(song) : null;
    const { queueKeySet } = storedQueue;

    const writePlaybackSession = (session: Omit<StoredPlaybackSession, 'queueSongKeys' | 'queueSnapshot'> | null) => {
      try {
        if (session) {
          // Splice the cached queue JSON into the small state record.
          const head = JSON.stringify(session);
          window.localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, `${head.slice(0, -1)},${getStoredQueueJson().slice(1)}`);
        } else {
          window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
        }
      } catch (error) {
        console.error('Failed to persist playback session:', error);
      }
    };

    const playbackSession = currentSongKey && queueKeySet.has(currentSongKey)
      ? {
          version: PLAYBACK_SESSION_STORAGE_VERSION,
          currentSongKey,
          currentTime: playbackRef.current?.getPosition() ?? 0,
          isPlaying,
          currentPlaybackPlaylistId,
          view,
          showLyrics,
          showPlaylist,
        }
      : null;

    // Deferred off the interaction frame (view switches, play/pause); flushed on unload.
    pendingSessionWriteRef.current = () => writePlaybackSession(playbackSession);
    const timeoutId = window.setTimeout(() => {
      const write = pendingSessionWriteRef.current;
      pendingSessionWriteRef.current = null;
      write?.();
    }, 450);
    return () => window.clearTimeout(timeoutId);

  }, [
    currentPlaybackPlaylistId,
    hasActiveSong,
    hasLoadedPlaybackSession,
    hasRestoredPlaybackSession,
    isPlaying,
    storedQueue,
    showLyrics,
    showPlaylist,
    song,
    view,
    getStoredQueueJson,
  ]);

  // Progress is a tiny separate record. Queue serialization is never on the clock path.
  useEffect(() => {
    if (!hasRestoredPlaybackSession || !hasLoadedPlaybackSession) return;
    const currentSongKey = hasActiveSong ? getPersistedSongKey(song) : null;
    let lastValue = '';
    const saveProgress = () => {
      try {
        if (!currentSongKey) {
          window.localStorage.removeItem(PLAYBACK_PROGRESS_STORAGE_KEY);
          return;
        }
        const audio = audioRef.current;
        const value = JSON.stringify({
          currentSongKey,
          currentTime: playbackRef.current?.getPosition() ?? 0,
          isPlaying: Boolean(audio && !audio.paused && !audio.ended && !audio.error),
        });
        if (value !== lastValue) {
          window.localStorage.setItem(PLAYBACK_PROGRESS_STORAGE_KEY, value);
          lastValue = value;
        }
      } catch (error) { console.error('Failed to persist playback progress:', error); }
    };
    saveProgress();
    const timer = window.setInterval(saveProgress, 5000);
    window.addEventListener('pagehide', saveProgress);
    window.addEventListener('beforeunload', saveProgress);
    audioRef.current?.addEventListener('pause', saveProgress);
    audioRef.current?.addEventListener('seeked', saveProgress);
    const audio = audioRef.current;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', saveProgress);
      window.removeEventListener('beforeunload', saveProgress);
      audio?.removeEventListener('pause', saveProgress);
      audio?.removeEventListener('seeked', saveProgress);
    };
  }, [hasRestoredPlaybackSession, hasLoadedPlaybackSession, hasActiveSong, song, isPlaying]);

  useEffect(() => {
    if (!selectedPlaylistId && savedPlaylists.length > 0) {
      setSelectedPlaylistId(savedPlaylists[0].id);
      return;
    }

    if (selectedPlaylistId && !savedPlaylists.some((playlist) => playlist.id === selectedPlaylistId)) {
      setSelectedPlaylistId(savedPlaylists[0]?.id ?? null);
    }
  }, [savedPlaylists, selectedPlaylistId]);

  useEffect(() => {
    if (!openedPlaylistId) return;

    if (!allPlaylists.some((playlist) => playlist.id === openedPlaylistId)) {
      setOpenedPlaylistId(null);
    }
  }, [allPlaylists, openedPlaylistId]);

  useEffect(() => {
    if (!toastMessage) return;

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null);
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!ipc) return;

    // Main-process media keys and taskbar controls reuse the same playback handlers
    // as the on-screen controls.
    const handleControl = (_event: any, command: string) => {
      switch (command) {
        case 'toggle-play':
          togglePlay();
          break;
        case 'next':
          handleNext();
          break;
        case 'prev':
          handlePrev();
          break;
      }
    };

    ipc.on('player-control', handleControl);
    return () => ipc.removeListener('player-control', handleControl);
  }, [isPlaying, currentIndex, playbackQueue, isShuffle, loopMode]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Keep Windows taskbar buttons/progress synchronized without leaking shell
  // concerns into child components.
  useEffect(() => {
    if (!ipc) return;
    const audio = audioRef.current;
    let lastSecond = -1;
    const sync = () => {
      const time = Math.floor(audio?.currentTime || 0);
      if (time === lastSecond) return;
      lastSecond = time;
      ipc.send('media:update-playback-state', { isPlaying, hasActiveSong, currentTime: time, duration });
    };
    sync();
    audio?.addEventListener('timeupdate', sync);
    return () => audio?.removeEventListener('timeupdate', sync);
  }, [isPlaying, hasActiveSong, duration]);

  // Central queue loader used by direct play, next/prev navigation, and playlist playback.
  const playSongs = async (songsToPlay: Song[], index: number, sourcePlaylistId: string | null = null) => {
    if (index < 0 || index >= songsToPlay.length) return;

    const nextQueue = [...songsToPlay];
    const selectedSong = nextQueue[index];

    setPlaybackQueue(nextQueue);
    setCurrentPlaybackPlaylistId(sourcePlaylistId);
    setCurrentIndex(index);
    setSong(selectedSong);
    setCurrentTime(0);
    setDuration(0);

    loadPlaybackTrack(selectedSong, true);
  };

  const togglePlay = () => {
    if (song.file && song.title !== EMPTY_SONG.title) {
      initAudioContext();
      playbackRef.current?.toggle();
    }
  };

  const handleSeek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Number.isFinite(audio.duration) ? Math.min(time, audio.duration) : time);
    // Local clock subscribers handle seeking; do not rerender the entire app.
  }, []);

  const playSong = async (index: number) => {
    if (index < 0 || index >= playbackQueue.length) return;
    await playSongs(playbackQueue, index, currentPlaybackPlaylistId);
  };

  const openCreatePlaylistModal = (pendingSongs: Song[] = [], openPlaylistsAfterCreate = true) => {
    const pendingSongIds = Array.from(
      new Set(
        pendingSongs
          .map(getNetEaseSongIdFromSong)
          .filter((songId): songId is string => Boolean(songId))
      )
    );

    if (pendingSongs.length > 0 && pendingSongIds.length === pendingSongs.length) {
      if (!neteaseSession.isLoggedIn) {
        showToast(uiText.neteasePlaylistLoginRequired);
        return;
      }

      openCreatePlaylistModalForScope('netease', {
        pendingSongIds,
        openPlaylistsAfterCreate,
        allowScopeSelection: false,
      });
      return;
    }

    const pendingSongKeys = Array.from(
      new Set(
        pendingSongs
          .map(getPersistedSongKey)
          .filter((songKey): songKey is string => Boolean(songKey))
      )
    );

    openCreatePlaylistModalForScope('local', {
      pendingSongKeys,
      openPlaylistsAfterCreate,
      allowScopeSelection: pendingSongs.length === 0 && neteaseSession.isLoggedIn,
    });
  };

  const appendSongKeysToPlaylist = (playlistId: string, songKeys: string[]) => {
    if (songKeys.length === 0) {
      return {
        addedCount: 0,
        playlistName: playlistDefinitions.find((playlist) => playlist.id === playlistId)?.name || '',
      };
    }

    let addedCount = 0;
    let playlistName = '';

    setPlaylistDefinitions((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;

      playlistName = playlist.name;
      const existing = new Set(playlist.songKeys);
      const mergedSongKeys = [...playlist.songKeys];

      songKeys.forEach((songKey) => {
        if (!existing.has(songKey)) {
          existing.add(songKey);
          mergedSongKeys.push(songKey);
          addedCount += 1;
        }
      });

      return {
        ...playlist,
        songKeys: mergedSongKeys,
        updatedAt: addedCount > 0 ? Date.now() : playlist.updatedAt,
      };
    }));

    return { addedCount, playlistName };
  };

  const requestAddSongsToPlaylist = (songsToAdd: Song[]) => {
    const pendingSongIds = Array.from(
      new Set(
        songsToAdd
          .map(getNetEaseSongIdFromSong)
          .filter((songId): songId is string => Boolean(songId))
      )
    );

    if (pendingSongIds.length > 0) {
      if (pendingSongIds.length !== songsToAdd.length) {
        showToast(uiText.mixedPlaylistUnsupported);
        return;
      }

      if (!neteaseSession.isLoggedIn) {
        showToast(uiText.neteasePlaylistLoginRequired);
        return;
      }

      if (editableNetEasePlaylists.length === 0) {
        openCreatePlaylistModal(songsToAdd, false);
        return;
      }

      setPlaylistModalState({
        type: 'pick-playlist',
        scope: 'netease',
        pendingSongKeys: [],
        pendingSongIds,
      });
      return;
    }

    const pendingSongKeys = Array.from(
      new Set(
        songsToAdd
          .map(getPersistedSongKey)
          .filter((songKey): songKey is string => Boolean(songKey))
      )
    );

    if (pendingSongKeys.length === 0) return;

    if (playlistDefinitions.length === 0) {
      openCreatePlaylistModal(songsToAdd, false);
      return;
    }

    setPlaylistModalState({
      type: 'pick-playlist',
      scope: 'local',
      pendingSongKeys,
      pendingSongIds: [],
    });
  };

  const requestAddSongToPlaylist = (songToAdd: Song) => {
    requestAddSongsToPlaylist([songToAdd]);
  };

  const handleConfirmCreatePlaylist = async () => {
    if (playlistModalState?.type !== 'create-playlist') return;

    const nextName = playlistNameDraft.trim();
    if (!nextName) return;

    if (playlistModalState.scope === 'netease') {
      try {
        const createdPlaylist = await createNetEasePlaylist(nextName);
        if (!createdPlaylist) {
          throw new Error(uiText.neteasePlaylistCreateFailed);
        }

        if (playlistModalState.pendingSongIds.length > 0) {
          const previousTrackCount = createdPlaylist.trackCount ?? createdPlaylist.songs.length;
          const updatedPlaylist = await addNetEaseSongsToPlaylist(createdPlaylist.id, playlistModalState.pendingSongIds);
          const nextTrackCount = updatedPlaylist?.songs.length
            || updatedPlaylist?.trackCount
            || previousTrackCount + playlistModalState.pendingSongIds.length;
          const addedCount = Math.max(0, nextTrackCount - previousTrackCount);
          const playlistName = updatedPlaylist?.name || createdPlaylist.name;

          showToast(addedCount > 0 ? uiText.addSuccess(playlistName, addedCount) : uiText.addNoop);
        }

        if (playlistModalState.openPlaylistsAfterCreate) {
          showPlaylistOverview();
        }

        closePlaylistModal();
      } catch (error) {
        console.error('Failed to create NetEase playlist:', error);
        showToast(error instanceof Error ? error.message : uiText.neteasePlaylistCreateFailed);
      }
      return;
    }

    const playlistId = `playlist-${Date.now()}`;
    setPlaylistDefinitions((previous) => [
      ...previous,
      {
        id: playlistId,
        name: nextName,
        songKeys: playlistModalState.pendingSongKeys,
        updatedAt: Date.now(),
      },
    ]);
    setSelectedPlaylistId(playlistId);

    if (playlistModalState.openPlaylistsAfterCreate) {
      showPlaylistOverview();
    }

    if (playlistModalState.pendingSongKeys.length > 0) {
      showToast(uiText.addSuccess(nextName, playlistModalState.pendingSongKeys.length));
    }

    closePlaylistModal();
  };

  const handleConfirmRenamePlaylist = () => {
    if (playlistModalState?.type !== 'rename-playlist') return;

    const nextName = playlistNameDraft.trim();
    if (!nextName) return;

    setPlaylistDefinitions((previous) => previous.map((playlist) => (
      playlist.id === playlistModalState.playlistId
        ? { ...playlist, name: nextName, updatedAt: Date.now() }
        : playlist
    )));

    showToast(uiText.renameSuccess);
    closePlaylistModal();
  };

  const handleConfirmDeletePlaylist = async () => {
    if (playlistModalState?.type !== 'delete-playlist') return;

    const deletedPlaylistId = playlistModalState.playlistId;
    const deletedPlaylistName = playlistModalState.playlistName;

    if (playlistModalState.scope === 'netease') {
      try {
        await deleteNetEasePlaylist(deletedPlaylistId);

        if (openedPlaylistId === deletedPlaylistId) {
          setOpenedPlaylistId(null);
        }

        if (currentPlaybackPlaylistId === deletedPlaylistId) {
          setCurrentPlaybackPlaylistId(null);
        }

        showToast(`${uiText.deleteSuccess}: ${deletedPlaylistName || uiText.playlistDeletedFallback}`);
        closePlaylistModal();
      } catch (error) {
        console.error('Failed to delete NetEase playlist:', error);
        showToast(error instanceof Error ? error.message : uiText.deleteSuccess);
      }
      return;
    }

    setPlaylistDefinitions((previous) => previous.filter((playlist) => playlist.id !== deletedPlaylistId));

    if (selectedPlaylistId === deletedPlaylistId) {
      setSelectedPlaylistId(null);
    }

    if (openedPlaylistId === deletedPlaylistId) {
      setOpenedPlaylistId(null);
    }

    if (currentPlaybackPlaylistId === deletedPlaylistId) {
      setCurrentPlaybackPlaylistId(null);
    }

    showToast(`${uiText.deleteSuccess}: ${deletedPlaylistName || uiText.playlistDeletedFallback}`);
    closePlaylistModal();
  };

  const handleChoosePlaylistForSongs = async (playlistId: string) => {
    if (playlistModalState?.type !== 'pick-playlist') return;

    if (playlistModalState.scope === 'netease') {
      try {
        const targetPlaylist = editableNetEasePlaylists.find((playlist) => playlist.id === playlistId) ?? null;
        const previousTrackCount = targetPlaylist?.trackCount ?? targetPlaylist?.songs.length ?? 0;
        const updatedPlaylist = await addNetEaseSongsToPlaylist(playlistId, playlistModalState.pendingSongIds);
        const nextTrackCount = updatedPlaylist?.songs.length
          || updatedPlaylist?.trackCount
          || previousTrackCount;
        const addedCount = Math.max(0, nextTrackCount - previousTrackCount);

        showToast(
          addedCount > 0
            ? uiText.addSuccess(updatedPlaylist?.name || targetPlaylist?.name || uiText.playlists, addedCount)
            : uiText.addNoop
        );
        closePlaylistModal();
      } catch (error) {
        console.error('Failed to add songs to NetEase playlist:', error);
        showToast(error instanceof Error ? error.message : uiText.addNoop);
      }
      return;
    }

    const { addedCount, playlistName } = appendSongKeysToPlaylist(playlistId, playlistModalState.pendingSongKeys);
    setSelectedPlaylistId(playlistId);
    showToast(addedCount > 0 ? uiText.addSuccess(playlistName, addedCount) : uiText.addNoop);
    closePlaylistModal();
  };

  const removeSongFromSavedPlaylist = (playlistId: string, index: number) => {
    setPlaylistDefinitions((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      return {
        ...playlist,
        songKeys: playlist.songKeys.filter((_, songIndex) => songIndex !== index),
        updatedAt: Date.now(),
      };
    }));
  };

  const clearPlayback = () => {
    setPlaybackQueue([]);
    setSong(EMPTY_SONG);
    setCurrentIndex(-1);
    setCurrentPlaybackPlaylistId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    playbackTrackRef.current = '';
    setPlaybackError(null);
    playbackRef.current?.clear();
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    audioObjectUrlRef.current = null;
  };

  const removeSongFromPlaybackQueue = (index: number) => {
    rememberQueue();
    const nextQueue = playbackQueue.filter((_, queueIndex) => queueIndex !== index);
    setPlaybackQueue(nextQueue);

    setCurrentPlaybackPlaylistId(null);

    if (nextQueue.length === 0) {
      clearPlayback();
      return;
    }

    if (index === currentIndex) {
      const nextIndex = Math.min(index, nextQueue.length - 1);
      playSongs(nextQueue, nextIndex, null);
      return;
    }

    if (index < currentIndex) {
      setCurrentIndex((value) => Math.max(0, value - 1));
    }
  };

  const handleRemoveFromPlaylist = async (playlist: PlaylistCollection | null, songToRemove: Song, index: number) => {
    if (!playlist) return;

    if (playlist.source === 'netease') {
      const songId = getNetEaseSongIdFromSong(songToRemove);
      if (!songId) {
        return;
      }

      try {
        await removeNetEaseSongsFromPlaylist(playlist.id, [songId]);

        if (currentPlaybackPlaylistId === playlist.id) {
          removeSongFromPlaybackQueue(index);
        }
      } catch (error) {
        console.error('Failed to remove song from NetEase playlist:', error);
        showToast(error instanceof Error ? error.message : uiText.deletePlaylistDescription);
      }
      return;
    }

    if (currentPlaybackPlaylistId === playlist.id) {
      removeSongFromSavedPlaylist(playlist.id, index);
      removeSongFromPlaybackQueue(index);
      return;
    }

    removeSongFromSavedPlaylist(playlist.id, index);
  };

  const playDisplayedPlaylist = () => {
    if (!displayedPlaylist || displayedPlaylist.songs.length === 0) return;
    playSongs(displayedPlaylist.songs, 0, displayedPlaylist.id);
  };

  const rememberQueue = () => setQueueUndo({ songs: playbackQueue, index: currentIndex, time: audioRef.current?.currentTime || 0, playing: Boolean(audioRef.current && !audioRef.current.paused), source: currentPlaybackPlaylistId });
  const moveQueueSong = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= playbackQueue.length || to >= playbackQueue.length) return;
    rememberQueue();
    const next = [...playbackQueue]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    setPlaybackQueue(next);
    setCurrentIndex(currentIndex === from ? to : from < currentIndex && to >= currentIndex ? currentIndex - 1 : from > currentIndex && to <= currentIndex ? currentIndex + 1 : currentIndex);
    setCurrentPlaybackPlaylistId(null);
  };
  const undoQueue = () => {
    if (!queueUndo) return;
    const previous = queueUndo; setQueueUndo(null);
    if (!previous.songs.length || previous.index < 0) { clearPlayback(); return; }
    const restored = previous.songs[previous.index];
    setPlaybackQueue(previous.songs); setCurrentIndex(previous.index); setSong(restored); setCurrentPlaybackPlaylistId(previous.source);
    if (restored !== song || !audioRef.current?.src) {
      loadPlaybackTrack(restored, previous.playing, previous.time);
    }
  };
  const queueNext = (track: Song) => {
    if (!hasActiveSong) { void playSongs([track], 0); return; }
    rememberQueue(); const next = [...playbackQueue]; next.splice(currentIndex + 1, 0, track);
    setPlaybackQueue(next); setCurrentPlaybackPlaylistId(null);
    showToast(language === 'zh-CN' ? '已加入下一首播放' : 'Added to play next');
  };
  const queuePanel = <Playlist songs={playbackQueue} currentIndex={currentIndex} isPlaying={isPlaying} onSelect={playSong} onRemove={removeSongFromPlaybackQueue}
    onMove={moveQueueSong} onClear={() => { rememberQueue(); clearPlayback(); }} onUndo={queueUndo ? undoQueue : undefined} language={language} />;

  const handleNext = () => {
    if (playbackQueue.length === 0) return;

    let nextIndex;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * playbackQueue.length);
      if (nextIndex === currentIndex && playbackQueue.length > 1) {
        nextIndex = (nextIndex + 1) % playbackQueue.length;
      }
    } else {
      nextIndex = (currentIndex + 1) % playbackQueue.length;
      if (nextIndex === 0 && loopMode === 'none') {
        playbackRef.current?.pause();
        return;
      }
    }

    playSong(nextIndex);
  };

  const handlePrev = () => {
    if (playbackQueue.length === 0) return;
    const previousIndex = (currentIndex - 1 + playbackQueue.length) % playbackQueue.length;
    playSong(previousIndex);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || playbackError) return;
      if (showGuide) return;
      if (isOverlaySection(currentSection)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          runViewTransition(() => setCurrentSection(lastLibrarySection), 'overlay', { direction: 'back' });
        }
        return; // Do not seek/change volume on the obscured player from settings.
      }
      if (event.key === 'Escape') {
        setShowDockQueue(false);
        // The key handler is not re-bound on view changes; read the live view.
        if (viewRef.current !== 'library') runViewTransition(() => setView('library'), 'page', { direction: 'back', enter: cardEnter.home });
        return;
      }
      if ((event.target as HTMLElement)?.closest('input, textarea, button, select, [contenteditable="true"], [role="slider"]')) {
        return;
      }

      // '/' or Ctrl+F jumps to the visible library search field.
      if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) {
        const searchInput = document.querySelector<HTMLInputElement>('input[data-rf-search]');
        if (searchInput && searchInput.offsetParent !== null) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
          return;
        }
      }

      const audio = audioRef.current;
      if (!audio) return;

      switch (event.key) {
        case 'ArrowLeft':
          if (event.ctrlKey || event.metaKey) {
            handlePrev();
          } else {
            audio.currentTime = Math.max(0, audio.currentTime - 5);
          }
          break;
        case 'ArrowRight':
          if (event.ctrlKey || event.metaKey) {
            handleNext();
          } else {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          setVolume((value) => Math.min(1, value + 0.05));
          break;
        case 'ArrowDown':
          event.preventDefault();
          setVolume((value) => Math.max(0, value - 0.05));
          break;
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, playbackQueue, isShuffle, loopMode, isPlaying, volume, currentSection, lastLibrarySection, showGuide, playbackError]);

  const showPlaylistOverview = () => {
    pendingNetEasePlaylistRequestRef.current = null;
    setLoadingPlaylistId(null);

    if (librarySourceMode === 'netease') {
      lastLibrarySectionBySourceRef.current.netease = 'playlists';
    } else {
      lastLibrarySectionBySourceRef.current.local = 'playlists';
    }

    runViewTransition(() => {
      setOpenedPlaylistId(null);
      setCurrentSection('playlists');
      setLastLibrarySection('playlists');
    }, 'section', { direction: 'back', enter: cardEnter.sectionBack });
  };

  const openLibrarySection = (section: LibrarySection) => {
    if (section !== 'playlists') {
      pendingNetEasePlaylistRequestRef.current = null;
      setLoadingPlaylistId(null);
    }

    if (librarySourceMode === 'local' && isLocalLibrarySection(section)) {
      lastLibrarySectionBySourceRef.current.local = section;
    }

    if (librarySourceMode === 'netease' && isNetEaseLibrarySection(section)) {
      lastLibrarySectionBySourceRef.current.netease = section;
    }

    if (section === 'playlists') {
      showPlaylistOverview();
      return;
    }

    runViewTransition(() => {
      setCurrentSection(section);
      setLastLibrarySection(section);
    }, 'section', { enter: cardEnter.sectionForward });
  };

  const openPlaylistDetails = async (playlistId: string) => {
    if (savedPlaylists.some((playlist) => playlist.id === playlistId)) {
      pendingNetEasePlaylistRequestRef.current = null;
      setLoadingPlaylistId(null);
      lastLibrarySectionBySourceRef.current.local = 'playlists';
      runViewTransition(() => {
        setSelectedPlaylistId(playlistId);
        setOpenedPlaylistId(playlistId);
        setCurrentSection('playlists');
        setLastLibrarySection('playlists');
      }, 'section', { enter: cardEnter.sectionForward });
      return;
    }

    lastLibrarySectionBySourceRef.current.netease = 'playlists';
    pendingNetEasePlaylistRequestRef.current = playlistId;
    setLoadingPlaylistId(playlistId);
    // Only navigation state joins the cross-fade; loading state stays synchronous
    // so a cached playlist that resolves within the same frame never sticks.
    runViewTransition(() => {
      setOpenedPlaylistId(playlistId);
      setCurrentSection('playlists');
      setLastLibrarySection('playlists');
    }, 'section', { enter: cardEnter.sectionForward });

    const cloudPlaylist = await loadNetEasePlaylist(playlistId);
    if (pendingNetEasePlaylistRequestRef.current !== playlistId) {
      return;
    }

    pendingNetEasePlaylistRequestRef.current = null;
    setLoadingPlaylistId(null);

    if (!cloudPlaylist) {
      setOpenedPlaylistId(null);
      return;
    }

    setOpenedPlaylistId(cloudPlaylist.id);
  };

  const switchLibrarySourceMode = (nextSource: 'local' | 'netease') => {
    if (nextSource === librarySourceMode) {
      return;
    }

    const nextSection = nextSource === 'local'
      ? (isLocalLibrarySection(lastLibrarySectionBySourceRef.current.local) ? lastLibrarySectionBySourceRef.current.local : 'playlists')
      : (isNetEaseLibrarySection(lastLibrarySectionBySourceRef.current.netease) ? lastLibrarySectionBySourceRef.current.netease : 'playlists');

    if (nextSource !== 'netease') {
      pendingNetEasePlaylistRequestRef.current = null;
      setLoadingPlaylistId(null);
    }

    // One compositor cross-fade replaces the old fade-out -> 180ms wait -> fade-in chain.
    // Sources sit side by side: NetEase arrives from the right, local from the left.
    const direction = nextSource === 'netease' ? 'forward' : 'back';
    runViewTransition(() => {
      setLibrarySourceMode(nextSource);
      setLastLibrarySection(nextSection);
      setCurrentSection((section) => (isOverlaySection(section) ? section : nextSection));
    }, 'section', { direction, enter: cardEnter.source(direction) });
  };

  const navigateToNetEaseSearch = (request: Omit<LibrarySearchNavigationRequest, 'id'>) => {
    const keyword = request.keyword.trim();
    if (!keyword) {
      return;
    }

    const nextRequest: LibrarySearchNavigationRequest = {
      ...request,
      id: searchNavigationRequestIdRef.current + 1,
      keyword,
      preferredName: request.preferredName?.trim(),
      preferredArtist: request.preferredArtist?.trim(),
    };

    searchNavigationRequestIdRef.current = nextRequest.id;
    pendingNetEasePlaylistRequestRef.current = null;
    setLoadingPlaylistId(null);
    lastLibrarySectionBySourceRef.current.netease = 'search';

    // Player -> library, source switch and section change land in one cross-fade.
    runViewTransition(() => {
      setOpenedPlaylistId(null);
      setSelectedPlaylistId(null);
      setLastLibrarySection('search');
      setSearchNavigationRequest(nextRequest);
      setView('library');
      setLibrarySourceMode('netease');
      setCurrentSection((section) => (isOverlaySection(section) ? section : 'search'));
    }, view === 'player' ? 'page' : 'section', view === 'player'
      ? { direction: 'back', enter: cardEnter.home }
      : { enter: cardEnter.source('forward') });
  };

  const handleSearchNavigationHandled = (requestId: number) => {
    setSearchNavigationRequest((current) => (
      current && current.id === requestId ? null : current
    ));
  };

  const handleOpenCurrentAlbum = () => {
    if (!hasActiveSong || !song.album?.trim()) {
      return;
    }

    navigateToNetEaseSearch({
      keyword: song.album,
      mode: 'album',
      autoOpen: true,
      preferredName: song.album,
      preferredArtist: song.artist,
    });
  };

  // Settings and EQ are overlay sections layered on top of the last active library
  // section, so closing them returns the user to the prior navigation context.
  const toggleOverlaySection = (section: 'settings' | 'eq') => {
    const isClosing = currentSection === section;
    runViewTransition(() => {
      if (currentSection === section) {
        setCurrentSection(lastLibrarySection);
        return;
      }

      if (!isOverlaySection(currentSection)) {
        setLastLibrarySection(currentSection);
      }

      setCurrentSection(section);
    }, 'overlay', isClosing ? { direction: 'back' } : { enter: cardEnter.overlay });
  };

  const navigateToView = (nextView: 'player' | 'library') => {
    if (nextView === view) return;
    runViewTransition(() => setView(nextView), 'page', nextView === 'player'
      ? { direction: 'forward', enter: cardEnter.player }
      : { direction: 'back', enter: cardEnter.home });
  };

  const prepareGuideStep = useCallback((surface: GuideSurface, panel?: GuidePanel) => {
    setCurrentSection(section => isOverlaySection(section) ? lastLibrarySection : section);
    setShowDockQueue(false);
    setIsFullScreen(false);
    setView(surface === 'library' ? 'library' : 'player');
    if (surface === 'player') {
      setShowLyrics(panel === 'lyrics');
      setShowPlaylist(panel === 'playlist');
    }
  }, [lastLibrarySection]);

  const dismissGuide = () => {
    setShowGuide(false);
    const origin = guideOriginRef.current;
    guideOriginRef.current = null;
    if (origin) {
      setView(origin.view);
      setCurrentSection(origin.section);
      setShowLyrics(origin.showLyrics);
      setShowPlaylist(origin.showPlaylist);
      setIsFullScreen(origin.isFullScreen);
    } else {
      setView('library');
      setShowLyrics(true);
      setShowPlaylist(false);
    }
    try { window.localStorage.setItem(GUIDE_COMPLETED_STORAGE_KEY, '1'); } catch { /* Guide still closes when storage is unavailable. */ }
  };

  const handleWindowMinimize = () => {
    if (!ipc) return;
    ipc.invoke('window:minimize');
  };

  const handleWindowToggleMaximize = async () => {
    if (!ipc) return;

    try {
      const nextState = await ipc.invoke('window:toggle-maximize');
      setIsWindowMaximized(Boolean(nextState));
    } catch (error) {
      console.error('Failed to toggle maximize state:', error);
    }
  };

  const handleWindowClose = () => {
    if (!ipc) return;
    ipc.invoke('window:close');
  };

  const handleCreatePlaylist = () => {
    if (librarySourceMode === 'netease') {
      if (!neteaseSession.isLoggedIn) {
        showToast(uiText.neteasePlaylistLoginRequired);
        return;
      }

      openCreatePlaylistModalForScope('netease', {
        pendingSongKeys: [],
        pendingSongIds: [],
        openPlaylistsAfterCreate: true,
        allowScopeSelection: false,
      });
      return;
    }

    openCreatePlaylistModal([], true);
  };

  const isShowingPlaylistOverview = currentSection === 'playlists' && !displayedPlaylist;
  const overlaySection = isOverlaySection(currentSection) ? currentSection : null;
  const activeLibrarySection = overlaySection ? lastLibrarySection : currentSection;
  const modalTargetPlaylists = playlistModalState?.type === 'pick-playlist'
    ? playlistModalState.scope === 'netease'
      ? editableNetEasePlaylists
      : savedPlaylists
    : [];
  const isPlayerExpanded = view === 'player';
  // Home stays mounted (paint-skipped) under the player so returning is instant.
  const isHomeVisible = !isPlayerExpanded;
  const hasDockLyrics = hasActiveSong && !isLoadingLyrics && lyrics.length > 0;
  const desktopLyrics = useDesktopLyricsSync({
    ipc,
    audioRef,
    hasActiveSong,
    title: song.title,
    artist: song.artist,
    lyrics,
    isLoadingLyrics,
  });

  const currentWindowSubtitle = currentSection === 'settings'
    ? uiText.settings
    : currentSection === 'eq'
      ? uiText.eq
    : isPlayerExpanded
      ? (hasActiveSong ? `${uiText.nowPlaying} · ${song.title}` : uiText.noPlaybackTitle)
      : sidebarItems.find((item) => item.id === activeLibrarySection)?.label || uiText.brandSubtitle;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden pt-14 text-white font-sans selection:bg-white/20"
      data-custom-background={isCustomBackgroundActive ? 'true' : 'false'}
      data-playing={isPlaying ? 'true' : 'false'}
      style={appShellStyle}
    >
      <WindowChrome
        appName={APP_NAME}
        subtitle={currentWindowSubtitle}
        actionSlot={(
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-guide="guide-entry"
              onClick={() => {
                if (!showGuide) {
                  guideOriginRef.current = { view, section: currentSection, showLyrics, showPlaylist, isFullScreen };
                  setShowGuide(true);
                }
              }}
              className="rf-chrome-button"
              aria-label={language === 'zh-CN' ? '使用指引' : 'Guide'}
              title={language === 'zh-CN' ? '使用指引' : 'Guide'}
            >
              <CircleHelp size={16} />
              <span className="hidden sm:inline">{language === 'zh-CN' ? '指引' : 'Guide'}</span>
            </button>
            {desktopLyrics.isSupported && (
              <button
                type="button"
                onClick={desktopLyrics.toggle}
                aria-pressed={desktopLyrics.isVisible}
                className="rf-chrome-button"
                title={language === 'zh-CN' ? '桌面歌词' : 'Desktop lyrics'}
              >
                <Captions size={16} />
                <span className="hidden sm:inline">{language === 'zh-CN' ? '桌面歌词' : 'Lyrics'}</span>
              </button>
            )}
            <button
              type="button"
              data-guide="guide-eq"
              onClick={() => toggleOverlaySection('eq')}
              aria-pressed={currentSection === 'eq'}
              className="rf-chrome-button"
              title={uiText.openEQ}
            >
              <SlidersHorizontal size={16} />
              <span className="hidden sm:inline">{uiText.eq}</span>
            </button>

            <button
              type="button"
              data-guide="guide-settings"
              onClick={() => toggleOverlaySection('settings')}
              aria-pressed={currentSection === 'settings'}
              className="rf-chrome-button"
              title={uiText.openSettings}
            >
              <Settings2 size={16} />
              <span className="hidden sm:inline">{uiText.settings}</span>
            </button>
          </div>
        )}
        showWindowControls={!!ipc}
        isWindowMaximized={isWindowMaximized}
        onMinimize={handleWindowMinimize}
        onToggleMaximize={handleWindowToggleMaximize}
        onClose={handleWindowClose}
      />

      <Background
        imageSrc={song.cover}
        effect={effect}
        customBackground={backgroundSource === 'custom' && customBackgroundImage
          ? { imageSrc: customBackgroundImage }
          : null}
        transparentBackground={isTransparentBackgroundActive}
      />
      <audio ref={audioRef} />

      <div
        aria-hidden={!isHomeVisible || !!overlaySection}
        inert={!isHomeVisible || !!overlaySection}
        className={cn('h-full w-full p-4 md:p-6', 'pb-38 md:pb-38', !isHomeVisible && 'pointer-events-none')}
        style={{ visibility: isHomeVisible ? 'visible' : 'hidden', contentVisibility: isHomeVisible ? 'visible' : 'hidden' }}
      >
        <div className="rf-home-layout h-full flex gap-4 min-w-0">
          <aside className="rf-sidebar rf-glass min-h-0 w-[clamp(14rem,22vw,17rem)] rounded-4xl flex flex-col overflow-hidden shrink-0">
            <div className="px-3 pt-3 pb-1">
              <div data-guide="guide-source" role="group" aria-label={language === 'zh-CN' ? '音乐来源' : 'Music source'} className="rf-segmented rf-segmented-block">
                {(['local', 'netease'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => switchLibrarySourceMode(mode)}
                    aria-pressed={librarySourceMode === mode}
                    className="rf-segmented-item"
                  >
                    {mode === 'local' ? <Music size={15} /> : <Disc size={15} />}
                    <span>{mode === 'local' ? uiText.localScope : uiText.neteaseScope}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="rf-sidebar-content min-h-0 h-full flex flex-col">
                <nav data-guide="guide-navigation" aria-label={uiText.sidebarNavLabel} className="px-3 pt-3 pb-2">
                  <p className="rf-side-label">{librarySourceMode === 'netease' ? uiText.neteaseScope : uiText.sidebarLibraryLabel}</p>
                  <div className="space-y-0.5">
                    {sidebarItems.map((item) => {
                      const isActive = activeLibrarySection === item.id && !overlaySection;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openLibrarySection(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn('rf-side-item', isActive && 'rf-side-item-active')}
                        >
                          {item.icon}
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </nav>

                <div data-guide="guide-playlists" className="min-h-0 flex-1 flex flex-col overflow-hidden">
                  <div className="mx-3 border-t border-white/8" />
                  <div className="flex items-center justify-between gap-2 pl-6 pr-4 pt-3 pb-1.5">
                    <div className="min-w-0">
                      <p className="rf-side-label p-0">{uiText.playlists}</p>
                      <p className="truncate text-[11px] text-white/45">
                        {librarySourceMode === 'netease'
                          ? (neteaseSession.isLoggedIn ? neteaseStatusDetail : neteaseStatusMessage || neteaseStatusText)
                          : uiText.playlistsCount(savedPlaylists.length)}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-guide="guide-create-playlist"
                      onClick={handleCreatePlaylist}
                      disabled={librarySourceMode === 'netease' && !neteaseSession.isLoggedIn}
                      className="rf-icon-button"
                      aria-label={uiText.createPlaylist}
                      title={uiText.createPlaylist}
                    >
                      <Plus size={17} />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rf-scroll px-3 pb-3 space-y-0.5">
                    {visibleLibraryPlaylists.length === 0 ? (
                      <div className="rf-side-empty">
                        <ListMusic size={18} className="shrink-0 text-white/40" />
                        <span>
                          {librarySourceMode === 'netease'
                            ? (neteaseSession.isLoggedIn ? uiText.neteaseNoPlaylists : uiText.neteasePlaylistLoginRequired)
                            : uiText.playlistEmpty}
                        </span>
                      </div>
                    ) : (
                      visibleLibraryPlaylists.map((playlist) => {
                        const isActive = displayedPlaylist?.id === playlist.id && !isShowingPlaylistOverview && activeLibrarySection === 'playlists';
                        const isNetEasePlaylist = playlist.source === 'netease';
                        const previewImage = playlist.cover || playlist.songs[0]?.cover;
                        const songCount = isNetEasePlaylist ? (playlist.trackCount ?? playlist.songs.length) : playlist.songs.length;
                        const isPlayingFrom = currentPlaybackPlaylistId === playlist.id && hasActiveSong;

                        return (
                          <button
                            key={playlist.id}
                            type="button"
                            onClick={() => { void openPlaylistDetails(playlist.id); }}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn('rf-side-playlist', isActive && 'rf-side-item-active')}
                            title={playlist.name}
                          >
                            <span className="rf-side-thumb">
                              {previewImage
                                ? <img src={previewImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                                : <ListMusic size={16} />}
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate text-[13px] font-medium">{playlist.name}</span>
                              <span className="block truncate text-[11px] text-white/45">{songCount} {uiText.songCountLabel}</span>
                            </span>
                            {isPlayingFrom && <span className="rf-now-bars shrink-0" aria-hidden="true"><i /><i /><i /></span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <section data-guide="guide-library" className="rf-library-panel rf-glass min-h-0 min-w-0 flex-1 rounded-4xl overflow-hidden relative">
            <div className="rf-library-content h-full">
              <Library
                currentSong={hasActiveSong ? song : null}
                onQueueNext={queueNext}
                songs={librarySongs}
                playlists={visibleLibraryPlaylists}
                isLoading={isLoadingLibrary}
                isPlaylistDetailLoading={loadingPlaylistId !== null && loadingPlaylistId === openedPlaylistId}
                language={language}
                sourceMode={librarySourceMode}
                section={activeLibrarySection}
                displayedPlaylist={displayedPlaylist}
                currentPlaybackPlaylistId={currentPlaybackPlaylistId}
                currentPlaybackIndex={currentIndex}
                onBackToPlaylistsOverview={showPlaylistOverview}
                onOpenPlaylist={(playlistId) => {
                  void openPlaylistDetails(playlistId);
                }}
                onPlaySongs={playSongs}
                onAddSongToPlaylist={requestAddSongToPlaylist}
                onAddSongsToPlaylist={requestAddSongsToPlaylist}
                onPlaySelectedPlaylist={playDisplayedPlaylist}
                onRemoveSongFromPlaylist={(songToRemove, index) => {
                  void handleRemoveFromPlaylist(displayedPlaylist, songToRemove, index);
                }}
                searchNavigationRequest={searchNavigationRequest}
                onSearchNavigationHandled={handleSearchNavigationHandled}
                onRequestSearchNavigation={navigateToNetEaseSearch}
              />
            </div>
          </section>
        </div>

        {isHomeVisible && (
              <MiniPlayer
                audioRef={audioRef}
              currentTime={currentTime} duration={duration} onSeek={handleSeek} statusStore={playbackFeedback} language={language}
              showQueue={showDockQueue} onToggleQueue={() => setShowDockQueue((value) => !value)} queueCount={playbackQueue.length}
              queuePanel={queuePanel}
              hasActiveSong={hasActiveSong}
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              onNext={handleNext}
              onPrev={handlePrev}
              title={hasActiveSong ? song.title : uiText.noPlaybackTitle}
              artist={hasActiveSong ? song.artist : uiText.noPlaybackSubtitle}
              cover={hasActiveSong ? song.cover : undefined}
              onClick={() => navigateToView('player')}
              volume={volume}
              onVolumeChange={setVolume}
              emptyActionLabel={uiText.openPlayerHint}
              lyrics={hasDockLyrics ? lyrics : undefined}
            />
        )}
      </div>

      {isPlayerExpanded && (
          <div
            key="player-overlay"
            inert={!!overlaySection}
            aria-hidden={!!overlaySection}
            className="rf-player-surface absolute inset-x-0 top-14 bottom-0 z-90"
          >
            <main
              className={cn(
                'rf-player-layout relative h-full w-full flex flex-col md:flex-row items-center justify-center gap-12 p-8 md:p-24',
                (!hasActiveSong || (!showLyrics && !showPlaylist)) ? 'justify-center' : ''
              )}
            >
              {isPersonalizedBackgroundActive && (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-0',
                    isCustomBackgroundActive ? 'bg-black/8 customizable-backdrop-strong' : 'bg-black/12'
                  )}
                />
              )}

              <div className="absolute top-6 right-6 z-50">
                <div className="flex gap-4">
                  <button
                    type="button"
                    data-guide="guide-player-fullscreen"
                    onClick={() => runViewTransition(() => setIsFullScreen((value) => !value), 'panel', { enter: cardEnter.focus })}
                    className="rf-round-button"
                    aria-pressed={isFullScreen}
                    aria-label={isFullScreen ? (language === 'zh-CN' ? '退出专注模式' : 'Exit focus mode') : (language === 'zh-CN' ? '专注模式' : 'Focus mode')}
                    title={isFullScreen ? (language === 'zh-CN' ? '退出专注模式' : 'Exit focus mode') : (language === 'zh-CN' ? '专注模式' : 'Focus mode')}
                  >
                    {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                  </button>
                </div>
              </div>

              {!isFullScreen && (
                  <div
                    className={cn(
                      'rf-player-primary relative z-10 flex w-full flex-col items-center gap-12',
                      (!hasActiveSong || (!showLyrics && !showPlaylist)) && 'rf-player-primary-centered'
                    )}
                  >
                    <button
                      type="button"
                      data-guide="guide-player-artwork"
                      onClick={handleOpenCurrentAlbum}
                      disabled={!hasActiveSong || !song.album?.trim()}
                      data-resting={hasActiveSong && isPlaying ? undefined : 'true'}
                      className="rf-player-artwork group relative h-64 w-64 shrink-0 overflow-hidden rounded-2xl bg-white/5 md:h-96 md:w-96 disabled:cursor-default"
                    >
                      {song.cover ? (
                        <img
                          src={song.cover}
                          alt={song.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music className="text-white/10 w-32 h-32" />
                        </div>
                      )}
                      {hasActiveSong && song.album?.trim() && (
                        <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-linear-to-t from-black/55 via-black/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <span className="mb-5 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/85 backdrop-blur-xl">
                            {language === 'zh-CN' ? '打开专辑' : 'Open Album'}
                          </span>
                        </div>
                      )}
                    </button>

                    <PlayerControls
                      statusStore={playbackFeedback}
                      visualizerActive={isPlayerExpanded && !overlaySection}
                      visualizerMode={visualizerMode}
                      audioRef={audioRef}
                      language={language}
                      isPlaying={isPlaying}
                      controlsDisabled={!hasActiveSong}
                      onTogglePlay={togglePlay}
                      onNext={handleNext}
                      onPrev={handlePrev}
                      currentTime={currentTime}
                      duration={duration}
                      onSeek={handleSeek}
                      title={hasActiveSong ? song.title : uiText.noPlaybackTitle}
                      artist={hasActiveSong ? song.artist : uiText.noPlaybackSubtitle}
                      analyser={analyser}
                      volume={volume}
                      onVolumeChange={setVolume}
                      loopMode={loopMode}
                      onToggleLoop={() => {
                        if (loopMode === 'none') setLoopMode('all');
                        else if (loopMode === 'all') setLoopMode('one');
                        else setLoopMode('none');
                      }}
                      isShuffle={isShuffle}
                      onToggleShuffle={() => setIsShuffle((value) => !value)}
                      showPlaylist={showPlaylist}
                      onTogglePlaylist={() => runViewTransition(() => {
                        setShowPlaylist((value) => !value);
                        if (!showPlaylist) setShowLyrics(false);
                      }, 'panel', { enter: cardEnter.panel })}
                      showLyrics={showLyrics}
                      onToggleLyrics={() => runViewTransition(() => {
                        setShowLyrics((value) => !value);
                        if (!showLyrics) setShowPlaylist(false);
                      }, 'panel', { enter: cardEnter.panel })}
                      onMinimize={() => navigateToView('library')}
                    />
                  </div>
              )}

              <div data-guide="guide-player-secondary" className={cn('rf-player-secondary relative z-10 h-full min-h-0 min-w-0 w-full', isFullScreen && 'rf-player-secondary-full')}
                inert={!hasActiveSong || (!showLyrics && !showPlaylist)}
                aria-hidden={!hasActiveSong || (!showLyrics && !showPlaylist)}>
                {(hasActiveSong || showGuide) && (showLyrics || showPlaylist) && (
                  <div
                    key={showLyrics ? 'lyrics' : 'playlist'}
                    className="rf-player-panel-surface absolute inset-0 h-full w-full flex flex-col justify-center"
                  >
                    {!hasActiveSong ? (
                      <div className="rf-glass flex h-full items-center justify-center rounded-3xl px-8 text-center text-sm text-white/60">
                        {language === 'zh-CN'
                          ? `选择歌曲后，这里会显示${showLyrics ? '同步歌词' : '播放队列'}`
                          : `Select a track to see ${showLyrics ? 'synchronized lyrics' : 'the play queue'} here.`}
                      </div>
                    ) : showLyrics ? (
                      isLoadingLyrics ? (
                        <div role="status" className="rf-panel-state">
                          <span className="rf-spinner" aria-hidden="true" />
                          <p>{language === 'zh-CN' ? '正在查找歌词…' : 'Looking for lyrics…'}</p>
                        </div>
                      ) : lyrics.length > 0 ? (
                        <LyricsView lyrics={lyrics} currentTime={currentTime} audioRef={audioRef} onSeek={handleSeek} />
                      ) : (
                        <div className="rf-panel-state rf-panel-state-quiet">
                          <p>{language === 'zh-CN' ? '暂无歌词' : 'No lyrics available'}</p>
                        </div>
                      )
                    ) : (
                      <div className="rf-glass h-full rounded-3xl overflow-hidden">{queuePanel}</div>
                    )}
                  </div>
                )}
              </div>
            </main>
          </div>
      )}

      {overlaySection && (
          <div
            key={overlaySection}
            className="absolute inset-x-0 top-14 bottom-0 z-105 p-4 md:p-6"
          >
            <div className="rf-overlay-surface h-full rounded-4xl border border-white/10 bg-black/45 backdrop-blur-3xl customizable-backdrop-strong shadow-2xl overflow-hidden">
              {overlaySection === 'settings' ? (
                <SettingsView
                  visualizerMode={visualizerMode}
                  onVisualizerModeChange={setVisualizerMode}
                  copy={settingsCopy}
                  language={language}
                  onLanguageChange={setLanguage}
                  currentFolder={musicFolder}
                  isElectron={!!ipc}
                  onSelectFolder={selectFolder}
                  onOpenFolder={openFolder}
                  onRefreshLibrary={handleManualLibraryRefresh}
                  isRefreshingLibrary={isLoadingLibrary}
                  neteaseCookie={neteaseCookieDraft}
                  neteaseStatusText={neteaseStatusText}
                  neteaseStatusDetail={neteaseStatusDetail}
                  neteaseAvatarUrl={neteaseSession.account?.avatarUrl ?? null}
                  neteaseQrImage={neteaseQrState?.qrImage ?? null}
                  neteaseQrStatusText={neteaseQrStatusText}
                  isNetEaseLoggedIn={neteaseSession.isLoggedIn}
                  isSavingNetEaseSession={isSavingNetEaseSession}
                  isLoadingNetEasePlaylists={isLoadingNetEasePlaylists}
                  onNetEaseCookieChange={setNetEaseCookieDraft}
                  onNetEaseLoginWithCookie={loginNetEaseWithCookie}
                  onNetEaseLogout={logoutNetEase}
                  onNetEaseStartQrLogin={startNetEaseQrLogin}
                  onNetEaseRefreshPlaylists={() => {
                    void refreshNetEasePlaylists();
                  }}
                  effect={effect}
                  backgroundSource={backgroundSource}
                  hasCustomBackground={Boolean(customBackgroundImage)}
                  customBackgroundBlur={customBackgroundBlur}
                  transparentBackgroundBlur={transparentBackgroundBlur}
                  supportsTransparentBackground={supportsTransparentBackground !== false}
                  onEffectChange={setEffect}
                  onBackgroundSourceChange={handleBackgroundSourceChange}
                  onSelectCustomBackground={handleSelectCustomBackground}
                  onRemoveCustomBackground={handleRemoveCustomBackground}
                  onCustomBackgroundBlurChange={setCustomBackgroundBlur}
                  onTransparentBackgroundBlurChange={setTransparentBackgroundBlur}
                  libraryCount={librarySongs.length}
                  appName={APP_NAME}
                  appVersion={APP_VERSION}
                />
              ) : (
                <EQView
                  copy={eqCopy}
                  enabled={eqEnabled}
                  bands={eqBands}
                  onToggleEnabled={setEQEnabled}
                  onBandGainChange={handleEQGainChange}
                  onReset={handleEQReset}
                />
              )}
            </div>
          </div>
      )}

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={DIALOG_TRANSITION}
            className="absolute top-18 left-1/2 -translate-x-1/2 z-110 pointer-events-none"
          >
            <div className="rf-toast">
              {toastMessage}
            </div>
          </motion.div>
        )}

        {playlistModalState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={DIALOG_TRANSITION}
            className="rf-dialog-backdrop z-120"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: 12, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 8, scale: 0.98 }}
              transition={DIALOG_TRANSITION}
              className="rf-dialog"
            >
              {playlistModalState.type === 'create-playlist' || playlistModalState.type === 'rename-playlist' ? (
                <>
                  <h2 className="rf-dialog-title">
                    {playlistModalState.type === 'create-playlist' ? uiText.createPlaylistTitle : uiText.renamePlaylistTitle}
                  </h2>
                  <p className="rf-dialog-text">
                    {playlistModalState.type === 'create-playlist' ? uiText.createPlaylistDescription : uiText.renamePlaylistDescription}
                  </p>

                  {playlistModalState.type === 'create-playlist' && playlistModalState.allowScopeSelection && (
                    <div role="group" className="mt-6 rf-segmented rf-segmented-block">
                      <button
                        type="button"
                        onClick={() => updateCreatePlaylistModalScope('local')}
                        aria-pressed={playlistModalState.scope === 'local'}
                        className="rf-segmented-item"
                      >
                        {uiText.localScope}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCreatePlaylistModalScope('netease')}
                        aria-pressed={playlistModalState.scope === 'netease'}
                        className="rf-segmented-item"
                      >
                        {uiText.neteaseScope}
                      </button>
                    </div>
                  )}

                  <div className="mt-6">
                    <input
                      type="text"
                      value={playlistNameDraft}
                      onChange={(event) => setPlaylistNameDraft(event.target.value)}
                      placeholder={uiText.playlistNamePlaceholder}
                      autoFocus
                      className="rf-input"
                    />
                  </div>

                  <div className="rf-dialog-actions">
                    <button
                      type="button"
                      onClick={closePlaylistModal}
                      className="rf-dialog-button"
                    >
                      {uiText.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={playlistModalState.type === 'create-playlist' ? handleConfirmCreatePlaylist : handleConfirmRenamePlaylist}
                      disabled={!playlistNameDraft.trim()}
                      className="rf-dialog-button rf-dialog-button-primary"
                    >
                      {playlistModalState.type === 'create-playlist'
                        ? (playlistModalState.pendingSongKeys.length > 0 || playlistModalState.pendingSongIds.length > 0 ? uiText.createAndAdd : uiText.createPlaylist)
                        : uiText.save}
                    </button>
                  </div>
                </>
              ) : playlistModalState.type === 'pick-playlist' ? (
                <>
                  <h2 className="rf-dialog-title">{uiText.choosePlaylistTitle}</h2>
                  <p className="rf-dialog-text">{uiText.choosePlaylistDescription}</p>

                  <div className="mt-6 space-y-2 max-h-72 overflow-y-auto scrollbar-hide pr-1">
                    {modalTargetPlaylists.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => handleChoosePlaylistForSongs(playlist.id)}
                        className="rf-dialog-option"
                      >
                        <p className="font-semibold text-white truncate">{playlist.name}</p>
                        <p className="mt-1 text-xs text-white/35">{uiText.songsCount(playlist.trackCount ?? playlist.songs.length)}</p>
                      </button>
                    ))}
                  </div>

                  <div className="rf-dialog-actions justify-between">
                    <button
                      type="button"
                      onClick={closePlaylistModal}
                      className="rf-dialog-button"
                    >
                      {uiText.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closePlaylistModal();
                        openCreatePlaylistModalForScope(playlistModalState.scope, {
                          pendingSongKeys: playlistModalState.pendingSongKeys,
                          pendingSongIds: playlistModalState.pendingSongIds,
                          openPlaylistsAfterCreate: false,
                          allowScopeSelection: false,
                        });
                      }}
                      className="rf-dialog-button rf-dialog-button-primary"
                    >
                      {uiText.createAndAdd}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="rf-dialog-title">{uiText.deletePlaylistTitle}</h2>
                  <p className="rf-dialog-text">{uiText.deletePlaylistDescription}</p>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <p className="text-sm text-white/45">{uiText.playlists}</p>
                    <p className="mt-1 text-lg font-semibold text-white truncate">{playlistModalState.playlistName}</p>
                  </div>

                  <div className="rf-dialog-actions">
                    <button
                      type="button"
                      onClick={closePlaylistModal}
                      className="rf-dialog-button"
                    >
                      {uiText.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeletePlaylist}
                      className="rf-dialog-button rf-dialog-button-danger"
                    >
                      {uiText.deleteConfirm}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}

        {transparentModeDialogState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={DIALOG_TRANSITION}
            className="rf-dialog-backdrop z-125"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: 12, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 8, scale: 0.98 }}
              transition={DIALOG_TRANSITION}
              className="rf-dialog"
            >
              <h2 className="rf-dialog-title">
                {transparentModeDialogState.nextTransparentWindowMode
                  ? uiText.transparentModeEnableTitle
                  : uiText.transparentModeDisableTitle}
              </h2>
              <p className="rf-dialog-text">
                {transparentModeDialogState.nextTransparentWindowMode
                  ? uiText.transparentModeEnableDescription
                  : uiText.transparentModeDisableDescription}
              </p>

              <div className="rf-dialog-actions">
                <button
                  type="button"
                  onClick={closeTransparentModeDialog}
                  className="rf-dialog-button"
                >
                  {uiText.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void confirmTransparentModeChange();
                  }}
                  className="rf-dialog-button rf-dialog-button-primary"
                >
                  {uiText.transparentModeRestartConfirm}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {showGuide && <OnboardingGuide language={language} onDismiss={dismissGuide} onPrepareStep={prepareGuideStep} visualizerEnabled={visualizerMode !== 'off'} />}
      {playbackError && <PlaybackErrorDialog
        track={playbackError.track} error={playbackError.error} language={language}
        onDismiss={() => setPlaybackError(null)}
      />}
    </div>
  );
}
