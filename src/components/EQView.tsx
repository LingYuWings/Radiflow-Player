import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Info, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { EQCopy } from '../lib/copy';

interface EQBand {
  frequency: number;
  label: string;
  gain: number;
}

interface EQViewProps {
  copy: EQCopy;
  enabled: boolean;
  bands: EQBand[];
  onToggleEnabled: (enabled: boolean) => void;
  onBandGainChange: (index: number, gain: number) => void;
  onReset: () => void;
}

interface CurvePoint {
  x: number;
  y: number;
}

const EQCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="rounded-3xl border border-white/10 bg-black/20 backdrop-blur-2xl customizable-backdrop-medium p-6 md:p-8 shadow-2xl">
    <div className="mb-6 flex items-center gap-3 text-white">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-white/70">
        {icon}
      </div>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
    </div>
    {children}
  </section>
);

const gainToRatio = (gain: number) => (Math.max(-12, Math.min(12, gain)) + 12) / 24;

const buildCurvePath = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    const midPointX = (previousPoint.x + currentPoint.x) / 2;
    const midPointY = (previousPoint.y + currentPoint.y) / 2;
    path += ` Q ${previousPoint.x} ${previousPoint.y} ${midPointX} ${midPointY}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` T ${lastPoint.x} ${lastPoint.y}`;
  return path;
};

export const EQView: React.FC<EQViewProps> = ({
  copy,
  enabled,
  bands,
  onToggleEnabled,
  onBandGainChange,
  onReset,
}) => {
  const graphAreaRef = useRef<HTMLDivElement | null>(null);
  const trackRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [curveLayout, setCurveLayout] = useState<{ width: number; height: number; points: CurvePoint[] }>({
    width: 100,
    height: 100,
    points: [],
  });

  useEffect(() => {
    const updateCurveLayout = () => {
      const graphArea = graphAreaRef.current;
      if (!graphArea) {
        return;
      }

      const graphRect = graphArea.getBoundingClientRect();
      if (graphRect.width === 0 || graphRect.height === 0) {
        return;
      }

      const points = bands
        .map((band, index) => {
          const track = trackRefs.current[index];
          if (!track) {
            return null;
          }

          const trackRect = track.getBoundingClientRect();
          return {
            x: trackRect.left + trackRect.width / 2 - graphRect.left,
            y: trackRect.bottom - trackRect.height * gainToRatio(band.gain) - graphRect.top,
          };
        })
        .filter((point): point is CurvePoint => point !== null);

      setCurveLayout({
        width: graphRect.width,
        height: graphRect.height,
        points,
      });
    };

    updateCurveLayout();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateCurveLayout())
      : null;

    if (observer) {
      if (graphAreaRef.current) {
        observer.observe(graphAreaRef.current);
      }

      trackRefs.current.forEach((track) => {
        if (track) {
          observer.observe(track);
        }
      });
    }

    window.addEventListener('resize', updateCurveLayout);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCurveLayout);
    };
  }, [bands]);

  const curvePath = useMemo(() => buildCurvePath(curveLayout.points), [curveLayout.points]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto p-8 scrollbar-hide md:p-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h1 className="text-5xl font-black uppercase tracking-tighter text-white">{copy.title}</h1>
        <p className="mt-2 text-xs font-mono uppercase tracking-widest text-white/40">{copy.subtitle}</p>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <EQCard title={copy.playback} icon={<SlidersHorizontal size={18} />}>
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{copy.enableEQ}</p>
                  <p className="mt-1 text-sm text-white/45">{copy.enableEQDescription}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleEnabled(!enabled)}
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-sm font-semibold transition-all',
                    enabled
                      ? 'border-white bg-white text-black shadow-lg'
                      : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {enabled ? copy.enabledState : copy.disabledState}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onReset}
                  className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  <RotateCcw size={16} />
                  {copy.reset}
                </button>
                <p className="text-sm text-white/45">{copy.resetDescription}</p>
              </div>
            </div>
          </EQCard>

          <EQCard title={copy.bands} icon={<Sparkles size={18} />}>
            <div className="space-y-5">
              <p className="text-sm text-white/45">{copy.bandsDescription}</p>
              <div className="overflow-x-auto pb-2 scrollbar-hide">
                <div className="relative min-w-[58rem] rounded-[2rem] border border-white/10 bg-white/[0.04] px-6 py-8">
                  <div className="relative z-10 h-[22rem]">
                    <div ref={graphAreaRef} className="pointer-events-none absolute inset-x-0 top-[2.1rem] bottom-[2.85rem] overflow-hidden">
                      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
                      <div className="absolute inset-x-0 top-1/4 h-px bg-white/6" />
                      <div className="absolute inset-x-0 bottom-1/4 h-px bg-white/6" />

                      <svg
                        viewBox={`0 0 ${Math.max(curveLayout.width, 1)} ${Math.max(curveLayout.height, 1)}`}
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full"
                      >
                        <path
                          d={curvePath}
                          fill="none"
                          stroke={enabled ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.28)'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>

                    <div className="relative grid h-full grid-cols-10 gap-3">
                    {bands.map((band, index) => {
                      const gainRatio = gainToRatio(band.gain);

                      return (
                        <div key={band.frequency} className="flex min-h-0 flex-col items-center">
                          <span className="mb-3 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
                            {band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)} {copy.gainUnit}
                          </span>

                          <div className="relative flex min-h-0 flex-1 items-center justify-center px-1">
                            <div
                              ref={(element) => {
                                trackRefs.current[index] = element;
                              }}
                              className="absolute inset-y-3 left-1/2 w-1.5 -translate-x-1/2 overflow-hidden rounded-full bg-white/10"
                            >
                              <div
                                className={cn(
                                  'absolute inset-x-0 bottom-0 rounded-full transition-all',
                                  enabled ? 'bg-white/85' : 'bg-white/35'
                                )}
                                style={{ height: `${gainRatio * 100}%` }}
                              />
                            </div>

                            <input
                              type="range"
                              min="-12"
                              max="12"
                              step="0.5"
                              value={band.gain}
                              onChange={(event) => onBandGainChange(index, Number.parseFloat(event.target.value))}
                              className="relative z-10 w-[14rem] -rotate-90 cursor-pointer appearance-none bg-transparent accent-white"
                            />
                          </div>

                          <div className="mt-3 flex flex-col items-center gap-1">
                            <span className="text-xs font-semibold text-white">{band.label}</span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{copy.gainLabel}</span>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>

                  <div className="relative z-10 mt-4 flex items-center justify-between text-xs text-white/35">
                    <span>-12 {copy.gainUnit}</span>
                    <span>0 {copy.gainUnit}</span>
                    <span>+12 {copy.gainUnit}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/35">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{copy.rangeLabel}: -12 {copy.gainUnit} / +12 {copy.gainUnit}</span>
                  <span>{copy.previewHint}</span>
                </div>
              </div>
            </div>
          </EQCard>
        </div>

        <div className="space-y-6">
          <EQCard title={copy.summary} icon={<Info size={18} />}>
            <div className="space-y-4 text-sm text-white/75">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-white/55">{copy.statusLabel}</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {enabled ? copy.enabledState : copy.disabledState}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-white/55">{copy.rangeLabel}</p>
                <p className="mt-2 font-semibold text-white">-12 dB to +12 dB</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 leading-6 text-white/70">
                <p>{copy.summaryDescription}</p>
                <p className="mt-3 text-white/45">{copy.previewHint}</p>
              </div>
            </div>
          </EQCard>
        </div>
      </div>
    </div>
  );
};