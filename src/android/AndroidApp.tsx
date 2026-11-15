import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Cloud, LibraryBig, Settings2, X } from 'lucide-react';
import { AppLogo } from '../components/AppLogo';
import { Background } from '../components/Background';
import { PlaybackErrorDialog } from '../components/PlaybackErrorDialog';
import { APP_COPY } from '../lib/copy';
import { animatePageArrival, pageMotion } from '../lib/pageMotion';
import { AndroidClock } from './AndroidClock';
import { AndroidLibrary, type AndroidLibraryHandle } from './AndroidLibrary';
import { AndroidNetEase, type AndroidNetEaseHandle } from './AndroidNetEase';
import { AndroidNetEaseAccount, type NetEaseAccountHandle } from './AndroidNetEaseAccount';
import { AndroidDock, AndroidPlayer, type PlayerPanel } from './AndroidPlayer';
import { AndroidSettings } from './AndroidSettings';
import { artworkUrl, readAppearance, writeAppearance, type AndroidAppearance } from './appearance';
import { loadTrackLyrics, netease, type OnlineSession } from './netease';
import { androidPlayback, emptyAndroidPlayback, type AndroidPlaybackState, type AndroidTrack } from './playback';
import { parseLRC, type LyricLine } from '../utils/lyricsParser';
import './android.css';

type Section = 'library' | 'netease' | 'settings';
type QueueEdit = Parameters<typeof androidPlayback.editQueue>[0];
type Configuration = Parameters<typeof androidPlayback.configurePlayback>[0];
type Resume = { id: string; queue: AndroidTrack[]; position: number; playing?: boolean };

const native = Capacitor.isNativePlatform();
const resumeKey = 'radiflow-android.last-playback';
const configurationKey = 'radiflow-android.playback-settings';
const manualKey = (id: string) => 'radiflow-android.lyrics:' + id;

function loadResume(): Resume | null {
  try {
    const stored = JSON.parse(localStorage.getItem(resumeKey) || 'null') as Resume | null;
    if (!stored || typeof stored.id !== 'string' || !Array.isArray(stored.queue) ||
      !Number.isFinite(stored.position) || !stored.queue.some(track => track?.id === stored.id)) return null;
    return stored;
  } catch {
    return null;
  }
}

function storeResume(value: Resume | null) {
  try {
    if (value) localStorage.setItem(resumeKey, JSON.stringify(value));
    else localStorage.removeItem(resumeKey);
  } catch {
    // Running out of local storage does not interrupt playback.
  }
}

const headingIcon = { library: LibraryBig, netease: Cloud, settings: Settings2 };
const LibraryScreen = memo(AndroidLibrary);
const NetEaseScreen = memo(AndroidNetEase);

function loadConfiguration(): Configuration | null {
  try {
    const stored = JSON.parse(localStorage.getItem(configurationKey) || 'null') as Configuration | null;
    if (!stored) return null;
    return {
      shuffle: typeof stored.shuffle === 'boolean' ? stored.shuffle : undefined,
      repeat: stored.repeat === 'all' || stored.repeat === 'one' || stored.repeat === 'off' ? stored.repeat : undefined,
      volume: Number.isFinite(stored.volume) ? stored.volume : undefined,
      eqEnabled: typeof stored.eqEnabled === 'boolean' ? stored.eqEnabled : undefined,
      eqGains: stored.eqGains?.length === 10 && stored.eqGains.every(Number.isFinite) ? stored.eqGains : undefined,
    };
  } catch {
    return null;
  }
}

export function AndroidApp() {
  const [appearance, setAppearance] = useState(readAppearance);
  const [tracks, setTracks] = useState<AndroidTrack[]>([]);
  const [playback, setPlayback] = useState(emptyAndroidPlayback);
  const [section, setSection] = useState<Section>('library');
  const [panel, setPanel] = useState<PlayerPanel | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Resume | null>(null);
  const [lyricData, setLyricData] = useState<{ id: string; lines: LyricLine[] } | null>(null);
  const [localLyricRevision, setLocalLyricRevision] = useState(0);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);
  const lyricCache = useRef(new Map<string, LyricLine[]>());
  const nativeClock = useRef<AndroidClock>(null);
  nativeClock.current ??= new AndroidClock();
  const library = useRef<AndroidLibraryHandle>(null);
  const online = useRef<AndroidNetEaseHandle>(null);
  const account = useRef<NetEaseAccountHandle>(null);
  const surface = useRef<HTMLElement>(null);
  const backAction = useRef<() => void>(null);
  const lastPersist = useRef(0);
  const playbackRef = useRef(playback);
  const ready = useRef(false);
  const lyricPicker = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const chinese = appearance.language === 'zh-CN';
  const labels = {
    library: chinese ? '本地曲库' : 'Library',
    netease: chinese ? '网易云音乐' : 'NetEase',
    settings: APP_COPY[appearance.language].settings.title,
  };

  const queue = playback.queue ?? playback.onlineQueue ?? tracks;
  const active = queue.find(track => track.id === playback.trackId);
  const error = playback.error;
  const errorKey = error ? JSON.stringify([playback.trackId, error.code]) : null;
  const lyrics = lyricData && lyricData.id === active?.id ? lyricData.lines : [];

  const report = (reason: unknown) => setToast(
    reason instanceof Error && reason.message ? reason.message : chinese ? '操作失败，请重试。' : 'Something went wrong. Try again.',
  );
  const acceptPlayback = (state: AndroidPlaybackState) => {
    playbackRef.current = state;
    nativeClock.current.update(state);
    setPlayback(state);
  };
  const snapshot = (state: AndroidPlaybackState): Resume | null => {
    const items = state.queue ?? state.onlineQueue;
    return state.trackId && items?.length
      ? { id: state.trackId, queue: items, position: state.position, playing: state.playing }
      : null;
  };

  useEffect(() => {
    if (!native) return;
    let alive = true;
    const listener = androidPlayback.addListener('playbackChanged', state => {
      if (alive) acceptPlayback(state);
    });
    void listener.catch(reason => { if (alive) report(reason); });
    void androidPlayback.library().then(({ tracks }) => { if (alive) setTracks(tracks); })
      .catch(reason => { if (alive) report(reason); });
    const initialize = async () => {
      const initial = await androidPlayback.state();
      if (!alive) return;
      const config = !initial.trackId ? loadConfiguration() : null;
      const state = config ? await androidPlayback.configurePlayback(config) : initial;
      if (!alive) return;
      acceptPlayback(state);
      const resume = loadResume();
      if (!state.trackId && resume) {
        const restored = await androidPlayback.playTracks({ ...resume, autoplay: false });
        if (alive) acceptPlayback(restored);
      }
      if (alive) ready.current = true;
    };
    void initialize().catch(reason => {
      if (alive) { ready.current = true; report(reason); }
    });
    return () => {
      alive = false;
      void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!native) return;
    let alive = true;
    let sampling = false;
    const save = () => {
      if (!ready.current) return;
      const next = snapshot(playbackRef.current);
      if (next) storeResume(next);
    };
    const refresh = async () => {
      if (document.hidden || sampling) return;
      sampling = true;
      const baseline = playbackRef.current;
      try {
        const state = await androidPlayback.state({ includeQueue: false });
        if (alive && playbackRef.current === baseline) {
          const { queue, onlineQueue } = baseline;
          acceptPlayback({ ...state, queue, onlineQueue });
          if (Date.now() - lastPersist.current > 2500) {
            save();
            lastPersist.current = Date.now();
          }
        }
      } catch {
        // Commands and the connection listener report failures.
      } finally {
        sampling = false;
      }
    };
    const visible = () => { if (document.hidden) save(); else void refresh(); };
    const timer = window.setInterval(refresh, panel && appearance.visualizer !== 'off' ? 66 : 375);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [panel, appearance.visualizer]);

  useEffect(() => {
    if (!native) return;
    const listener = NativeApp.addListener('backButton', () => backAction.current?.());
    void listener.catch(report);
    return () => { void listener.then(handle => handle.remove()).catch(() => {}); };
  }, []);

  backAction.current = () => {
    if (errorKey && errorKey !== dismissedError) setDismissedError(errorKey);
    else if (panel) setPanel(panel === 'artwork' ? null : 'artwork');
    else if (section === 'netease' && online.current?.handleBack()) return;
    else if (section === 'settings' && account.current?.handleBack()) return;
    else if (section === 'library' && library.current?.handleBack()) return;
    else if (section !== 'library') setSection('library');
    else if (native) void NativeApp.minimizeApp();
  };

  useEffect(() => {
    if (!errorKey) setDismissedError(null);
  }, [errorKey]);

  useEffect(() => {
    if (!native || section === 'library' || onlineSession) return;
    let cancelled = false;
    void netease<OnlineSession>('/api/netease/session').then(session => {
      if (!cancelled) setOnlineSession(current => current ?? session);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [section, onlineSession]);

  useEffect(() => {
    if (surface.current) surface.current.scrollTop = 0;
  }, [section]);

  useEffect(() => {
    if (!panel) animatePageArrival(surface.current, !!reducedMotion);
  }, [section, panel, reducedMotion]);

  useEffect(() => {
    if (!active || (!appearance.dockLyrics && panel !== 'lyrics') || !native) return;
    let cancelled = false;
    const id = active.id;
    try {
      const manual = localStorage.getItem(manualKey(id));
      if (manual) { setLyricData({ id, lines: parseLRC(manual) }); return; }
    } catch {}
    const cached = lyricCache.current.get(id);
    if (cached) { setLyricData({ id, lines: cached }); return; }
    void loadTrackLyrics(active).then(lines => {
      if (cancelled) return;
      if (lyricCache.current.size >= 40) lyricCache.current.delete(lyricCache.current.keys().next().value);
      lyricCache.current.set(id, lines);
      setLyricData({ id, lines });
    }).catch(() => { if (!cancelled) setLyricData({ id, lines: [] }); });
    return () => { cancelled = true; };
  }, [active?.id, panel === 'lyrics', appearance.dockLyrics, localLyricRevision]);

  const command = useCallback(async (action: () => Promise<AndroidPlaybackState>) => {
    if (!native) return;
    setToast(null);
    try {
      const state = await action();
      acceptPlayback(state);
      return state;
    } catch (reason) {
      report(reason);
    }
  }, [chinese]);

  const importMusic = useCallback(async () => {
    if (!native || importing) return;
    setImporting(true);
    setToast(null);
    try { setTracks((await androidPlayback.importTracks()).tracks); }
    catch (reason) { report(reason); }
    finally { setImporting(false); }
  }, [chinese, importing]);

  const play = useCallback((id: string, items: AndroidTrack[]) => {
    setUndo(null);
    const start = Math.max(0, items.findIndex(track => track.id === id) - 2500);
    void command(() => androidPlayback.playTracks({ id, queue: items.slice(start, start + 5000) }));
  }, [command]);
  const configure = (changes: Configuration) => {
    void command(() => androidPlayback.configurePlayback(changes)).then(state => {
      if (!state) return;
      const { shuffle, repeat, volume, eqEnabled, eqGains } = state;
      try { localStorage.setItem(configurationKey, JSON.stringify({ shuffle, repeat, volume, eqEnabled, eqGains })); }
      catch {}
    });
  };
  const enqueue = useCallback((track: AndroidTrack, next = false) => {
    void command(() => androidPlayback.editQueue({ action: 'enqueue', track, next }));
  }, [command]);
  const enqueueNext = useCallback((track: AndroidTrack) => enqueue(track, true), [enqueue]);
  const editQueue = (edit: QueueEdit) => {
    const previous = snapshot(playback);
    void command(() => androidPlayback.editQueue(edit)).then(state => {
      if (!state) return;
      if (previous) setUndo(previous);
      if (!state.trackId) { storeResume(null); setPanel(null); }
    });
  };
  const undoQueue = () => {
    if (!undo) return;
    void command(() => androidPlayback.playTracks({ ...undo, autoplay: undo.playing })).then(state => { if (state) setUndo(null); });
  };
  const updateAppearance = (changes: Partial<AndroidAppearance>) => {
    const next = { ...appearance, ...changes };
    try { writeAppearance(next); setAppearance(next); }
    catch (reason) { report(reason); }
  };

  useEffect(() => {
    if (!native) return;
    const update = () => {
      const visualizer = panel && !document.hidden ? appearance.visualizer : 'off';
      void androidPlayback.configurePlayback({ visualizer }).catch(() => {});
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [!!panel, appearance.visualizer]);

  const drawerLyrics = active && !active.id.startsWith('netease:') ? () => lyricPicker.current?.click() : undefined;
  const openAlbum = () => {
    if (!active) return;
    if (active.albumId && active.id.startsWith('netease:')) {
      setSection('netease');
      online.current?.openAlbum(active.albumId);
      setPanel(null);
    } else if (active.album && library.current?.openAlbum(active.album, active.artist)) {
      setSection('library');
      setPanel(null);
    }
  };

  const sharedPlayer = active && {
    active, playback, language: appearance.language, clock: nativeClock,
    lyrics, onToggle: () => { void command(() => androidPlayback.toggle()); },
    onSkip: (direction: 'previous' | 'next') => { void command(() => androidPlayback.skip({ direction })); },
    onSeek: (position: number) => { void command(() => androidPlayback.seek({ position })); },
  };

  return <div className="rf-mobile" style={{ '--rf-card-blur': appearance.blur + 'px' } as CSSProperties}>
    <div className="rf-mobile-wallpaper" aria-hidden="true">
      <Background imageSrc={artworkUrl(active?.cover)} effect={appearance.effect}
        customBackground={appearance.background ? { imageSrc: appearance.background } : null} />
    </div>
    <div className="rf-mobile-shell" aria-hidden={!!panel} inert={!!panel}>
      <header className="rf-mobile-header rf-mobile-chrome">
        <span className="rf-mobile-brand"><AppLogo className="rf-mobile-logo" /><span>RadiFlow</span></span>
        <button type="button" className="rf-mobile-icon-button" title={labels.settings} aria-label={labels.settings}
          aria-pressed={section === 'settings'} onClick={() => setSection(section === 'settings' ? 'library' : 'settings')}><Settings2 size={22} /></button>
      </header>
      <main ref={surface} className="rf-mobile-content rf-mobile-surface">
        <div className="rf-mobile-tab-page" hidden={section !== 'library'}>
          <LibraryScreen ref={library} tracks={tracks} activeId={playback.trackId} playing={playback.playing} onPlay={play}
            onImport={importMusic} importing={importing} language={appearance.language} onQueueNext={enqueueNext} />
        </div>
        <div className="rf-mobile-tab-page" hidden={section !== 'netease'}>
          <NetEaseScreen ref={online} active={native && section === 'netease' && !panel} activeId={playback.trackId}
            language={appearance.language} session={onlineSession} onPlay={play} onEnqueue={enqueue} />
        </div>
        {section === 'settings' && <AndroidSettings appearance={appearance} playback={playback} count={tracks.length}
          netEaseAccount={<AndroidNetEaseAccount ref={account} language={appearance.language}
            native={native} session={onlineSession} onSession={setOnlineSession} />}
          onAppearance={updateAppearance} onConfigure={configure} onError={setToast} />}
      </main>
      {sharedPlayer && <AndroidDock {...sharedPlayer} lyrics={appearance.dockLyrics ? lyrics : []} onOpen={() => setPanel('artwork')} />}
      <nav className="rf-mobile-navigation" aria-label={chinese ? '页面' : 'Pages'}>
        {(Object.keys(headingIcon) as Section[]).map(item => {
          const Icon = headingIcon[item];
          return <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>
            <Icon size={21} aria-hidden="true" />{labels[item]}
          </button>;
        })}
      </nav>
    </div>

    <AnimatePresence initial={false}>
      {panel && sharedPlayer && <motion.div className="rf-mobile-full-player" key="player" {...pageMotion(reducedMotion, 'y', 24)}>
        <AndroidPlayer {...sharedPlayer} panel={panel} queue={queue} visualizer={appearance.visualizer}
          lyricLoading={lyricData?.id !== active.id} canUndoQueue={!!undo}
          onPanel={setPanel} onClose={() => setPanel(null)}
          onOpenAlbum={active.albumId || (!active.id.startsWith('netease:') && active.album) ? openAlbum : undefined}
          onAttachLyrics={drawerLyrics}
          onConfigure={configure} onQueueEdit={editQueue} onUndoQueue={undoQueue}
          onSelect={id => { void command(() => androidPlayback.playQueuedTrack({ id })); }} />
      </motion.div>}
    </AnimatePresence>
    <input ref={lyricPicker} hidden type="file" accept=".lrc,text/plain" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file || !active) return;
      const id = active.id;
      if (file.size > 256 * 1024) { setToast(chinese ? '歌词文件过大' : 'Lyric file is too large'); return; }
      void file.text().then(text => {
        if (!parseLRC(text).length) throw new Error(chinese ? '歌词文件没有有效时间戳' : 'The lyric file has no valid timestamps');
        localStorage.setItem(manualKey(id), text);
        setLocalLyricRevision(value => value + 1);
      }).catch(report);
    }} />
    {!active && undo && <div className="rf-mobile-toast rf-glass">
      <span>{chinese ? '播放队列已清空' : 'Queue cleared'}</span>
      <button type="button" className="rf-mobile-text-button" onClick={undoQueue}>{chinese ? '撤销' : 'Undo'}</button>
    </div>}
    {toast && <div className="rf-mobile-toast rf-glass" role="alert">
      <span>{toast}</span><button className="rf-mobile-icon-button" type="button" aria-label={chinese ? '关闭提示' : 'Dismiss'} onClick={() => setToast(null)}><X size={20} /></button>
    </div>}
    {error && errorKey !== dismissedError && <PlaybackErrorDialog
      error={error} track={active?.title ?? 'RadiFlow'} language={appearance.language} onDismiss={() => setDismissedError(errorKey)} />}
  </div>;
}
