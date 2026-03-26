import React, { useEffect, useRef } from 'react';

interface SpectrumVisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!canvasRef.current || !analyser) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Sync internal resolution with display size
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / 64);
      let barHeight;
      let x = 0;

      // Only use the first half of the frequency data (lower frequencies)
      for (let i = 0; i < 64; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        // Create a gradient for the bars
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.6)');

        ctx.fillStyle = gradient;
        
        // Draw rounded bars
        const radius = 1;
        const y = canvas.height - barHeight;
        
        if (barHeight > 2) {
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth - 2, barHeight, radius);
          ctx.fill();
        }

        x += barWidth;
      }
    };

    if (isPlaying) {
      draw();
    } else {
      // Clear canvas when paused or just show a flat line
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isPlaying]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-[60px] opacity-80"
    />
  );
};
