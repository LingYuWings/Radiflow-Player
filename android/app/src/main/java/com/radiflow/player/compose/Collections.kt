package com.radiflow.player

import android.content.SharedPreferences
import androidx.compose.runtime.Immutable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

@Immutable
data class LocalPlaylist(val id: String, val name: String, val trackIds: List<String>)

@Immutable
data class LocalCollections(val playlists: List<LocalPlaylist> = emptyList(), val favoriteIds: List<String> = emptyList())

/** Local playlists and favorites, stored as JSON in shared preferences. */
class CollectionsStore(private val prefs: SharedPreferences) {
    private val key = "library-collections"
    private val _state = MutableStateFlow(read())
    val state = _state.asStateFlow()

    private fun read(): LocalCollections = runCatching {
        val json = JSONObject(prefs.getString(key, null) ?: return LocalCollections())
        val seen = HashSet<String>()
        val playlists = json.optJSONArray("playlists")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val entry = array.optJSONObject(index) ?: return@mapNotNull null
                val id = entry.optString("id").trim()
                val name = entry.optString("name").trim()
                if (id.isEmpty() || name.isEmpty() || !seen.add(id)) null else LocalPlaylist(id, name, ids(entry.optJSONArray("trackIds")))
            }
        }.orEmpty()
        LocalCollections(playlists, ids(json.optJSONArray("favoriteIds")))
    }.getOrDefault(LocalCollections())

    private fun ids(array: JSONArray?) = if (array == null) emptyList()
        else (0 until array.length()).mapNotNull { array.optString(it).trim().ifEmpty { null } }.distinct()

    private fun update(change: (LocalCollections) -> LocalCollections): Boolean {
        val next = change(_state.value)
        val json = JSONObject()
            .put("playlists", JSONArray().apply {
                next.playlists.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("trackIds", JSONArray(it.trackIds))) }
            })
            .put("favoriteIds", JSONArray(next.favoriteIds))
        val saved = prefs.edit().putString(key, json.toString()).commit()
        if (saved) _state.value = next
        return saved
    }

    fun toggleFavorite(id: String) = update { c ->
        c.copy(favoriteIds = if (id in c.favoriteIds) c.favoriteIds - id else c.favoriteIds + id)
    }

    fun createPlaylist(name: String, trackIds: List<String>): String {
        val id = UUID.randomUUID().toString()
        update { it.copy(playlists = it.playlists + LocalPlaylist(id, name, trackIds.distinct())) }
        return id
    }

    fun rename(id: String, name: String) = update { c -> c.copy(playlists = c.playlists.map { if (it.id == id) it.copy(name = name) else it }) }
    fun delete(id: String) = update { c -> c.copy(playlists = c.playlists.filterNot { it.id == id }) }
    fun addTracks(id: String, trackIds: List<String>) = update { c ->
        c.copy(playlists = c.playlists.map { if (it.id == id) it.copy(trackIds = (it.trackIds + trackIds).distinct()) else it })
    }
    fun removeTrack(id: String, trackId: String) = update { c ->
        c.copy(playlists = c.playlists.map { if (it.id == id) it.copy(trackIds = it.trackIds - trackId) else it })
    }
}

@Immutable
data class OnlineFavorites(val tracks: List<Track> = emptyList(), val albums: List<OnlineItem> = emptyList())

/** NetEase songs/albums saved on the device. */
class OnlineFavoritesStore(private val prefs: SharedPreferences) {
    private val key = "netease-favorites"
    private val _state = MutableStateFlow(read())
    val state = _state.asStateFlow()

    private fun read(): OnlineFavorites = runCatching {
        val json = JSONObject(prefs.getString(key, null) ?: return OnlineFavorites())
        val tracks = json.optJSONArray("tracks")?.let { a ->
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
                Track(it.optString("id"), it.optString("title"), it.optString("artist"), it.optString("album").ifEmpty { null },
                    it.optString("cover").ifEmpty { null }, it.optDouble("duration").takeIf { d -> d.isFinite() && d > 0 },
                    it.optString("albumId").ifEmpty { null })
            }.filter { it.isOnline }
        }.orEmpty()
        OnlineFavorites(tracks, OnlineItem.list(json.optJSONArray("albums")))
    }.getOrDefault(OnlineFavorites())

    private fun save(next: OnlineFavorites) {
        val json = JSONObject()
            .put("tracks", JSONArray().apply {
                next.tracks.forEach { t ->
                    put(JSONObject().put("id", t.id).put("title", t.title).put("artist", t.artist).putOpt("album", t.album)
                        .putOpt("cover", t.cover).putOpt("duration", t.durationSec).putOpt("albumId", t.albumId))
                }
            })
            .put("albums", JSONArray().apply {
                next.albums.forEach { put(JSONObject().put("id", it.id).put("name", it.name).putOpt("cover", it.cover).putOpt("artist", it.artist)) }
            })
        if (prefs.edit().putString(key, json.toString()).commit()) _state.value = next
    }

    fun toggleTrack(track: Track) = _state.value.let { c ->
        save(c.copy(tracks = if (c.tracks.any { it.id == track.id }) c.tracks.filterNot { it.id == track.id } else c.tracks + track))
    }

    fun toggleAlbum(album: OnlineItem) = _state.value.let { c ->
        save(c.copy(albums = if (c.albums.any { it.id == album.id }) c.albums.filterNot { it.id == album.id }
            else c.albums + album.copy(subtitle = null, trackCount = null, category = null)))
    }
}
