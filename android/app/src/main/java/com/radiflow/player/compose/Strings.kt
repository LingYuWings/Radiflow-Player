package com.radiflow.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

/** UI copy, mirroring the zh-CN / en-US strings of the desktop app. */
class Strings(val zh: Boolean) {
    private fun t(chinese: String, english: String) = if (zh) chinese else english

    // Shell
    val library = t("本地曲库", "Library")
    val netease = t("网易云音乐", "NetEase")
    val settings = t("设置", "Settings")
    val pages = t("页面", "Pages")
    val dismiss = t("关闭提示", "Dismiss")
    val genericError = t("操作失败，请重试。", "Something went wrong. Try again.")
    val queueCleared = t("播放队列已清空", "Queue cleared")

    // Player
    val nowPlaying = t("正在播放", "Now playing")
    val back = t("返回", "Back")
    val collapse = t("收起播放器", "Collapse player")
    val lyrics = t("歌词", "Lyrics")
    val queue = t("播放队列", "Queue")
    val play = t("播放", "Play")
    val pause = t("暂停", "Pause")
    val previous = t("上一首", "Previous track")
    val next = t("下一首", "Next track")
    val progress = t("播放进度", "Playback position")
    val volume = t("音量", "Volume")
    val shuffle = t("随机播放", "Shuffle")
    val repeatOff = t("关闭循环", "Repeat off")
    val repeatAll = t("列表循环", "Repeat all")
    val repeatOne = t("单曲循环", "Repeat one")
    val clearQueue = t("清空队列", "Clear queue")
    val undo = t("撤销", "Undo")
    val removeFromQueue = t("从队列移除", "Remove from queue")
    val moveUp = t("向上移动", "Move up")
    val moveDown = t("向下移动", "Move down")
    val noLyrics = t("暂无歌词", "No lyrics available")
    val loadingLyrics = t("正在获取歌词…", "Loading lyrics…")
    val unknownArtist = t("未知歌手", "Unknown artist")
    val unknownAlbum = t("未知专辑", "Unknown album")
    val openAlbum = t("打开专辑", "Open album")
    val buffering = t("正在缓冲…", "Buffering…")
    val importLyrics = t("导入 LRC 歌词", "Import LRC lyrics")
    fun songs(count: Int) = if (zh) "$count 首歌曲" else "$count ${if (count == 1) "song" else "songs"}"

    // Library
    val localLibrary = t("本地音乐库", "Local library")
    val songsTab = t("歌曲", "Songs")
    val artists = t("歌手", "Artists")
    val albums = t("专辑", "Albums")
    val playlists = t("歌单", "Playlists")
    val favorites = t("收藏", "Favorites")
    val importMusic = t("导入音乐", "Import music")
    val musicFolderTitle = t("读取手机音乐目录", "Read your Music folder")
    val musicFolderHint = t("允许读取音频后，会自动显示手机存储和 SD 卡中 Music 目录里的歌曲。", "Allow audio access to list the songs in the Music folders on this phone and its SD card.")
    val allowAccess = t("允许访问", "Allow access")
    val scanningLibrary = t("正在读取音乐库…", "Reading your library…")
    val importing = t("正在导入…", "Importing…")
    val searchLibrary = t("搜索音乐库", "Search library")
    val searchSongs = t("搜索歌曲", "Search songs")
    val emptyLibrary = t("音乐库还没有歌曲", "Your library is empty")
    val noMatches = t("没有找到匹配的结果", "No matching results")
    val noPlaylists = t("还没有歌单", "No playlists yet")
    val noFavorites = t("还没有收藏的歌曲", "No favorites yet")
    val emptyPlaylist = t("这个歌单还没有歌曲", "This playlist is empty")
    val unavailableTracks = t("部分歌曲暂时无法播放", "Some tracks are temporarily unavailable")
    val playAll = t("全部播放", "Play all")
    val playNext = t("下一首播放", "Play next")
    val addToQueue = t("加入队列", "Add to queue")
    val addToPlaylist = t("添加到歌单", "Add to playlist")
    val addSongs = t("添加歌曲", "Add songs")
    val newPlaylist = t("新建歌单", "New playlist")
    val renamePlaylist = t("重命名歌单", "Rename playlist")
    val playlistName = t("歌单名称", "Playlist name")
    val deletePlaylist = t("删除歌单", "Delete playlist")
    fun deleteMessage(name: String) = if (zh) "删除「$name」？音乐文件会保留在设备上。" else "Delete “$name”? Your music files will stay on this device."
    val removeFromPlaylist = t("从歌单移除", "Remove from playlist")
    val favorite = t("收藏歌曲", "Favorite track")
    val unfavorite = t("取消收藏", "Remove favorite")
    val trackActions = t("歌曲操作", "Track actions")
    val gridView = t("网格视图", "Grid view")
    val listView = t("列表视图", "List view")
    val cancel = t("取消", "Cancel")
    val save = t("保存", "Save")
    val close = t("关闭", "Close")
    val done = t("完成", "Done")
    val added = t("已添加", "Added")
    val artist = t("歌手", "Artist")
    val album = t("专辑", "Album")
    val playlist = t("歌单", "Playlist")

    // NetEase
    val search = t("搜索", "Search")
    val searchNetEase = t("搜索网易云音乐", "Search NetEase Music")
    val trending = t("热搜", "Trending searches")
    val nothing = t("没有找到结果", "No results")
    val loadMore = t("加载更多", "Load more")
    val createdPlaylists = t("创建的", "Created")
    val followedPlaylists = t("关注的", "Followed")
    val noCreatedPlaylists = t("还没有创建的歌单", "No playlists created yet")
    val noFollowedPlaylists = t("还没有关注的歌单", "No followed playlists")
    val signInHint = t("在设置中登录网易云后，即可查看你的歌单。", "Sign in to NetEase from Settings to see your playlists.")
    val create = t("创建", "Create")
    val addToNetEase = t("添加到网易云歌单", "Add to NetEase playlist")
    val neteaseError = t("网易云请求失败", "NetEase request failed")
    val emptyOnlineFavorites = t("还没有歌曲或专辑收藏", "No saved songs or albums")
    fun loaded(count: Int, total: Int) = if (zh) "已加载 $count / $total" else "Loaded $count of $total"
    val loadRest = t("继续加载", "Load the rest")

    // Settings
    val appearance = t("外观", "Appearance")
    val equalizer = t("均衡器", "Equalizer")
    val backgroundEffect = t("背景效果", "Background effect")
    val streamer = t("流光", "Light flow")
    val blurMode = t("封面模糊", "Cover blur")
    val backgroundSource = t("背景图片", "Background image")
    val uploadBackground = t("上传背景", "Upload background")
    val replaceBackground = t("更换背景", "Replace background")
    val removeBackground = t("移除自定义背景", "Remove custom background")
    val glassBlur = t("玻璃模糊强度", "Glass blur")
    val general = t("通用", "General")
    val language = t("语言", "Language")
    val dockLyrics = t("迷你播放条歌词", "Mini-player lyrics")
    val visualizer = t("音频可视化", "Audio visualizer")
    val about = t("关于", "About")
    val visualizerOff = t("关闭", "Off")
    val spectrum = t("频谱", "Spectrum")
    val mirror = t("镜像频谱", "Mirror")
    val waveform = t("波形", "Waveform")
    val neteaseAccount = t("网易云账号", "NetEase account")
    val signedOut = t("未登录", "Signed out")
    val signIn = t("扫码登录", "Sign in with QR code")
    val signOut = t("退出登录", "Sign out")
    val qrHint = t("使用网易云音乐 App 扫码登录", "Scan with the NetEase Music app")
    val qrConfirm = t("请在网易云音乐中确认登录", "Confirm sign-in in NetEase Music")
    val qrExpired = t("二维码已过期", "QR code expired")
    val qrRefresh = t("获取新二维码", "Get a new code")
    val eqEnabled = t("已开启", "On")
    val eqDisabled = t("已关闭", "Off")
    val bands = t("频段", "Bands")
    val reset = t("重置", "Reset")

    // Playback error dialog
    val errorTitle = t("无法播放", "Can't play this track")
    /** Same reasons as components/PlaybackErrorDialog.tsx, keyed by diagnostic code. */
    fun errorReason(code: String, retryAfter: Int?): String = when (code) {
        "NETEASE_TRACK_UNAVAILABLE" -> t("网易云未提供可播放的完整音频。歌曲可能无版权、已下架，或当前账号无权播放。",
            "NetEase did not provide a full stream. The track may be unlicensed, removed, or unavailable to this account.")
        "NETEASE_PREVIEW_ONLY" -> t("网易云只提供试听片段，当前账号无法播放完整版。", "NetEase only offers a preview to this account.")
        "NETEASE_RISK_CONTROL" -> if (zh) "网易云暂时限制了播放请求。" + (retryAfter?.let { "请至少等待 $it 秒后重试。" } ?: "请稍后重试。")
            else "NetEase temporarily limited playback requests. " + (retryAfter?.let { "Wait at least $it seconds before trying again." } ?: "Try again later.")
        "NETEASE_SESSION_CHANGED" -> t("检查期间网易云登录会话已变化，请重试。", "The NetEase session changed during the check. Try again.")
        "NETEASE_LOOKUP_FAILED" -> t("网易云取址请求失败，请稍后重试。", "The NetEase stream lookup failed. Try again later.")
        "NETEASE_SDK_INIT_FAILED" -> t("网易云播放协议初始化失败，请检查网络后重试。", "NetEase playback encryption could not be initialized. Check your connection and try again.")
        "NETEASE_CHECK_TIMEOUT" -> t("检查网易云歌曲是否可播放时超时。", "The NetEase playback check timed out.")
        "NETEASE_CHECK_NETWORK" -> t("无法连接播放器的本地服务。", "The player could not reach its local service.")
        "NETEASE_ANDROID_STARTUP" -> t("无法启动应用内的网易云服务，请重新打开应用。", "The embedded NetEase service could not start. Reopen the app to try again.")
        "NETEASE_ANDROID_NETWORK" -> t("音频连接中断，请检查网络后重试。", "The audio connection was interrupted. Check your network and try again.")
        "NETEASE_STREAM_FAILED" -> t("音源服务器拒绝了音频请求，请稍后重试。", "The audio server refused the request. Try again later.")
        else -> t("播放器无法加载或解码音频。", "The player could not load or decode the audio.")
    }
    val ok = t("知道了", "OK")

    companion object {
        val Zh = Strings(true)
        val En = Strings(false)
    }
}

val LocalStrings = staticCompositionLocalOf { Strings.Zh }

val strings: Strings @Composable get() = LocalStrings.current
