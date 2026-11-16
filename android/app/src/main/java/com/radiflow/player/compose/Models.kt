package com.radiflow.player

import android.net.Uri
import android.os.Bundle
import androidx.compose.runtime.Immutable
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject

/** A playable track, local (content URI id) or NetEase (`netease:<id>`). */
@Immutable
data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val cover: String? = null,
    val durationSec: Double? = null,
    val albumId: String? = null,
) {
    val isOnline: Boolean get() = id.startsWith(NETEASE_PREFIX)
    val onlineId: String? get() = if (isOnline) id.removePrefix(NETEASE_PREFIX) else null

    /** MediaItem with the metadata PlaybackService and the media notification read. */
    fun toMediaItem(): MediaItem {
        val metadata = MediaMetadata.Builder().setTitle(title).setArtist(artist)
        album?.takeIf { it.isNotEmpty() }?.let(metadata::setAlbumTitle)
        albumId?.takeIf { it.isNotEmpty() }?.let { metadata.setExtras(Bundle(1).apply { putString("albumId", it) }) }
        cover?.takeIf { it.isNotEmpty() }?.let { metadata.setArtworkUri(Uri.parse(it)) }
        durationSec?.takeIf { it > 0 && it.isFinite() }?.let { metadata.setDurationMs((it * 1000).toLong()) }
        return MediaItem.Builder().setMediaId(id).setUri(id).setMediaMetadata(metadata.build()).build()
    }

    companion object {
        const val NETEASE_PREFIX = "netease:"

        fun from(item: MediaItem): Track {
            val m = item.mediaMetadata
            return Track(
                id = item.mediaId,
                title = m.title?.toString().orEmpty(),
                artist = m.artist?.toString().orEmpty(),
                album = m.albumTitle?.toString(),
                cover = m.artworkUri?.toString(),
                durationSec = m.durationMs?.let { it / 1000.0 },
                albumId = m.extras?.getString("albumId"),
            )
        }

        /** Local library entries saved by [AndroidTrackLibrary]. */
        fun fromLibrary(json: JSONObject) = Track(
            id = json.optString("id"),
            title = json.optString("title"),
            artist = json.optString("artist"),
            album = json.optString("album").ifEmpty { null },
            cover = json.optString("cover").ifEmpty { null },
            durationSec = json.optDouble("duration").takeIf { it.isFinite() && it > 0 },
        )

        /** NetEase song payloads from the embedded server (`LibrarySongPayload`). */
        fun fromOnlineSong(json: JSONObject): Track? {
            val id = json.optString("filename")
            if (!Regex("^netease:\\d+$").matches(id)) return null
            return Track(
                id = id,
                title = json.optString("title"),
                artist = json.optString("artist"),
                album = json.optString("album").ifEmpty { null },
                cover = json.optString("cover").ifEmpty { null }?.replaceFirst(Regex("^http:", RegexOption.IGNORE_CASE), "https:"),
                durationSec = json.optDouble("duration").takeIf { it.isFinite() && it > 0 },
                albumId = json.optString("albumId").ifEmpty { null },
            )
        }

        fun fromOnlineSongs(array: JSONArray?): List<Track> {
            if (array == null) return emptyList()
            val seen = LinkedHashMap<String, Track>()
            for (index in 0 until array.length()) {
                val track = array.optJSONObject(index)?.let(::fromOnlineSong) ?: continue
                seen.putIfAbsent(track.id, track)
            }
            return seen.values.toList()
        }
    }
}

/** Playlist / album / artist summary shown as a card. */
@Immutable
data class OnlineItem(
    val id: String,
    val name: String,
    val cover: String? = null,
    val artist: String? = null,
    val subtitle: String? = null,
    val trackCount: Int? = null,
    val category: String? = null,
) {
    companion object {
        fun from(json: JSONObject) = OnlineItem(
            id = json.optString("id"),
            name = json.optString("name"),
            cover = json.optString("cover").ifEmpty { null }?.replaceFirst(Regex("^http:", RegexOption.IGNORE_CASE), "https:"),
            artist = json.optString("artist").ifEmpty { null },
            subtitle = json.optString("subtitle").ifEmpty { null },
            trackCount = if (json.has("trackCount")) json.optInt("trackCount") else null,
            category = json.optString("category").ifEmpty { null },
        )

        fun list(array: JSONArray?): List<OnlineItem> {
            if (array == null) return emptyList()
            val seen = LinkedHashMap<String, OnlineItem>()
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index)?.let(::from) ?: continue
                if (item.id.isNotEmpty()) seen.putIfAbsent(item.id, item)
            }
            return seen.values.toList()
        }
    }
}

@Immutable
data class OnlineAccount(val userId: Long, val nickname: String, val avatarUrl: String?)

@Immutable
data class OnlineSession(val isLoggedIn: Boolean, val account: OnlineAccount?) {
    companion object {
        fun from(json: JSONObject): OnlineSession {
            val account = json.optJSONObject("account")?.let {
                OnlineAccount(it.optLong("userId"), it.optString("nickname"), it.optString("avatarUrl").ifEmpty { null })
            }
            return OnlineSession(json.optBoolean("isLoggedIn"), account)
        }
    }
}

/** Mirrors `PlaybackError` used by the shared error dialog. */
@Immutable
data class PlaybackError(val code: String, val httpStatus: Int? = null, val retryAfter: Int? = null)

enum class RepeatMode { OFF, ALL, ONE }
enum class VisualizerMode { OFF, SPECTRUM, MIRROR, WAVEFORM }
enum class BackgroundEffect { STREAMER, BLUR }
enum class Language { ZH, EN }
