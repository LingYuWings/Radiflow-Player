package com.radiflow.player

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor

/*
 * Native port of components/LyricsView.tsx + index.css (.rf-lyric-*):
 *  - the active line's original text is centred, followed by a critically damped
 *    spring (lyricScroll.ts); a user drag pauses following;
 *  - lines: .40 opacity + 4px blur, past .30, distant (>2) .20 + 7px blur,
 *    current opaque, 1.05 scale, roomier padding; 0.7s ease transitions;
 *  - word-timed lines fill left-to-right with a soft-edged mask over 35% white,
 *    the sung word carries an accent glow with attack/afterglow (lyricProgress.ts);
 *  - the translation expands under the current line only; edges fade out.
 */

private val LineEase = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
private val TranslationEase = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

/** lyricProgress.ts: absolute-time progress of a word. */
private fun wordProgress(time: Double, start: Double, duration: Double): Float = when {
    time < start -> 0f
    duration <= 0 -> 1f
    else -> ((time - start) / duration).coerceIn(0.0, 1.0).toFloat()
}

/** lyricProgress.ts: soft attack and short afterglow envelope. */
private fun wordGlow(time: Double, start: Double, duration: Double): Float {
    if (duration <= 0 || time <= start) return 0f
    val elapsed = time - start
    val attack = minOf(0.14, duration * 0.3)
    val value = if (elapsed < attack) elapsed / attack else 1 - maxOf(0.0, elapsed - duration) / 0.32
    val c = value.coerceIn(0.0, 1.0).toFloat()
    return c * c * (3 - 2 * c)
}

/** lyricScroll.ts: exact critically damped step, stable across refresh rates. */
private fun springStep(position: Float, velocity: Float, target: Float, seconds: Float): Pair<Float, Float> {
    val dt = seconds.coerceIn(0f, 0.05f)
    val frequency = 12f
    val offset = position - target
    val impulse = velocity + frequency * offset
    val decay = exp(-frequency * dt)
    return (target + (offset + impulse * dt) * decay) to ((velocity - frequency * impulse * dt) * decay)
}

@Composable
fun LyricsView(lines: List<LyricLine>, position: State<Long>, onSeek: (Double) -> Unit, modifier: Modifier = Modifier) {
    val active by remember(lines) { derivedStateOf { LyricsParser.activeIndex(lines, position.value / 1000.0) } }
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    // Layout of each line's original text, resolved against the scrolling content on demand.
    val anchors = remember(lines) { arrayOfNulls<LayoutCoordinates>(lines.size) }
    val content = remember { arrayOfNulls<LayoutCoordinates>(1) }
    var userUntil by remember { mutableLongStateOf(0L) }

    LaunchedEffect(scroll) {
        scroll.interactionSource.interactions.collectLatest { interaction ->
            if (interaction is DragInteraction.Start || interaction is DragInteraction.Stop || interaction is DragInteraction.Cancel) {
                userUntil = System.nanoTime() + 2_500_000_000L
            }
        }
    }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val viewport = with(density) { maxHeight.toPx() }
        val edge = maxHeight * 0.4f

        // Spring-follow the active line; layout changes move the target and are absorbed first
        // (stepAnchoredLyricScroll), so an expanding translation never becomes a second motion.
        LaunchedEffect(active, viewport) {
            if (active < 0) return@LaunchedEffect
            var pos = scroll.value.toFloat()
            var velocity = 0f
            var last = 0L
            fun target(): Float {
                val text = anchors.getOrNull(active)?.takeIf { it.isAttached } ?: return scroll.value.toFloat()
                val column = content[0]?.takeIf { it.isAttached } ?: return scroll.value.toFloat()
                val centre = column.localPositionOf(text, Offset(0f, text.size.height / 2f)).y
                return (centre - viewport / 2).coerceIn(0f, scroll.maxValue.toFloat())
            }
            var previousTarget = target()
            val settleAfter = System.nanoTime() + 750_000_000L
            while (true) {
                val now = withFrameNanos { it }
                if (now < userUntil) { last = 0; previousTarget = target(); pos = scroll.value.toFloat(); velocity = 0f; continue }
                val dt = if (last == 0L) 0.016f else (now - last) / 1e9f
                last = now
                val destination = target()
                val compensated = pos + destination - previousTarget
                val distance = destination - compensated
                previousTarget = destination
                var (nextPos, nextVel) = springStep(compensated, if (velocity * distance < 0) 0f else velocity, destination, dt)
                if ((destination - nextPos) * distance <= 0) { nextPos = destination; nextVel = 0f }
                pos = nextPos; velocity = nextVel
                scroll.scrollTo(pos.toInt())
                if (now > settleAfter && abs(destination - pos) < 0.5f && abs(velocity) < 3f) break
            }
        }

        Column(
            Modifier.fillMaxSize()
                // mask-fade-edges: transparent → opaque over the outer 20% at both ends.
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithContent {
                    drawContent()
                    drawRect(Brush.verticalGradient(0f to Color.Transparent, 0.2f to Color.Black, 0.8f to Color.Black, 1f to Color.Transparent),
                        blendMode = BlendMode.DstIn)
                }
                .verticalScroll(scroll)
                .onPlaced { content[0] = it }
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(edge))
            lines.forEachIndexed { index, line ->
                LyricLineItem(
                    line = line,
                    state = when {
                        index == active -> LineState.CURRENT
                        active >= 0 && abs(index - active) > 2 -> LineState.DISTANT
                        index < active -> LineState.PAST
                        else -> LineState.UPCOMING
                    },
                    position = position,
                    onAnchor = { anchors[index] = it },
                    onClick = { userUntil = 0; onSeek(line.start) },
                )
            }
            Spacer(Modifier.height(edge))
        }
    }
}

private enum class LineState { CURRENT, PAST, UPCOMING, DISTANT }

@Composable
private fun LyricLineItem(line: LyricLine, state: LineState, position: State<Long>, onAnchor: (LayoutCoordinates) -> Unit, onClick: () -> Unit) {
    val current = state == LineState.CURRENT
    val spec = tween<Float>(700, easing = LineEase)
    val alpha by animateFloatAsState(when (state) { LineState.CURRENT -> 1f; LineState.PAST -> 0.30f; LineState.DISTANT -> 0.20f; else -> 0.40f }, spec, label = "alpha")
    val blur by animateDpAsState(when (state) { LineState.CURRENT -> 0.dp; LineState.DISTANT -> 7.dp; else -> 4.dp }, tween(700, easing = LineEase), label = "blur")
    val scale by animateFloatAsState(if (current) 1.05f else 1f, spec, label = "scale")
    val shift by animateDpAsState(if (current) 0.dp else 8.dp, tween(700, easing = LineEase), label = "shift")
    val padding by animateDpAsState(if (current) 30.dp else 14.dp, tween(700, easing = LineEase), label = "padding")
    val accent = LocalAccent.current

    Column(
        Modifier.fillMaxWidth()
            .clickable(onClickLabel = line.text, onClick = onClick)
            .padding(vertical = padding)
            .graphicsLayer {
                this.alpha = alpha
                scaleX = scale; scaleY = scale
                translationY = shift.toPx()
                transformOrigin = TransformOrigin(0f, 0.5f)
            }
            .then(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && blur > 0.2.dp) Modifier.blur(blur, androidx.compose.ui.draw.BlurredEdgeTreatment.Unbounded) else Modifier),
    ) {
        // Anchor = centre of the original text, not the expanding bilingual block.
        Box(Modifier.onPlaced(onAnchor)) {
            if (current && !line.words.isNullOrEmpty()) KaraokeText(line, position, accent)
            else Text(line.text, style = LyricStyle.copy(color = Color(0xF2FFFFFF)))
        }
        AnimatedVisibility(
            visible = current && !line.translation.isNullOrBlank() && line.translation != "//",
            enter = expandVertically(tween(400, easing = TranslationEase)) + fadeIn(tween(400, easing = TranslationEase)),
            exit = shrinkVertically(tween(400, easing = TranslationEase)) + fadeOut(tween(300)),
        ) {
            Text(line.translation.orEmpty(), style = TranslationStyle, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

private val LyricStyle = TextStyle(fontSize = 27.sp, lineHeight = 34.sp, fontWeight = FontWeight.W700, letterSpacing = (-0.02).em)
private val TranslationStyle = TextStyle(fontSize = 17.sp, lineHeight = 26.sp, fontWeight = FontWeight.W500, color = Color(0xA6FFFFFF))

/**
 * Word-timed paint for the current line. Three stacked copies of the same layout:
 * 35% white base, an accent glow limited to the sung word, and a white fill masked
 * up to the singing position with a soft edge. Only the draw phase reads the clock.
 */
@Composable
private fun KaraokeText(line: LyricLine, position: State<Long>, accent: Color) {
    val words = line.words!!
    var layout by remember(line) { mutableStateOf<TextLayoutResult?>(null) }
    // Character offsets of each word inside line.text (words are concatenated in order).
    val starts = remember(line) { IntArray(words.size).also { var o = 0; words.forEachIndexed { i, w -> it[i] = o; o += w.text.length } } }
    val soft = with(LocalDensity.current) { 10.dp.toPx() }

    fun fillOffset(time: Double): Float {
        var offset = 0f
        words.forEachIndexed { i, w ->
            val p = wordProgress(time, w.start, w.duration)
            if (p > 0f) offset = starts[i] + p * w.text.length
        }
        return offset
    }
    fun xFor(text: TextLayoutResult, offset: Float): Pair<Int, Float> {
        val length = line.text.length
        val index = floor(offset).toInt().coerceIn(0, maxOf(0, length - 1))
        val row = text.getLineForOffset(index)
        val left = text.getHorizontalPosition(index, true)
        val right = if (index + 1 <= length && text.getLineForOffset(minOf(index + 1, length)) == row)
            text.getHorizontalPosition(minOf(index + 1, length), true) else text.getLineRight(row)
        return row to (left + (right - left) * (offset - index))
    }

    Box {
        Text(line.text, style = LyricStyle.copy(color = Color(0x59FFFFFF)), onTextLayout = { layout = it })
        // Accent glow on the word being sung (rf-lyric-word-glow).
        Text(
            line.text, style = LyricStyle.copy(color = accent),
            modifier = Modifier
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .then(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Modifier.blur(4.dp, androidx.compose.ui.draw.BlurredEdgeTreatment.Unbounded) else Modifier)
                .drawWithContent {
                    val text = layout ?: return@drawWithContent
                    val time = position.value / 1000.0
                    val i = words.indexOfLast { time >= it.start }
                    if (i < 0) return@drawWithContent
                    val glow = wordGlow(time, words[i].start, words[i].duration)
                    if (glow <= 0.01f) return@drawWithContent
                    drawContent()
                    val (rowA, x0) = xFor(text, starts[i].toFloat())
                    val (rowB, x1) = xFor(text, (starts[i] + words[i].text.length).toFloat())
                    for (row in 0 until text.lineCount) {
                        val top = text.getLineTop(row); val bottom = text.getLineBottom(row)
                        val from = if (row == rowA) x0 else 0f
                        val to = if (row == rowB) x1 else size.width
                        val inside = row in rowA..rowB
                        if (inside) {
                            drawRect(Color.Transparent, Offset(0f, top), Size(from, bottom - top), blendMode = BlendMode.DstIn)
                            drawRect(Color.Transparent, Offset(to, top), Size(size.width - to, bottom - top), blendMode = BlendMode.DstIn)
                            drawRect(Color.Black.copy(alpha = glow * 0.8f), Offset(from, top), Size(to - from, bottom - top), blendMode = BlendMode.DstIn)
                        } else drawRect(Color.Transparent, Offset(0f, top), Size(size.width, bottom - top), blendMode = BlendMode.DstIn)
                    }
                },
        )
        // White fill up to the singing position with a soft edge (rf-lyric-word-fill mask).
        Text(
            line.text, style = LyricStyle.copy(color = Color.White),
            modifier = Modifier
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithContent {
                    val text = layout ?: return@drawWithContent
                    val offset = fillOffset(position.value / 1000.0)
                    if (offset <= 0f) return@drawWithContent
                    drawContent()
                    if (offset >= line.text.length) return@drawWithContent
                    val (fillRow, x) = xFor(text, offset)
                    for (row in 0 until text.lineCount) {
                        val top = text.getLineTop(row); val bottom = text.getLineBottom(row)
                        when {
                            row < fillRow -> Unit
                            row > fillRow -> drawRect(Color.Transparent, Offset(0f, top), Size(size.width, bottom - top), blendMode = BlendMode.DstIn)
                            else -> drawRect(
                                Brush.horizontalGradient(0f to Color.Black, 1f to Color.Transparent, startX = x - soft, endX = x + soft),
                                Offset(0f, top), Size(size.width, bottom - top), blendMode = BlendMode.DstIn,
                            )
                        }
                    }
                },
        )
    }
}
