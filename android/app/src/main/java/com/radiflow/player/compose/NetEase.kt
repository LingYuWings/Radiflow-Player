package com.radiflow.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Tab order; playlists come first and are shown when the screen opens. */
private enum class OnlineTab { PLAYLISTS, SEARCH, FAVORITES }

private sealed interface OnlineSheet {
    data class TrackMenu(val track: Track) : OnlineSheet
    data object CreatePlaylist : OnlineSheet
    data class DeletePlaylist(val item: OnlineItem) : OnlineSheet
}

@Composable
fun NetEaseScreen(model: AppViewModel, nav: Navigator, state: PlayerState) {
    val s = strings
    val scope = rememberCoroutineScope()
    val session by model.session.collectAsStateWithLifecycle()
    val stack by model.browser.stack.collectAsStateWithLifecycle()
    val browseBusy by model.browser.busy.collectAsStateWithLifecycle()
    val browseError by model.browser.error.collectAsStateWithLifecycle()
    val favorites by model.onlineFavorites.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(OnlineTab.PLAYLISTS) }
    // Like the desktop library: created and followed playlists are shown separately, created first.
    var followed by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var searched by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf(SearchKind.TRACKS) }
    var result by remember { mutableStateOf<SearchResult?>(null) }
    var offset by remember { mutableIntStateOf(0) }
    var hot by remember { mutableStateOf(emptyList<String>()) }
    var playlists by remember { mutableStateOf(emptyList<OnlineItem>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<OnlineSheet?>(null) }
    val detail = stack.lastOrNull()
    val favoriteIds = remember(favorites.tracks) { favorites.tracks.mapTo(HashSet()) { it.id } }

    fun run(block: suspend () -> Unit) = scope.launch {
        busy = true; error = null
        try { block() } catch (c: CancellationException) { throw c } catch (e: Exception) { error = "${s.neteaseError} · ${e.message}" } finally { busy = false }
    }
    suspend fun refreshPlaylists() { playlists = model.api.playlists() }
    fun search(text: String, nextKind: SearchKind = kind, append: Boolean = false) {
        val value = text.trim()
        if (value.isEmpty()) return
        val from = if (append) offset else 0
        if (!append) { result = null; offset = 0; kind = nextKind }
        query = value; searched = value
        run {
            val response = model.api.search(value, nextKind, from)
            val previous = result
            result = if (!append || previous == null) response else previous.copy(total = response.total, tracks = previous.tracks + response.tracks,
                albums = previous.albums + response.albums, artists = previous.artists + response.artists)
            val received = when (nextKind) { SearchKind.TRACKS -> response.tracks.size; SearchKind.ALBUMS -> response.albums.size; SearchKind.ARTISTS -> response.artists.size }
            offset = if (received > 0) from + received else response.total
        }
    }

    LaunchedEffect(Unit) { runCatching { hot = model.api.hotSearches() } }
    LaunchedEffect(session?.isLoggedIn, session?.account?.userId) {
        if (session?.isLoggedIn == true) runCatching { refreshPlaylists() } else playlists = emptyList()
    }
    LaunchedEffect(nav.pendingOnlineAlbum) {
        nav.pendingOnlineAlbum?.let { model.browser.open(DetailKind.ALBUM, it); nav.pendingOnlineAlbum = null }
    }
    DisposableEffect(detail != null) {
        val handler: () -> Boolean = { model.browser.back() }
        if (detail != null) nav.backStack += handler
        onDispose { nav.backStack.remove(handler) }
    }

    val playTrack: (Track, List<Track>, String?) -> Unit = { track, list, source -> model.play(track.id, list, source) }
    val onMenu: (Track) -> Unit = { sheet = OnlineSheet.TrackMenu(it) }
    val onFavorite: (Track) -> Unit = { model.onlineFavorites.toggleTrack(it) }

    AnimatedContent(detail?.let { it.kind to it.item.id }, modifier = Modifier.fillMaxSize(), transitionSpec = {
        val forward = targetState != null && (initialState == null || stack.size > 1)
        (slideInHorizontally(tween(340, easing = Rf.CardEase)) { if (forward) it / 12 else -it / 16 } + fadeIn(tween(220))) togetherWith fadeOut(tween(140))
    }, label = "online") { key ->
        val current = stack.lastOrNull()?.takeIf { key != null && it.kind to it.item.id == key }
        LazyVerticalGrid(GridCells.Adaptive(125.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            if (current != null) {
                full {
                    DetailHeader(current, favorites, busy = browseBusy, onBack = { model.browser.back() },
                        onPlayAll = { current.tracks.firstOrNull()?.let { playTrack(it, current.tracks, current.source) } },
                        onRetry = { model.browser.openPlaylist(current.item.id, force = true) },
                        onToggleAlbum = { model.onlineFavorites.toggleAlbum(current.item) },
                        onDelete = { sheet = OnlineSheet.DeletePlaylist(current.item) })
                }
                trackRows(current.tracks, state, favoriteIds, { playTrack(it, current.tracks, current.source) }, onFavorite, onMenu)
                if (current.albums.isNotEmpty()) {
                    full { Text(s.albums, style = RfType.Section, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp)) }
                    itemCards(current.albums, DetailKind.ALBUM) { model.browser.open(DetailKind.ALBUM, it.id) }
                }
            } else {
                full {
                    FilterRow(OnlineTab.entries, tab, { when (it) { OnlineTab.SEARCH -> s.search; OnlineTab.PLAYLISTS -> s.playlists; OnlineTab.FAVORITES -> s.favorites } },
                        { tab = it; error = null; model.browser.clear(); if (it == OnlineTab.PLAYLISTS && session?.isLoggedIn == true) run { refreshPlaylists() } },
                        icon = { when (it) { OnlineTab.SEARCH -> Icons.Rounded.Search; OnlineTab.PLAYLISTS -> Icons.AutoMirrored.Rounded.QueueMusic; OnlineTab.FAVORITES -> Icons.Rounded.Favorite } })
                }
                when (tab) {
                    OnlineTab.SEARCH -> {
                        full {
                            SearchField(query, { query = it }, s.searchNetEase, Modifier.padding(vertical = 8.dp), onSubmit = { search(query) }) {
                                RfTextButton(s.search, { search(query) }, enabled = !busy && query.isNotBlank(), color = LocalAccent.current)
                            }
                        }
                        if (searched.isNotEmpty()) {
                            full {
                                FilterRow(SearchKind.entries, kind, { when (it) { SearchKind.TRACKS -> s.songsTab; SearchKind.ALBUMS -> s.albums; SearchKind.ARTISTS -> s.artists } },
                                    { search(searched, it) })
                            }
                            val r = result
                            when (kind) {
                                SearchKind.TRACKS -> trackRows(r?.tracks.orEmpty(), state, favoriteIds, { playTrack(it, r!!.tracks, null) }, onFavorite, onMenu)
                                SearchKind.ALBUMS -> itemCards(r?.albums.orEmpty(), DetailKind.ALBUM) { model.browser.open(DetailKind.ALBUM, it.id) }
                                SearchKind.ARTISTS -> itemCards(r?.artists.orEmpty(), DetailKind.ARTIST) { model.browser.open(DetailKind.ARTIST, it.id) }
                            }
                            if (r != null && r.total == 0) full { EmptyState(s.nothing) }
                            if (r != null && offset < r.total) full { RfTextButton(s.loadMore, { search(searched, kind, append = true) }, enabled = !busy) }
                        } else if (hot.isNotEmpty()) {
                            full {
                                Column {
                                    Text(s.trending, style = RfType.Section, modifier = Modifier.padding(top = 10.dp, bottom = 8.dp))
                                    HotChips(hot) { search(it, SearchKind.TRACKS) }
                                }
                            }
                        }
                    }
                    OnlineTab.PLAYLISTS -> if (session == null) {
                        full { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), color = LocalAccent.current, strokeWidth = 2.dp) } }
                    } else if (session?.isLoggedIn == true) {
                        val created = playlists.filter { it.category != "followed" }
                        val following = playlists.filter { it.category == "followed" }
                        full {
                            Column {
                                Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(session?.account?.nickname.orEmpty(), style = RfType.Title, modifier = Modifier.weight(1f))
                                    if (!followed) RfTextButton(s.newPlaylist, { sheet = OnlineSheet.CreatePlaylist }, icon = Icons.Rounded.Add)
                                }
                                Segmented(listOf(false, true), followed,
                                    { if (it) "${s.followedPlaylists} · ${following.size}" else "${s.createdPlaylists} · ${created.size}" },
                                    Modifier.fillMaxWidth().padding(bottom = 8.dp),
                                    icon = { if (it) Icons.Rounded.Album else Icons.Rounded.Person }) { followed = it }
                            }
                        }
                        val shown = if (followed) following else created
                        if (shown.isEmpty() && playlists.isNotEmpty()) full { EmptyState(if (followed) s.noFollowedPlaylists else s.noCreatedPlaylists) }
                        itemCards(shown, DetailKind.PLAYLIST) { model.browser.open(DetailKind.PLAYLIST, it.id) }
                    } else full { EmptyState(s.signInHint) }
                    OnlineTab.FAVORITES -> {
                        if (favorites.tracks.isEmpty() && favorites.albums.isEmpty()) full { EmptyState(s.emptyOnlineFavorites) }
                        trackRows(favorites.tracks, state, favoriteIds, { playTrack(it, favorites.tracks, null) }, onFavorite, onMenu)
                        itemCards(favorites.albums, DetailKind.ALBUM) { model.browser.open(DetailKind.ALBUM, it.id) }
                    }
                }
            }
            if (busy || browseBusy) full { Box(Modifier.fillMaxWidth().padding(14.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = LocalAccent.current, strokeWidth = 2.dp) } }
            (error ?: browseError?.let { "${s.neteaseError} · $it" })?.let { full { InlineError(it) } }
        }
    }

    sheet?.let { current ->
        val dismiss = { sheet = null }
        when (current) {
            is OnlineSheet.TrackMenu -> RfSheet(current.track.title, dismiss) {
                SheetAction(s.playNext, Icons.AutoMirrored.Rounded.PlaylistAdd, { model.player.enqueue(current.track, true); dismiss() })
                SheetAction(s.addToQueue, Icons.AutoMirrored.Rounded.QueueMusic, { model.player.enqueue(current.track, false); dismiss() })
                val editable = detail?.takeIf { it.editable }
                if (editable != null) SheetAction(s.removeFromPlaylist, Icons.Rounded.DeleteOutline, {
                    run {
                        model.api.editPlaylist(editable.item.id, add = false, current.track.id)
                        model.browser.invalidate(editable.item.id); model.browser.openPlaylist(editable.item.id, force = true); refreshPlaylists()
                    }; dismiss()
                })
                if (session?.isLoggedIn == true) {
                    Text(s.addToNetEase, style = RfType.Subtitle, modifier = Modifier.padding(start = 10.dp, top = 10.dp, bottom = 4.dp))
                    androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 300.dp)) {
                        items(playlists.filter { it.category == "created" }.size) { index ->
                            val p = playlists.filter { it.category == "created" }[index]
                            SheetAction(p.name, Icons.AutoMirrored.Rounded.QueueMusic, {
                                run { model.api.editPlaylist(p.id, add = true, current.track.id); model.browser.invalidate(p.id); refreshPlaylists() }
                                dismiss()
                            })
                        }
                    }
                }
            }
            OnlineSheet.CreatePlaylist -> RfSheet(s.newPlaylist, dismiss) {
                NameForm("", s.playlistName, s.create, { name -> run { model.api.createPlaylist(name); refreshPlaylists() }; dismiss() }, dismiss)
            }
            is OnlineSheet.DeletePlaylist -> RfSheet(s.deletePlaylist, dismiss) {
                Text("${s.deletePlaylist} · ${current.item.name}?", style = RfType.Subtitle.copy(fontSize = 14.sp))
                Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                    RfGhostButton(s.cancel, dismiss)
                    RfPrimaryButton(s.deletePlaylist, {
                        run { model.api.deletePlaylist(current.item.id); model.browser.invalidate(current.item.id); model.browser.clear(); refreshPlaylists() }
                        dismiss()
                    }, container = Color(0xFFFECACA))
                }
            }
        }
    }
}

private fun LazyGridScope.full(content: @Composable () -> Unit) = item(span = { GridItemSpan(maxLineSpan) }) { content() }

private fun LazyGridScope.trackRows(tracks: List<Track>, state: PlayerState, favorites: Set<String>, onPlay: (Track) -> Unit,
                                    onFavorite: (Track) -> Unit, onMenu: (Track) -> Unit) {
    items(tracks, key = { "t:" + it.id }, span = { GridItemSpan(maxLineSpan) }, contentType = { "track" }) { track ->
        val s = strings
        val favorite = track.id in favorites
        TrackRow(track, track.id == state.track?.id, { onPlay(track) }) {
            RowIconButton(if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, "${s.favorites} · ${track.title}",
                { onFavorite(track) }, selected = favorite)
            RowIconButton(Icons.Rounded.MoreHoriz, "${s.trackActions} · ${track.title}", { onMenu(track) }, iconSize = 20.dp)
        }
    }
}

private fun LazyGridScope.itemCards(items: List<OnlineItem>, kind: DetailKind, onOpen: (OnlineItem) -> Unit) {
    items(items, key = { "${kind.name}:${it.id}" }, contentType = { "card" }) { item ->
        Column(Modifier.padding(vertical = 4.5.dp).clip(RoundedCornerShape(14.dp)).border(1.dp, Color(0x16FFFFFF), RoundedCornerShape(14.dp))
            .clickable(role = Role.Button) { onOpen(item) }.padding(8.dp)) {
            Cover(item.cover, Modifier.fillMaxWidth().aspectRatio(1f), if (kind == DetailKind.ARTIST) CircleShape else RoundedCornerShape(10.dp), size = 360,
                placeholder = when (kind) { DetailKind.ARTIST -> Icons.Rounded.Person; DetailKind.ALBUM -> Icons.Rounded.Album; else -> Icons.AutoMirrored.Rounded.QueueMusic })
            Text(item.name, style = RfType.Title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 7.dp))
            (item.artist ?: item.subtitle ?: item.trackCount?.let { strings.songs(it) })?.let {
                Text(it, style = RfType.Subtitle.copy(fontSize = 12.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HotChips(items: List<String>, onClick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        items.forEach { text ->
            Box(Modifier.heightIn(min = 39.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x0BFFFFFF)).border(1.dp, Color(0x17FFFFFF), RoundedCornerShape(12.dp))
                .clickable { onClick(text) }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                Text(text, style = RfType.Subtitle.copy(color = Rf.Text))
            }
        }
    }
}

@Composable
private fun DetailHeader(detail: BrowseDetail, favorites: OnlineFavorites, busy: Boolean, onBack: () -> Unit, onPlayAll: () -> Unit,
                         onRetry: () -> Unit, onToggleAlbum: () -> Unit, onDelete: () -> Unit) {
    val s = strings
    Column(Modifier.padding(bottom = 6.dp)) {
        RfTextButton(s.back, onBack, icon = Icons.AutoMirrored.Rounded.ArrowBack)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(detail.item.cover, Modifier.size(110.dp), if (detail.kind == DetailKind.ARTIST) CircleShape else RoundedCornerShape(14.dp), size = 360)
            Column(Modifier.weight(1f)) {
                Text(detail.item.name, style = RfType.PageTitle.copy(fontSize = 24.sp), maxLines = 3, overflow = TextOverflow.Ellipsis)
                (detail.item.artist ?: detail.item.subtitle)?.let { Text(it, style = RfType.Subtitle.copy(fontSize = 12.sp)) }
                if (detail.partial && detail.total != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 4.dp)) {
                    if (detail.loading) CircularProgressIndicator(Modifier.size(12.dp), color = LocalAccent.current, strokeWidth = 1.5.dp)
                    Text(s.loaded(detail.tracks.size, detail.total), style = RfType.Mono.copy(fontSize = 12.sp))
                }
            }
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
            if (detail.tracks.isNotEmpty()) RfPrimaryButton(s.playAll, onPlayAll, icon = Icons.Rounded.PlayArrow)
            if (detail.kind == DetailKind.PLAYLIST && detail.partial && !detail.loading) RfTextButton(s.loadRest, onRetry, icon = Icons.Rounded.Refresh, enabled = !busy)
            if (detail.kind == DetailKind.ALBUM) {
                val saved = favorites.albums.any { it.id == detail.item.id }
                RfIconButton(if (saved) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, s.favorites, onToggleAlbum, selected = saved, iconSize = 19.dp)
            }
            if (detail.editable) RfIconButton(Icons.Rounded.DeleteOutline, s.deletePlaylist, onDelete, iconSize = 18.dp)
        }
    }
}
