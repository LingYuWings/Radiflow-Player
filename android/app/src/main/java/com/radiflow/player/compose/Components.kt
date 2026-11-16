package com.radiflow.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade

/** 44dp round icon button with the desktop app's pressed scale and selected tint. */
@Composable
fun RfIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    size: Dp = 44.dp,
    iconSize: Dp = 22.dp,
    tint: Color = Rf.Text,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.92f else 1f, tween(160, easing = Rf.EaseOut), label = "press")
    val accent = LocalAccent.current
    Box(
        modifier.size(size).scale(scale).clip(CircleShape)
            .background(if (selected) Color(0x18FFFFFF) else Color.Transparent)
            .clickable(interaction, ripple(bounded = true), enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label }
            .alpha(if (enabled) 1f else 0.36f),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) accent else tint, modifier = Modifier.size(iconSize))
    }
}

/** Compact icon button for list rows: ripple only, no per-instance animation state. */
@Composable
fun RowIconButton(icon: ImageVector, label: String, onClick: () -> Unit, enabled: Boolean = true, iconSize: Dp = 18.dp,
                  tint: Color = Color(0xD9FFFFFF), selected: Boolean = false) {
    Box(
        Modifier.size(44.dp).clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = if (selected) LocalAccent.current else tint.copy(alpha = if (enabled) tint.alpha else 0.3f),
            modifier = Modifier.size(iconSize))
    }
}

/** Text button (`.rf-mobile-text-button`). */
@Composable
fun RfTextButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null,
                 enabled: Boolean = true, color: Color = Color(0xFFE9EDF1)) {
    Row(
        modifier.heightIn(min = 42.dp).clip(RoundedCornerShape(11.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.36f).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        icon?.let { Icon(it, null, tint = color, modifier = Modifier.size(18.dp)) }
        Text(text, style = TextStyle(color = color, fontSize = androidx.compose.ui.unit.TextUnit(14f, androidx.compose.ui.unit.TextUnitType.Sp)))
    }
}

/** Primary pill (`.rf-primary-button`): white with dark text. */
@Composable
fun RfPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true,
                    container: Color = Color(0xF2FFFFFF)) {
    Row(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(container)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).alpha(if (enabled) 1f else 0.42f)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        icon?.let { Icon(it, null, tint = Color(0xFF14181D), modifier = Modifier.size(17.dp)) }
        Text(text, style = RfType.Title.copy(color = Color(0xFF14181D), fontSize = RfType.Subtitle.fontSize))
    }
}

/** Ghost pill (`.rf-ghost-button`). */
@Composable
fun RfGhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true) {
    Row(
        modifier.heightIn(min = 44.dp).fieldSurface(RoundedCornerShape(22.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).alpha(if (enabled) 1f else 0.42f)
            .padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        icon?.let { Icon(it, null, tint = Rf.Text, modifier = Modifier.size(17.dp)) }
        Text(text, style = RfType.Title.copy(fontSize = RfType.Subtitle.fontSize, fontWeight = androidx.compose.ui.text.font.FontWeight.W500))
    }
}

/** Artwork with a music-note placeholder (`.rf-mobile-cover`). */
@Composable
fun Cover(cover: String?, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(9.dp), size: Int? = null,
          placeholder: ImageVector = Icons.Rounded.MusicNote) {
    val context = LocalContext.current
    Box(
        modifier.clip(shape).background(Brush.linearGradient(listOf(Color(0x20FFFFFF), Color(0x25000000)))).background(Color(0x66343B43)),
        contentAlignment = Alignment.Center,
    ) {
        // Placeholder underneath, image on top: no per-row subcomposition while lists scroll.
        Icon(placeholder, null, tint = Color(0x5CE5EDF5), modifier = Modifier.fillMaxSize(0.45f))
        if (cover != null) {
            val request = remember(cover, size) {
                ImageRequest.Builder(context).data(artworkModel(cover)).crossfade(180).apply { if (size != null) size(size) }.build()
            }
            AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Two-line track label. */
@Composable
fun TrackLabel(title: String, subtitle: String, modifier: Modifier = Modifier, active: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, style = RfType.Title.copy(color = if (active) LocalAccent.current else Rf.Text), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(subtitle, style = RfType.Subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 58dp list row: cover + label + trailing actions (`.rf-mobile-track`). */
@Composable
fun TrackRow(
    track: Track,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String = listOfNotNull(track.artist.ifEmpty { null }, track.album).joinToString(" · "),
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().height(58.dp).clip(Rf.RowShape)
            .background(if (active) LocalAccent.current.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick).padding(start = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(track.cover, Modifier.size(40.dp), size = 120)
        TrackLabel(track.title, subtitle, Modifier.weight(1f).padding(horizontal = 10.dp), active)
        trailing()
    }
}

/**
 * Seek/volume bar (`.rf-slider`): thin rounded track, accent-free white fill,
 * tap or drag; while dragging only the draft moves and the commit happens on release.
 */
@Composable
fun SeekBar(
    value: Float,
    max: Float,
    onCommit: (Float) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    height: Dp = 32.dp,
    onDraft: ((Float?) -> Unit)? = null,
    continuous: Boolean = false,
) {
    var draft by remember { mutableStateOf<Float?>(null) }
    val safeMax = if (max.isFinite() && max > 0f) max else 1f
    val shown = ((draft ?: value) / safeMax).coerceIn(0f, 1f)
    val enabled = max.isFinite() && max > 0f
    Canvas(
        modifier.fillMaxWidth().height(height)
            .semantics {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(value.coerceIn(0f, safeMax), 0f..safeMax)
                setProgress { target -> onCommit(target.coerceIn(0f, safeMax)); true }
            }
            .then(if (!enabled) Modifier else Modifier
                .pointerInput(safeMax) {
                    detectTapGestures { offset -> onCommit((offset.x / size.width).coerceIn(0f, 1f) * safeMax) }
                }
                .pointerInput(safeMax) {
                    detectHorizontalDragGestures(
                        onDragStart = { offset -> draft = (offset.x / size.width).coerceIn(0f, 1f) * safeMax; onDraft?.invoke(draft) },
                        onDragEnd = { draft?.let(onCommit); draft = null; onDraft?.invoke(null) },
                        onDragCancel = { draft = null; onDraft?.invoke(null) },
                        onHorizontalDrag = { change, _ ->
                            change.consume()
                            draft = (change.position.x / size.width).coerceIn(0f, 1f) * safeMax
                            onDraft?.invoke(draft)
                            if (continuous) draft?.let(onCommit)
                        },
                    )
                }),
    ) {
        val track = if (draft != null) 6.dp.toPx() else 4.dp.toPx()
        val top = (size.height - track) / 2
        drawRoundRect(Color(0x2EFFFFFF), Offset(0f, top), Size(size.width, track), CornerRadius(track / 2))
        drawRoundRect(Color.White, Offset(0f, top), Size(size.width * shown, track), CornerRadius(track / 2))
        val thumb = if (draft != null) 8.dp.toPx() else 5.dp.toPx()
        drawCircle(Color.White, thumb, Offset(size.width * shown, size.height / 2))
    }
}

fun formatTime(seconds: Double): String {
    val value = if (seconds.isFinite()) seconds.toLong().coerceAtLeast(0) else 0
    return "${value / 60}:${(value % 60).toString().padStart(2, '0')}"
}

/** Section-local empty state (`.rf-mobile-empty`). */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().heightIn(min = 180.dp).padding(16.dp), contentAlignment = Alignment.Center) {
        Text(text, style = RfType.Subtitle.copy(color = Rf.TextTertiary, textAlign = androidx.compose.ui.text.style.TextAlign.Center))
    }
}

@Composable
fun InlineError(text: String, modifier: Modifier = Modifier) {
    Text(text, style = RfType.Subtitle.copy(color = Rf.ErrorText),
        modifier = modifier.fillMaxWidth().padding(vertical = 7.dp).clip(RoundedCornerShape(9.dp)).background(Rf.Error).padding(10.dp))
}

/** Segmented filter chips (`.rf-mobile-filter`). */
@Composable
fun <T> FilterRow(options: List<T>, selected: T, label: @Composable (T) -> String, onSelect: (T) -> Unit,
                  modifier: Modifier = Modifier, icon: ((T) -> ImageVector?)? = null) {
    val accent = LocalAccent.current
    androidx.compose.foundation.lazy.LazyRow(modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(5.dp),
        contentPadding = PaddingValues(horizontal = 2.dp)) {
        items(options.size) { index ->
            val option = options[index]
            val active = option == selected
            Row(
                Modifier.height(42.dp).clip(RoundedCornerShape(12.dp)).background(if (active) Color(0x16FFFFFF) else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(option) }.padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                icon?.invoke(option)?.let { Icon(it, null, tint = if (active) accent else Color(0xFFD2D8DF), modifier = Modifier.size(16.dp)) }
                Text(label(option), style = RfType.Title.copy(color = if (active) Color.White else Color(0xFFD2D8DF), fontWeight = androidx.compose.ui.text.font.FontWeight.W500))
            }
        }
    }
}
