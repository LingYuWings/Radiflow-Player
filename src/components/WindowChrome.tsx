import React from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { AppLogo } from './AppLogo';

interface WindowChromeProps {
  appName: string;
  subtitle: string;
  actionSlot?: React.ReactNode;
  showWindowControls: boolean;
  isWindowMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const dragRegionStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export const WindowChrome: React.FC<WindowChromeProps> = ({
  appName,
  subtitle,
  actionSlot,
  showWindowControls,
  isWindowMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}) => {
  return (
    <div className="absolute inset-x-0 top-0 z-90 h-14 border-b border-white/10 bg-black/35 backdrop-blur-2xl">
      <div className="flex h-full items-center justify-between gap-4 px-4 md:px-5" style={dragRegionStyle}>
        <div className="flex min-w-0 items-center gap-3">
          <AppLogo className="h-9 w-9 rounded-2xl shadow-lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-black tracking-[0.16em] text-white uppercase">{appName}</p>
            <p className="truncate text-[10px] font-mono uppercase tracking-[0.22em] text-white/35">{subtitle}</p>
          </div>
        </div>

        {(actionSlot || showWindowControls) && (
          <div className="flex items-center gap-2" style={noDragStyle}>
            {actionSlot}
            <button
              type="button"
              onClick={onMinimize}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
              aria-label="Minimize window"
              title="Minimize"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              onClick={onToggleMaximize}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
              aria-label={isWindowMaximized ? 'Restore window' : 'Maximize window'}
              title={isWindowMaximized ? 'Restore' : 'Maximize'}
            >
              {isWindowMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition-all hover:border-red-400/30 hover:bg-red-500/15 hover:text-red-200"
              aria-label="Close window"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};