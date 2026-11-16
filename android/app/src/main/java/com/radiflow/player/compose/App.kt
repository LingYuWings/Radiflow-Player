package com.radiflow.player

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.delay

/** Bottom-bar order; the first entry is the home screen shown at launch. */
enum class Section { NETEASE, LIBRARY, SETTINGS }

val HomeSection = Section.NETEASE

/** Cross-screen navigation requests (e.g. "open this album" from the player). */
class Navigator {
    var section by mutableStateOf(HomeSection)
    var panel by mutableStateOf<PlayerPanel?>(null)
    var pendingLocalAlbum by mutableStateOf<Pair<String, String?>?>(null)
    var pendingOnlineAlbum by mutableStateOf<String?>(null)
    /** Screens push back handlers for their own nested state (details, dialogs). */
    val backStack = mutableListOf<() -> Boolean>()
}

@Composable
fun RadiFlowApp(model: AppViewModel) {
    val state by model.playerState.collectAsStateWithLifecycle()
    val appearance by model.appearance.collectAsStateWithLifecycle()
    val lyrics by model.lyrics.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val canUndo by model.canUndo.collectAsStateWithLifecycle()
    val nav = remember { Navigator() }
    val haze = rememberHazeState()
    val palette = rememberCoverPalette(state.track?.cover)
    val accent by animateColorAsState(palette.accent, tween(800), label = "accent")
    var dismissedError by rememberSaveable { mutableStateOf<String?>(null) }
    val errorKey = state.error?.let { "${state.track?.id}:${it.code}" }

    val lyricPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(model::attachLyrics) }

    LaunchedEffect(nav.panel) {
        model.setLyricsWanted(nav.panel == PlayerPanel.LYRICS)
        model.setVisualizerVisible(nav.panel != null)
    }
    LaunchedEffect(message) { if (message != null) { delay(5000); model.showMessage(null) } }
    LaunchedEffect(state.track == null) { if (state.track == null) nav.panel = null }

    // Back: player panel → screen-local state → home section → system.
    BackHandler(enabled = nav.panel != null || nav.section != HomeSection || nav.backStack.isNotEmpty()) {
        when {
            nav.panel == PlayerPanel.ARTWORK -> nav.panel = null
            nav.panel != null -> nav.panel = PlayerPanel.ARTWORK
            nav.backStack.lastOrNull()?.invoke() == true -> Unit
            nav.section != HomeSection -> nav.section = HomeSection
        }
    }

    CompositionLocalProvider(
        LocalStrings provides if (appearance.language == Language.ZH) Strings.Zh else Strings.En,
        LocalAccent provides accent,
        LocalHaze provides haze,
        LocalGlassBlur provides appearance.blur.dp,
    ) {
        val s = strings
        Box(Modifier.fillMaxSize().background(Rf.Background)) {
            Wallpaper(state.track?.cover, palette, appearance, Modifier.hazeSource(haze))

            // Shell stays composed under the player so its scroll positions survive.
            AnimatedVisibility(nav.panel == null, enter = fadeIn(tween(260)) + scaleIn(tween(420, easing = Rf.CardEase), 0.96f, TransformOrigin(0.5f, 0.4f)),
                exit = fadeOut(tween(220, easing = Rf.ExitEase)) + scaleOut(tween(340, easing = Rf.ExitEase), 0.92f, TransformOrigin(0.5f, 0.55f))) {
                Shell(model, nav, state, lyrics, appearance)
            }

            AnimatedVisibility(nav.panel != null && state.track != null,
                enter = slideInVertically(tween(440, easing = Rf.CardEase)) { it / 9 } + scaleIn(tween(440, easing = Rf.CardEase), 0.95f) + fadeIn(tween(200)),
                exit = slideOutVertically(tween(300, easing = Rf.ExitEase)) { it / 6 } + fadeOut(tween(260))) {
                val track = state.track
                FullPlayer(
                    model, state, nav.panel ?: PlayerPanel.ARTWORK, lyrics, appearance.visualizer, canUndo,
                    onPanel = { nav.panel = it }, onClose = { nav.panel = null },
                    onOpenAlbum = when {
                        track == null -> null
                        track.isOnline && track.albumId != null -> ({ nav.pendingOnlineAlbum = track.albumId; nav.section = Section.NETEASE; nav.panel = null })
                        !track.isOnline && track.album != null -> ({ nav.pendingLocalAlbum = track.album to track.artist; nav.section = Section.LIBRARY; nav.panel = null })
                        else -> null
                    },
                    onImportLyrics = if (track != null && !track.isOnline) ({ lyricPicker.launch(arrayOf("*/*")) }) else null,
                )
            }

            message?.let { text ->
                Toast(text, onDismiss = { model.showMessage(null) }, Modifier.align(Alignment.BottomCenter))
            }
            val error = state.error
            if (error != null && errorKey != dismissedError) {
                PlaybackErrorDialog(error, state.track?.title ?: "RadiFlow") { dismissedError = errorKey }
            }
        }
    }
}

@Composable
private fun Shell(model: AppViewModel, nav: Navigator, state: PlayerState, lyrics: LyricsState, appearance: Appearance) {
    val s = strings
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 12.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Icon(painterResource(R.drawable.radiflow_launcher), null, tint = Color.Unspecified,
                    modifier = Modifier.size(29.dp).clip(RoundedCornerShape(8.dp)))
                Text("RadiFlow", style = RfType.Section.copy(fontSize = 19.sp, fontWeight = FontWeight.W800))
            }
            RfIconButton(Icons.Rounded.Tune, s.settings, { nav.section = if (nav.section == Section.SETTINGS) HomeSection else Section.SETTINGS },
                selected = nav.section == Section.SETTINGS)
        }
        AnimatedContent(nav.section, modifier = Modifier.weight(1f).fillMaxWidth(), transitionSpec = {
            val forward = targetState.ordinal > initialState.ordinal
            (slideInHorizontally(tween(360, easing = Rf.CardEase)) { if (forward) it / 14 else -it / 14 } + fadeIn(tween(240))) togetherWith
                fadeOut(tween(160, easing = Rf.ExitEase))
        }, label = "section") { section ->
            when (section) {
                Section.LIBRARY -> LibraryScreen(model, nav, state)
                Section.NETEASE -> NetEaseScreen(model, nav, state)
                Section.SETTINGS -> SettingsScreen(model)
            }
        }
        if (state.track != null) {
            Dock(model, state, lyrics.lines.takeIf { lyrics.trackId == state.track.id }.orEmpty(), appearance.dockLyrics,
                onOpen = { nav.panel = PlayerPanel.ARTWORK }, modifier = Modifier.padding(top = 6.dp))
        }
        NavigationBar(nav)
    }
}

@Composable
private fun NavigationBar(nav: Navigator) {
    val s = strings
    val accent = androidx.compose.runtime.rememberUpdatedState(LocalAccent.current).value
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(Triple(Section.NETEASE, Icons.Rounded.Cloud, s.netease), Triple(Section.LIBRARY, Icons.Rounded.LibraryMusic, s.library),
            Triple(Section.SETTINGS, Icons.Rounded.Tune, s.settings)).forEach { (section, icon, label) ->
            val active = nav.section == section
            Column(
                Modifier.weight(1f).heightIn(min = 47.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Tab) { nav.section = section },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
            ) {
                Icon(icon, null, tint = if (active) accent else Color(0xFFC6CBD0), modifier = Modifier.size(21.dp))
                Text(label, style = RfType.Caption.copy(color = if (active) Color.White else Color(0xFFC6CBD0)), maxLines = 1)
            }
        }
    }
}

@Composable
private fun Toast(text: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.navigationBarsPadding().padding(bottom = 120.dp, start = 12.dp, end = 12.dp).widthIn(max = 500.dp).fillMaxWidth()
            .shadow(12.dp, RoundedCornerShape(12.dp)).glass(RoundedCornerShape(12.dp)).heightIn(min = 47.dp).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = RfType.Subtitle.copy(color = Rf.Text), modifier = Modifier.weight(1f))
        RfIconButton(Icons.Rounded.Close, strings.dismiss, onDismiss, iconSize = 20.dp)
    }
}

/** Native counterpart of components/PlaybackErrorDialog.tsx. */
@Composable
private fun PlaybackErrorDialog(error: PlaybackError, track: String, onDismiss: () -> Unit) {
    val s = strings
    val reason = s.errorReason(error.code, error.retryAfter)
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color(0xFF222831), titleContentColor = Rf.Text, textContentColor = Rf.TextSecondary,
        title = { Text(s.errorTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(track, style = RfType.Title)
                Text(reason)
                Text(listOfNotNull(error.code, error.httpStatus?.let { "HTTP $it" }).joinToString(" · "),
                    style = RfType.Mono)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(s.ok, color = LocalAccent.current) } },
    )
}
