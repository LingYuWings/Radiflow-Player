import React, { useEffect, useRef, useState } from 'react';
import { useBufferedRanges } from '../hooks/useBufferedRanges';
import { bufferedTrack } from '../lib/bufferedRanges';
export const formatPlaybackTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
export function PlaybackSlider({ value, max = 1, onChange, label, disabled = false, time = false, audioRef }: {
  value: number; max?: number; onChange: (value: number) => void; label: string; disabled?: boolean; time?: boolean;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const cancelledGesture = useRef(false);
  const pending = useRef<number | null>(null);
  const buffered = useBufferedRanges(time ? audioRef : undefined);
  const cancel = () => { if (dragging.current) cancelledGesture.current = true; dragging.current = false; pending.current = null; setDraft(null); setPreview(null); };
  useEffect(() => {
    cancel();
    const audio = audioRef?.current;
    audio?.addEventListener('loadstart', cancel);
    audio?.addEventListener('emptied', cancel);
    return () => { audio?.removeEventListener('loadstart', cancel); audio?.removeEventListener('emptied', cancel); };
  }, [audioRef, max, disabled]);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const displayValue = draft ?? value;
  const safeValue = Math.min(safeMax, Math.max(0, Number.isFinite(displayValue) ? displayValue : 0));
  const unavailable = disabled || !Number.isFinite(max) || max <= 0;
  return <div className="rf-slider-wrap" onPointerLeave={() => setPreview(null)}>
    {time && preview !== null && !unavailable && <span className="rf-seek-preview" style={{ left: `${Math.max(5, Math.min(95, preview / safeMax * 100))}%` }}>{formatPlaybackTime(preview)}</span>}
    <input className="rf-slider" type="range" min={0} max={safeMax} step={time ? 0.1 : 0.01} value={safeValue} disabled={unavailable} aria-label={label}
      aria-valuetext={time ? formatPlaybackTime(safeValue) : `${Math.round(safeValue * 100)}%`}
      style={{ '--rf-progress': `${safeValue / safeMax * 100}%`, '--rf-track': bufferedTrack(buffered, max, safeValue / safeMax * 100) } as React.CSSProperties}
      onPointerDown={(event) => {
        if (!time || unavailable || event.button !== 0) return;
        cancelledGesture.current = false;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={() => { const next = pending.current; const commit = dragging.current; cancel(); if (commit && next !== null && !unavailable) onChange(next); }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } else if (!dragging.current) cancelledGesture.current = false; }}
      onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPreview(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * safeMax); }}
      onChange={(event) => {
        if (cancelledGesture.current || unavailable) return;
        const next = Number(event.target.value);
        if (dragging.current && time) { pending.current = next; setDraft(next); setPreview(next); }
        else onChange(next);
      }} />
  </div>;
}
