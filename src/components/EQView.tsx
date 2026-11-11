import React from 'react';
import { Info, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { EQCopy } from '../lib/copy';

interface EQBand { frequency: number; label: string; gain: number; }
interface EQViewProps {
  copy: EQCopy;
  enabled: boolean;
  bands: EQBand[];
  onToggleEnabled: (enabled: boolean) => void;
  onBandGainChange: (index: number, gain: number) => void;
  onReset: () => void;
}

// Shared normalized coordinates: no DOM measurements while dragging/resizing.
export const gainToRatio = (gain: number) =>
  (Math.max(-12, Math.min(12, Number.isFinite(gain) ? gain : 0)) + 12) / 24;
export const buildEQCurve = (gains: number[]) => {
  const points = gains.map((gain, index) => ({ x: (index + 0.5) / gains.length * 100, y: (1 - gainToRatio(gain)) * 100 }));
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    const middle = (previous.x + current.x) / 2;
    path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
};

export const EQView: React.FC<EQViewProps> = ({ copy, enabled, bands, onToggleEnabled, onBandGainChange, onReset }) => {
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, bands.length)}, minmax(0, 1fr))` };
  return (
    <div className="rf-eq-page mx-auto h-full w-full max-w-7xl overflow-y-auto p-6 md:p-10 rf-scroll">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-5">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white">{copy.title}</h1>
          <p className="mt-2 text-xs tracking-widest text-white/55">{copy.subtitle}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label={copy.enableEQ}
          onClick={() => onToggleEnabled(!enabled)}
          className={cn('flex shrink-0 items-center gap-3 rounded-2xl border px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white',
            enabled ? 'border-white bg-white text-black' : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10')}>
          <SlidersHorizontal size={18} />{enabled ? copy.enabledState : copy.disabledState}
        </button>
      </header>
      <section aria-label={copy.bands} className="min-w-0 rounded-3xl border border-white/10 bg-black/20 customizable-backdrop-medium p-5 md:p-7 shadow-xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-xl font-bold text-white">{copy.bands}</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">{copy.bandsDescription}</p>
          </div>
          <button type="button" onClick={onReset} title={copy.resetDescription}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white">
            <RotateCcw size={16} />{copy.reset}
          </button>
        </div>
        <div className="rf-eq-scroll overflow-x-auto pb-3 rf-scroll">
          <div className="rf-eq-chart rounded-2xl border border-white/10 bg-white/[0.03] p-5" style={{ minWidth: Math.max(480, bands.length * 64 + 88) }}>
            <div className="ml-12 grid mb-3" style={columns}>
              {bands.map(band => <span key={band.frequency} className="text-center text-xs tabular-nums text-white/75 whitespace-nowrap">{band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)} <span className="text-white/40">{copy.gainUnit}</span></span>)}
            </div>
            <div className="relative pl-12">
              <div aria-hidden="true" className="pointer-events-none absolute left-0 top-2 bottom-2 w-10 text-[11px] tabular-nums text-white/45">
                {[12, 6, 0, -6, -12].map(gain => <span key={gain} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - gainToRatio(gain)) * 100}%` }}>{gain > 0 ? '+' : ''}{gain}</span>)}
              </div>
              <div className="relative">
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="rf-eq-curve pointer-events-none absolute inset-x-0 top-2 w-full overflow-visible" style={{ height: 'calc(100% - 16px)' }}>
                  {[0, 25, 50, 75, 100].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={y === 50 ? '#ffffff30' : '#ffffff0f'} vectorEffect="non-scaling-stroke" />)}
                  <path d={buildEQCurve(bands.map(band => band.gain))} fill="none" stroke={enabled ? '#ffffffa8' : '#ffffff40'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="relative grid" style={columns}>
                  {bands.map((band, index) => {
                    const ratio = gainToRatio(band.gain);
                    return <div key={band.frequency} className="rf-eq-band relative mx-auto w-11 rounded-xl">
                      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-1 -translate-x-1/2 rounded-full bg-white/10">
                        <span className={cn('absolute w-full rounded-full', enabled ? 'bg-white/75' : 'bg-white/30')}
                          style={{ top: `${Math.min(0.5, 1 - ratio) * 100}%`, height: `${Math.abs(ratio - 0.5) * 100}%` }} />
                        <span className={cn('absolute left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-md', enabled ? 'border-white bg-white' : 'border-white/60 bg-[#9ca3af]')}
                          style={{ top: `${(1 - ratio) * 100}%` }} />
                      </div>
                      <input type="range" min={-12} max={12} step={0.5} value={band.gain}
                        aria-label={`${band.label} ${copy.gainLabel}`} aria-orientation="vertical" aria-valuetext={`${band.gain} ${copy.gainUnit}`}
                        onChange={event => onBandGainChange(index, Number(event.target.value))}
                        className="rf-eq-slider" />
                    </div>;
                  })}
                </div>
              </div>
            </div>
            <div className="ml-12 mt-4 grid" style={columns}>
              {bands.map(band => <span key={band.frequency} className="text-center text-xs font-semibold text-white/85">{band.label}</span>)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs leading-5 text-white/55">
          <span>{copy.rangeLabel}: −12 / +12 {copy.gainUnit}</span><span>{copy.previewHint}</span>
        </div>
      </section>
      <aside className="mt-5 flex items-start gap-3 px-2 text-sm leading-6 text-white/60">
        <Info size={18} className="mt-1 shrink-0 text-white/45" />
        <div><p className="font-medium text-white/80">{copy.enableEQDescription}</p><p className="mt-1">{copy.summaryDescription}</p></div>
      </aside>
    </div>
  );
};
