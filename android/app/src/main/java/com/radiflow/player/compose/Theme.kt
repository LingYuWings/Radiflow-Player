package com.radiflow.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect

/** Design tokens taken from src/android/android.css and the shared .rf-glass rules. */
object Rf {
    val Background = Color(0xFF101215)
    val Wallpaper = Color(0xFF15191E)
    val Text = Color(0xFFF7F8FA)
    val TextSecondary = Color(0xB8E4E9EF)
    val TextTertiary = Color(0xA6D9DEE5)
    val Muted = Color(0xFFC6CBD0)
    val Divider = Color(0x0FFFFFFF)
    val Pressed = Color(0x18FFFFFF)
    val Field = Color(0x10FFFFFF)
    val FieldBorder = Color(0x14FFFFFF)
    val GlassBase = Color(0xC70E1317)
    val GlassBorder = Color(0x2EFFFFFF)
    val Error = Color(0xA9671720)
    val ErrorText = Color(0xFFFFD9D1)
    val DefaultAccent = Color(0xFFC5D4E2)

    /** Non-overshooting curves shared with the desktop app (pageMotion.ts / --rf-ease-out). */
    val EaseOut = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
    val CardEase = CubicBezierEasing(0.2f, 0.9f, 0.25f, 1f)
    val ExitEase = CubicBezierEasing(0.4f, 0f, 0.8f, 0.4f)

    val CardShape = RoundedCornerShape(18.dp)
    val DockShape = RoundedCornerShape(20.dp)
    val RowShape = RoundedCornerShape(12.dp)
    val ArtShape = RoundedCornerShape(22.dp)
}

/** Cover-derived accent (`--rf-accent-soft`), animated by the app shell. */
val LocalAccent = staticCompositionLocalOf { Rf.DefaultAccent }
/** Shared backdrop for glass surfaces; null disables backdrop blur. */
val LocalHaze = staticCompositionLocalOf<HazeState?> { null }
/** Glass blur strength from Settings (CSS --rf-card-blur, 0–72px). */
val LocalGlassBlur = staticCompositionLocalOf { 36.dp }

object RfType {
    val PageTitle = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.W700, letterSpacing = (-0.6).sp, color = Rf.Text)
    val Section = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.W700, letterSpacing = (-0.4).sp, color = Rf.Text)
    val Title = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.W600, color = Rf.Text)
    val Subtitle = TextStyle(fontSize = 13.sp, color = Rf.TextSecondary)
    val Caption = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.W500, color = Rf.Muted)
    val Mono = TextStyle(fontSize = 11.sp, color = Color(0x9CE5E9ED), fontFeatureSettings = "tnum")
}

/**
 * The `.rf-glass` surface: blurred backdrop (API 31+, via Haze), a diagonal
 * sheen over a dark tint, a hairline border and a top highlight.
 */
@Composable
fun Modifier.glass(shape: Shape = Rf.CardShape, strong: Boolean = true): Modifier {
    val haze = LocalHaze.current
    val blur = LocalGlassBlur.current
    val sheen = Brush.linearGradient(
        0f to Color(0x1FFFFFFF), 0.48f to Color(0x06FFFFFF), 1f to Color(0x10FFFFFF),
        start = Offset.Zero, end = Offset.Infinite,
    )
    var modifier = this.clip(shape)
    if (haze != null && blur > 0.dp) {
        modifier = modifier.hazeEffect(state = haze, style = HazeStyle(
            backgroundColor = Rf.Background,
            tints = listOf(HazeTint(if (strong) Color(0x9E0E1317) else Color(0x660E1317))),
            blurRadius = blur.coerceAtMost(72.dp),
            noiseFactor = 0f,
        ))
    } else {
        modifier = modifier.background(if (strong) Rf.GlassBase else Color(0x800E1317))
    }
    return modifier.background(sheen).border(1.dp, Rf.GlassBorder, shape)
}

fun Modifier.fieldSurface(shape: Shape = RoundedCornerShape(13.dp), border: Dp = 1.dp) =
    this.clip(shape).background(Rf.Field).border(border, Rf.FieldBorder, shape)

@Composable
fun RadiFlowTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = Rf.Background, surface = Rf.Background, onBackground = Rf.Text, onSurface = Rf.Text,
            primary = Rf.DefaultAccent, onPrimary = Color(0xFF111419),
        ),
    ) {
        CompositionLocalProvider(content = content)
    }
}
