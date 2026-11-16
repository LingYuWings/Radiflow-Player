package com.radiflow.player

import androidx.compose.runtime.Immutable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

enum class DetailKind { PLAYLIST, ALBUM, ARTIST }

@Immutable
data class BrowseDetail(
    val kind: DetailKind,
    val item: OnlineItem,
    val tracks: List<Track>,
    val albums: List<OnlineItem> = emptyList(),
    val editable: Boolean = false,
    val total: Int? = null,
    /** Pages still missing (loading, or failed and retryable). */
    val partial: Boolean = false,
    val loading: Boolean = false,
) {
    val source: String? get() = if (kind == DetailKind.PLAYLIST && partial) "netease-playlist:${item.id}" else null
}

/**
 * Holds NetEase browse state outside composition so background playlist
 * pages keep loading after the user leaves a detail view. Paging follows the
 * desktop contract (useNetEase.loadPlaylist): first 200 tracks at once, then
 * 500-track pages two at a time, appended strictly in order, one retry each.
 */
class NetEaseBrowser(private val api: NetEaseApi, private val scope: CoroutineScope, private val onExtend: (String, List<Track>) -> Unit) {
    private val _stack = MutableStateFlow<List<BrowseDetail>>(emptyList())
    val stack = _stack.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private val cache = HashMap<String, BrowseDetail>()
    private val loads = HashMap<String, Job>()
    private var foreground: Job? = null

    fun clearError() { _error.value = null }

    /** Session changed: cached playlists belong to another account. */
    fun resetPlaylists() {
        loads.values.forEach { it.cancel() }
        loads.clear()
        cache.clear()
        _stack.update { list -> list.filter { it.kind != DetailKind.PLAYLIST } }
    }

    fun back(): Boolean {
        if (_stack.value.isEmpty()) return false
        foreground?.cancel()
        _busy.value = false
        _error.value = null
        _stack.update { it.dropLast(1) }
        return true
    }

    fun clear() {
        foreground?.cancel()
        _busy.value = false
        _error.value = null
        _stack.value = emptyList()
    }

    private fun push(detail: BrowseDetail) = _stack.update { list ->
        val last = list.lastOrNull()
        if (last != null && last.kind == detail.kind && last.item.id == detail.item.id) list.dropLast(1) + detail else list + detail
    }

    private fun publish(detail: BrowseDetail) {
        cache[detail.item.id] = detail
        _stack.update { list -> list.map { if (it.kind == DetailKind.PLAYLIST && it.item.id == detail.item.id) detail else it } }
    }

    private fun foreground(block: suspend () -> Unit) {
        foreground?.cancel()
        _error.value = null
        foreground = scope.launch {
            _busy.value = true
            try { block() } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) {
                _error.value = error.message ?: "HTTP"
            } finally { _busy.value = false }
        }
    }

    fun open(kind: DetailKind, id: String) {
        if (!Regex("^\\d+$").matches(id)) return
        if (kind == DetailKind.PLAYLIST) return openPlaylist(id, force = false)
        foreground {
            val collection = api.collection(if (kind == DetailKind.ALBUM) "album" else "artist", id)
            push(BrowseDetail(kind, collection.item, collection.tracks, collection.albums))
        }
    }

    fun openPlaylist(id: String, force: Boolean) {
        val cached = cache[id]
        if (!force && cached != null && (!cached.partial || loads[id]?.isActive == true)) {
            foreground?.cancel(); _busy.value = false; _error.value = null
            push(cached)
            return
        }
        loads.remove(id)?.cancel()
        foreground {
            val page = fetchPage(id, 0, FIRST_PAGE)
            val playlist = page.playlist ?: throw NetEaseException("HTTP 404", 404)
            val offsets = remaining(page.nextOffset, page.total)
            val detail = BrowseDetail(DetailKind.PLAYLIST, playlist, page.tracks, editable = playlist.category == "created",
                total = if (offsets.isEmpty()) page.tracks.size else page.total, partial = offsets.isNotEmpty(), loading = offsets.isNotEmpty())
            cache[id] = detail
            push(detail)
            if (offsets.isNotEmpty()) loads[id] = scope.launch { loadRemaining(detail, offsets) }
        }
    }

    private suspend fun loadRemaining(base: BrowseDetail, offsets: List<Int>) {
        val seen = base.tracks.mapTo(HashSet()) { it.id }
        val accumulated = base.tracks.toMutableList()
        val pages = arrayOfNulls<List<Track>>(offsets.size)
        var flushed = 0
        fun emit(partial: Boolean, loading: Boolean) {
            val snapshot = accumulated.toList()
            publish(base.copy(tracks = snapshot, partial = partial, loading = loading, total = if (partial) base.total else snapshot.size))
            onExtend("netease-playlist:${base.item.id}", snapshot)
        }
        try {
            val gate = Semaphore(PAGE_CONCURRENCY)
            coroutineScope {
                offsets.mapIndexed { index, offset ->
                    async {
                        val tracks = gate.withPermit { fetchPage(base.item.id, offset, PAGE).tracks }
                        synchronized(pages) {
                            pages[index] = tracks
                            var advanced = false
                            while (flushed < pages.size && pages[flushed] != null) {
                                pages[flushed]!!.forEach { if (seen.add(it.id)) accumulated += it }
                                pages[flushed] = null
                                flushed++
                                advanced = true
                            }
                            if (advanced && flushed < pages.size) emit(partial = true, loading = true)
                        }
                    }
                }.awaitAll()
            }
            emit(partial = false, loading = false)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (error: Exception) {
            // Keep what loaded; staying partial lets reopening (or Retry) fetch the rest.
            emit(partial = true, loading = false)
            _error.value = error.message
        } finally {
            loads.remove(base.item.id)
        }
    }

    private suspend fun fetchPage(id: String, offset: Int, limit: Int): PlaylistPage {
        var failure: Exception? = null
        repeat(2) {
            try { return api.playlistPage(id, offset, limit) } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { failure = error }
        }
        throw failure!!
    }

    /** Playlist contents changed on the server (track added/removed, deleted). */
    fun invalidate(id: String) {
        loads.remove(id)?.cancel()
        cache.remove(id)
    }

    companion object {
        const val FIRST_PAGE = 200
        const val PAGE = 500
        const val PAGE_CONCURRENCY = 2

        fun remaining(nextOffset: Int?, total: Int): List<Int> {
            if (nextOffset == null) return emptyList()
            return (nextOffset.coerceAtLeast(0) until total step PAGE).toList()
        }
    }
}
