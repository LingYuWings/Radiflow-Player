package com.radiflow.player

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.automirrored.rounded.ViewList
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.Collator

private enum class LibrarySection { SONGS, ARTISTS, ALBUMS, PLAYLISTS, FAVORITES }

private data class Group(val id: String, val name: String, val artist: String?, val cover: String?, val count: Int, val tracks: List<Track>)

private sealed interface LibrarySheet {
    data class TrackMenu(val track: Track, val playlistId: String?) : LibrarySheet
    data class AddTo(val trackIds: List<String>) : LibrarySheet
    data class AddTracks(val playlistId: String) : LibrarySheet
    data class Create(val trackIds: List<String>) : LibrarySheet
    data class Rename(val playlistId: String, val name: String) : LibrarySheet
    data class Delete(val playlistId: String, val name: String) : LibrarySheet
}

private fun String.norm() = trim().lowercase()
private fun Track.matches(q: String) = title.norm().contains(q) || artist.norm().contains(q) || (album?.norm()?.contains(q) == true)

@Composable
fun LibraryScreen(model: AppViewModel, nav: Navigator, state: PlayerState) {
    val s = strings
    val tracks by model.library.collectAsStateWithLifecycle()
    val importing by model.importing.collectAsStateWithLifecycle()
    val scanning by model.scanning.collectAsStateWithLifecycle()
    val mediaPermission by model.mediaPermission.collectAsStateWithLifecycle()
    var askedPermission by rememberSaveable { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { model.refreshMediaPermission() }
    // Ask once when the library is first shown; afterwards the card below offers it again.
    LaunchedEffect(mediaPermission) {
        if (!mediaPermission && !askedPermission) { askedPermission = true; permissionLauncher.launch(MediaStoreLibrary.permission) }
    }
    val collections by model.collections.state.collectAsStateWithLifecycle()
    var section by rememberSaveable { mutableStateOf(LibrarySection.SONGS) }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var grid by rememberSaveable { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<LibrarySheet?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { model.importTracks(it) }

    val collator = remember(s.zh) { Collator.getInstance(if (s.zh) java.util.Locale.CHINA else java.util.Locale.US) }
    val sorted = remember(tracks, collator) { tracks.sortedWith(compareBy(collator) { t: Track -> t.title }.thenBy(collator) { it.artist }) }
    val byId = remember(tracks) { tracks.associateBy { it.id } }
    val favorites = remember(collections.favoriteIds, byId) { collections.favoriteIds.mapNotNull(byId::get) }
    val favoriteIds = remember(collections.favoriteIds) { collections.favoriteIds.toHashSet() }
    val artists = remember(sorted, s.zh) { group(sorted, artists = true, s, collator) }
    val albums = remember(sorted, s.zh) { group(sorted, artists = false, s, collator) }
    val playlists = remember(collections.playlists, byId) {
        collections.playlists.map { p ->
            val available = p.trackIds.mapNotNull(byId::get)
            Group(p.id, p.name, null, available.firstNotNullOfOrNull { it.cover }, p.trackIds.size, available)
        }
    }
    val groups = when (section) { LibrarySection.ARTISTS -> artists; LibrarySection.ALBUMS -> albums; LibrarySection.PLAYLISTS -> playlists; else -> null }
    val detail = groups?.firstOrNull { it.id == detailId }
    val q = query.norm()
    val sectionTracks = if (section == LibrarySection.FAVORITES) favorites else sorted
    val visibleTracks = remember(detail, sectionTracks, q) { detail?.tracks ?: if (q.isEmpty()) sectionTracks else sectionTracks.filter { it.matches(q) } }
    val visibleGroups = remember(groups, q) { groups?.filter { g -> q.isEmpty() || g.name.norm().contains(q) || g.artist?.norm()?.contains(q) == true || g.tracks.any { it.matches(q) } } }

    // Open an album requested from the player.
    LaunchedEffect(nav.pendingLocalAlbum) {
        val (album, artist) = nav.pendingLocalAlbum ?: return@LaunchedEffect
        nav.pendingLocalAlbum = null
        albums.firstOrNull { it.name.norm() == album.norm() && (artist == null || it.artist?.norm() == artist.norm()) }?.let {
            section = LibrarySection.ALBUMS; query = ""; detailId = it.id
        }
    }
    DisposableEffect(detailId) {
        val handler: () -> Boolean = { if (detailId != null) { detailId = null; true } else false }
        if (detailId != null) nav.backStack += handler
        onDispose { nav.backStack.remove(handler) }
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.localLibrary, style = RfType.PageTitle, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            RfGhostButton(if (importing) s.importing else s.importMusic, { picker.launch(arrayOf("audio/*")) }, icon = Icons.Rounded.FolderOpen, enabled = !importing)
        }
        if (!mediaPermission) Row(Modifier.fillMaxWidth().glass(Rf.CardShape).padding(12.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(s.musicFolderTitle, style = RfType.Title)
                Text(s.musicFolderHint, style = RfType.Subtitle.copy(fontSize = 12.sp))
            }
            RfPrimaryButton(s.allowAccess, { permissionLauncher.launch(MediaStoreLibrary.permission) })
        }
        if (scanning && tracks.isEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(14.dp), color = LocalAccent.current, strokeWidth = 1.5.dp)
            Text(s.scanningLibrary, style = RfType.Subtitle)
        }
        Segmented(LibrarySection.entries, section, {
            when (it) { LibrarySection.SONGS -> s.songsTab; LibrarySection.ARTISTS -> s.artists; LibrarySection.ALBUMS -> s.albums
                LibrarySection.PLAYLISTS -> s.playlists; LibrarySection.FAVORITES -> s.favorites }
        }) { value -> if (value == section) detailId = null else { section = value; detailId = null; query = "" } }

        if (detail == null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SearchField(query, { query = it }, s.searchLibrary, Modifier.weight(1f))
            if (groups == null) Segmented(listOf(false, true), grid, { "" }, icon = { if (it) Icons.Rounded.GridView else Icons.AutoMirrored.Rounded.ViewList },
                labelFor = { if (it) s.gridView else s.listView }, compact = true) { grid = it }
            if (section == LibrarySection.PLAYLISTS) RfGhostButton(s.newPlaylist, { sheet = LibrarySheet.Create(emptyList()) }, icon = Icons.Rounded.Add)
        }

        AnimatedContent(Triple(section, detailId, grid), modifier = Modifier.weight(1f), transitionSpec = {
            val forward = targetState.second != null && initialState.second == null
            (slideInHorizontally(tween(340, easing = Rf.CardEase)) { if (forward) it / 12 else -it / 16 } + fadeIn(tween(220))) togetherWith fadeOut(tween(140))
        }, label = "library") { (_, _, isGrid) ->
            val onMenu: (Track) -> Unit = { sheet = LibrarySheet.TrackMenu(it, detail?.id?.takeIf { section == LibrarySection.PLAYLISTS }) }
            val play: (Track) -> Unit = { model.play(it.id, visibleTracks) }
            when {
                detail != null -> TrackList(visibleTracks, state, favoriteIds, play, onMenu) {
                    item { DetailHeader(detail, section, s, onBack = { detailId = null },
                        onPlayAll = { visibleTracks.firstOrNull()?.let(play) },
                        onAddTo = { sheet = LibrarySheet.AddTo(visibleTracks.map { it.id }) },
                        onAddSongs = { sheet = LibrarySheet.AddTracks(detail.id) },
                        onRename = { sheet = LibrarySheet.Rename(detail.id, detail.name) },
                        onDelete = { sheet = LibrarySheet.Delete(detail.id, detail.name) }) }
                    if (detail.count == 0) item { EmptyState(s.emptyPlaylist) }
                }
                visibleGroups != null -> if (visibleGroups.isEmpty()) EmptyState(if (q.isNotEmpty()) s.noMatches else if (section == LibrarySection.PLAYLISTS) s.noPlaylists else s.emptyLibrary)
                    else GroupGrid(visibleGroups, section) { detailId = it }
                visibleTracks.isEmpty() -> EmptyState(when { q.isNotEmpty() -> s.noMatches; section == LibrarySection.FAVORITES -> s.noFavorites; else -> s.emptyLibrary })
                isGrid -> TrackGrid(visibleTracks, state, play, onMenu)
                else -> TrackList(visibleTracks, state, favoriteIds, play, onMenu)
            }
        }
    }

    sheet?.let { current ->
        LibrarySheetHost(current, onDismiss = { sheet = null }, onNavigate = { sheet = it }, model = model, tracks = sorted,
            collections = collections, favoriteIds = favoriteIds,
            onCreated = { id, empty -> if (empty) { section = LibrarySection.PLAYLISTS; query = ""; detailId = id } },
            onDeleted = { detailId = null })
    }
}

private fun group(tracks: List<Track>, artists: Boolean, s: Strings, collator: Collator): List<Group> {
    val groups = LinkedHashMap<String, MutableList<Track>>()
    tracks.forEach { t ->
        val id = if (artists) t.artist.norm() else "${t.artist.norm()}\u0000${t.album.orEmpty().norm()}"
        groups.getOrPut(id) { mutableListOf() } += t
    }
    return groups.map { (id, list) ->
        val first = list.first()
        val artist = first.artist.trim().ifEmpty { s.unknownArtist }
        Group(id, if (artists) artist else first.album?.trim()?.ifEmpty { null } ?: s.unknownAlbum, if (artists) null else artist,
            list.firstNotNullOfOrNull { it.cover }, list.size, list)
    }.sortedWith(compareBy(collator) { g: Group -> g.artist.orEmpty() }.thenBy(collator) { it.name })
}

@Composable
private fun TrackList(tracks: List<Track>, state: PlayerState, favorites: Set<String>, onPlay: (Track) -> Unit, onMenu: (Track) -> Unit,
                      header: LazyListScope.() -> Unit = {}) {
    val s = strings
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 12.dp)) {
        header()
        items(tracks, key = { it.id }, contentType = { "track" }) { track ->
            val active = track.id == state.track?.id
            TrackRow(track, active, { onPlay(track) }, subtitle = listOfNotNull(track.artist.ifEmpty { s.unknownArtist }, track.album).joinToString(" · ")) {
                if (active) NowBars(state.playing)
                if (track.id in favorites) Icon(Icons.Rounded.Favorite, null, tint = LocalAccent.current, modifier = Modifier.size(13.dp))
                track.durationSec?.let { Text(formatTime(it), style = RfType.Mono, modifier = Modifier.padding(start = 8.dp)) }
                RowIconButton(Icons.Rounded.MoreHoriz, "${s.trackActions} · ${track.title}", { onMenu(track) }, iconSize = 20.dp, tint = Color(0xB3FFFFFF))
            }
        }
    }
}

/** Three animated equalizer bars on the playing row (`.rf-now-bars`). */
@Composable
private fun NowBars(playing: Boolean) {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "bars")
    val accent = LocalAccent.current
    Row(Modifier.height(14.dp).padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        listOf(520, 700, 610).forEach { period ->
            val h by transition.animateFloat(0.3f, 1f, androidx.compose.animation.core.infiniteRepeatable(tween(period),
                androidx.compose.animation.core.RepeatMode.Reverse), label = "bar")
            Box(Modifier.width(3.dp).fillMaxSize(if (playing) h else 0.35f).clip(RoundedCornerShape(1.dp)).background(accent))
        }
    }
}

@Composable
private fun TrackGrid(tracks: List<Track>, state: PlayerState, onPlay: (Track) -> Unit, onMenu: (Track) -> Unit) {
    val s = strings
    LazyVerticalGrid(GridCells.Adaptive(122.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(tracks, key = { it.id }) { track ->
            val active = track.id == state.track?.id
            Column(Modifier.clip(RoundedCornerShape(16.dp)).background(if (active) Color(0x15FFFFFF) else Color.Transparent)
                .clickable(role = Role.Button) { onPlay(track) }.padding(7.dp)) {
                Cover(track.cover, Modifier.fillMaxWidth().aspectRatio(1f), RoundedCornerShape(13.dp), size = 360)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TrackLabel(track.title, track.artist.ifEmpty { s.unknownArtist }, Modifier.weight(1f).padding(top = 8.dp), active)
                    RfIconButton(Icons.Rounded.MoreHoriz, "${s.trackActions} · ${track.title}", { onMenu(track) }, size = 36.dp, iconSize = 18.dp)
                }
            }
        }
    }
}

@Composable
private fun GroupGrid(groups: List<Group>, section: LibrarySection, onOpen: (String) -> Unit) {
    val s = strings
    val icon = when (section) { LibrarySection.ARTISTS -> Icons.Rounded.Person; LibrarySection.ALBUMS -> Icons.Rounded.Album; else -> Icons.AutoMirrored.Rounded.QueueMusic }
    LazyVerticalGrid(GridCells.Adaptive(122.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(groups, key = { it.id }) { g ->
            Column(Modifier.clip(RoundedCornerShape(16.dp)).clickable(role = Role.Button) { onOpen(g.id) }.padding(7.dp)) {
                Cover(g.cover, Modifier.fillMaxWidth().aspectRatio(1f), if (section == LibrarySection.ARTISTS) CircleShape else RoundedCornerShape(13.dp),
                    size = 360, placeholder = icon)
                TrackLabel(g.name, listOfNotNull(g.artist, s.songs(g.count)).joinToString(" · "), Modifier.padding(top = 8.dp))
            }
        }
    }
}

@Composable
private fun DetailHeader(detail: Group, section: LibrarySection, s: Strings, onBack: () -> Unit, onPlayAll: () -> Unit, onAddTo: () -> Unit,
                         onAddSongs: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit) {
    Column(Modifier.padding(bottom = 10.dp)) {
        RfTextButton(when (section) { LibrarySection.ARTISTS -> s.artists; LibrarySection.ALBUMS -> s.albums; else -> s.playlists }, onBack,
            icon = Icons.AutoMirrored.Rounded.ArrowBack)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(detail.cover, Modifier.size(84.dp), RoundedCornerShape(15.dp), size = 300,
                placeholder = when (section) { LibrarySection.ARTISTS -> Icons.Rounded.Person; LibrarySection.ALBUMS -> Icons.Rounded.Album; else -> Icons.AutoMirrored.Rounded.QueueMusic })
            Column(Modifier.weight(1f)) {
                Text(when (section) { LibrarySection.ARTISTS -> s.artist; LibrarySection.ALBUMS -> s.album; else -> s.playlist }.uppercase(),
                    style = RfType.Caption.copy(color = LocalAccent.current, letterSpacing = 1.sp))
                Text(detail.name, style = RfType.PageTitle.copy(fontSize = 24.sp))
                Text(listOfNotNull(detail.artist, s.songs(detail.count)).joinToString(" · "), style = RfType.Subtitle)
            }
        }
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            RfPrimaryButton(s.playAll, onPlayAll, icon = Icons.Rounded.PlayArrow, enabled = detail.tracks.isNotEmpty())
            if (section == LibrarySection.PLAYLISTS) {
                RfGhostButton(s.addSongs, onAddSongs, icon = Icons.Rounded.Add)
                RfIconButton(Icons.Rounded.Edit, s.renamePlaylist, onRename, iconSize = 17.dp)
                RfIconButton(Icons.Rounded.DeleteOutline, s.deletePlaylist, onDelete, iconSize = 18.dp)
            } else RfGhostButton(s.addToPlaylist, onAddTo, icon = Icons.AutoMirrored.Rounded.PlaylistAdd, enabled = detail.tracks.isNotEmpty())
        }
        if (detail.count > detail.tracks.size) Text(s.unavailableTracks, style = RfType.Subtitle, modifier = Modifier.padding(top = 8.dp))
    }
}

// region shared bits

@Composable
fun <T> Segmented(options: List<T>, selected: T, label: @Composable (T) -> String, modifier: Modifier = Modifier,
                  icon: ((T) -> ImageVector)? = null, labelFor: ((T) -> String)? = null, compact: Boolean = false, onSelect: (T) -> Unit) {
    Row(modifier.fieldSurface(RoundedCornerShape(14.dp)).padding(2.dp)) {
        options.forEach { option ->
            val active = option == selected
            Box(
                (if (compact) Modifier.size(44.dp) else Modifier.weight(1f).heightIn(min = 44.dp))
                    .clip(RoundedCornerShape(12.dp)).background(if (active) Color(0x24FFFFFF) else Color.Transparent)
                    .clickable(role = Role.Tab, onClickLabel = labelFor?.invoke(option)) { onSelect(option) }.padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                val text = label(option)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (icon != null) Icon(icon(option), labelFor?.invoke(option), tint = if (active) Color.White else Color(0xB3FFFFFF), modifier = Modifier.size(16.dp))
                    if (text.isNotEmpty()) Text(text, style = RfType.Caption.copy(fontSize = 12.sp, color = if (active) Color.White else Color(0xB3FFFFFF),
                        fontWeight = if (active) FontWeight.W600 else FontWeight.W500), maxLines = 1)
                }
            }
        }
    }
}

@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, onSubmit: (() -> Unit)? = null,
                trailing: @Composable () -> Unit = {}) {
    Row(modifier.heightIn(min = 44.dp).fieldSurface().padding(horizontal = 11.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(Icons.Rounded.Search, null, tint = Color(0xB3FFFFFF), modifier = Modifier.size(17.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, style = RfType.Subtitle.copy(color = Color(0xA6FFFFFF)), maxLines = 1)
            BasicTextField(value, onChange, singleLine = true, textStyle = RfType.Title.copy(fontSize = 16.sp, fontWeight = FontWeight.W400),
                cursorBrush = SolidColor(LocalAccent.current), modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = if (onSubmit != null) ImeAction.Search else ImeAction.Done),
                keyboardActions = KeyboardActions(onSearch = { onSubmit?.invoke() }))
        }
        if (value.isNotEmpty()) RfIconButton(Icons.Rounded.Close, strings.close, { onChange("") }, size = 32.dp, iconSize = 16.dp, tint = Color(0xB3FFFFFF))
        trailing()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RfSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Color(0xFF171D22), contentColor = Rf.Text,
        scrimColor = Color(0x88000000), shape = RoundedCornerShape(topStart = 23.dp, topEnd = 23.dp), dragHandle = null) {
        Column(Modifier.padding(horizontal = 15.dp).padding(top = 12.dp, bottom = 14.dp).navigationBarsPadding()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = RfType.Section.copy(fontSize = 20.sp), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                RfIconButton(Icons.Rounded.Close, strings.close, onDismiss, iconSize = 20.dp)
            }
            Spacer(Modifier.height(6.dp))
            content()
        }
    }
}

@Composable
fun SheetAction(text: String, icon: ImageVector?, onClick: () -> Unit, enabled: Boolean = true, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).clip(RoundedCornerShape(11.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        icon?.let { Icon(it, null, tint = if (enabled) Color(0xE6FFFFFF) else Color(0x8CFFFFFF), modifier = Modifier.size(20.dp)) }
        Text(text, style = RfType.Title.copy(color = if (enabled) Color(0xE6FFFFFF) else Color(0x8CFFFFFF), fontWeight = FontWeight.W500), modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
fun NameForm(initial: String, label: String, confirm: String, onSave: (String) -> Unit, onCancel: () -> Unit) {
    var name by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Text(label, style = RfType.Subtitle)
    BasicTextField(name, { if (it.length <= 80) name = it }, singleLine = true, textStyle = RfType.Title.copy(fontSize = 16.sp, fontWeight = FontWeight.W400),
        cursorBrush = SolidColor(LocalAccent.current), modifier = Modifier.padding(top = 6.dp).fillMaxWidth().heightIn(min = 44.dp)
            .fieldSurface(RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 12.dp).focusRequester(focus),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (name.isNotBlank()) onSave(name.trim()) }))
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
        RfGhostButton(strings.cancel, onCancel)
        RfPrimaryButton(confirm, { onSave(name.trim()) }, enabled = name.isNotBlank())
    }
}

// endregion

@Composable
private fun LibrarySheetHost(sheet: LibrarySheet, onDismiss: () -> Unit, onNavigate: (LibrarySheet) -> Unit, model: AppViewModel, tracks: List<Track>,
                             collections: LocalCollections, favoriteIds: Set<String>, onCreated: (String, Boolean) -> Unit, onDeleted: () -> Unit) {
    val s = strings
    val store = model.collections
    when (sheet) {
        is LibrarySheet.TrackMenu -> RfSheet(sheet.track.title, onDismiss) {
            val favorite = sheet.track.id in favoriteIds
            SheetAction(if (favorite) s.unfavorite else s.favorite, if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                { store.toggleFavorite(sheet.track.id); onDismiss() })
            SheetAction(s.playNext, Icons.AutoMirrored.Rounded.PlaylistAdd, { model.player.enqueue(sheet.track, next = true); onDismiss() })
            SheetAction(s.addToQueue, Icons.AutoMirrored.Rounded.QueueMusic, { model.player.enqueue(sheet.track, next = false); onDismiss() })
            SheetAction(s.addToPlaylist, Icons.Rounded.Add, { onNavigate(LibrarySheet.AddTo(listOf(sheet.track.id))) })
            sheet.playlistId?.let { id -> SheetAction(s.removeFromPlaylist, Icons.Rounded.DeleteOutline, { store.removeTrack(id, sheet.track.id); onDismiss() }) }
        }
        is LibrarySheet.AddTo -> RfSheet(s.addToPlaylist, onDismiss) {
            SheetAction(s.newPlaylist, Icons.Rounded.Add, { onNavigate(LibrarySheet.Create(sheet.trackIds)) })
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(collections.playlists, key = { it.id }) { p ->
                    val added = sheet.trackIds.all { it in p.trackIds }
                    SheetAction("${p.name} · ${if (added) s.added else s.songs(p.trackIds.size)}", Icons.AutoMirrored.Rounded.QueueMusic,
                        { store.addTracks(p.id, sheet.trackIds); onDismiss() }, enabled = !added) {
                        if (added) Icon(Icons.Rounded.Check, null, tint = LocalAccent.current, modifier = Modifier.size(17.dp))
                    }
                }
            }
        }
        is LibrarySheet.AddTracks -> RfSheet(s.addSongs, onDismiss) {
            val playlist = collections.playlists.firstOrNull { it.id == sheet.playlistId } ?: return@RfSheet
            val existing = remember(playlist) { playlist.trackIds.toHashSet() }
            var picked by remember { mutableStateOf(setOf<String>()) }
            var query by remember { mutableStateOf("") }
            val results = remember(query, tracks) { query.norm().let { q -> if (q.isEmpty()) tracks else tracks.filter { it.matches(q) } } }
            SearchField(query, { query = it }, s.searchSongs)
            LazyColumn(Modifier.heightIn(max = 460.dp).padding(top = 6.dp)) {
                items(results, key = { it.id }) { track ->
                    val added = track.id in existing
                    Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).clip(RoundedCornerShape(11.dp)).clickable(enabled = !added) {
                        picked = if (track.id in picked) picked - track.id else picked + track.id
                    }.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(track.cover, Modifier.size(40.dp), size = 120)
                        TrackLabel(track.title, if (added) s.added else track.artist.ifEmpty { s.unknownArtist }, Modifier.weight(1f).padding(horizontal = 10.dp))
                        Checkbox(added || track.id in picked, null, enabled = !added, colors = CheckboxDefaults.colors(checkedColor = LocalAccent.current, checkmarkColor = Color(0xFF14181D)))
                    }
                }
            }
            if (results.isEmpty()) EmptyState(if (tracks.isEmpty()) s.emptyLibrary else s.noMatches)
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.End) {
                RfPrimaryButton(s.done, { store.addTracks(playlist.id, picked.toList()); onDismiss() }, icon = Icons.Rounded.Check, enabled = picked.isNotEmpty())
            }
        }
        is LibrarySheet.Create -> RfSheet(s.newPlaylist, onDismiss) {
            NameForm("", s.playlistName, s.save, { name -> val id = store.createPlaylist(name, sheet.trackIds); onDismiss(); onCreated(id, sheet.trackIds.isEmpty()) }, onDismiss)
        }
        is LibrarySheet.Rename -> RfSheet(s.renamePlaylist, onDismiss) {
            NameForm(sheet.name, s.playlistName, s.save, { store.rename(sheet.playlistId, it); onDismiss() }, onDismiss)
        }
        is LibrarySheet.Delete -> RfSheet(s.deletePlaylist, onDismiss) {
            Text(s.deleteMessage(sheet.name), style = RfType.Subtitle.copy(fontSize = 14.sp, lineHeight = 21.sp))
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                RfGhostButton(s.cancel, onDismiss)
                RfPrimaryButton(s.deletePlaylist, { store.delete(sheet.playlistId); onDismiss(); onDeleted() }, container = Color(0xFFFECACA))
            }
        }
    }
}
