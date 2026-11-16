package com.radiflow.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lyrics
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

enum class PlayerPanel { ARTWORK, LYRICS, QUEUE }

/**
 * Playback position that keeps moving between player callbacks. Reads the
 * extrapolated Media3 position every frame ([perFrame], for lyrics) or 4×/s.
 */
@Composable
fun rememberPosition(model: AppViewModel, playing: Boolean, perFrame: Boolean = false): State<Long> =
    produceState(model.player.positionMs(), playing, perFrame) {
        value = model.player.positionMs()
        if (!playing) return@produceState
        while (true) {
            if (perFrame) withFrameMillis { } else delay(250)
            value = model.player.positionMs()
        }
    }

private fun Swipe.toSkip(state: PlayerState) = when (this) {
    Swipe.LEFT -> if (state.hasNext) true else null
    Swipe.RIGHT -> if (state.hasPrevious) false else null
    else -> null
}

enum class Swipe { UP, DOWN, LEFT, RIGHT }

/** Drag recognizer with damped follow and spring-back; reports a direction past the threshold. */
@Composable
fun Modifier.swipeable(onSwipe: (Swipe) -> Unit, threshold: Float = 160f): Modifier {
    val scope = rememberCoroutineScope()
    val offsetX = remember { Animatable(0f) }
    val offsetY = remember { Animatable(0f) }
    var total by remember { mutableStateOf(Offset.Zero) }
    return this
        .graphicsLayer { translationX = offsetX.value; translationY = offsetY.value }
        .pointerInput(Unit) {
            detectDragGestures(
                onDragStart = { total = Offset.Zero },
                onDragEnd = {
                    val (dx, dy) = total
                    if (maxOf(abs(dx), abs(dy)) >= threshold) {
                        onSwipe(if (abs(dx) > abs(dy)) (if (dx > 0) Swipe.RIGHT else Swipe.LEFT) else (if (dy > 0) Swipe.DOWN else Swipe.UP))
                    }
                    scope.launch { offsetX.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 500f)) }
                    scope.launch { offsetY.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 500f)) }
                },
                onDragCancel = {
                    scope.launch { offsetX.animateTo(0f) }
                    scope.launch { offsetY.animateTo(0f) }
                },
            ) { change, amount ->
                change.consume()
                total += amount
                scope.launch {
                    if (abs(total.x) > abs(total.y)) { offsetX.snapTo(total.x * 0.35f); offsetY.snapTo(0f) }
                    else { offsetY.snapTo((total.y * 0.4f).coerceAtLeast(-14f)); offsetX.snapTo(0f) }
                }
            }
        }
}

@Composable
private fun PlayGlyph(state: PlayerState, tint: Color, size: androidx.compose.ui.unit.Dp) {
    when {
        state.buffering -> CircularProgressIndicator(Modifier.size(size * 0.85f), color = tint, strokeWidth = 2.dp)
        state.playing -> Icon(Icons.Rounded.Pause, null, tint = tint, modifier = Modifier.size(size))
        else -> Icon(Icons.Rounded.PlayArrow, null, tint = tint, modifier = Modifier.size(size))
    }
}

// region Dock

@Composable
fun Dock(model: AppViewModel, state: PlayerState, lyrics: List<LyricLine>, showLyrics: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val track = state.track ?: return
    val s = strings
    Column(modifier.fillMaxWidth().glass(Rf.DockShape).padding(start = 8.dp, end = 8.dp, top = 3.dp, bottom = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(Rf.RowShape)
                    .swipeable({ swipe ->
                        when (swipe) {
                            Swipe.UP -> onOpen()
                            else -> swipe.toSkip(state)?.let(model.player::skip)
                        }
                    }, threshold = 110f)
                    .clickable(role = Role.Button, onClickLabel = s.nowPlaying, onClick = onOpen).padding(horizontal = 5.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Cover(track.cover, Modifier.size(39.dp), RoundedCornerShape(10.dp), size = 160)
                AnimatedContent(track.id, transitionSpec = {
                    (fadeIn(tween(360, easing = Rf.EaseOut)) + slideInVertically(tween(360, easing = Rf.EaseOut)) { it / 4 }) togetherWith fadeOut(tween(120))
                }, label = "dockTitle", modifier = Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    TrackLabel(track.title, track.artist.ifEmpty { s.unknownArtist })
                }
            }
            RfIconButton(if (state.playing || state.buffering) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                if (state.playing || state.buffering) s.pause else s.play, model.player::toggle)
            RfIconButton(Icons.Rounded.SkipNext, s.next, { model.player.skip(true) }, enabled = state.hasNext, iconSize = 22.dp)
        }
        DockProgress(model, state)
        if (showLyrics && lyrics.isNotEmpty()) MiniLyric(model, state, lyrics)
    }
}

@Composable
private fun DockProgress(model: AppViewModel, state: PlayerState) {
    val position by rememberPosition(model, state.playing)
    val duration = state.durationMs / 1000.0
    Row(Modifier.height(22.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(formatTime(position / 1000.0), style = RfType.Mono)
        SeekBar(position / 1000f, duration.toFloat(), { model.player.seek((it * 1000).toLong()) }, strings.progress,
            Modifier.weight(1f), height = 22.dp)
        Text(formatTime(duration), style = RfType.Mono)
    }
}

@Composable
private fun MiniLyric(model: AppViewModel, state: PlayerState, lyrics: List<LyricLine>) {
    val position by rememberPosition(model, state.playing)
    val index by remember(lyrics) { derivedStateOf { LyricsParser.activeIndex(lyrics, position / 1000.0) } }
    val line = lyrics.getOrNull(index)?.text?.takeIf { it.isNotBlank() } ?: "♪"
    Crossfade(line, animationSpec = tween(260), label = "miniLyric") { text ->
        Text(text, style = RfType.Subtitle.copy(fontSize = 12.sp, color = Color(0xD9F7F8FA)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 2.dp))
    }
}

// endregion
// region Full player

@Composable
fun FullPlayer(
    model: AppViewModel,
    state: PlayerState,
    panel: PlayerPanel,
    lyrics: LyricsState,
    visualizer: VisualizerMode,
    canUndo: Boolean,
    onPanel: (PlayerPanel) -> Unit,
    onClose: () -> Unit,
    onOpenAlbum: (() -> Unit)?,
    onImportLyrics: (() -> Unit)?,
) {
    val track = state.track ?: return
    val s = strings
    Column(Modifier.fillMaxSize().background(Color(0x4214191F)).statusBarsPadding().navigationBarsPadding()
        .padding(horizontal = 12.dp).widthIn(max = 740.dp)) {
        // Header
        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp), verticalAlignment = Alignment.CenterVertically) {
            RfIconButton(if (panel == PlayerPanel.ARTWORK) Icons.Rounded.KeyboardArrowDown else Icons.AutoMirrored.Rounded.ArrowBack,
                if (panel == PlayerPanel.ARTWORK) s.collapse else s.back, { if (panel == PlayerPanel.ARTWORK) onClose() else onPanel(PlayerPanel.ARTWORK) })
            Text(when (panel) { PlayerPanel.QUEUE -> s.queue; PlayerPanel.LYRICS -> s.lyrics; else -> s.nowPlaying },
                style = RfType.Section.copy(fontSize = 18.sp, textAlign = TextAlign.Center), modifier = Modifier.weight(1f))
            RfIconButton(Icons.Rounded.Lyrics, s.lyrics, { onPanel(if (panel == PlayerPanel.LYRICS) PlayerPanel.ARTWORK else PlayerPanel.LYRICS) },
                selected = panel == PlayerPanel.LYRICS, iconSize = 20.dp)
            RfIconButton(Icons.AutoMirrored.Rounded.QueueMusic, s.queue, { onPanel(if (panel == PlayerPanel.QUEUE) PlayerPanel.ARTWORK else PlayerPanel.QUEUE) },
                selected = panel == PlayerPanel.QUEUE, iconSize = 21.dp)
        }
        // Stage: panels swap with a short rise (the desktop app's 'panel' card transition).
        AnimatedContent(panel, modifier = Modifier.weight(1f).fillMaxWidth(), transitionSpec = {
            (fadeIn(tween(220)) + slideInVertically(tween(380, easing = Rf.CardEase)) { it / 14 } + scaleIn(tween(380, easing = Rf.CardEase), 0.97f)) togetherWith
                fadeOut(tween(160, easing = Rf.ExitEase))
        }, label = "panel") { current ->
            when (current) {
                PlayerPanel.ARTWORK -> ArtworkPanel(model, state, track, onClose, onPanel, onOpenAlbum)
                PlayerPanel.LYRICS -> LyricsPanel(model, state, lyrics, onImportLyrics)
                PlayerPanel.QUEUE -> QueuePanel(model, state, canUndo)
            }
        }
        Transport(model, state, visualizer)
    }
}

@Composable
private fun ArtworkPanel(model: AppViewModel, state: PlayerState, track: Track, onClose: () -> Unit, onPanel: (PlayerPanel) -> Unit, onOpenAlbum: (() -> Unit)?) {
    val s = strings
    val resting by animateFloatAsState(if (state.playing) 1f else 0.94f, tween(450, easing = Rf.EaseOut), label = "rest")
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val side = minOf(maxWidth * 0.86f, maxHeight * 0.62f, 390.dp)
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                Modifier.size(side).swipeable({ swipe ->
                    when (swipe) {
                        Swipe.DOWN -> onClose()
                        Swipe.UP -> onPanel(PlayerPanel.LYRICS)
                        else -> swipe.toSkip(state)?.let(model.player::skip)
                    }
                }),
            ) {
                Crossfade(track.id, animationSpec = tween(420), label = "art") { id ->
                    val cover = if (id == track.id) track.cover else null
                    Cover(cover, Modifier.fillMaxSize().scale(resting).shadow(24.dp, Rf.ArtShape, ambientColor = Color.Black, spotColor = Color.Black)
                        .then(if (onOpenAlbum != null) Modifier.clickable(role = Role.Button, onClickLabel = s.openAlbum, onClick = onOpenAlbum) else Modifier),
                        Rf.ArtShape, size = 1024)
                }
            }
            AnimatedContent(track.id, transitionSpec = {
                (fadeIn(tween(360)) + slideInVertically(tween(360, easing = Rf.EaseOut)) { it / 6 }) togetherWith fadeOut(tween(120))
            }, label = "song") { _ ->
                Column(Modifier.widthIn(max = side + 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(track.title, style = RfType.PageTitle.copy(fontSize = 26.sp, fontWeight = FontWeight.W800, textAlign = TextAlign.Center, lineHeight = 30.sp),
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(5.dp))
                    Text(listOfNotNull(track.artist.ifEmpty { s.unknownArtist }, track.album).joinToString(" · "),
                        style = RfType.Subtitle.copy(textAlign = TextAlign.Center), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun LyricsPanel(model: AppViewModel, state: PlayerState, lyrics: LyricsState, onImportLyrics: (() -> Unit)?) {
    val s = strings
    Box(Modifier.fillMaxSize()) {
        if (lyrics.lines.isEmpty()) EmptyState(if (lyrics.loading) s.loadingLyrics else s.noLyrics, Modifier.align(Alignment.Center))
        else LyricsList(model, state, lyrics.lines)
        if (onImportLyrics != null) {
            RfTextButton(s.importLyrics, onImportLyrics, Modifier.align(Alignment.BottomEnd).padding(6.dp).clip(RoundedCornerShape(11.dp))
                .background(Color(0xCF282E38)), icon = Icons.Rounded.Description)
        }
    }
}

/** PC-style lyrics (LyricsView.kt); position is read per frame only where it is drawn. */
@Composable
private fun LyricsList(model: AppViewModel, state: PlayerState, lines: List<LyricLine>) {
    val position = rememberPosition(model, state.playing, perFrame = true)
    LyricsView(lines, position, onSeek = { model.player.seek((it * 1000).toLong()) })
}

@Composable
private fun QueuePanel(model: AppViewModel, state: PlayerState, canUndo: Boolean) {
    val s = strings
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (state.index - 3).coerceAtLeast(0))
    // Plain tinted panel: a live backdrop blur under a scrolling list would re-blur every frame.
    Column(Modifier.fillMaxSize().padding(vertical = 4.dp).clip(RoundedCornerShape(18.dp)).background(Color(0x8C0E1317))
        .border(1.dp, Rf.GlassBorder, RoundedCornerShape(18.dp)).padding(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.songs(state.queue.size), style = RfType.Caption.copy(color = Rf.TextTertiary, fontFeatureSettings = "tnum"),
                modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
            RfTextButton(s.clearQueue, { model.editQueue { it.clearQueue() } }, icon = Icons.Rounded.DeleteOutline)
            if (canUndo) RfTextButton(s.undo, model::undoQueue, icon = Icons.AutoMirrored.Rounded.Undo)
        }
        LazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            itemsIndexed(state.queue, key = { _, track -> track.id }, contentType = { _, _ -> "track" }) { index, track ->
                TrackRow(track, index == state.index, { model.player.playQueued(index) }, Modifier.animateItem(),
                    subtitle = track.artist) {
                    RowIconButton(Icons.Rounded.ArrowUpward, "${s.moveUp} · ${track.title}", { model.editQueue { it.moveQueued(index, index - 1) } },
                        enabled = index > 0, iconSize = 17.dp)
                    RowIconButton(Icons.Rounded.ArrowDownward, "${s.moveDown} · ${track.title}", { model.editQueue { it.moveQueued(index, index + 1) } },
                        enabled = index + 1 < state.queue.size, iconSize = 17.dp)
                    RowIconButton(Icons.Rounded.Close, "${s.removeFromQueue} · ${track.title}", { model.editQueue { it.removeQueued(index) } }, iconSize = 17.dp)
                }
            }
        }
    }
}

@Composable
private fun Transport(model: AppViewModel, state: PlayerState, visualizer: VisualizerMode) {
    val s = strings
    val position by rememberPosition(model, state.playing)
    val duration = state.durationMs / 1000.0
    var draft by remember { mutableStateOf<Float?>(null) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(top = 4.dp, bottom = 6.dp)) {
        if (visualizer != VisualizerMode.OFF) Visualizer(model, state.playing, visualizer)
        Box {
            if (state.buffering) Text(s.buffering, style = RfType.Caption.copy(color = Color(0xB0E3E9F2)), modifier = Modifier.align(Alignment.TopCenter))
            SeekBar(position / 1000f, duration.toFloat(), { model.player.seek((it * 1000).toLong()) }, s.progress, height = 33.dp, onDraft = { draft = it })
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(draft?.toDouble() ?: (position / 1000.0)), style = RfType.Mono)
            Text(formatTime(duration), style = RfType.Mono)
        }
        Row(Modifier.fillMaxWidth().padding(top = 13.dp, bottom = 3.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            RfIconButton(Icons.Rounded.Shuffle, s.shuffle, { model.player.setShuffle(!state.shuffle) }, selected = state.shuffle, iconSize = 20.dp)
            RfIconButton(Icons.Rounded.SkipPrevious, s.previous, { model.player.skip(false) }, enabled = state.hasPrevious, iconSize = 30.dp)
            Box(Modifier.size(62.dp).clip(CircleShape).background(Color.White).clickable(role = Role.Button,
                onClickLabel = if (state.playing) s.pause else s.play, onClick = model.player::toggle), contentAlignment = Alignment.Center) {
                PlayGlyph(state, Color(0xFF111419), 30.dp)
            }
            RfIconButton(Icons.Rounded.SkipNext, s.next, { model.player.skip(true) }, enabled = state.hasNext, iconSize = 30.dp)
            RfIconButton(if (state.repeat == RepeatMode.ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                when (state.repeat) { RepeatMode.OFF -> s.repeatOff; RepeatMode.ALL -> s.repeatAll; RepeatMode.ONE -> s.repeatOne },
                { model.player.setRepeat(when (state.repeat) { RepeatMode.OFF -> RepeatMode.ALL; RepeatMode.ALL -> RepeatMode.ONE; RepeatMode.ONE -> RepeatMode.OFF }) },
                selected = state.repeat != RepeatMode.OFF, iconSize = 20.dp)
        }
        Row(Modifier.fillMaxWidth(0.72f).widthIn(max = 320.dp).align(Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Icon(Icons.AutoMirrored.Rounded.VolumeUp, null, tint = Color(0xB8CCD4DF), modifier = Modifier.size(17.dp))
            SeekBar(state.volume, 1f, model.player::setVolume, s.volume, Modifier.weight(1f), height = 27.dp, continuous = true)
        }
    }
}

/**
 * Native PCM visualizer: spectrum bars, mirrored bars or waveform. Samples are
 * aligned to the audible position and smoothed per display frame (fast attack,
 * slower release) so motion stays fluid at the screen's refresh rate.
 */
@Composable
private fun Visualizer(model: AppViewModel, playing: Boolean, mode: VisualizerMode) {
    var levels by remember { mutableStateOf(FloatArray(0)) }
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(playing, mode) {
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                val dt = if (last == 0L) 0.016f else ((now - last) / 1e9f).coerceIn(0.001f, 0.1f)
                last = now
                val target = if (playing) model.player.visualSample() else null
                val current = levels
                val next = if (target == null) FloatArray(current.size) { current[it] * (1f - (dt * 6f).coerceAtMost(1f)) }
                    else if (mode == VisualizerMode.WAVEFORM) target.copyOf()
                    else FloatArray(target.size) { i ->
                        val previous = current.getOrElse(i) { 0f }
                        val goal = target[i].coerceIn(0f, 1f)
                        val rate = if (goal > previous) 28f else 7f
                        previous + (goal - previous) * (dt * rate).coerceAtMost(1f)
                    }
                levels = next
                tick = now
            }
            if (!playing && levels.all { kotlin.math.abs(it) < 0.002f }) break
        }
    }
    Canvas(Modifier.fillMaxWidth().widthIn(max = 460.dp).height(30.dp)) {
        tick // redraw every frame
        val samples = levels
        if (samples.isEmpty()) return@Canvas
        val color = Color(0xC0DFECFA)
        if (mode == VisualizerMode.WAVEFORM) {
            val path = Path()
            samples.forEachIndexed { i, v ->
                val x = i / (samples.size - 1f).coerceAtLeast(1f) * size.width
                val y = size.height / 2 - v.coerceIn(-1f, 1f) * size.height * 0.47f
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, color, style = Stroke(1.5.dp.toPx()))
        } else {
            val bar = size.width / samples.size
            val gap = (bar * 0.28f).coerceAtMost(3.dp.toPx())
            samples.forEachIndexed { i, v ->
                val h = (v.coerceIn(0f, 1f) * size.height).coerceAtLeast(1.5.dp.toPx())
                val top = if (mode == VisualizerMode.MIRROR) (size.height - h) / 2 else size.height - h
                drawRoundRect(color, Offset(i * bar, top), Size((bar - gap).coerceAtLeast(1f), h), CornerRadius(1.5.dp.toPx()))
            }
        }
    }
}

// endregion
