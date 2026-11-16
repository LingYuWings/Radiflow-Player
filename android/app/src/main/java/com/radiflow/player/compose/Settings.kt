package com.radiflow.player

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SettingsTab { APPEARANCE, EQUALIZER }

@Composable
fun SettingsScreen(model: AppViewModel) {
    val s = strings
    var tab by rememberSaveable { mutableStateOf(SettingsTab.APPEARANCE) }
    val appearance by model.appearance.collectAsStateWithLifecycle()
    val library by model.library.collectAsStateWithLifecycle()
    val player by model.playerState.collectAsStateWithLifecycle()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(model::setCustomBackground) }

    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 5.dp, bottom = 12.dp)) {
        item {
            FilterRow(SettingsTab.entries, tab, { if (it == SettingsTab.APPEARANCE) s.appearance else s.equalizer }, { tab = it },
                icon = { if (it == SettingsTab.EQUALIZER) Icons.Rounded.Tune else null })
        }
        if (tab == SettingsTab.EQUALIZER) item { Equalizer(model, player) }
        else {
            item { AccountCard(model) }
            item {
                Card(s.appearance) {
                    SettingRow(s.backgroundEffect) {
                        Segmented(BackgroundEffect.entries, appearance.effect, { if (it == BackgroundEffect.STREAMER) s.streamer else s.blurMode },
                            Modifier.width(200.dp)) { effect -> model.updateAppearance { it.copy(effect = effect) } }
                    }
                    SettingRow(s.backgroundSource) {
                        RfTextButton(if (appearance.background != null) s.replaceBackground else s.uploadBackground,
                            { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, icon = Icons.Rounded.AddPhotoAlternate)
                        if (appearance.background != null) RfIconButton(Icons.Rounded.RestartAlt, s.removeBackground, model::clearCustomBackground, iconSize = 18.dp)
                    }
                    SettingRow(s.glassBlur) {
                        SeekBar(appearance.blur.toFloat(), 72f, { v -> model.updateAppearance { it.copy(blur = v.toInt()) } }, s.glassBlur,
                            Modifier.width(180.dp), continuous = true)
                    }
                }
            }
            item {
                Card(s.general) {
                    SettingRow(s.language) {
                        Segmented(Language.entries, appearance.language, { if (it == Language.ZH) "中文" else "English" }, Modifier.width(170.dp)) { lang ->
                            model.updateAppearance { it.copy(language = lang) }
                        }
                    }
                    SettingRow(s.dockLyrics) {
                        Switch(appearance.dockLyrics, { on -> model.updateAppearance { it.copy(dockLyrics = on) } },
                            colors = SwitchDefaults.colors(checkedTrackColor = LocalAccent.current, checkedThumbColor = Color(0xFF14181D)))
                    }
                    SettingRow(s.visualizer, stacked = true) {
                        Segmented(VisualizerMode.entries, appearance.visualizer, {
                            when (it) { VisualizerMode.OFF -> s.visualizerOff; VisualizerMode.SPECTRUM -> s.spectrum; VisualizerMode.MIRROR -> s.mirror; VisualizerMode.WAVEFORM -> s.waveform }
                        }, Modifier.fillMaxWidth()) { mode -> model.updateAppearance { it.copy(visualizer = mode) } }
                    }
                }
            }
            item {
                Card(s.about) {
                    SettingRow("RadiFlow Player ${BuildConfig.VERSION_NAME}") { Text(s.songs(library.size), style = RfType.Subtitle) }
                }
            }
        }
    }
}

@Composable
private fun Card(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().glass(Rf.CardShape).padding(12.dp)) {
        Text(title, style = RfType.Section.copy(fontSize = 19.sp), modifier = Modifier.padding(bottom = 6.dp))
        content()
    }
}

@Composable
private fun SettingRow(label: String, stacked: Boolean = false, content: @Composable () -> Unit) {
    if (stacked) Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = RfType.Title.copy(fontWeight = FontWeight.W400))
        content()
    } else Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = RfType.Title.copy(fontWeight = FontWeight.W400), modifier = Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically) { content() }
    }
}

@Composable
private fun AccountCard(model: AppViewModel) {
    val s = strings
    val scope = rememberCoroutineScope()
    val session by model.session.collectAsStateWithLifecycle()
    var qr by remember { mutableStateOf<Pair<String, String>?>(null) }
    var status by remember { mutableIntStateOf(801) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun startLogin() = scope.launch {
        busy = true; error = null
        try { qr = model.api.startQrLogin(); status = 801 } catch (c: CancellationException) { throw c } catch (e: Exception) { error = e.message } finally { busy = false }
    }

    // Poll the QR state like the desktop app: every 1.7s until confirmed (803) or expired (800).
    LaunchedEffect(qr, status == 800) {
        val key = qr?.first ?: return@LaunchedEffect
        if (status == 800) return@LaunchedEffect
        delay(1500)
        while (true) {
            val result = try { model.api.checkQr(key) } catch (c: CancellationException) { throw c } catch (e: Exception) { error = e.message; status = 800; break }
            status = result.code
            if (result.code == 803) {
                result.session?.let(model::setSession)
                qr = null
                if (result.session?.isLoggedIn != true) error = s.signedOut
                break
            }
            if (result.code == 800) break
            delay(1700)
        }
    }

    Card(s.neteaseAccount) {
        SettingRow(if (session?.isLoggedIn == true) session?.account?.nickname.orEmpty() else s.signedOut) {
            if (session?.isLoggedIn == true) RfTextButton(s.signOut, {
                scope.launch { busy = true; runCatching { model.setSession(model.api.logout()) }.onFailure { error = it.message }; busy = false }
            }, icon = Icons.AutoMirrored.Rounded.Logout, enabled = !busy)
            else RfTextButton(s.signIn, { startLogin() }, icon = Icons.AutoMirrored.Rounded.Login, enabled = !busy)
        }
        error?.let { InlineError(it) }
    }

    qr?.let { (_, image) ->
        RfSheet(s.signIn, onDismiss = { qr = null }) {
            Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val bitmap = remember(image) {
                    runCatching { Base64.decode(image.substringAfter("base64,"), Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) }.asImageBitmap() }.getOrNull()
                }
                bitmap?.let { Image(it, s.qrHint, Modifier.fillMaxWidth(0.62f).aspectRatio(1f).clip(RoundedCornerShape(10.dp)).background(Color.White)) }
                Text(when (status) { 800 -> s.qrExpired; 802 -> s.qrConfirm; else -> s.qrHint }, style = RfType.Subtitle)
                if (status == 800) RfPrimaryButton(s.qrRefresh, { startLogin() }, enabled = !busy)
            }
        }
    }
}

private val frequencies = listOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)

@Composable
private fun Equalizer(model: AppViewModel, state: PlayerState) {
    val s = strings
    val accent = LocalAccent.current
    val gains = state.eqGains.takeIf { it.size == frequencies.size } ?: List(frequencies.size) { 0f }
    Column(Modifier.fillMaxWidth().glass(RoundedCornerShape(20.dp)).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.equalizer, style = RfType.PageTitle.copy(fontSize = 24.sp), modifier = Modifier.weight(1f))
            Row(Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp)).background(if (state.eqEnabled) Color(0xFFF4F6FA) else Color(0x14FFFFFF))
                .clickable(role = Role.Switch) { model.player.configureEqualizer(enabled = !state.eqEnabled) }.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                val tint = if (state.eqEnabled) Color(0xFF15191F) else Color(0xFFE8EDF4)
                Icon(Icons.Rounded.Tune, null, tint = tint, modifier = Modifier.height(17.dp))
                Text(if (state.eqEnabled) s.eqEnabled else s.eqDisabled, style = RfType.Subtitle.copy(color = tint))
            }
        }
        // Curve: same smooth path as EQView.buildEQCurve on desktop.
        Row(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x5C0A0E15)).padding(8.dp)) {
            Column(Modifier.height(110.dp).width(28.dp), verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
                listOf("+12", "0", "−12").forEach { Text(it, style = RfType.Mono.copy(color = Color(0xB5E6EBF1))) }
            }
            Canvas(Modifier.weight(1f).height(110.dp).padding(start = 6.dp)) {
                listOf(0f, 0.25f, 0.5f, 0.75f, 1f).forEach { y ->
                    drawLine(if (y == 0.5f) Color(0x49FFFFFF) else Color(0x1AFFFFFF), Offset(0f, size.height * y), Offset(size.width, size.height * y), 1f)
                }
                val points = gains.mapIndexed { i, g -> Offset((i + 0.5f) / gains.size * size.width, (1f - (g.coerceIn(-12f, 12f) + 12f) / 24f) * size.height) }
                val path = Path().apply {
                    moveTo(points[0].x, points[0].y)
                    for (i in 1 until points.size) {
                        val mid = (points[i - 1].x + points[i].x) / 2
                        cubicTo(mid, points[i - 1].y, mid, points[i].y, points[i].x, points[i].y)
                    }
                }
                drawPath(path, accent, style = Stroke(2.dp.toPx()))
                points.forEach { drawCircle(accent, 3.5.dp.toPx(), it) }
            }
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(s.bands, style = RfType.Title.copy(fontSize = 15.sp), modifier = Modifier.weight(1f))
            RfTextButton(s.reset, { model.player.configureEqualizer(gains = List(frequencies.size) { 0f }) }, icon = Icons.Rounded.RestartAlt)
        }
        frequencies.forEachIndexed { index, frequency ->
            val gain = gains[index]
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (frequency >= 1000) "${frequency / 1000} kHz" else "$frequency Hz", style = RfType.Mono.copy(fontSize = 12.sp, color = Rf.Text),
                    modifier = Modifier.width(52.dp))
                SeekBar(gain + 12f, 24f, { v ->
                    val snapped = (Math.round((v - 12f) * 2) / 2f)
                    model.player.configureEqualizer(gains = gains.mapIndexed { i, g -> if (i == index) snapped else g })
                }, "$frequency Hz", Modifier.weight(1f), continuous = true)
                Text("${if (gain > 0) "+" else ""}${"%.1f".format(gain)} dB", style = RfType.Mono.copy(fontSize = 12.sp, color = Rf.Text), modifier = Modifier.width(62.dp))
            }
        }
    }
}
