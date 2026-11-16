package com.radiflow.player

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException

class NetEaseException(message: String, val status: Int = 0) : IOException(message)

data class PlaylistPage(
    val playlist: OnlineItem?,
    val tracks: List<Track>,
    val total: Int,
    val nextOffset: Int?,
)

data class SearchResult(val tracks: List<Track>, val albums: List<OnlineItem>, val artists: List<OnlineItem>, val total: Int)

data class OnlineCollection(val item: OnlineItem, val tracks: List<Track>, val albums: List<OnlineItem>)

data class LyricData(val lrc: String?, val yrc: String?, val translation: String?)

/**
 * Client for the embedded Node service (the same server.ts the desktop app
 * runs). Requests go over loopback with the per-launch token held by
 * [EmbeddedNode]; nothing here talks to NetEase directly.
 */
class NetEaseApi(context: Context) {
    private val app = context.applicationContext

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val node = try { EmbeddedNode.get(app) } catch (error: IOException) {
                throw NetEaseException("Could not start the embedded NetEase service.")
            }
            val response = node.request(path, method, body?.toString()?.toByteArray(Charsets.UTF_8))
            val json = runCatching { JSONObject(response.body()) }.getOrNull()
            if (response.status() !in 200..299) {
                val message = json?.optString("error")?.ifEmpty { null } ?: json?.optString("code")?.ifEmpty { null }
                throw NetEaseException(message ?: "HTTP ${response.status()}", response.status())
            }
            json ?: throw NetEaseException("Invalid NetEase response.")
        }

    private fun query(path: String, vararg params: Pair<String, Any?>): String {
        val builder = Uri.parse(path).buildUpon()
        params.forEach { (key, value) -> if (value != null) builder.appendQueryParameter(key, value.toString()) }
        return builder.build().toString()
    }

    suspend fun session() = OnlineSession.from(request("/api/netease/session"))

    suspend fun hotSearches(): List<String> {
        val items = request("/api/netease/search/hot/detail").optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { items.optJSONObject(it)?.optString("name")?.ifEmpty { null } }.take(10)
    }

    suspend fun search(keywords: String, kind: SearchKind, offset: Int, limit: Int = 30): SearchResult {
        val json = request(query("/api/netease/search", "keywords" to keywords, "type" to kind.code, "limit" to limit, "offset" to offset))
        return SearchResult(
            tracks = Track.fromOnlineSongs(json.optJSONArray("songs")),
            albums = OnlineItem.list(json.optJSONArray("albums")),
            artists = OnlineItem.list(json.optJSONArray("artists")),
            total = json.optInt("total"),
        )
    }

    suspend fun playlists(): List<OnlineItem> = OnlineItem.list(request("/api/netease/playlists").optJSONArray("playlists"))

    suspend fun playlistPage(id: String, offset: Int, limit: Int): PlaylistPage {
        val json = request(query("/api/netease/playlist/$id", "offset" to offset, "limit" to limit))
        val tracks = Track.fromOnlineSongs(json.optJSONArray("songs"))
        return PlaylistPage(
            playlist = json.optJSONObject("playlist")?.let(OnlineItem::from),
            tracks = tracks,
            total = if (json.has("total")) json.optInt("total") else tracks.size,
            nextOffset = if (json.isNull("nextOffset") || !json.has("nextOffset")) null else json.optInt("nextOffset"),
        )
    }

    /** Album or artist detail. */
    suspend fun collection(kind: String, id: String): OnlineCollection {
        val json = request("/api/netease/$kind/$id").optJSONObject("collection") ?: throw NetEaseException("HTTP 404", 404)
        return OnlineCollection(OnlineItem.from(json), Track.fromOnlineSongs(json.optJSONArray("songs")), OnlineItem.list(json.optJSONArray("albums")))
    }

    suspend fun lyrics(track: Track): LyricData? {
        val path = track.onlineId?.let { "/api/netease/lyric/$it" }
            ?: query("/api/netease/lyric", "title" to track.title, "artist" to track.artist)
        val data = request(path).optJSONObject("data") ?: return null
        fun text(key: String) = data.optString(key).ifEmpty { null }
        return LyricData(text("lrc") ?: text("lyric"), text("yrc"), text("ytlrc") ?: text("tlyric") ?: text("trans"))
    }

    suspend fun startQrLogin(): Pair<String, String> {
        val json = request("/api/netease/login/qr/start", "POST")
        return json.optString("key") to json.optString("qrImage")
    }

    data class QrStatus(val code: Int, val session: OnlineSession?)

    suspend fun checkQr(key: String): QrStatus {
        val json = request(query("/api/netease/login/qr/check", "key" to key))
        return QrStatus(json.optInt("code"), if (json.optInt("code") == 803) OnlineSession.from(json) else null)
    }

    suspend fun logout() = OnlineSession.from(request("/api/netease/logout", "POST"))

    suspend fun createPlaylist(name: String) { request("/api/netease/playlists", "POST", JSONObject().put("name", name)) }
    suspend fun deletePlaylist(id: String) { request("/api/netease/playlists/$id", "DELETE") }
    suspend fun editPlaylist(id: String, add: Boolean, trackId: String) {
        request("/api/netease/playlists/$id/tracks", "POST", JSONObject().put("op", if (add) "add" else "del")
            .put("trackIds", org.json.JSONArray().put(trackId.removePrefix(Track.NETEASE_PREFIX))))
    }
}

enum class SearchKind(val code: Int) { TRACKS(1), ALBUMS(10), ARTISTS(100) }

/** Lyrics for a track: NetEase word timing when available, translations merged. */
suspend fun NetEaseApi.loadLyrics(track: Track): List<LyricLine> {
    val data = lyrics(track) ?: return emptyList()
    val timed = data.yrc?.let(LyricsParser::parseYrc).orEmpty()
    val primary = timed.ifEmpty { LyricsParser.parseLrc(data.lrc.orEmpty()) }
    return data.translation?.let { LyricsParser.merge(primary, LyricsParser.parseLrc(it)) } ?: primary
}
