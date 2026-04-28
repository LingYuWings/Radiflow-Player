export type AppLanguage = 'zh-CN' | 'en-US';

export interface CommonCopy {
	noSongSelected: string;
	noSongHint: string;
	backToBrowser: string;
	searchingLyrics: string;
	noLyrics: string;
	currentQueue: string;
}

export interface SidebarCopy {
	title: string;
	subtitle: string;
	playlists: string;
	allSongs: string;
	artists: string;
	albums: string;
	search: string;
	settings: string;
	playlistSection: string;
	selectedPlaylist: string;
	createPlaylist: string;
	nowPlaying: string;
	newPlaylistName: (index: number) => string;
}

export interface PlaylistCopy {
	songsCount: (count: number) => string;
	play: string;
	emptyTitle: string;
	emptyDescription: string;
}

export interface LibraryCopy {
	playlists: string;
	allSongs: string;
	artists: string;
	albums: string;
	search: string;
	explore: string;
	currentTarget: string;
	playPlaylist: string;
	openPlaylist: string;
	addToPlaylist: string;
	addAllSongs: string;
	addArtistSongs: string;
	addAlbumSongs: string;
	songs: (count: number) => string;
	playlistsCount: (count: number) => string;
	searchPlaylists: string;
	searchPlaylist: string;
	searchSongs: string;
	searchArtists: string;
	searchAlbums: string;
	searchLibrary: string;
	emptyPlaylist: string;
	emptyPlaylists: string;
	emptySongs: string;
	emptyArtists: string;
	emptyAlbums: string;
	emptySearch: string;
	noSearchResults: string;
	artistSubtitle: (count: number) => string;
	albumSubtitle: (artist: string) => string;
	back: string;
	searchResults: string;
	searchResultsSubtitle: string;
	allSongsSubtitle: string;
	artistsSubtitle: string;
	albumsSubtitle: string;
	playlistSubtitle: string;
	artistSongsLabel: string;
	albumSongsLabel: string;
	lastUpdated: string;
}

export interface SettingsCopy {
	title: string;
	subtitle: string;
	general: string;
	language: string;
	languageDescription: string;
	chinese: string;
	english: string;
	library: string;
	currentFolder: string;
	currentFolderDescription: string;
	folderUnavailable: string;
	refreshLibrary: string;
	selectFolder: string;
	openFolder: string;
	refreshDescription: string;
	appearance: string;
	 backgroundSource: string;
	 useBuiltInBackground: string;
	 useCustomBackground: string;
	 useTransparentBackground: string;
	 customBackgroundDescription: string;
	 transparentBackgroundDescription: string;
	 transparentBackgroundUnsupported: string;
	 uploadCustomBackground: string;
	 replaceCustomBackground: string;
	 removeCustomBackground: string;
	 customBackgroundNotSelected: string;
	 customBackgroundReady: string;
	 customBackgroundBlur: string;
	 transparentBackgroundBlur: string;
	backgroundEffect: string;
	blurMode: string;
	streamerMode: string;
	about: string;
	version: string;
	runtime: string;
	libraryStats: string;
	tracksCount: (count: number) => string;
}

export interface EQCopy {
	title: string;
	subtitle: string;
	playback: string;
	enableEQ: string;
	enableEQDescription: string;
	enabledState: string;
	disabledState: string;
	reset: string;
	resetDescription: string;
	bands: string;
	bandsDescription: string;
	summary: string;
	summaryDescription: string;
	gainLabel: string;
	gainUnit: string;
	rangeLabel: string;
	statusLabel: string;
	previewHint: string;
}

export interface AppCopy {
	common: CommonCopy;
	sidebar: SidebarCopy;
	playlist: PlaylistCopy;
	library: LibraryCopy;
	settings: SettingsCopy;
	eq: EQCopy;
}

export const APP_COPY: Record<AppLanguage, AppCopy> = {
	'zh-CN': {
		common: {
			noSongSelected: '未选择歌曲',
			noSongHint: '从媒体库或播放列表中选择音乐开始播放',
			backToBrowser: '返回媒体库',
			searchingLyrics: '搜索歌词中',
			noLyrics: '暂无歌词',
			currentQueue: '当前队列',
		},
		sidebar: {
			title: '音乐中心',
			subtitle: '播放列表与媒体库',
			playlists: '播放列表',
			allSongs: '所有歌曲',
			artists: '歌手',
			albums: '专辑',
			search: '搜索',
			settings: '设置',
			playlistSection: '列表',
			selectedPlaylist: '选择要浏览或播放的播放列表',
			createPlaylist: '新建播放列表',
			nowPlaying: '正在播放',
			newPlaylistName: (index) => `播放列表 ${index}`,
		},
		playlist: {
			songsCount: (count) => `${count} 首歌曲`,
			play: '播放此列表',
			emptyTitle: '当前播放列表还没有歌曲',
			emptyDescription: '从媒体库添加歌曲，或导入本地音频开始整理。',
		},
		library: {
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
			songs: (count) => `${count} 首歌曲`,
			playlistsCount: (count) => `${count} 个播放列表`,
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
			artistSubtitle: (count) => `${count} 首歌`,
			albumSubtitle: (artist) => artist,
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
		settings: {
			title: '设置',
			subtitle: '界面、语言与媒体库管理',
			general: '通用',
			language: '语言',
			languageDescription: '切换应用界面的显示语言。',
			chinese: '中文',
			english: 'English',
			library: '媒体库',
			currentFolder: '当前音乐文件夹',
			currentFolderDescription: '这里显示当前用于扫描音乐文件的目录。',
			folderUnavailable: '当前运行环境不支持文件夹操作',
			refreshLibrary: '刷新媒体库',
			selectFolder: '选择文件夹',
			openFolder: '打开文件夹',
			refreshDescription: '修改目录后请刷新媒体库，重新读取歌曲与封面信息。',
			appearance: '外观',
			backgroundSource: '背景来源',
			useBuiltInBackground: '项目内置背景',
			useCustomBackground: '自定义背景',
			useTransparentBackground: '透明背景',
			customBackgroundDescription: '上传一张背景图片，并自定义其模糊程度。启用后将覆盖当前歌曲封面和内置背景效果。',
			transparentBackgroundDescription: '启用透明窗口背景，并使用系统级毛玻璃材质。滑杆会在不同材质强度之间切换，该模式不会渲染项目内置背景。',
			transparentBackgroundUnsupported: '当前系统不支持 Electron 的系统级毛玻璃。该功能需要 Windows 11 22H2 或更高版本。',
			uploadCustomBackground: '上传背景图片',
			replaceCustomBackground: '替换背景图片',
			removeCustomBackground: '移除自定义背景',
			customBackgroundNotSelected: '当前未选择自定义背景图片。',
			customBackgroundReady: '已选择自定义背景图片',
			customBackgroundBlur: '背景模糊程度',
			transparentBackgroundBlur: '透明毛玻璃强度',
			backgroundEffect: '背景效果',
			blurMode: '模糊',
			streamerMode: '光流',
			about: '关于',
			version: '版本',
			runtime: '运行环境',
			libraryStats: '曲库数量',
			tracksCount: (count) => `${count} 首歌曲`,
		},
		eq: {
			title: '均衡器',
			subtitle: '播放链路与频段增益控制',
			playback: '播放处理',
			enableEQ: '启用 EQ',
			enableEQDescription: '在当前播放器的 Web Audio 链中启用多段均衡器处理。',
			enabledState: '已启用',
			disabledState: '已关闭',
			reset: '重置频段',
			resetDescription: '将所有频段恢复到 0 dB，不会影响当前音量。',
			bands: '频段控制',
			bandsDescription: '调节不同频率范围的增益，范围为 -12 dB 到 +12 dB。',
			summary: '状态摘要',
			summaryDescription: 'EQ 会直接作用于当前播放输出；切歌和暂停恢复后会保持设置。',
			gainLabel: '增益',
			gainUnit: 'dB',
			rangeLabel: '范围',
			statusLabel: '当前状态',
			previewHint: '频谱可视化会反映 EQ 处理后的频率变化。',
		},
	},
	'en-US': {
		common: {
			noSongSelected: 'No Song Selected',
			noSongHint: 'Choose a track from the library or a playlist to start playback',
			backToBrowser: 'Back to Library',
			searchingLyrics: 'Searching Lyrics',
			noLyrics: 'No lyrics available',
			currentQueue: 'Current Queue',
		},
		sidebar: {
			title: 'Music Hub',
			subtitle: 'Playlists and library',
			playlists: 'Playlists',
			allSongs: 'All Songs',
			artists: 'Artists',
			albums: 'Albums',
			search: 'Search',
			settings: 'Settings',
			playlistSection: 'Playlists',
			selectedPlaylist: 'Choose a playlist to browse or play',
			createPlaylist: 'Create Playlist',
			nowPlaying: 'Now Playing',
			newPlaylistName: (index) => `Playlist ${index}`,
		},
		playlist: {
			songsCount: (count) => `${count} track${count === 1 ? '' : 's'}`,
			play: 'Play Playlist',
			emptyTitle: 'This playlist is empty',
			emptyDescription: 'Add tracks from the library or import local audio to get started.',
		},
		library: {
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
			songs: (count) => `${count} track${count === 1 ? '' : 's'}`,
			playlistsCount: (count) => `${count} playlist${count === 1 ? '' : 's'}`,
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
			artistSubtitle: (count) => `${count} track${count === 1 ? '' : 's'}`,
			albumSubtitle: (artist) => artist,
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
		settings: {
			title: 'Settings',
			subtitle: 'Interface, language, and library controls',
			general: 'General',
			language: 'Language',
			languageDescription: 'Switch the display language used by the app.',
			chinese: 'Chinese',
			english: 'English',
			library: 'Library',
			currentFolder: 'Current Music Folder',
			currentFolderDescription: 'This folder is currently used to scan local music files.',
			folderUnavailable: 'Folder actions are unavailable in this runtime',
			refreshLibrary: 'Refresh Library',
			selectFolder: 'Select Folder',
			openFolder: 'Open Folder',
			refreshDescription: 'Refresh after changing folders to reload tracks and cover artwork.',
			appearance: 'Appearance',
			backgroundSource: 'Background Source',
			useBuiltInBackground: 'Built-in Background',
			useCustomBackground: 'Custom Background',
			useTransparentBackground: 'Transparent Background',
			customBackgroundDescription: 'Upload a background image and control its blur amount. When enabled, it overrides the current song-based background rendering.',
			transparentBackgroundDescription: 'Use a transparent window background with system-level glass material. The slider switches between different material strengths and skips the built-in background renderer.',
			transparentBackgroundUnsupported: 'System glass material is not available on this machine. Electron requires Windows 11 22H2 or newer for this feature.',
			uploadCustomBackground: 'Upload Background',
			replaceCustomBackground: 'Replace Background',
			removeCustomBackground: 'Remove Custom Background',
			customBackgroundNotSelected: 'No custom background image selected yet.',
			customBackgroundReady: 'Custom background image selected',
			customBackgroundBlur: 'Background Blur Amount',
			transparentBackgroundBlur: 'Transparent Glass Strength',
			backgroundEffect: 'Background Effect',
			blurMode: 'Blur',
			streamerMode: 'Streamer',
			about: 'About',
			version: 'Version',
			runtime: 'Runtime',
			libraryStats: 'Library Size',
			tracksCount: (count) => `${count} tracks`,
		},
		eq: {
			title: 'Equalizer',
			subtitle: 'Playback processing and band gain control',
			playback: 'Playback Processing',
			enableEQ: 'Enable EQ',
			enableEQDescription: 'Enable multi-band equalizer processing in the current Web Audio playback chain.',
			enabledState: 'Enabled',
			disabledState: 'Disabled',
			reset: 'Reset Bands',
			resetDescription: 'Restore every band to 0 dB without changing the master volume.',
			bands: 'Band Controls',
			bandsDescription: 'Adjust gain across different frequency ranges, from -12 dB to +12 dB.',
			summary: 'Status Summary',
			summaryDescription: 'EQ is applied directly to the active playback output and stays active across track changes and pause/resume.',
			gainLabel: 'Gain',
			gainUnit: 'dB',
			rangeLabel: 'Range',
			statusLabel: 'Current Status',
			previewHint: 'The spectrum visualizer reflects the post-EQ frequency response.',
		},
	},
};

export const getSettingsCopy = (language: AppLanguage): SettingsCopy => APP_COPY[language].settings;
export const getEQCopy = (language: AppLanguage): EQCopy => APP_COPY[language].eq;
