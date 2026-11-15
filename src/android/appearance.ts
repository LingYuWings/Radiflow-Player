import { Capacitor } from '@capacitor/core';
import type { AppLanguage } from '../lib/copy';
import { normalizeVisualizerMode, type VisualizerMode } from '../lib/visualizer';

export interface AndroidAppearance {
  language: AppLanguage;
  effect: 'blur' | 'streamer';
  background: string | null;
  blur: number;
  dockLyrics: boolean;
  visualizer: VisualizerMode;
}

const key = 'radiflow-android.appearance';

export function readAppearance(): AndroidAppearance {
  const base: AndroidAppearance = {
    language: navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    effect: 'streamer', background: null, blur: 36, dockLyrics: true, visualizer: 'off',
  };
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null') as Partial<AndroidAppearance> | null;
    if (!stored) return base;
    return {
      language: stored.language === 'zh-CN' || stored.language === 'en-US' ? stored.language : base.language,
      effect: stored.effect === 'blur' ? 'blur' : 'streamer',
      background: typeof stored.background === 'string' && stored.background.startsWith('data:image/jpeg;')
        ? stored.background : null,
      blur: Number.isFinite(stored.blur) ? Math.max(0, Math.min(72, stored.blur)) : base.blur,
      dockLyrics: stored.dockLyrics ?? base.dockLyrics,
      visualizer: stored.visualizer ? normalizeVisualizerMode(stored.visualizer) : base.visualizer,
    };
  } catch {
    return base;
  }
}

export function writeAppearance(preferences: AndroidAppearance) {
  localStorage.setItem(key, JSON.stringify(preferences));
}

export function artworkUrl(cover?: string) {
  if (!cover) return undefined;
  return cover.startsWith('content:') || cover.startsWith('file:')
    ? Capacitor.convertFileSrc(cover) : cover.replace(/^http:/i, 'https:');
}

export async function makeBackground(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Invalid background image'));
      image.src = url;
    });
    const ratio = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not process the background image');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
