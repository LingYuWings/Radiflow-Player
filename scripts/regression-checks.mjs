import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const load = (filename, extra = '', overrides = {}) => {
  const contents = fs.readFileSync(filename, 'utf8') + extra;
  const output = buildSync({ stdin: { contents, resolveDir: path.dirname(path.resolve(filename)), loader: filename.endsWith('tsx') ? 'tsx' : 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)((id) => overrides[id] || require(id), mod, mod.exports);
  return mod.exports;
};
const { createAudioPlayback } = load('src/lib/audioPlayback.ts');
const { lyricWordProgress, lyricWordGlow } = load('src/lib/lyricProgress.ts');
assert.equal(lyricWordGlow(10, 10, 2), 0);
assert(lyricWordGlow(10.07, 10, 2) > 0 && lyricWordGlow(10.07, 10, 2) < 1);
assert.equal(lyricWordGlow(11, 10, 2), 1);
assert(lyricWordGlow(12.16, 10, 2) > 0 && lyricWordGlow(12.16, 10, 2) < 1);
assert.equal(lyricWordGlow(12.4, 10, 2), 0);
assert.equal(lyricWordGlow(9, 10, 2), 0);
assert.equal(lyricWordGlow(10, 10, 0), 0);
assert.equal(lyricWordProgress(9, 10, 2), 0);
assert.equal(lyricWordProgress(11, 10, 2), .5);
assert.equal(lyricWordProgress(11, 10, 2), .5, 'paused time preserves the highlight');
assert.equal(lyricWordProgress(10.5, 10, 2), .25, 'backward seeking recomputes the highlight');
assert.equal(lyricWordProgress(13, 10, 2), 1);
assert.equal(lyricWordProgress(10, 10, 0), 1);
assert.equal(lyricWordProgress(NaN, 10, 2), 0);
console.log('PASS lyrics: absolute timing, pause, backward seek, boundaries and zero duration');
class Audio extends EventTarget {
  paused = true; ended = false; duration = 60; currentTime = 0; readyState = 0; src = ''; error = null;
  requests = [];
  play() { this.paused = false; return new Promise((resolve, reject) => this.requests.push({ resolve, reject })); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.currentTime = 0; this.error = null; }
  removeAttribute() { this.src = ''; }
}
const audio = new Audio(); const states = [];
const player = createAudioPlayback(audio, (state) => states.push(state));
player.load('first'); player.load('second', true, 24);
audio.requests[0].reject(new Error('old request failed')); await Promise.resolve();
assert.notEqual(states.at(-1), 'error', 'old failures must not change a newer track');
audio.dispatchEvent(new Event('loadedmetadata')); assert.equal(audio.currentTime, 24);
audio.requests[1].resolve(); await Promise.resolve(); assert.equal(states.at(-1), 'playing');
audio.dispatchEvent(new Event('waiting')); assert.equal(states.at(-1), 'buffering');
player.toggle(); assert.equal(states.at(-1), 'paused');
player.load('unavailable'); audio.requests[2].reject(new Error('network')); await Promise.resolve(); assert.equal(states.at(-1), 'error');
player.clear(); assert.equal(audio.src, ''); assert.equal(states.at(-1), 'idle');
const beforeDispose = states.length; player.dispose(); audio.dispatchEvent(new Event('error')); assert.equal(states.length, beforeDispose);
console.log('PASS playback: restore, buffering, cancel, failure, stale requests, cleanup');
const restoredAudio = new Audio();
const restoredStates = [];
const restoredPlayer = createAudioPlayback(restoredAudio, state => restoredStates.push(state));
restoredPlayer.load('last-track', false, 83.25);
assert.equal(restoredAudio.requests.length, 0, 'startup must never call play');
assert.equal(restoredAudio.paused, true);
assert.equal(restoredPlayer.getPosition(), 83.25, 'progress survives before metadata loads');
restoredAudio.duration = 240;
restoredAudio.dispatchEvent(new Event('loadedmetadata'));
assert.equal(restoredAudio.currentTime, 83.25);
assert.equal(restoredStates.at(-1), 'paused');
restoredPlayer.dispose();
console.log('PASS startup: paused restore and preserved fractional progress');
const { mapConcurrent } = load('src/lib/mapConcurrent.ts');
let active = 0, maximum = 0;
const results = await mapConcurrent(Array.from({ length: 30 }, (_, i) => i), 4, async (i) => { active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, i % 3)); active--; return i * 2; });
assert.equal(maximum, 4); assert.deepEqual(results, Array.from({ length: 30 }, (_, i) => i * 2));
console.log('PASS scan: bounded concurrency and stable ordering');
const { audit } = load('src/components/Library.tsx', '\nexport const audit = { VirtualSongGrid, VirtualSongList, SongCard, CollectionCard };');
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const songs = Array.from({ length: 500 }, (_, i) => ({ title: `AUDIT_${i}`, artist: 'Artist', file: `/music/${i}.wav`, lrc: '' }));
const props = { songs, addLabel: 'Add', getKey: (s) => s.file, onPlaySong() {}, onAddSong() {}, scrollContainerRef: { current: null } };
for (const Component of [audit.VirtualSongGrid, audit.VirtualSongList]) {
  const markup = renderToStaticMarkup(React.createElement(Component, props));
  const count = new Set(markup.match(/AUDIT_\d+/g)).size;
  assert(count > 0 && count <= 48, `initial render must be bounded, got ${count}`);
}
assert.equal(audit.SongCard.compare, null); assert.equal(audit.CollectionCard.compare, null);
console.log('PASS lists: bounded first render and no callback-blind memo comparison');
const { LyricsView } = load('src/components/LyricsView.tsx');
const bilingual = [
  { startTime: 0, text: 'First', translation: 'TRANSLATION_FIRST' },
  { startTime: 5, text: 'Second', translation: 'TRANSLATION_SECOND' },
];
for (const time of [0, 6]) {
  const markup = renderToStaticMarkup(React.createElement(LyricsView, { lyrics: bilingual, currentTime: time }));
  assert.equal((markup.match(/rf-lyric-translation/g) || []).length, 1);
  assert(markup.includes(time === 0 ? 'TRANSLATION_FIRST' : 'TRANSLATION_SECOND'));
  assert(!markup.includes(time === 0 ? 'TRANSLATION_SECOND' : 'TRANSLATION_FIRST'));
}
console.log('PASS translations: only the active line mounts translation space');
const { stepLyricScroll } = load('src/lib/lyricScroll.ts');
const simulateScroll = (fps) => {
  let position = 0, velocity = 0;
  for (let i = 0; i < fps * 2; i++) {
    const next = stepLyricScroll(position, velocity, 500, 1 / fps);
    assert(next.position >= position - 1e-8 && next.position <= 500);
    ({ position, velocity } = next);
  }
  return position;
};
assert(Math.abs(simulateScroll(60) - simulateScroll(120)) < 0.01);
assert(Math.abs(simulateScroll(60) - 500) < 0.01);
const changingTarget = stepLyricScroll(120, 200, 350, 1 / 60);
assert(changingTarget.position > 120 && changingTarget.velocity > 0);
const timedLyrics = bilingual.map(line => ({ ...line, words: [{ text: line.text, startTime: line.startTime, duration: 2 }] }));
for (const currentTime of [0, 6]) {
  const markup = renderToStaticMarkup(React.createElement(LyricsView, { lyrics: timedLyrics, currentTime }));
  assert.equal((markup.match(/class="rf-lyric-word"/g) || []).length, 2, 'word layout remains stable across line changes');
}
console.log('PASS lyric transitions: refresh-rate stability, smooth retargeting and stable word layout');
const { normalizeVisualizerMode, VISUALIZER_MODES } = load('src/lib/visualizer.ts');
assert.equal(normalizeVisualizerMode(undefined), 'spectrum');
assert.equal(normalizeVisualizerMode('unknown'), 'spectrum');
for (const mode of VISUALIZER_MODES) assert.equal(normalizeVisualizerMode(mode), mode);
const { SpectrumVisualizer } = load('src/components/SpectrumVisualizer.tsx');
assert.equal(renderToStaticMarkup(React.createElement(SpectrumVisualizer, { analyser: null, isPlaying: true, mode: 'off' })), '');
for (const mode of ['spectrum', 'waveform', 'mirror']) {
  assert(renderToStaticMarkup(React.createElement(SpectrumVisualizer, { analyser: null, isPlaying: false, mode })).includes('<canvas'));
}
console.log('PASS visualizer: default compatibility, supported modes and no canvas when off');
const seekUpdates = [];
let subscribeClock;
const { useAudioClock } = load('src/hooks/useAudioClock.ts', '', { react: {
  useRef: current => ({ current }),
  useState: init => [init(), value => seekUpdates.push(value)],
  useEffect: effect => { subscribeClock = effect; },
} });
const seekSource = new EventTarget(); seekSource.currentTime = 12;
useAudioClock({ current: seekSource }, 0);
const unsubscribeClock = subscribeClock();
seekSource.currentTime = 30; seekSource.dispatchEvent(new Event('seeking'));
assert.equal(seekUpdates.at(-1), 30, 'controls update on seeking without root state or a timeupdate');
seekSource.currentTime = 5; seekSource.dispatchEvent(new Event('seeked'));
assert.equal(seekUpdates.at(-1), 5, 'backward seek resynchronizes');
unsubscribeClock();
const updateCount = seekUpdates.length;
seekSource.dispatchEvent(new Event('seeking'));
assert.equal(seekUpdates.length, updateCount);
console.log('PASS seek clock: immediate local updates and unmount cleanup');
const { updateWaveform } = load('src/lib/waveform.ts');
const wavePoints = new Float32Array(128);
const silence = new Uint8Array(2048).fill(128);
updateWaveform(silence, wavePoints, 1 / 30);
assert(wavePoints.every(value => value === 0), 'silence remains a flat line');
const tone = Uint8Array.from({ length: 2048 }, (_, i) => Math.round(128 + 110 * Math.sin(i * .04)));
updateWaveform(tone, wavePoints, 1 / 30);
assert(wavePoints.some(value => Math.abs(value) > .1));
assert(wavePoints.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
for (let i = 0; i < 30; i++) updateWaveform(silence, wavePoints, 1 / 30);
assert(wavePoints.every(value => Math.abs(value) < .001), 'waveform smoothly settles to silence');
console.log('PASS waveform: silence, signal response, bounds and decay');
