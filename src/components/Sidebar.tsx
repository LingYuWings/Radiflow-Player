import React from 'react';
import { Disc3, Library, ListMusic, Plus, Search, Settings2, UserRound, Volume2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { SidebarCopy } from '../lib/copy';

export type SidebarSection = 'playlists' | 'all' | 'artist' | 'album' | 'search' | 'settings';

interface PlaylistItem {
  id: string;
  name: string;
  songCount: number;
}

interface SidebarProps {
  section: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  playlists: PlaylistItem[];
  selectedPlaylistId: string;
  currentPlaybackPlaylistId: string;
  onSelectPlaylist: (playlistId: string) => void;
  onPlayPlaylist: (playlistId: string) => void;
  onCreatePlaylist: () => void;
  copy: SidebarCopy;
}

const navItems: Array<{ key: SidebarSection; icon: React.ReactNode }> = [
  { key: 'playlists', icon: <ListMusic size={17} /> },
  { key: 'all', icon: <Library size={17} /> },
  { key: 'artist', icon: <UserRound size={17} /> },
  { key: 'album', icon: <Disc3 size={17} /> },
  { key: 'search', icon: <Search size={17} /> },
  { key: 'settings', icon: <Settings2 size={17} /> },
];

const getNavLabel = (copy: SidebarCopy, key: SidebarSection) => {
  switch (key) {
    case 'playlists':
      return copy.playlists;
    case 'all':
      return copy.allSongs;
    case 'artist':
      return copy.artists;
    case 'album':
      return copy.albums;
    case 'search':
      return copy.search;
    case 'settings':
      return copy.settings;
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  section,
  onSectionChange,
  playlists,
  selectedPlaylistId,
  currentPlaybackPlaylistId,
  onSelectPlaylist,
  onPlayPlaylist,
  onCreatePlaylist,
  copy,
}) => {
  return (
    <aside className="h-full min-h-0 rounded-4xl border border-white/10 bg-black/25 backdrop-blur-2xl shadow-2xl px-5 py-6 flex flex-col gap-6 overflow-hidden">
      <div className="px-2">
        <p className="text-white/35 text-[11px] font-mono tracking-[0.28em] uppercase">{copy.subtitle}</p>
        <h1 className="text-white text-2xl font-black tracking-tight mt-2">{copy.title}</h1>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const active = section === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSectionChange(item.key)}
              className={cn(
                'w-full rounded-2xl px-4 py-3 flex items-center gap-3 text-sm font-semibold transition-all border',
                active
                  ? 'bg-white text-black border-white shadow-lg'
                  : 'bg-white/5 text-white/65 border-white/5 hover:bg-white/10 hover:text-white'
              )}
            >
              {item.icon}
              <span>{getNavLabel(copy, item.key)}</span>
            </button>
          );
        })}
      </nav>

      <section className="min-h-0 flex-1 rounded-[28px] border border-white/8 bg-white/4 px-3 py-4 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-2 mb-4">
          <div>
            <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-white/30">{copy.playlistSection}</p>
            <p className="text-sm text-white/55 mt-1">{copy.selectedPlaylist}</p>
          </div>
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="w-10 h-10 rounded-2xl bg-white/10 text-white/75 hover:bg-white hover:text-black transition-all flex items-center justify-center"
            title={copy.createPlaylist}
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide space-y-2 pr-1">
          {playlists.map((playlist) => {
            const selected = playlist.id === selectedPlaylistId;
            const playing = playlist.id === currentPlaybackPlaylistId;

            return (
              <div
                key={playlist.id}
                className={cn(
                  'group rounded-2xl border px-3 py-3 transition-all',
                  selected
                    ? 'bg-white/10 border-white/15 shadow-lg'
                    : 'bg-white/5 border-white/5 hover:bg-white/8'
                )}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPlaylist(playlist.id);
                      onSectionChange('playlists');
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-semibold text-white truncate">{playlist.name}</p>
                    <p className="text-xs text-white/40 mt-1 truncate">
                      {playing ? `${copy.nowPlaying} · ` : ''}
                      {playlist.songCount} songs
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onPlayPlaylist(playlist.id)}
                    className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0',
                      playing
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white/70 hover:bg-white hover:text-black'
                    )}
                    title={copy.nowPlaying}
                  >
                    <Volume2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
};