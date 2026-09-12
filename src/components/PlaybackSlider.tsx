import React, { useState } from 'react';
export const formatPlaybackTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
export function PlaybackSlider({ value, max = 1, onChange, label, disabled = false, time = false }: {
  value: number; max?: number; onChange: (value: number) => void; label: string; disabled?: boolean; time?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
  return <div className="rf-slider-wrap" onPointerLeave={() => setPreview(null)}>
    {time && preview !== null && !disabled && <span className="rf-seek-preview" style={{ left: `${Math.max(5, Math.min(95, preview / safeMax * 100))}%` }}>{formatPlaybackTime(preview)}</span>}
    <input className="rf-slider" type="range" min={0} max={safeMax} step={time ? 0.1 : 0.01} value={safeValue} disabled={disabled || max <= 0} aria-label={label}
      aria-valuetext={time ? formatPlaybackTime(safeValue) : `${Math.round(safeValue * 100)}%`}
      style={{ '--rf-progress': `${safeValue / safeMax * 100}%` } as React.CSSProperties}
      onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPreview(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * safeMax); }}
      onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}
