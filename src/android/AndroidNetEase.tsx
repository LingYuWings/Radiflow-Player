import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Heart, ListMusic, LoaderCircle, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import type { AppLanguage } from '../lib/copy';
import { Cover } from './AndroidPlayer';
import { netease, toOnlineTracks, type OnlineCollection, type OnlineItem, type OnlinePlaylist, type OnlineSession, type OnlineSong } from './netease';
import type { AndroidTrack } from './playback';

export interface AndroidNetEaseHandle {
  handleBack(): boolean;
  openAlbum(id: string): void;
}

interface Props {
  active: boolean; activeId: string | null; language: AppLanguage;
  session: OnlineSession | null;
  onPlay: (id: string, queue: AndroidTrack[]) => void;
  onEnqueue: (track: AndroidTrack, next?: boolean) => void;
}

interface BrowseDetail extends OnlineItem {
  kind: 'playlist' | 'album' | 'artist';
  tracks: AndroidTrack[];
  albums?: OnlineItem[];
  nextOffset?: number | null;
  editable?: boolean;
}
type Result = { songs?: OnlineSong[]; artists?: OnlineItem[]; albums?: OnlineItem[]; total: number };

const favoritesKey = 'radiflow-android.netease.favorites';
const english = {
  search: 'Search', searchSongs: 'Search NetEase Music', tracks: 'Songs', albums: 'Albums', artists: 'Artists',
  playlists: 'Playlists', favorites: 'Favorites', nothing: 'No results', back: 'Back', more: 'Load more',
  trending: 'Trending searches', signInHint: 'Sign in to NetEase from Settings to see your playlists.',
  close: 'Close', create: 'New playlist', name: 'Playlist name', save: 'Create', delete: 'Delete playlist',
  add: 'Add to NetEase playlist', playNext: 'Play next', enqueue: 'Add to queue', remove: 'Remove from playlist',
  playAll: 'Play all', actions: 'Song actions', error: 'NetEase request failed', emptyFavorites: 'No saved songs or albums',
};
const chinese = {
  search: '搜索', searchSongs: '搜索网易云音乐', tracks: '歌曲', albums: '专辑', artists: '歌手',
  playlists: '歌单', favorites: '收藏', nothing: '没有找到结果', back: '返回', more: '加载更多',
  trending: '热搜', signInHint: '在设置中登录网易云后，即可查看你的歌单。',
  close: '关闭', create: '新建歌单', name: '歌单名称', save: '创建', delete: '删除歌单',
  add: '添加到网易云歌单', playNext: '下一首播放', enqueue: '加入队列', remove: '从歌单移除',
  playAll: '播放全部', actions: '歌曲操作', error: '网易云请求失败', emptyFavorites: '还没有歌曲或专辑收藏',
};

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(favoritesKey) || 'null');
    return { tracks: Array.isArray(value?.tracks) ? value.tracks as AndroidTrack[] : [], albums: Array.isArray(value?.albums) ? value.albums as OnlineItem[] : [] };
  } catch {
    return { tracks: [] as AndroidTrack[], albums: [] as OnlineItem[] };
  }
}

export const AndroidNetEase = forwardRef<AndroidNetEaseHandle, Props>(function AndroidNetEase({ active, activeId, language, session, onPlay, onEnqueue }, ref) {
  const copy = language === 'zh-CN' ? chinese : english;
  const [tab, setTab] = useState<'search' | 'playlists' | 'favorites'>('search');
  const [kind, setKind] = useState<'tracks' | 'albums' | 'artists'>('tracks');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [offset, setOffset] = useState(0);
  const [hot, setHot] = useState<OnlineItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [playlists, setPlaylists] = useState<OnlinePlaylist[]>([]);
  const [details, setDetails] = useState<BrowseDetail[]>([]);
  const [favorites, setFavorites] = useState(readFavorites);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<AndroidTrack | null>(null);
  const [create, setCreate] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const detail = details.at(-1);
  const hasModal = !!menu || create;

  const showError = (cause: unknown) => setError(copy.error + (cause instanceof Error ? ' · ' + cause.message : ''));
  const refreshPlaylists = async () => {
    const response = await netease<{ playlists: OnlinePlaylist[] }>('/api/netease/playlists');
    setPlaylists(response.playlists);
  };

  useEffect(() => {
    if (!active || initialized) return;
    setInitialized(true);
    void netease<{items: OnlineItem[]}>('/api/netease/search/hot/detail').then(response => setHot(response.items.slice(0, 8))).catch(() => {});
  }, [active, initialized]);

  useEffect(() => {
    if (!session?.isLoggedIn) {
      setPlaylists([]);
      setDetails(items => items.filter(item => item.kind !== 'playlist'));
    } else if (active) void refreshPlaylists().catch(showError);
  }, [active, session?.isLoggedIn, session?.account?.userId]);

  useEffect(() => {
    const dialog = modal.current;
    if (hasModal && active && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [hasModal, active]);

  const closeModal = () => { setMenu(null); setCreate(false); };
  const back = () => {
    if (hasModal) { closeModal(); return true; }
    if (!details.length) return false;
    request.current++;
    setBusy(false);
    setError('');
    setDetails(items => items.slice(0, -1));
    return true;
  };

  const runBrowse = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) { showError(cause); } finally { setBusy(false); }
  };

  const search = async (text: string, nextKind = kind, append = false) => {
    const value = text.trim();
    if (!value) return;
    const previousOffset = append ? offset : 0;
    const requestId = ++request.current;
    setBusy(true);
    setError('');
    if (!append) { setResult(null); setOffset(0); setKind(nextKind); }
    setQuery(value);
    setSearched(value);
    try {
      const params = new URLSearchParams({ keywords: value, type: String({ tracks: 1, albums: 10, artists: 100 }[nextKind]), limit: '30', offset: String(previousOffset) });
      const response = await netease<Result>('/api/netease/search?' + params);
      if (request.current !== requestId) return;
      setResult(current => !append ? response : {
        total: response.total,
        songs: [...(current?.songs ?? []), ...(response.songs ?? [])],
        albums: [...(current?.albums ?? []), ...(response.albums ?? [])],
        artists: [...(current?.artists ?? []), ...(response.artists ?? [])],
      });
      const received = (nextKind === 'tracks' ? response.songs : response[nextKind])?.length ?? 0;
      setOffset(received ? previousOffset + received : response.total);
    } catch (cause) {
      if (request.current === requestId) showError(cause);
    } finally {
      if (request.current === requestId) setBusy(false);
    }
  };

  const openDetail = async (id: string, detailKind: BrowseDetail['kind'], page?: number) => {
    if (!/^\d+$/.test(id)) return;
    const requestId = ++request.current;
    setBusy(true);
    setError('');
    try {
      const root = '/api/netease/' + detailKind + '/' + id;
      if (detailKind === 'playlist') {
        const response = await netease<{ playlist?: OnlinePlaylist; songs: OnlineSong[]; nextOffset: number | null }>(
          root + '?offset=' + (page ?? 0) + '&limit=150',
        );
        if (request.current !== requestId) return;
        const tracks = toOnlineTracks(response.songs);
        if (page !== undefined) {
          setDetails(stack => {
            const last = stack.at(-1);
            if (last?.id !== id) return stack;
            const combined = [...new Map([...last.tracks, ...tracks].map(track => [track.id, track])).values()];
            return [...stack.slice(0, -1), { ...last, tracks: combined, nextOffset: response.nextOffset }];
          });
        } else if (response.playlist) {
          const data = { ...response.playlist, kind: detailKind, tracks, nextOffset: response.nextOffset, editable: response.playlist.category === 'created' };
          setDetails(stack => stack.at(-1)?.id === id && stack.at(-1)?.kind === 'playlist'
            ? [...stack.slice(0, -1), data] : [...stack, data]);
        }
      } else {
        const { collection } = await netease<{ collection: OnlineCollection }>(root);
        if (request.current === requestId) setDetails(stack => [...stack, { ...collection, kind: detailKind, tracks: toOnlineTracks(collection.songs) }]);
      }
    } catch (cause) {
      if (request.current === requestId) showError(cause);
    } finally {
      if (request.current === requestId) setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    handleBack: back,
    openAlbum: id => { void openDetail(id, 'album'); },
  }));

  const saveFavorites = (next: ReturnType<typeof readFavorites>) => {
    try {
      localStorage.setItem(favoritesKey, JSON.stringify(next));
      setFavorites(next);
    } catch (cause) { showError(cause); }
  };
  const toggleTrack = (track: AndroidTrack) => saveFavorites({
    ...favorites, tracks: favorites.tracks.some(item => item.id === track.id)
      ? favorites.tracks.filter(item => item.id !== track.id) : [...favorites.tracks, track],
  });
  const toggleAlbum = (album: OnlineItem) => saveFavorites({
    ...favorites, albums: favorites.albums.some(item => item.id === album.id)
      ? favorites.albums.filter(item => item.id !== album.id)
      : [...favorites.albums, { id: album.id, name: album.name, cover: album.cover, artist: album.artist }],
  });

  const tracksView = (tracks: AndroidTrack[]) => <ul className="rf-mobile-online-tracks">
    {tracks.map(track => <li key={track.id} className={track.id === activeId ? 'rf-queue-row-active' : ''}>
      <button type="button" className="rf-mobile-track" aria-current={track.id === activeId || undefined} onClick={() => onPlay(track.id, tracks)}>
        <Cover track={track} className="rf-mobile-track-icon" />
        <span className="rf-mobile-track-label"><strong>{track.title}</strong><span>{track.artist}{track.album ? ' · ' + track.album : ''}</span></span>
      </button>
      <button type="button" className="rf-mobile-icon-button" aria-label={copy.favorites + ' · ' + track.title}
        aria-pressed={favorites.tracks.some(item => item.id === track.id)} onClick={() => toggleTrack(track)}><Heart size={18} /></button>
      <button type="button" className="rf-mobile-icon-button" aria-label={copy.actions + ' · ' + track.title} onClick={() => setMenu(track)}><MoreHorizontal size={20} /></button>
    </li>)}
  </ul>;

  const itemsView = (items: OnlineItem[], itemKind: BrowseDetail['kind']) => <ul className={'rf-mobile-online-items rf-mobile-items-' + itemKind}>
    {[...new Map(items.map(item => [item.id, item])).values()].map(item => <li key={item.id}>
      <button type="button" className="home-glass-card" onClick={() => void openDetail(item.id, itemKind)}>
        <Cover track={{ cover: item.cover, title: item.name }} /><strong>{item.name}</strong>
        {(item.artist || item.subtitle) && <span>{item.artist || item.subtitle}</span>}
      </button>
    </li>)}
  </ul>;

  const switchTab = (value: typeof tab) => {
    request.current++;
    setBusy(false);
    setError('');
    setDetails([]);
    setTab(value);
    if (value === 'playlists' && session?.isLoggedIn) void runBrowse(refreshPlaylists);
  };

  const updatePlaylist = async (playlistId: string, operation: 'add' | 'del', id: string) => {
    await netease('/api/netease/playlists/' + playlistId + '/tracks', 'POST', { op: operation, trackIds: [id.slice(8)] });
    closeModal();
    if (detail?.id === playlistId && detail.kind === 'playlist') await openDetail(playlistId, 'playlist');
    await refreshPlaylists();
  };

  const playCollection = async (collection: BrowseDetail) => {
    if (!collection.tracks.length) return;
    if (collection.kind !== 'playlist' || collection.nextOffset == null) {
      onPlay(collection.tracks[0].id, collection.tracks);
      return;
    }
    const requestId = ++request.current;
    setBusy(true);
    setError('');
    const tracks = new Map(collection.tracks.map(track => [track.id, track]));
    let nextOffset = collection.nextOffset;
    try {
      while (nextOffset != null && tracks.size < 5000) {
        const response = await netease<{ songs: OnlineSong[]; nextOffset: number | null }>(
          '/api/netease/playlist/' + collection.id + '?offset=' + nextOffset + '&limit=400',
        );
        if (request.current !== requestId) return;
        for (const track of toOnlineTracks(response.songs)) {
          if (tracks.size >= 5000) break;
          tracks.set(track.id, track);
        }
        nextOffset = response.nextOffset != null && response.nextOffset > nextOffset ? response.nextOffset : null;
      }
      const loaded = [...tracks.values()];
      if (tracks.size < 5000) {
        setDetails(stack => [...stack.slice(0, -1), { ...collection, tracks: loaded, nextOffset }]);
      }
      onPlay(collection.tracks[0].id, loaded);
    } catch (cause) {
      if (request.current === requestId) showError(cause);
    } finally {
      if (request.current === requestId) setBusy(false);
    }
  };

  const songs = toOnlineTracks(result?.songs);
  return <div className="rf-mobile-netease">
    {detail ? <div className="rf-mobile-detail" key={detail.id}>
      <button className="rf-mobile-text-button" type="button" onClick={back}><ArrowLeft size={18} />{copy.back}</button>
      <header className="rf-mobile-detail-header"><Cover track={{ cover: detail.cover, title: detail.name }} />
        <div><h2>{detail.name}</h2><p>{detail.artist || detail.subtitle}</p></div></header>
      <div className="rf-mobile-header-actions">
        {detail.tracks.length > 0 && <button className="rf-primary-button" type="button" disabled={busy}
          onClick={() => void playCollection(detail)}>{copy.playAll}</button>}
        {detail.kind === 'album' && <button className="rf-mobile-icon-button" type="button" aria-label={copy.favorites}
          aria-pressed={favorites.albums.some(album => album.id === detail.id)} onClick={() => toggleAlbum(detail)}><Heart size={19} /></button>}
        {detail.editable && <button type="button" className="rf-mobile-icon-button" aria-label={copy.delete} onClick={() => {
          if (confirm(copy.delete + ' · ' + detail.name + '?')) void runBrowse(async () => {
            await netease('/api/netease/playlists/' + detail.id, 'DELETE');
            setDetails([]);
            await refreshPlaylists();
          });
        }}><Trash2 size={18} /></button>}
      </div>
      {tracksView(detail.tracks)}
      {!!detail.albums?.length && <><h2>{copy.albums}</h2>{itemsView(detail.albums, 'album')}</>}
      {detail.nextOffset != null && <button className="rf-mobile-text-button" type="button" disabled={busy}
        onClick={() => void openDetail(detail.id, 'playlist', detail.nextOffset)}>{copy.more}<ChevronRight size={18} /></button>}
    </div> : <>
      <div className="rf-mobile-filter">
        <button type="button" aria-pressed={tab === 'search'} onClick={() => switchTab('search')}><Search size={16} />{copy.search}</button>
        <button type="button" aria-pressed={tab === 'playlists'} onClick={() => switchTab('playlists')}><ListMusic size={16} />{copy.playlists}</button>
        <button type="button" aria-pressed={tab === 'favorites'} onClick={() => switchTab('favorites')}><Heart size={16} />{copy.favorites}</button>
      </div>
      {tab === 'search' && <>
        <form className="rf-mobile-search rf-mobile-online-search" onSubmit={event => { event.preventDefault(); void search(query); }}>
          <Search size={18} /><input type="search" aria-label={copy.searchSongs} placeholder={copy.searchSongs} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
          <button type="submit" disabled={busy || !query.trim()}>{copy.search}</button>
        </form>
        {searched ? <>
          <div className="rf-mobile-filter">
            {(['tracks', 'albums', 'artists'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value}
              onClick={() => void search(searched, value)}>{copy[value]}</button>)}
          </div>
          {kind === 'tracks' ? tracksView(songs) : itemsView(result?.[kind] || [], kind === 'albums' ? 'album' : 'artist')}
          {result && !result.total && <p className="rf-mobile-empty">{copy.nothing}</p>}
          {result && offset < result.total && <button type="button" className="rf-mobile-text-button" disabled={busy}
            onClick={() => void search(searched, kind, true)}>{copy.more}</button>}
        </> : !!hot.length && <section className="rf-mobile-hot"><h2>{copy.trending}</h2>
          <div>{hot.map(item => <button key={item.id} type="button" onClick={() => void search(item.name, 'tracks')}>{item.name}</button>)}</div>
        </section>}
      </>}
      {tab === 'playlists' && <section className="rf-mobile-account">
        {session?.isLoggedIn ? <>
          <div className="rf-mobile-account-row"><strong>{session.account?.nickname}</strong></div>
          <button type="button" className="rf-mobile-text-button" onClick={() => setCreate(true)}><Plus size={18} />{copy.create}</button>
          {itemsView(playlists, 'playlist')}
        </> : <p className="rf-mobile-empty">{copy.signInHint}</p>}
      </section>}
      {tab === 'favorites' && <>
        {!favorites.tracks.length && !favorites.albums.length && <p className="rf-mobile-empty">{copy.emptyFavorites}</p>}
        {tracksView(favorites.tracks)}{itemsView(favorites.albums, 'album')}
      </>}
    </>}
    {busy && <div className="rf-mobile-online-busy" role="status" aria-label={copy.search}><LoaderCircle className="rf-mobile-loading" /></div>}
    {error && <p className="rf-mobile-inline-error" role="alert">{error}</p>}

    <dialog ref={modal} className="rf-mobile-dialog rf-glass" onCancel={event => { event.preventDefault(); closeModal(); }}>
      <header><h2>{create ? copy.create : menu?.title}</h2>
        <button type="button" className="rf-mobile-icon-button" aria-label={copy.close} onClick={closeModal}><X size={20} /></button>
      </header>
      {create && <form className="rf-mobile-playlist-form" onSubmit={event => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get('name') || '').trim();
        if (name) void runBrowse(async () => {
          await netease('/api/netease/playlists', 'POST', { name });
          closeModal();
          await refreshPlaylists();
        });
      }}>
        <input name="name" aria-label={copy.name} placeholder={copy.name} maxLength={60} required />
        <button type="submit" className="rf-primary-button" disabled={busy}>{copy.save}</button>
      </form>}
      {menu && <div className="rf-mobile-menu-list">
        <button type="button" onClick={() => { onEnqueue(menu, true); closeModal(); }}>{copy.playNext}</button>
        <button type="button" onClick={() => { onEnqueue(menu); closeModal(); }}>{copy.enqueue}</button>
        {detail?.editable && <button type="button" disabled={busy} onClick={() => void runBrowse(() => updatePlaylist(detail.id, 'del', menu.id))}>{copy.remove}</button>}
        {session?.isLoggedIn && <label>{copy.add}<select value="" disabled={busy} onChange={event => {
          const playlistId = event.target.value;
          if (playlistId) void runBrowse(() => updatePlaylist(playlistId, 'add', menu.id));
        }}>
          <option value="" disabled>{copy.playlists}</option>
          {playlists.filter(playlist => playlist.category === 'created').map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
        </select></label>}
      </div>}
      {hasModal && error && <p className="rf-mobile-inline-error" role="alert">{error}</p>}
    </dialog>
  </div>;
});
