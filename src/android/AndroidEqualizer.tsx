import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { buildEQCurve, gainToRatio } from '../components/EQView';
import { getEQCopy, type AppLanguage } from '../lib/copy';
import type { androidPlayback, AndroidPlaybackState } from './playback';

const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const flat = frequencies.map(() => 0);

export function AndroidEqualizer({ playback, language, onConfigure }: {
  playback: AndroidPlaybackState; language: AppLanguage;
  onConfigure: (value: Parameters<typeof androidPlayback.configurePlayback>[0]) => void;
}) {
  const copy = getEQCopy(language);
  const enabled = !!playback.eqEnabled;
  const gains = playback.eqGains?.length === frequencies.length ? playback.eqGains : flat;

  return <section className="rf-mobile-eq rf-glass" aria-label={copy.title}>
    <header className="rf-mobile-eq-header">
      <h2>{copy.title}</h2>
      <button type="button" role="switch" aria-label={copy.enableEQ} aria-checked={enabled}
        onClick={() => onConfigure({ eqEnabled: !enabled })} className="rf-mobile-eq-switch">
        <SlidersHorizontal size={17} aria-hidden="true" />
        {enabled ? copy.enabledState : copy.disabledState}
      </button>
    </header>

    <div className="rf-mobile-eq-meter" aria-hidden="true">
      <span className="rf-mobile-eq-scale"><span>+12</span><span>0</span><span>−12</span></span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rf-mobile-eq-curve">
        {[0, 25, 50, 75, 100].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y}
          stroke={y === 50 ? '#ffffff49' : '#ffffff1a'} vectorEffect="non-scaling-stroke" />)}
        <path d={buildEQCurve(gains)} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {gains.map((gain, index) => <line key={index} x1={(index + .5) * 10} x2={(index + .5) * 10 + .01}
          y1={(1 - gainToRatio(gain)) * 100} y2={(1 - gainToRatio(gain)) * 100}
          stroke="currentColor" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
      </svg>
    </div>

    <div className="rf-mobile-eq-band-heading"><h3>{copy.bands}</h3>
      <button className="rf-mobile-text-button" type="button" aria-label={copy.reset} onClick={() => onConfigure({ eqGains: flat })}>
        <RotateCcw size={16} aria-hidden="true" />{copy.reset}
      </button>
    </div>
    <div className="rf-mobile-eq-bands">
      {frequencies.map((frequency, index) => {
        const gain = gains[index];
        const label = frequency >= 1000 ? frequency / 1000 + ' kHz' : frequency + ' Hz';
        const gainText = (gain > 0 ? '+' : '') + gain.toFixed(1);
        return <label key={frequency} className="rf-mobile-eq-band">
          <span>{label}</span>
          <input type="range" min={-12} max={12} step={.5} value={gain}
            aria-label={label + ' ' + copy.gainLabel} aria-valuetext={gainText + ' dB'}
            onChange={event => onConfigure({
              eqGains: gains.map((current, i) => i === index ? Number(event.target.value) : current),
            })} />
          <output>{gainText} <span>dB</span></output>
        </label>;
      })}
    </div>
  </section>;
}
