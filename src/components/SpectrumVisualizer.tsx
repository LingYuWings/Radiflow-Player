import React, { useEffect, useRef } from 'react';
import type { VisualizerMode } from '../lib/visualizer';
import { updateWaveform } from '../lib/waveform';

interface SpectrumVisualizerProps {
  mode?: VisualizerMode;
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({ analyser, isPlaying, mode = 'spectrum' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || mode === 'off') return;
    let frame = 0;
    let lastFrame = -Infinity;
    let gradient: CanvasGradient;
    const data = new Uint8Array((mode === 'waveform' ? analyser?.fftSize : analyser?.frequencyBinCount) || 256);
    const points = new Float32Array(128);
    let width = 1, height = 1;
    let waveGradient: CanvasGradient;
    const resize = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      waveGradient = ctx.createLinearGradient(0, 0, width, 0);
      waveGradient.addColorStop(0, 'rgba(255,255,255,0)');
      waveGradient.addColorStop(.12, 'rgba(255,255,255,.75)');
      waveGradient.addColorStop(.88, 'rgba(255,255,255,.75)');
      waveGradient.addColorStop(1, 'rgba(255,255,255,0)');
      gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,.05)');
      gradient.addColorStop(.5, 'rgba(255,255,255,.3)');
      gradient.addColorStop(1, 'rgba(255,255,255,.6)');
    };
    const draw = (now: number) => {
      if (!analyser || !isPlaying || document.hidden) return;
      frame = requestAnimationFrame(draw);
      if (now - lastFrame < 1000 / 30) return;
      const elapsed = Number.isFinite(lastFrame) ? (now - lastFrame) / 1000 : 1 / 30;
      lastFrame = now;
      if (mode === 'waveform') analyser.getByteTimeDomainData(data);
      else analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = gradient;
      if (mode === 'waveform') {
        updateWaveform(data, points, elapsed);
        ctx.strokeStyle = waveGradient;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, height / 2 + points[0] * height * .42);
        for (let index = 1; index < points.length; index++) {
          const x = index / (points.length - 1) * width;
          const previousX = (index - 1) / (points.length - 1) * width;
          const y = height / 2 + points[index] * height * .42;
          const previousY = height / 2 + points[index - 1] * height * .42;
          ctx.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
        }
        ctx.lineTo(width, height / 2 + points[points.length - 1] * height * .42);
        ctx.globalAlpha = .16;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        return;
      }
      const count = Math.min(64, data.length);
      const barWidth = width / count;
      ctx.beginPath();
      for (let index = 0; index < count; index++) {
        const barHeight = data[index] / 255 * height;
        if (barHeight > 2 && barWidth > 2) ctx.roundRect(index * barWidth, mode === 'mirror' ? (height - barHeight) / 2 : height - barHeight, barWidth - 2, barHeight, 1);
      }
      ctx.fill();
    };
    const resume = () => { cancelAnimationFrame(frame); if (!document.hidden) frame = requestAnimationFrame(draw); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
    };
  }, [analyser, isPlaying, mode]);
  return mode === 'off' ? null : <canvas ref={canvasRef} aria-hidden="true" className="w-full h-[60px] opacity-80" />;
};
