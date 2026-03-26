import React, { useEffect, useState, useRef } from 'react';
// @ts-ignore
import { getPalette } from 'colorthief';
import { motion, AnimatePresence } from 'motion/react';

interface BackgroundProps {
  imageSrc?: string;
  effect: 'blur' | 'streamer';
}

export const Background: React.FC<BackgroundProps> = ({ imageSrc, effect }) => {
  const [colors, setColors] = useState<string[]>(['#1a1a1a', '#000000']);

  useEffect(() => {
    if (!imageSrc) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;
    img.onload = async () => {
      try {
        const palette = await getPalette(img, { colorCount: 4 });
        if (palette) {
          const hexColors = palette.map((color: any) => {
            const [r, g, b] = color.array();
            return `rgb(${r}, ${g}, ${b})`;
          });
          setColors(hexColors);
        }
      } catch (e) {
        console.error('ColorThief error:', e);
      }
    };
  }, [imageSrc]);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        <motion.div
          key={imageSrc}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          {effect === 'blur' ? (
            <div 
              className="absolute inset-0 bg-cover bg-center scale-110 blur-[80px] opacity-60 transition-all duration-1000"
              style={{ backgroundImage: `url(${imageSrc})` }}
            />
          ) : (
            <div className="absolute inset-0 opacity-80">
              <div 
                className="absolute inset-0 animate-pulse-slow"
                style={{
                  background: `radial-gradient(circle at 20% 30%, ${colors[0]} 0%, transparent 50%),
                               radial-gradient(circle at 80% 20%, ${colors[1]} 0%, transparent 50%),
                               radial-gradient(circle at 40% 80%, ${colors[2] || colors[0]} 0%, transparent 50%),
                               radial-gradient(circle at 70% 70%, ${colors[3] || colors[1]} 0%, transparent 50%)`
                }}
              />
              <div className="absolute inset-0 backdrop-blur-[100px]" />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
};
