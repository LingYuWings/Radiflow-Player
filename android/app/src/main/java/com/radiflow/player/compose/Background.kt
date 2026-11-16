package com.radiflow.player

import android.graphics.Bitmap
import android.os.Build
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode as AnimationRepeat
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.palette.graphics.Palette
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.SingletonImageLoader
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.withContext
import kotlin.math.cos
import kotlin.math.sin

/** Cover-derived colors: five for the light flow plus the soft accent. */
@Immutable
data class CoverPalette(val colors: List<Color>, val accent: Color) {
    companion object {
        val Default = CoverPalette(
            listOf(Color(0xFF2B3A4A), Color(0xFF3D4F63), Color(0xFF1E2A36), Color(0xFF52667A), Color(0xFF283340)),
            Rf.DefaultAccent,
        )
    }
}

/** Extracts a palette from the artwork (like colorthief on desktop), off the main thread. */
@Composable
fun rememberCoverPalette(cover: String?): CoverPalette {
    val context = LocalContext.current
    var palette by remember { mutableStateOf(CoverPalette.Default) }
    LaunchedEffect(cover) {
        if (cover == null) { palette = CoverPalette.Default; return@LaunchedEffect }
        val bitmap = withContext(Dispatchers.IO) {
            val request = ImageRequest.Builder(context).data(artworkModel(cover)).size(96).allowHardware(false).build()
            (SingletonImageLoader.get(context).execute(request) as? SuccessResult)?.image?.toBitmap()
        } ?: return@LaunchedEffect
        palette = withContext(Dispatchers.Default) { paletteOf(bitmap) }
    }
    return palette
}

private fun paletteOf(bitmap: Bitmap): CoverPalette {
    val p = Palette.from(bitmap).maximumColorCount(16).generate()
    val swatches = listOfNotNull(p.vibrantSwatch, p.darkVibrantSwatch, p.mutedSwatch, p.darkMutedSwatch, p.lightVibrantSwatch, p.dominantSwatch)
        .map { Color(it.rgb) }.distinct()
    if (swatches.isEmpty()) return CoverPalette.Default
    val colors = List(5) { swatches[it % swatches.size] }.map { lerp(it, Color.Black, 0.18f) }
    val base = Color((p.vibrantSwatch ?: p.dominantSwatch)!!.rgb)
    // --rf-accent-soft: 35% accent, 65% white.
    return CoverPalette(colors, lerp(Color.White, base, 0.35f))
}

/** Local artwork is a content/file URI, online artwork is forced to HTTPS (as artworkUrl() on web). */
fun artworkModel(cover: String?): Any? = cover?.replaceFirst(Regex("^http:", RegexOption.IGNORE_CASE), "https:")

@Composable
fun Wallpaper(cover: String?, palette: CoverPalette, appearance: Appearance, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Rf.Wallpaper)) {
        val custom = appearance.background
        Crossfade(targetState = Triple(custom, appearance.effect, if (custom == null) cover else null), animationSpec = tween(700),
            label = "wallpaper") { (background, effect, art) ->
            when {
                background != null -> AsyncImage(model = java.io.File(background), contentDescription = null,
                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                effect == BackgroundEffect.BLUR && art != null -> BlurredCover(art)
                else -> LightFlow(palette)
            }
        }
        // Same scrim as .rf-mobile-wallpaper::after.
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(
            0f to Color(0x1A11151A), 0.63f to Color(0x400B0E13), 1f to Color(0x900B0E13),
            start = Offset(0f, 0f), end = Offset(600f, 1400f),
        )))
    }
}

@Composable
private fun BlurredCover(cover: String) {
    val context = LocalContext.current
    // A tiny decode scaled up already reads as blur; API 31+ adds a real blur on top.
    AsyncImage(
        model = ImageRequest.Builder(context).data(artworkModel(cover)).size(64).build(),
        contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = 1.15f; scaleY = 1.15f }
            .then(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Modifier.blur(48.dp) else Modifier),
    )
    Box(Modifier.fillMaxSize().background(Color(0x55000000)))
}

/**
 * Streamer mode: slow drifting radial light blobs in cover colors. Drawn with
 * a single Canvas (GPU gradients, no bitmaps); colors cross-fade on track change.
 */
@Composable
private fun LightFlow(palette: CoverPalette) {
    val colors = palette.colors.mapIndexed { index, color ->
        animateColorAsState(color, tween(1400), label = "flow$index").value
    }
    var time by remember { mutableStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameNanos { it }
        while (true) {
            withFrameNanos { now -> time = ((now - start) / 1e9f / 36f * 2f * Math.PI.toFloat()) % (2f * Math.PI.toFloat()) }
            delay(33)
        }
    }
    // Rendered at 1/8 resolution into a small bitmap, then stretched: the flow is soft
    // by design, and one bilinear blit per frame keeps the GPU free for scrolling lists.
    val density = androidx.compose.ui.platform.LocalDensity.current
    val layout = androidx.compose.ui.platform.LocalLayoutDirection.current
    var buffer by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    val painter = remember { androidx.compose.ui.graphics.drawscope.CanvasDrawScope() }
    Canvas(Modifier.fillMaxSize()) {
        val small = androidx.compose.ui.unit.IntSize((size.width / 8).toInt().coerceAtLeast(8), (size.height / 8).toInt().coerceAtLeast(8))
        val bitmap = buffer?.takeIf { it.width == small.width && it.height == small.height }
            ?: androidx.compose.ui.graphics.ImageBitmap(small.width, small.height).also { buffer = it }
        painter.draw(density, layout, androidx.compose.ui.graphics.Canvas(bitmap), Size(small.width.toFloat(), small.height.toFloat())) {
            drawRect(lerp(colors[2], Color.Black, 0.55f))
            val w = this.size.width
            val h = this.size.height
            val radius = maxOf(w, h) * 0.62f
            colors.forEachIndexed { index, color ->
                val phase = time + index * 1.256f
                val center = Offset(
                    w * (0.5f + 0.38f * cos(phase * (1f + index * 0.17f)) * if (index % 2 == 0) 1f else -1f),
                    h * (0.5f + 0.34f * sin(phase * (0.8f + index * 0.13f) + index)),
                )
                drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.85f), color.copy(alpha = 0f)), center, radius), radius, center)
            }
        }
        drawImage(bitmap, dstSize = androidx.compose.ui.unit.IntSize(size.width.toInt(), size.height.toInt()),
            filterQuality = androidx.compose.ui.graphics.FilterQuality.Low)
    }
}
