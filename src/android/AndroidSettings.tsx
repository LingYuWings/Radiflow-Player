import { useRef, useState, type ReactNode } from 'react';
import { ImagePlus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { getEQCopy, getSettingsCopy } from '../lib/copy';
import { VISUALIZER_MODES, type VisualizerMode } from '../lib/visualizer';
import { makeBackground, type AndroidAppearance } from './appearance';
import { AndroidEqualizer } from './AndroidEqualizer';
import type { androidPlayback, AndroidPlaybackState } from './playback';

const visualizerCopy = {
  off: ['关闭', 'Off'], spectrum: ['频谱', 'Spectrum'], mirror: ['镜像频谱', 'Mirror'],
  waveform: ['波形', 'Waveform'],
};

export function AndroidSettings({ appearance, playback, count, netEaseAccount, onAppearance, onConfigure, onError }: {
  appearance: AndroidAppearance; playback: AndroidPlaybackState; count: number;
  netEaseAccount: ReactNode;
  onAppearance: (patch: Partial<AndroidAppearance>) => void;
  onConfigure: (value: Parameters<typeof androidPlayback.configurePlayback>[0]) => void;
  onError: (message: string) => void;
}) {
  const copy = getSettingsCopy(appearance.language);
  const chinese = appearance.language === 'zh-CN';
  const [section, setSection] = useState<'appearance' | 'eq'>('appearance');
  const [processing, setProcessing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const equalizer = getEQCopy(appearance.language);

  return <div className="rf-mobile-settings">
    <div className="rf-mobile-filter" aria-label={copy.title}>
      <button type="button" aria-pressed={section === 'appearance'} onClick={() => setSection('appearance')}>{copy.appearance}</button>
      <button type="button" aria-pressed={section === 'eq'} onClick={() => setSection('eq')}><SlidersHorizontal size={16} />{equalizer.title}</button>
    </div>
    {section === 'eq' ? <AndroidEqualizer language={appearance.language} playback={playback} onConfigure={onConfigure} /> : <>
      {netEaseAccount}
      <section className="rf-mobile-settings-card rf-glass">
        <h2>{copy.appearance}</h2>
        <label className="rf-mobile-setting-row">
          <span>{copy.backgroundEffect}</span>
          <select value={appearance.effect} onChange={event => onAppearance({ effect: event.target.value as AndroidAppearance['effect'], background: null })}>
            <option value="streamer">{copy.streamerMode}</option><option value="blur">{copy.blurMode}</option>
          </select>
        </label>
        <div className="rf-mobile-setting-row"><span>{copy.backgroundSource}</span>
          <div className="rf-mobile-header-actions">
            <button type="button" aria-label={appearance.background ? copy.replaceCustomBackground : copy.uploadCustomBackground}
              disabled={processing} onClick={() => picker.current?.click()}><ImagePlus size={18} />
              {appearance.background ? copy.replaceCustomBackground : copy.uploadCustomBackground}</button>
            {appearance.background && <button type="button" aria-label={copy.removeCustomBackground}
              onClick={() => onAppearance({ background: null })}><RotateCcw size={17} /></button>}
          </div>
        </div>
        <input ref={picker} type="file" accept="image/*" hidden onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file || processing) return;
          setProcessing(true);
          void makeBackground(file).then(background => onAppearance({ background })).catch(() => {
            onError(chinese ? '无法读取所选图片' : 'Could not read the selected image');
          }).finally(() => setProcessing(false));
        }} />
        <label className="rf-mobile-setting-row">
          <span>{chinese ? '玻璃模糊强度' : 'Glass blur'}</span>
          <input type="range" min="0" max="72" value={appearance.blur}
            onChange={event => onAppearance({ blur: Number(event.target.value) })} />
        </label>
      </section>
      <section className="rf-mobile-settings-card rf-glass">
        <h2>{copy.general}</h2>
        <label className="rf-mobile-setting-row"><span>{copy.language}</span>
          <select value={appearance.language} onChange={event => onAppearance({ language: event.target.value as AndroidAppearance['language'] })}>
            <option value="zh-CN">{copy.chinese}</option><option value="en-US">{copy.english}</option>
          </select>
        </label>
        <label className="rf-mobile-setting-row"><span>{chinese ? '迷你播放条歌词' : 'Mini-player lyrics'}</span>
          <input type="checkbox" checked={appearance.dockLyrics}
            onChange={event => onAppearance({ dockLyrics: event.target.checked })} />
        </label>
        <label className="rf-mobile-setting-row"><span>{chinese ? '音频可视化' : 'Audio visualizer'}</span>
          <select value={appearance.visualizer} onChange={event => onAppearance({ visualizer: event.target.value as VisualizerMode })}>
            {VISUALIZER_MODES.map(mode => <option key={mode} value={mode}>{visualizerCopy[mode][chinese ? 0 : 1]}</option>)}
          </select>
        </label>
      </section>
      <section className="rf-mobile-settings-card rf-glass">
        <h2>{copy.about}</h2><div className="rf-mobile-setting-row"><span>RadiFlow Player</span><span>{copy.tracksCount(count)}</span></div>
      </section>
    </>}
  </div>;
}
