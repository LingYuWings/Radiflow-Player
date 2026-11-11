import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import App from './App.tsx';
import { MotionConfig } from 'motion/react';
import { PAGE_TRANSITION } from './lib/pageMotion';
import { DesktopLyrics } from './components/DesktopLyrics';
import { DESKTOP_LYRICS_HASH, type DesktopLyricsBridge } from './lib/desktopLyrics';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './index.css';

// @ts-ignore
window.Buffer = Buffer;
// @ts-ignore
window.process = process;

// The desktop lyrics overlay loads this bundle with a hash and an isolated bridge.
const isDesktopLyricsSurface = window.location.hash === DESKTOP_LYRICS_HASH;
const desktopLyricsBridge = (window as unknown as { radiflowDesktopLyrics?: DesktopLyricsBridge }).radiflowDesktopLyrics ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={PAGE_TRANSITION}>
      {isDesktopLyricsSurface
        ? (desktopLyricsBridge && <DesktopLyrics bridge={desktopLyricsBridge} />)
        : <App />}
    </MotionConfig>
  </StrictMode>,
);
