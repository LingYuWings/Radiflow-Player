import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import App from './App.tsx';
import './index.css';

// @ts-ignore
window.Buffer = Buffer;
// @ts-ignore
window.process = process;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
