import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import { getPalette } from 'colorthief';
import { motion, AnimatePresence } from 'motion/react';

interface BackgroundProps {
  imageSrc?: string;
  effect: 'blur' | 'streamer';
  customBackground?: {
    imageSrc: string;
  } | null;
  transparentBackground?: boolean;
}

interface StreamerPaletteState {
  key: string;
  colors: string[];
}

const DEFAULT_STREAMER_COLORS = ['rgb(82, 82, 82)', 'rgb(38, 38, 38)'];
const TARGET_STREAMER_LIGHTNESS = 60;
const MIN_STREAMER_SATURATION = 58;
const MAX_STREAMER_SATURATION = 82;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const rgbToHsl = (red: number, green: number, blue: number) => {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness: lightness * 100 };
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue = 0;
  if (max === normalizedRed) {
    hue = (normalizedGreen - normalizedBlue) / delta + (normalizedGreen < normalizedBlue ? 6 : 0);
  } else if (max === normalizedGreen) {
    hue = (normalizedBlue - normalizedRed) / delta + 2;
  } else {
    hue = (normalizedRed - normalizedGreen) / delta + 4;
  }

  return {
    hue: hue * 60,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
};

const normalizeStreamerColor = (red: number, green: number, blue: number) => {
  const { hue, saturation } = rgbToHsl(red, green, blue);
  if (!Number.isFinite(hue) || !Number.isFinite(saturation)) {
    return DEFAULT_STREAMER_COLORS[0];
  }

  const normalizedSaturation = clamp(Math.round(Math.max(saturation, MIN_STREAMER_SATURATION)), MIN_STREAMER_SATURATION, MAX_STREAMER_SATURATION);
  return `hsl(${Math.round(hue)} ${normalizedSaturation}% ${TARGET_STREAMER_LIGHTNESS}%)`;
};

const BLOB_CONFIGS = [
  { duration:  72, xKeys: [0,  140,  -80,   60, 0], yKeys: [0,  170,  240,  -100, 0], left: '15%', top: '20%' },
  { duration:  90, xKeys: [0, -120, -200,  -70, 0], yKeys: [0,  190,  310,   140, 0], left: '72%', top:  '8%' },
  { duration:  60, xKeys: [0,  160,   90,  230, 0], yKeys: [0, -150, -260,  -110, 0], left: '18%', top: '72%' },
  { duration:  80, xKeys: [0, -140,  -70, -200, 0], yKeys: [0, -120, -220,   -80, 0], left: '78%', top: '68%' },
  { duration:  76, xKeys: [0,   80,  180,   40, 0], yKeys: [0,  120,   60,   200, 0], left: '45%', top: '10%' },
  { duration:  84, xKeys: [0,  -90,  -30, -160, 0], yKeys: [0,  -80,  180,   -40, 0], left: '55%', top: '75%' },
  { duration:  66, xKeys: [0,  200,  100,  150, 0], yKeys: [0,   50,  160,   100, 0], left:  '5%', top: '45%' },
  { duration:  96, xKeys: [0, -170,  -80, -130, 0], yKeys: [0,  -60, -160,   -90, 0], left: '88%', top: '40%' },
  { duration:  68, xKeys: [0,  -60,  120,  -80, 0], yKeys: [0,  140,   80,   200, 0], left: '30%', top: '35%' },
  { duration:  82, xKeys: [0,  100, -120,   60, 0], yKeys: [0, -100,   50,  -150, 0], left: '65%', top: '55%' },
  { duration:  74, xKeys: [0, -180,  -90, -140, 0], yKeys: [0,  100,  200,    80, 0], left: '10%', top: '85%' },
  { duration:  88, xKeys: [0,  130,   60,  180, 0], yKeys: [0,  -80, -170,   -50, 0], left: '90%', top: '15%' },
  { duration:  62, xKeys: [0,   80, -100,   50, 0], yKeys: [0,   60,  130,    40, 0], left: '50%', top: '50%' },
  { duration:  78, xKeys: [0, -100, -200,  -60, 0], yKeys: [0, -160,  -80,  -220, 0], left: '35%', top: '60%' },
  { duration:  94, xKeys: [0,  160,   80,  120, 0], yKeys: [0,  180,   90,   240, 0], left: '60%', top: '28%' },
  { duration:  70, xKeys: [0,  -80, -160,  -50, 0], yKeys: [0,  200,  130,   280, 0], left: '25%', top: '88%' },
];

export const Background: React.FC<BackgroundProps> = ({ imageSrc, effect, customBackground = null, transparentBackground = false }) => {
  const [streamerLayers, setStreamerLayers] = useState<StreamerPaletteState[]>([
    { key: 'default', colors: DEFAULT_STREAMER_COLORS },
  ]);
  const paletteRequestIdRef = useRef(0);
  const isUsingCustomBackground = Boolean(customBackground?.imageSrc);
  const shouldSkipBuiltInBackground = isUsingCustomBackground || transparentBackground;

  useEffect(() => {
    if (shouldSkipBuiltInBackground || !imageSrc) {
      setStreamerLayers([{ key: 'default', colors: DEFAULT_STREAMER_COLORS }]);
      return;
    }

    const requestId = paletteRequestIdRef.current + 1;
    paletteRequestIdRef.current = requestId;
    let isDisposed = false;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;
    img.onload = async () => {
      try {
        const palette = await getPalette(img, { colorCount: 4 });
        if (!isDisposed && paletteRequestIdRef.current === requestId && palette) {
          const hexColors = palette.map((color: any) => {
            const [r, g, b] = color.array();
            return normalizeStreamerColor(r, g, b);
          });
          const nextLayer = {
            key: imageSrc,
            colors: hexColors.length > 0 ? hexColors : DEFAULT_STREAMER_COLORS,
          };

          setStreamerLayers((currentLayers) => {
            const latestLayer = currentLayers.at(-1);
            if (latestLayer?.key === nextLayer.key) {
              return [nextLayer];
            }

            return latestLayer ? [latestLayer, nextLayer] : [nextLayer];
          });
        }
      } catch (e) {
        console.error('ColorThief error:', e);
      }
    };

    return () => {
      isDisposed = true;
    };
  }, [imageSrc, shouldSkipBuiltInBackground]);

  useEffect(() => {
    if (streamerLayers.length < 2) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStreamerLayers((currentLayers) => currentLayers.slice(-1));
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [streamerLayers]);

  const blurBackgroundKey = `blur:${imageSrc || 'empty'}`;
  const customBackgroundKey = `custom:${customBackground?.imageSrc || 'empty'}`;

  return (
    <div
      className={transparentBackground ? 'fixed inset-0 -z-10 overflow-hidden bg-transparent' : 'fixed inset-0 -z-10 overflow-hidden bg-black'}
      style={{ clipPath: 'inset(0 round 24px)' }}
    >
      {isUsingCustomBackground ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={customBackgroundKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0"
          >
            <div
              className="absolute inset-[-4%] bg-cover bg-center opacity-88 transition-all duration-700"
              style={{
                backgroundImage: `url(${customBackground?.imageSrc})`,
              }}
            />
          </motion.div>
        </AnimatePresence>
      ) : transparentBackground ? null : effect === 'blur' ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={blurBackgroundKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0"
          >
            <div
              className="absolute inset-0 bg-cover bg-center scale-110 blur-[80px] opacity-60 transition-all duration-1000"
              style={{ backgroundImage: `url(${imageSrc})` }}
            />
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="absolute inset-0">
          <AnimatePresence initial={false}>
            {streamerLayers.map((layer) => (
              <motion.div
                key={layer.key}
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: 'easeInOut' }}
              >
                {BLOB_CONFIGS.map((cfg, i) => (
                  <div key={`${layer.key}-${i}`} className="absolute" style={{ left: cfg.left, top: cfg.top }}>
                    <motion.div
                      className="absolute rounded-full pointer-events-none"
                      style={{
                        width: '35vw',
                        height: '35vw',
                        marginLeft: '-17.5vw',
                        marginTop: '-17.5vw',
                        background: `radial-gradient(circle, ${layer.colors[i % layer.colors.length] || layer.colors[0]} 0%, transparent 60%)`,
                        opacity: 0.85,
                      }}
                      animate={{ x: cfg.xKeys, y: cfg.yKeys }}
                      transition={{ duration: cfg.duration, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                ))}
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="absolute inset-0 backdrop-blur-[100px]" />
        </div>
      )}
      {!transparentBackground && <div className="absolute inset-0 bg-black/40" />}
    </div>
  );
};
