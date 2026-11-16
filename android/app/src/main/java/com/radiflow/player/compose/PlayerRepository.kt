package com.radiflow.player

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Immutable
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

/** Everything the UI renders about playback, except the continuously moving position. */
@Immutable
data class PlayerState(
    val connected: Boolean = false,
    val track: Track? = null,
    val queue: List<Track> = emptyList(),
    val index: Int = -1,
    val playing: Boolean = false,
    val buffering: Boolean = false,
    val durationMs: Long = 0,
    val hasPrevious: Boolean = false,
    val hasNext: Boolean = false,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.OFF,
    val volume: Float = 1f,
    val eqEnabled: Boolean = false,
    val eqGains: List<Float> = List(PlaybackSignal.BAND_COUNT) { 0f },
    val error: PlaybackError? = null,
)

/**
 * Owns the Media3 controller for the Compose front end. State arrives through
 * Player.Listener callbacks; nothing is polled or serialized.
 */
class PlayerRepository(private val context: Context, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state.asStateFlow()
    private var controller: MediaController? = null

    val player: Player? get() = controller

    fun connect() {
        if (controller != null) return
        scope.launch {
            val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
            val connected = runCatching { MediaController.Builder(context, token).buildAsync().await() }.getOrNull() ?: return@launch
            controller = connected
            connected.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) {
                    val queueChanged = events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION)
                    publish(player, queueChanged)
                }
            })
            publish(connected, true)
        }
    }

    fun release() {
        controller?.release()
        controller = null
    }

    /** Current position, extrapolated by Media3; cheap to call every frame. */
    fun positionMs(): Long = controller?.currentPosition?.coerceAtLeast(0) ?: 0

    private fun publish(player: Player, queueChanged: Boolean) {
        val item = player.currentMediaItem
        val previous = _state.value
        val queue = if (queueChanged || previous.queue.size != player.mediaItemCount) {
            List(player.mediaItemCount) { Track.from(player.getMediaItemAt(it)) }.let { next ->
                if (next == previous.queue) previous.queue else next
            }
        } else previous.queue
        var duration = player.duration
        if (duration == C.TIME_UNSET || duration < 0) duration = item?.mediaMetadata?.durationMs ?: 0
        val audio = PlaybackService.audioProcessor()?.settings()
        val failure = player.playerError?.let { error ->
            val detail = item?.mediaId?.let(PlaybackService::playbackFailure)
            if (detail != null) PlaybackError(detail.code(), detail.status().takeIf { it > 0 }, detail.retryAfter().takeIf { it > 0 })
            else PlaybackError(error.errorCodeName)
        }
        _state.value = PlayerState(
            connected = true,
            track = item?.let(Track::from),
            queue = queue,
            index = player.currentMediaItemIndex,
            playing = player.isPlaying,
            buffering = player.playWhenReady && player.playbackState == Player.STATE_BUFFERING,
            durationMs = duration,
            hasPrevious = player.hasPreviousMediaItem(),
            hasNext = player.hasNextMediaItem(),
            shuffle = player.shuffleModeEnabled,
            repeat = when (player.repeatMode) {
                Player.REPEAT_MODE_ONE -> RepeatMode.ONE
                Player.REPEAT_MODE_ALL -> RepeatMode.ALL
                else -> RepeatMode.OFF
            },
            volume = player.volume,
            eqEnabled = audio?.eqEnabled() ?: previous.eqEnabled,
            eqGains = audio?.eqGains()?.toList() ?: previous.eqGains,
            error = failure,
        )
    }

    private inline fun withPlayer(block: (MediaController) -> Unit) {
        controller?.let(block)
    }

    fun playTracks(tracks: List<Track>, startId: String, positionMs: Long = 0, autoplay: Boolean = true) = withPlayer { player ->
        val unique = LinkedHashMap<String, MediaItem>()
        tracks.forEach { unique.putIfAbsent(it.id, it.toMediaItem()) }
        val items = unique.values.take(MAX_QUEUE)
        val start = items.indexOfFirst { it.mediaId == startId }.coerceAtLeast(0)
        if (!autoplay) { player.pause(); player.stop() }
        player.setMediaItems(items, start, positionMs)
        player.prepare()
        if (autoplay) player.play()
    }

    fun toggle() = withPlayer { player ->
        if (player.playWhenReady) player.pause()
        else if (player.currentMediaItem != null) {
            if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
            if (player.playbackState == Player.STATE_IDLE) player.prepare()
            player.play()
        }
    }

    fun skip(next: Boolean) = withPlayer { player ->
        if (next && player.hasNextMediaItem()) player.seekToNextMediaItem()
        else if (!next && player.hasPreviousMediaItem()) player.seekToPreviousMediaItem()
        if (player.currentMediaItem != null && player.playbackState == Player.STATE_IDLE) player.prepare()
    }

    fun seek(positionMs: Long) = withPlayer { it.seekTo(positionMs.coerceAtLeast(0)) }
    fun playQueued(index: Int) = withPlayer { player ->
        if (index !in 0 until player.mediaItemCount) return@withPlayer
        player.seekTo(index, 0)
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
    }
    fun setShuffle(enabled: Boolean) = withPlayer { it.shuffleModeEnabled = enabled }
    fun setRepeat(mode: RepeatMode) = withPlayer {
        it.repeatMode = when (mode) {
            RepeatMode.OFF -> Player.REPEAT_MODE_OFF
            RepeatMode.ALL -> Player.REPEAT_MODE_ALL
            RepeatMode.ONE -> Player.REPEAT_MODE_ONE
        }
    }
    fun setVolume(volume: Float) = withPlayer { it.volume = volume.coerceIn(0f, 1f) }

    fun moveQueued(from: Int, to: Int) = withPlayer { player ->
        if (from in 0 until player.mediaItemCount && to in 0 until player.mediaItemCount && from != to) player.moveMediaItem(from, to)
    }
    fun removeQueued(index: Int) = withPlayer { player ->
        if (index !in 0 until player.mediaItemCount) return@withPlayer
        if (player.mediaItemCount == 1) player.pause()
        player.removeMediaItem(index)
    }
    fun clearQueue() = withPlayer { it.pause(); it.clearMediaItems() }

    /** Adds a track (or moves it right after the current one when [next]). */
    fun enqueue(track: Track, next: Boolean) = withPlayer { player ->
        val current = player.currentMediaItemIndex
        for (index in 0 until player.mediaItemCount) {
            if (player.getMediaItemAt(index).mediaId != track.id) continue
            if (next && index != current) {
                val destination = if (index < current) current else current + 1
                if (index != destination) player.moveMediaItem(index, destination)
            }
            return@withPlayer
        }
        if (player.mediaItemCount >= MAX_QUEUE) return@withPlayer
        if (next && player.mediaItemCount > 0) player.addMediaItem(current + 1, track.toMediaItem())
        else player.addMediaItem(track.toMediaItem())
        if (player.mediaItemCount == 1) { player.prepare(); player.play() }
    }

    /** Appends tracks not already queued, in order. */
    fun append(tracks: List<Track>) = withPlayer { player ->
        val queued = HashSet<String>()
        for (index in 0 until player.mediaItemCount) queued += player.getMediaItemAt(index).mediaId
        val additions = tracks.filter { queued.add(it.id) }.take((MAX_QUEUE - player.mediaItemCount).coerceAtLeast(0))
        if (additions.isNotEmpty()) player.addMediaItems(additions.map(Track::toMediaItem))
    }

    fun configureEqualizer(enabled: Boolean? = null, gains: List<Float>? = null) {
        val audio = PlaybackService.audioProcessor() ?: return
        audio.update(enabled, gains?.map { it.coerceIn(-12f, 12f) }?.toFloatArray(), null)
        _state.update { it.copy(eqEnabled = enabled ?: it.eqEnabled, eqGains = gains ?: it.eqGains) }
    }

    fun setVisualizer(mode: VisualizerMode) {
        PlaybackService.audioProcessor()?.update(null, null, when (mode) {
            VisualizerMode.OFF -> PlaybackAudioProcessor.VisualizerMode.OFF
            VisualizerMode.SPECTRUM, VisualizerMode.MIRROR -> PlaybackAudioProcessor.VisualizerMode.SPECTRUM
            VisualizerMode.WAVEFORM -> PlaybackAudioProcessor.VisualizerMode.WAVEFORM
        })
    }

    /** Latest PCM-derived sample for the visualizer (read per frame while visible). */
    /** PCM-derived sample that is audible right now (aligned to the playback position, not the decoder). */
    fun visualSample(): FloatArray? {
        val player = controller ?: return null
        if (!player.isPlaying) return null
        return PlaybackService.audioProcessor()?.visualSample(player.currentPosition.coerceAtLeast(0) * 1000)?.values()
    }

    companion object {
        const val MAX_QUEUE = 5000
    }
}
