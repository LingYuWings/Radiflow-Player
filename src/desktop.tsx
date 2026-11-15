import App from './App';
import { DesktopLyrics } from './components/DesktopLyrics';
import { DESKTOP_LYRICS_HASH, type DesktopLyricsBridge } from './lib/desktopLyrics';

export function DesktopApp() {
  if (window.location.hash !== DESKTOP_LYRICS_HASH) return <App />;

  const bridge = (window as Window & { radiflowDesktopLyrics?: DesktopLyricsBridge }).radiflowDesktopLyrics;
  return bridge ? <DesktopLyrics bridge={bridge} /> : null;
}
