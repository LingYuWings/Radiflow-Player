import {StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import { MotionConfig } from 'motion/react';
import { PAGE_TRANSITION } from './lib/pageMotion';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './index.css';

// @ts-ignore
window.Buffer = Buffer;
// @ts-ignore
window.process = process;

const render = (app: ReactNode) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user" transition={PAGE_TRANSITION}>{app}</MotionConfig>
    </StrictMode>,
  );
};

if (import.meta.env.MODE === 'android') {
  void import('./android/AndroidApp').then(({ AndroidApp }) => render(<AndroidApp />));
} else {
  void import('./desktop').then(({ DesktopApp }) => render(<DesktopApp />));
}
