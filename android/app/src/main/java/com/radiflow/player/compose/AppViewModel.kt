package com.radiflow.player

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

@Immutable
data class Appearance(
    val language: Language,
    val effect: BackgroundEffect = BackgroundEffect.STREAMER,
    val background: String? = null,
    val blur: Int = 36,
    val dockLyrics: Boolean = true,
    val visualizer: VisualizerMode = VisualizerMode.OFF,
)

@Immutable
data class LyricsState(val trackId: String? = null, val lines: List<LyricLine> = emptyList(), val loading: Boolean = false)

/** Queue snapshot used for undo and for restoring after the process is killed. */
private data class QueueSnapshot(val tracks: List<Track>, val currentId: String, val positionMs: Long, val playing: Boolean)

/** A queue started from the top of a still-loading playlist; grows while left untouched. */
private data class QueueExtension(val source: String, val queue: List<Track>)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val context: Context get() = getApplication()
    private val prefs = application.getSharedPreferences("radiflow-compose", Context.MODE_PRIVATE)

    val player = PlayerRepository(application, viewModelScope)
    val api = NetEaseApi(application)
    val playerState: StateFlow<PlayerState> = player.state
    val collections = CollectionsStore(prefs)
    val onlineFavorites = OnlineFavoritesStore(prefs)
    val browser = NetEaseBrowser(api, viewModelScope) { source, items -> extendQueue(source, items) }

    private val _appearance = MutableStateFlow(readAppearance())
    val appearance = _appearance.asStateFlow()

    private val _library = MutableStateFlow<List<Track>>(emptyList())
    val library = _library.asStateFlow()
    private val _importing = MutableStateFlow(false)
    val importing = _importing.asStateFlow()
    private val _scanning = MutableStateFlow(false)
    val scanning = _scanning.asStateFlow()
    private val _mediaPermission = MutableStateFlow(MediaStoreLibrary.hasPermission(application))
    /** Whether the app may read the device Music folders. */
    val mediaPermission = _mediaPermission.asStateFlow()
    private var libraryJob: Job? = null
    private val mediaObserver = MediaStoreLibrary.observe(application) { loadLibrary(debounce = true) }

    private val _lyrics = MutableStateFlow(LyricsState())
    val lyrics = _lyrics.asStateFlow()
    private val lyricCache = object : LinkedHashMap<String, List<LyricLine>>(48, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<LyricLine>>?) = size > 40
    }
    private var lyricsWanted = false
    private var lyricJob: Job? = null

    private val _session = MutableStateFlow<OnlineSession?>(null)
    val session = _session.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    private val _canUndo = MutableStateFlow(false)
    val canUndo = _canUndo.asStateFlow()
    private var undoSnapshot: QueueSnapshot? = null
    private var extension: QueueExtension? = null

    init {
        player.connect()
        loadLibrary()
        viewModelScope.launch { restoreAfterConnect() }
        viewModelScope.launch {
            // Persist the queue whenever it changes; position is saved on pause/background.
            player.state.distinctUntilChangedBy { it.queue to it.track?.id }.collect { persistResume() }
        }
        viewModelScope.launch {
            player.state.distinctUntilChangedBy { it.track?.id }.collect { refreshLyrics() }
        }
        viewModelScope.launch { player.state.distinctUntilChangedBy { it.playing }.collect { if (!it.playing) persistResume() } }
        refreshSession()
    }

    override fun onCleared() {
        context.contentResolver.unregisterContentObserver(mediaObserver)
        persistResume()
        player.release()
    }

    fun onForeground(visible: Boolean) {
        if (!visible) persistResume() else refreshMediaPermission()
        player.setVisualizer(if (visible && visualizerVisible) _appearance.value.visualizer else VisualizerMode.OFF)
    }

    private var visualizerVisible = false
    fun setVisualizerVisible(visible: Boolean) {
        visualizerVisible = visible
        player.setVisualizer(if (visible) _appearance.value.visualizer else VisualizerMode.OFF)
    }

    fun showMessage(text: String?) { _message.value = text }

    private fun text(zh: String, en: String) = if (_appearance.value.language == Language.ZH) zh else en

    // region Appearance

    private fun readAppearance(): Appearance {
        val system = if (java.util.Locale.getDefault().language.startsWith("zh")) Language.ZH else Language.EN
        return Appearance(
            language = prefs.getString("language", null)?.let { runCatching { Language.valueOf(it) }.getOrNull() } ?: system,
            effect = prefs.getString("effect", null)?.let { runCatching { BackgroundEffect.valueOf(it) }.getOrNull() } ?: BackgroundEffect.STREAMER,
            background = prefs.getString("background", null)?.takeIf { File(it).isFile },
            blur = prefs.getInt("blur", 36).coerceIn(0, 72),
            dockLyrics = prefs.getBoolean("dockLyrics", true),
            visualizer = prefs.getString("visualizer", null)?.let { runCatching { VisualizerMode.valueOf(it) }.getOrNull() } ?: VisualizerMode.OFF,
        )
    }

    fun updateAppearance(change: (Appearance) -> Appearance) {
        val next = change(_appearance.value)
        _appearance.value = next
        prefs.edit().putString("language", next.language.name).putString("effect", next.effect.name)
            .putString("background", next.background).putInt("blur", next.blur)
            .putBoolean("dockLyrics", next.dockLyrics).putString("visualizer", next.visualizer.name).apply()
        if (visualizerVisible) player.setVisualizer(next.visualizer)
        refreshLyrics()
    }

    /** Copies a picked image into app storage, downscaled like the desktop app (max 1440px JPEG). */
    fun setCustomBackground(uri: Uri) = viewModelScope.launch {
        val path = withContext(Dispatchers.IO) {
            runCatching {
                val bitmap = context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it) }
                    ?: return@runCatching null
                val ratio = minOf(1f, 1440f / maxOf(bitmap.width, bitmap.height))
                val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).toInt().coerceAtLeast(1),
                    (bitmap.height * ratio).toInt().coerceAtLeast(1), true)
                val file = File(context.filesDir, "background-${System.currentTimeMillis()}.jpg")
                file.outputStream().use { scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, it) }
                context.filesDir.listFiles { f -> f.name.startsWith("background-") && f != file }?.forEach { it.delete() }
                file.absolutePath
            }.getOrNull()
        }
        if (path == null) showMessage(text("无法读取所选图片", "Could not read the selected image"))
        else updateAppearance { it.copy(background = path) }
    }

    fun clearCustomBackground() {
        _appearance.value.background?.let { File(it).delete() }
        updateAppearance { it.copy(background = null) }
    }

    // endregion
    // region Local library

    /** Device Music folders (media store) plus files imported elsewhere through the system picker. */
    private fun loadLibrary(debounce: Boolean = false) {
        libraryJob?.cancel()
        libraryJob = viewModelScope.launch {
            if (debounce) delay(1500)
            _scanning.value = true
            val tracks = withContext(Dispatchers.IO) {
                val scanned = runCatching { MediaStoreLibrary.query(context) }.getOrDefault(emptyList())
                val imported = AndroidTrackLibrary.read(context)
                if (AndroidTrackLibrary.refreshMetadata(context, imported)) AndroidTrackLibrary.save(context, imported)
                val merged = LinkedHashMap<String, Track>()
                scanned.forEach { merged[it.id] = it }
                imported.values.map(Track::fromLibrary).forEach { merged.putIfAbsent(it.id, it) }
                merged.values.toList()
            }
            _library.value = tracks
            _scanning.value = false
        }
    }

    /** Called after the media permission prompt and when the app returns to the foreground. */
    fun refreshMediaPermission() {
        val granted = MediaStoreLibrary.hasPermission(context)
        if (granted != _mediaPermission.value) {
            _mediaPermission.value = granted
            loadLibrary()
        }
    }

    /** Files picked outside the Music folders: persistable read grants + cached metadata (AndroidTrackLibrary). */
    fun importTracks(uris: List<Uri>) = viewModelScope.launch {
        if (uris.isEmpty()) return@launch
        _importing.value = true
        val result = withContext(Dispatchers.IO) {
            val tracks = AndroidTrackLibrary.read(context)
            var readable = false
            for (uri in uris) {
                if (uri.scheme != "content") continue
                try {
                    context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    tracks[uri.toString()] = AndroidTrackLibrary.readMetadata(context, uri, tracks[uri.toString()])
                    readable = true
                } catch (_: SecurityException) {
                    // Providers without a persistent grant cannot be reopened later.
                }
            }
            when {
                !readable -> null
                !AndroidTrackLibrary.save(context, tracks) -> emptyList()
                else -> tracks.values.map(Track::fromLibrary)
            }
        }
        _importing.value = false
        when {
            result == null -> showMessage(text("系统没有授予所选音频的读取权限。", "Android did not grant access to the selected audio files."))
            result.isEmpty() -> showMessage(text("无法保存本地音乐库。", "Could not save the local music library."))
            else -> loadLibrary()
        }
    }

    // endregion
    // region Playback commands

    /** Plays [id] within [items]; [source] marks a still-loading playlist whose later pages may extend the queue. */
    fun play(id: String, items: List<Track>, source: String? = null) {
        undoSnapshot = null
        _canUndo.value = false
        extension = null
        val index = items.indexOfFirst { it.id == id }.coerceAtLeast(0)
        val start = (index - PlayerRepository.MAX_QUEUE / 2).coerceAtLeast(0)
        val window = items.subList(start, minOf(items.size, start + PlayerRepository.MAX_QUEUE))
        player.playTracks(window, id)
        if (source != null && start == 0) {
            viewModelScope.launch {
                val state = player.state.first { s -> s.track?.id == id && s.queue.isNotEmpty() }
                extension = QueueExtension(source, state.queue)
            }
        }
    }

    fun extendQueue(source: String, items: List<Track>) {
        val current = extension ?: return
        if (current.source != source) return
        val queue = player.state.value.queue
        if (queue != current.queue) { extension = null; return }
        val known = queue.mapTo(HashSet()) { it.id }
        val additions = items.filter { it.id !in known }
        if (additions.isEmpty()) return
        player.append(additions)
        viewModelScope.launch {
            val state = player.state.first { it.queue.size > queue.size || it.queue != queue }
            extension = if (extension === current) QueueExtension(source, state.queue) else extension
        }
    }

    private fun snapshot(): QueueSnapshot? {
        val state = player.state.value
        val id = state.track?.id ?: return null
        return if (state.queue.isEmpty()) null else QueueSnapshot(state.queue, id, player.positionMs(), state.playing)
    }

    /** Queue edits are undoable, like the desktop app. */
    fun editQueue(edit: (PlayerRepository) -> Unit) {
        undoSnapshot = snapshot()
        _canUndo.value = undoSnapshot != null
        edit(player)
    }

    fun undoQueue() {
        val previous = undoSnapshot ?: return
        player.playTracks(previous.tracks, previous.currentId, previous.positionMs, previous.playing)
        undoSnapshot = null
        _canUndo.value = false
    }

    // endregion
    // region Resume after process death

    private val resumeFile get() = File(context.noBackupFilesDir, "compose-resume.json")
    private var resumeJob: Job? = null

    private fun persistResume() {
        val snap = snapshot() ?: return
        resumeJob?.cancel()
        resumeJob = viewModelScope.launch(Dispatchers.IO) {
            delay(400)
            val queue = JSONArray()
            snap.tracks.forEach { t ->
                queue.put(JSONObject().put("id", t.id).put("title", t.title).put("artist", t.artist).putOpt("album", t.album)
                    .putOpt("cover", t.cover).putOpt("duration", t.durationSec).putOpt("albumId", t.albumId))
            }
            val json = JSONObject().put("id", snap.currentId).put("position", snap.positionMs).put("queue", queue)
            runCatching {
                val temp = File(resumeFile.path + ".tmp")
                temp.writeText(json.toString())
                temp.renameTo(resumeFile)
            }
        }
    }

    private suspend fun restoreAfterConnect() {
        val state = player.state.first { it.connected }
        if (state.track != null) return
        val json = withContext(Dispatchers.IO) { runCatching { JSONObject(resumeFile.readText()) }.getOrNull() } ?: return
        val array = json.optJSONArray("queue") ?: return
        val tracks = (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let {
                Track(it.optString("id"), it.optString("title"), it.optString("artist"), it.optString("album").ifEmpty { null },
                    it.optString("cover").ifEmpty { null }, it.optDouble("duration").takeIf { d -> d.isFinite() && d > 0 },
                    it.optString("albumId").ifEmpty { null })
            }
        }
        val id = json.optString("id")
        if (tracks.any { it.id == id }) player.playTracks(tracks, id, json.optLong("position"), autoplay = false)
    }

    // endregion
    // region Lyrics

    fun setLyricsWanted(wanted: Boolean) {
        if (lyricsWanted == wanted) return
        lyricsWanted = wanted
        refreshLyrics()
    }

    private fun manualKey(id: String) = "lyrics:$id"

    private fun refreshLyrics() {
        val track = player.state.value.track
        val wanted = lyricsWanted || _appearance.value.dockLyrics
        if (track == null || !wanted) return
        if (_lyrics.value.trackId == track.id && !_lyrics.value.loading) return
        lyricJob?.cancel()
        prefs.getString(manualKey(track.id), null)?.let {
            _lyrics.value = LyricsState(track.id, LyricsParser.parseLrc(it))
            return
        }
        lyricCache[track.id]?.let { _lyrics.value = LyricsState(track.id, it); return }
        _lyrics.value = LyricsState(track.id, emptyList(), loading = true)
        lyricJob = viewModelScope.launch {
            val lines = runCatching { api.loadLyrics(track) }.getOrDefault(emptyList())
            lyricCache[track.id] = lines
            if (player.state.value.track?.id == track.id) _lyrics.value = LyricsState(track.id, lines)
        }
    }

    /** Attaches an LRC file to the current local track (max 256 KB, must contain timestamps). */
    fun attachLyrics(uri: Uri) = viewModelScope.launch {
        val track = player.state.value.track ?: return@launch
        val content = withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val bytes = input.readBytes()
                    if (bytes.size > 256 * 1024) null else bytes.toString(Charsets.UTF_8)
                }
            }.getOrNull()
        }
        when {
            content == null -> showMessage(text("歌词文件过大或无法读取", "The lyric file is too large or unreadable"))
            LyricsParser.parseLrc(content).isEmpty() -> showMessage(text("歌词文件没有有效时间戳", "The lyric file has no valid timestamps"))
            else -> {
                prefs.edit().putString(manualKey(track.id), content).apply()
                _lyrics.update { LyricsState() }
                refreshLyrics()
            }
        }
    }

    // endregion
    // region NetEase session

    fun setSession(session: OnlineSession) {
        val previous = _session.value
        if (previous?.isLoggedIn != session.isLoggedIn || previous?.account?.userId != session.account?.userId) browser.resetPlaylists()
        _session.value = session
    }

    fun refreshSession() = viewModelScope.launch { runCatching { api.session() }.onSuccess(::setSession) }

    // endregion
}
