import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { tsImport } from 'tsx/esm/api';
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

const cloudAudio = new Audio();
const checks = [];
const playbackErrors = [];
const cloudPlayer = createAudioPlayback(cloudAudio, (_status, error) => {
  if (error) playbackErrors.push(error);
}, (_url, signal) => new Promise((resolve, reject) => checks.push({ signal, resolve, reject })));
cloudPlayer.load('/api/netease/song/stream/1', false, 27);
assert.equal(cloudAudio.src, '', 'restoring a cloud song must defer loading its stream');
assert.equal(checks.length, 0, 'startup must not check a paused cloud song');
cloudPlayer.toggle();
assert.equal(checks.length, 1);
assert.equal(cloudAudio.requests.length, 0, 'do not call play until the check succeeds');
cloudPlayer.load('/api/netease/song/stream/2');
assert.equal(checks[0].signal.aborted, true);
checks[0].reject(new Error('obsolete check failed'));
await Promise.resolve();
assert.equal(playbackErrors.length, 0, 'a replaced track cannot show a stale error');
const copyrightError = { code: 'NETEASE_TRACK_UNAVAILABLE', httpStatus: 404 };
checks[1].reject(copyrightError);
await Promise.resolve();
assert.deepEqual(playbackErrors, [copyrightError]);
assert.equal(cloudAudio.requests.length, 0);
cloudPlayer.toggle();
checks[2].resolve();
await Promise.resolve();
assert.equal(cloudAudio.src, '/api/netease/song/stream/2');
assert.equal(cloudAudio.requests.length, 1, 'the track can play after a successful check');
cloudAudio.requests[0].reject(new DOMException('Format failure', 'NotSupportedError'));
await Promise.resolve();
assert.equal(playbackErrors.at(-1).code, 'NotSupportedError', 'media failures include a diagnostic code');
cloudPlayer.dispose();
console.log('PASS playback checks: deferred cloud restore, cancellation, retry, and error details');
const { createPlaybackFeedback, hasPlaybackIntent } = load('src/lib/playbackFeedback.ts');
const feedback = createPlaybackFeedback();
const feedbackStates = [];
const unsubscribeFeedback = feedback.subscribe(() => feedbackStates.push(feedback.getSnapshot()));
feedback.setStatus('playing');
for (let i = 0; i < 50; i++) {
  feedback.setStatus('buffering');
  feedback.setStatus('playing');
}
await new Promise(resolve => setTimeout(resolve, 210));
assert.deepEqual(feedbackStates, ['playing'], 'short seeks must not flash feedback or notify page subscribers');
feedback.setStatus('buffering');
await new Promise(resolve => setTimeout(resolve, 100));
feedback.setStatus('buffering');
await new Promise(resolve => setTimeout(resolve, 110));
assert.equal(feedback.getSnapshot(), 'buffering', 'repeated waiting must not postpone feedback indefinitely');
feedback.setStatus('paused');
assert.equal(feedback.getSnapshot(), 'paused');
feedback.setStatus('loading');
feedback.setStatus('error');
assert.equal(feedback.getSnapshot(), 'error', 'failures are immediate');
await new Promise(resolve => setTimeout(resolve, 210));
assert.equal(feedback.getSnapshot(), 'error', 'stale timers cannot overwrite a failure');
feedback.setStatus('loading');
feedback.cancelPending();
await new Promise(resolve => setTimeout(resolve, 210));
assert.equal(feedback.getSnapshot(), 'error', 'cleanup cancels delayed feedback');
unsubscribeFeedback();
const intentAudio = new Audio();
const intents = [];
const intentPlayer = createAudioPlayback(intentAudio, status => {
  const intent = hasPlaybackIntent(status);
  if (intents.at(-1) !== intent) intents.push(intent);
});
void intentPlayer.play();
intentAudio.requests[0].resolve(); await Promise.resolve();
for (let i = 0; i < 50; i++) {
  intentAudio.dispatchEvent(new Event('waiting'));
  intentAudio.dispatchEvent(new Event('stalled'));
  intentAudio.dispatchEvent(new Event('playing'));
}
assert.deepEqual(intents, [true], 'seek buffering must not restart cover/visualizer/persistence state');
intentAudio.dispatchEvent(new Event('waiting'));
intentPlayer.toggle();
intentAudio.dispatchEvent(new Event('playing'));
assert.deepEqual(intents, [true, false], 'pause during buffering remains authoritative');
intentPlayer.dispose();
console.log('PASS buffering: stable transport intent, isolated delayed feedback, repeated seeks, cancellation and immediate errors');
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
const { stepLyricScroll, stepAnchoredLyricScroll } = load('src/lib/lyricScroll.ts');
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
for (const fps of [30, 60, 120]) {
  for (const direction of [-1, 1]) {
    let position = 500 - direction * 180, velocity = -direction * 100;
    let previousTarget = 500, previousDistance = 180;
    for (let frame = 0; frame < fps * 2; frame++) {
      // Previous translation collapses while the new line's padding expands.
      const time = frame / fps;
      const target = 500 - 100 * Math.min(time / .4, 1) + 64 * Math.min(time / .7, 1);
      ({ position, velocity } = stepAnchoredLyricScroll(position, velocity, previousTarget, target, 1 / fps));
      const distance = (target - position) * direction;
      assert(distance >= -1e-8 && distance <= previousDistance + 1e-8, 'translation layout must not reverse or overshoot visual travel');
      previousDistance = distance;
      previousTarget = target;
    }
    assert(previousDistance < .01);
  }
}
console.log('PASS translation anchor: expanding/collapsing layout, forward/backward seeking, no rebound at 30/60/120fps');
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
const quietTone = Uint8Array.from({ length: 2048 }, (_, i) => Math.round(128 + 12 * Math.sin(i * .025)));
const boostedPoints = new Float32Array(128);
const gainState = { gain: 1 };
for (let i = 0; i < 30; i++) updateWaveform(quietTone, boostedPoints, 1 / 30, gainState);
assert(Math.max(...boostedPoints.map(Math.abs)) > .35, 'quiet music must have clearly visible amplitude');
assert(gainState.gain <= 6 && gainState.gain >= 1);
const noise = Uint8Array.from({ length: 2048 }, (_, i) => i % 2 ? 127 : 129);
for (let i = 0; i < 30; i++) updateWaveform(noise, boostedPoints, 1 / 30, gainState);
assert(boostedPoints.every(value => Math.abs(value) < .001), 'noise floor must not be amplified');
const loudTone = new Uint8Array(2048).fill(255);
updateWaveform(loudTone, boostedPoints, 1 / 30, gainState);
assert(boostedPoints.every(value => Math.abs(value) <= .95), 'loud passages remain inside the canvas');
console.log('PASS waveform gain: visible quiet signals, bounded gain, noise gate and headroom');
const { pageMotion, animatePageArrival, PAGE_TRANSITION } = load('src/lib/pageMotion.ts');
for (const axis of ['x', 'y']) {
  const normal = pageMotion(false, axis, 18);
  assert.equal(normal.initial[axis], 18);
  assert.equal(normal.animate[axis], 0);
  assert(normal.exit.transition.duration < normal.transition.duration);
  assert.equal(normal.transition.type, 'tween');
  assert(!('filter' in normal.initial) && !('scale' in normal.initial));
  const reduced = pageMotion(true, axis, 18);
  assert.equal(reduced.initial[axis], 0);
  assert.equal(reduced.exit[axis], 0);
  assert.equal(reduced.transition.duration, 0);
  assert.equal(reduced.exit.transition.duration, 0);
}
let arrivalCalls = 0, arrivalCancellations = 0;
const retainedSurface = {
  closest: () => null,
  animate: (frames, options) => {
    arrivalCalls++;
    assert(frames.every(frame => !('filter' in frame) && !('opacity' in frame)));
    assert.equal(options.duration, PAGE_TRANSITION.duration * 1000);
    return { cancel: () => arrivalCancellations++ };
  },
};
animatePageArrival(retainedSurface, false).cancel();
assert.equal(arrivalCalls, 1);
assert.equal(arrivalCancellations, 1);
assert.equal(animatePageArrival(retainedSurface, true), undefined);
assert.equal(animatePageArrival({ ...retainedSurface, closest: () => ({}) }, false), undefined);
assert.equal(animatePageArrival(null, false), undefined);
assert.equal(arrivalCalls, 1, 'reduced-motion and hidden pages do not start animations');
console.log('PASS page motion: asymmetric easing, bounded travel, reduced motion, retained surfaces and cleanup');
const { Background, backgroundAudit } = load('src/components/Background.tsx',
  '\nexport const backgroundAudit = { ACTIVE_BLOB_CONFIGS, STREAMER_SPEED_MULTIPLIER, STREAMER_PALETTE_COLOR_COUNT, STREAMER_PALETTE_QUALITY, buildStreamerColors, buildStreamerUnderpaint };',
  { colorthief: { getPalette() {} } });
const renderBackground = props => renderToStaticMarkup(React.createElement(Background, props));
const coverBackground = renderBackground({ effect: 'blur', imageSrc: '/cover.jpg' });
assert(coverBackground.includes('blur-[7px]') && !coverBackground.includes('blur-[80px]'));
const lightFlow = renderBackground({ effect: 'streamer' });
assert.equal((lightFlow.match(/radial-gradient/g) || []).length, 10);
assert(lightFlow.includes('bg-black/30'));
assert.equal(backgroundAudit.ACTIVE_BLOB_CONFIGS.length, 10);
assert(backgroundAudit.ACTIVE_BLOB_CONFIGS.slice(0, 6).every(blob => blob.size === 65));
assert(lightFlow.includes('65vmax'), 'broad fields must follow the longer viewport dimension');
assert(lightFlow.includes('background-color:rgb(38, 38, 38)'), 'palette crossfades retain a nonblack backing');
for (const colors of [[], ['rgb(80, 90, 100)'], ['red', 'green', 'blue']]) {
  const underpaint = backgroundAudit.buildStreamerUnderpaint(colors);
  assert(underpaint.includes('linear-gradient(135deg,'));
  assert(!underpaint.includes('transparent') && !underpaint.includes('undefined'), 'underpainting has opaque stops even with an empty palette');
}
assert.equal(backgroundAudit.STREAMER_PALETTE_COLOR_COUNT, 10);
assert.equal(backgroundAudit.STREAMER_PALETTE_QUALITY, 5);
assert.equal(new Set(backgroundAudit.ACTIVE_BLOB_CONFIGS.map(blob => blob.size)).size, 3);
assert.equal(new Set(backgroundAudit.ACTIVE_BLOB_CONFIGS.map(blob => blob.phase)).size, 10);
const richPalette = [[255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [128, 0, 255], [255, 0, 255], [255, 128, 128], [128, 255, 128]];
assert.equal(backgroundAudit.buildStreamerColors(richPalette).length, 8);
assert(backgroundAudit.buildStreamerColors([]).length > 0);
for (const blob of backgroundAudit.ACTIVE_BLOB_CONFIGS) {
  assert.equal(blob.xKeys[0], blob.xKeys.at(-1), 'flow loops without a positional seam');
  assert.equal(blob.yKeys[0], blob.yKeys.at(-1));
  assert(blob.duration * backgroundAudit.STREAMER_SPEED_MULTIPLIER >= 30, 'flow stays slow and atmospheric');
}
assert(!renderBackground({ effect: 'streamer', transparentBackground: true }).includes('radial-gradient'));
assert(!renderBackground({ effect: 'blur', customBackground: { imageSrc: '/custom.jpg' } }).includes('blur-[7px]'));
console.log('PASS backgrounds: 7px cover blur, richer palette, ten varied light-flow layers, closed paths and unchanged custom/transparent modes');
const { readBufferedRanges, bufferedTrack } = load('src/lib/bufferedRanges.ts');
const mediaRanges = (pairs, duration = 100) => ({ duration, buffered: { length: pairs.length, start: i => pairs[i][0], end: i => pairs[i][1] } });
assert.deepEqual(readBufferedRanges(mediaRanges([[0, 10], [40, 60]])), [{ start: 0, end: 10 }, { start: 40, end: 60 }]);
assert.deepEqual(readBufferedRanges(mediaRanges([[-5, 10], [90, 130], [30, 20], [NaN, 3]])), [{ start: 0, end: 10 }, { start: 90, end: 100 }]);
for (const duration of [0, NaN, Infinity, -1]) assert.deepEqual(readBufferedRanges(mediaRanges([[0, 10]], duration)), []);
assert.deepEqual(readBufferedRanges({ duration: 100, get buffered() { throw Error('source replaced'); } }), []);
const track = bufferedTrack(readBufferedRanges(mediaRanges([[0, 10], [40, 60]])), 100, 5);
assert(track.includes('transparent 0% 40%, #ffffff40 40% 60%'), 'unbuffered gaps remain visible');
let bufferedEffect;
const bufferedUpdates = [];
const { useBufferedRanges } = load('src/hooks/useBufferedRanges.ts', '', { react: {
  useState: value => [value, next => bufferedUpdates.push(next)],
  useEffect: effect => { bufferedEffect = effect; },
} });
const bufferedAudio = Object.assign(new EventTarget(), mediaRanges([[0, 10]]));
useBufferedRanges({ current: bufferedAudio });
const disposeBuffer = bufferedEffect();
const initialBufferUpdates = bufferedUpdates.length;
for (let i = 0; i < 50; i++) bufferedAudio.dispatchEvent(new Event('progress'));
assert.equal(bufferedUpdates.length, initialBufferUpdates, 'unchanged ranges do not schedule React updates');
bufferedAudio.buffered = mediaRanges([[0, 20], [60, 80]]).buffered;
bufferedAudio.dispatchEvent(new Event('progress'));
assert.equal(bufferedUpdates.at(-1).length, 2);
bufferedAudio.dispatchEvent(new Event('emptied'));
assert.deepEqual(bufferedUpdates.at(-1), []);
disposeBuffer();
const beforeBufferDispose = bufferedUpdates.length;
bufferedAudio.dispatchEvent(new Event('progress'));
assert.equal(bufferedUpdates.length, beforeBufferDispose);
const { PlaybackSlider: TestSlider } = load('src/components/PlaybackSlider.tsx', '', { react: {
  ...React, useRef: current => ({ current }), useState: value => [value, () => {}], useEffect: () => {},
} });
const seeks = [];
const slider = TestSlider({ value: 10, max: 100, label: 'Seek', time: true, onChange: value => seeks.push(value) });
const input = slider.props.children.find(child => child?.type === 'input').props;
const down = () => input.onPointerDown({ button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } });
down();
for (let i = 20; i <= 40; i++) input.onChange({ target: { value: String(i) } });
assert.deepEqual(seeks, [], 'drag previews never send repeated audio seeks');
input.onPointerUp();
assert.deepEqual(seeks, [40], 'release commits once');
down(); input.onChange({ target: { value: '60' } }); input.onPointerCancel(); input.onPointerUp();
assert.deepEqual(seeks, [40]);
down(); input.onChange({ target: { value: '70' } }); input.onKeyDown({ key: 'Escape', stopPropagation() {} });
input.onChange({ target: { value: '80' } }); input.onPointerUp();
assert.deepEqual(seeks, [40], 'Escape ignores the rest of the cancelled gesture');
input.onKeyDown({ key: 'ArrowRight' }); input.onChange({ target: { value: '41' } });
assert.deepEqual(seeks, [40, 41], 'keyboard seeking remains immediate');
const { playbackAction, PlaybackStatusLine } = load('src/components/PlaybackStatus.tsx');
assert.equal(playbackAction('buffering', true, 'zh-CN'), '暂停');
assert.equal(playbackAction('error', false, 'zh-CN'), '重试播放');
assert(renderToStaticMarkup(React.createElement(PlaybackStatusLine, { status: 'error', language: 'en-US' })).includes('Playback failed'));
const { PlaybackErrorDialog } = load('src/components/PlaybackErrorDialog.tsx');
const unavailableDialog = renderToStaticMarkup(React.createElement(PlaybackErrorDialog, {
  track: 'Unavailable track', error: copyrightError, language: 'zh-CN', onDismiss() {},
}));
assert(unavailableDialog.includes('role="alertdialog"') && unavailableDialog.includes('Unavailable track'));
assert(unavailableDialog.includes('可能无版权') && unavailableDialog.includes('HTTP 404'));
const riskDialog = renderToStaticMarkup(React.createElement(PlaybackErrorDialog, {
  track: 'Cloud track', error: { code: 'NETEASE_RISK_CONTROL', httpStatus: 429, retryAfter: 60 },
  language: 'en-US', onDismiss() {},
}));
assert(riskDialog.includes('Wait at least 60 seconds') && riskDialog.includes('NETEASE_RISK_CONTROL'));
console.log('PASS iteration A: disjoint buffered ranges, source reset, deduplicated updates, listener cleanup, single-commit scrubbing and shared playback feedback');

let queueEffect, queueDependencies;
const queueRefs = [];
const { Playlist: TestQueue } = load('src/components/Playlist.tsx', '', { react: {
  ...React, useState: value => [value, () => {}],
  useRef: current => { const ref = { current }; queueRefs.push(ref); return ref; },
  useLayoutEffect: (effect, dependencies) => { queueEffect = effect; queueDependencies = dependencies; },
} });
const queueSongs = Array.from({ length: 100 }, (_, index) => ({ title: `Track ${index}`, artist: 'Artist', file: `/${index}.mp3` }));
const queueProps = { songs: queueSongs, currentIndex: 70, isPlaying: false, onSelect() {}, onRemove() {} };
TestQueue(queueProps);
const queueList = { scrollTop: 0, clientHeight: 400, getBoundingClientRect: () => ({ top: 100 }) };
queueRefs[0].current = queueList;
queueRefs[1].current = { offsetHeight: 60, getBoundingClientRect: () => ({ top: 4300 }) };
queueEffect();
assert.equal(queueList.scrollTop, 4030, 'opening a deep queue centers the active row instead of starting at the top');
const initialQueueDependencies = queueDependencies;
TestQueue({ ...queueProps, isPlaying: true });
assert.deepEqual(queueDependencies, initialQueueDependencies, 'play/pause does not reset manual queue scrolling');
TestQueue({ ...queueProps, currentIndex: 71 });
assert.notDeepEqual(queueDependencies, initialQueueDependencies, 'changing the current track updates the location');
TestQueue({ ...queueProps, currentIndex: -1 });
assert.doesNotThrow(() => queueEffect(), 'empty or inactive queues are safe');
console.log('PASS queue location: center current song on open/change, no transport-driven scroll reset');

const { EQView, gainToRatio, buildEQCurve } = load('src/components/EQView.tsx');
const { getEQCopy } = load('src/lib/copy.ts');
assert.equal(gainToRatio(-12), 0);
assert.equal(gainToRatio(0), 0.5);
assert.equal(gainToRatio(12), 1);
assert.equal(gainToRatio(NaN), 0.5);
assert.equal(buildEQCurve([]), '');
assert.equal(buildEQCurve([0]), 'M 50 50');
assert.equal(buildEQCurve([-12, 12]), 'M 25 100 C 50 100, 50 0, 75 0');
for (const language of ['zh-CN', 'en-US']) {
  const markup = renderToStaticMarkup(React.createElement(EQView, {
    copy: getEQCopy(language), enabled: true,
    bands: Array.from({ length: 10 }, (_, index) => ({ frequency: index + 1, label: `${index + 1} Hz`, gain: 0 })),
    onToggleEnabled() {}, onBandGainChange() {}, onReset() {},
  }));
  assert.equal((markup.match(/aria-orientation="vertical"/g) || []).length, 10);
  assert(markup.includes('aria-checked="true"'));
  assert(markup.includes('repeat(10, minmax(0, 1fr))'));
  assert(!markup.includes('-rotate-90') && !markup.includes('min-w-[58rem]'));
}
console.log('PASS equalizer: normalized endpoints, responsive full-width grid and ten labelled vertical controls');

const miniSource = fs.readFileSync('src/components/MiniPlayer.tsx', 'utf8');
const playerStyles = fs.readFileSync('src/index.css', 'utf8');
assert(miniSource.includes('rf-queue-anchor') && miniSource.includes('AnimatePresence initial={false}'));
assert(miniSource.includes("pageMotion(reducedMotion, 'y', 10)"), 'queue shares reduced-motion-aware enter/exit easing');
assert(miniSource.includes('queueButtonRef.current?.focus()'), 'closing returns focus to the trigger');
const primaryStyle = playerStyles.match(/\.rf-player-primary\s*\{[^}]+\}/g) || [];
assert(primaryStyle.some(rule => rule.includes('overflow: visible')));
assert(primaryStyle.every(rule => !rule.includes('overflow-y: auto')), 'the artwork column cannot become a shadow-clipping scroll viewport');
const popoverStyle = playerStyles.match(/\.rf-queue-popover\s*\{([^}]+)\}/)[1];
assert(popoverStyle.includes('position: fixed') && miniSource.includes('window.innerHeight - rect.top + 20') && miniSource.includes('window.innerWidth - rect.right'), 'portaled popover follows the queue button');
assert(!popoverStyle.includes('bottom: 148px'), 'popover follows its button, not a fixed viewport offset');
console.log('PASS dock queue: anchored presence animation, close focus, unclipped responsive artwork');

const guideSource = fs.readFileSync('src/components/OnboardingGuide.tsx', 'utf8');
const guideTargets = [...guideSource.matchAll(/target: '(guide-[^']+)'/g)].map(match => match[1]);
const guideAnchorSources = [
  fs.readFileSync('src/App.tsx', 'utf8'),
  miniSource,
  fs.readFileSync('src/components/PlayerControls.tsx', 'utf8'),
].join('\n');
assert(guideTargets.length >= 20, 'tour covers the home and expanded player controls');
for (const target of new Set(guideTargets)) {
  assert(guideAnchorSources.includes(`data-guide="${target}"`), `missing guide anchor: ${target}`);
}
assert(guideSource.includes('pointer-events-none') && guideSource.includes('aria-modal="false"'), 'guided controls must remain interactive');
assert(playerStyles.includes('rf-guide-spotlight') && playerStyles.includes('border: 2px dashed') && playerStyles.includes('backdrop-filter: blur(30px)'), 'tour uses dashed glass spotlight');
console.log('PASS onboarding: every tour target is anchored, controls remain interactive, glass spotlight exists');

{
  const flushCalls = [];
  const { runViewTransition, canUseViewTransition, playCardEnter, cardEnter } = load('src/lib/viewTransition.ts', '', { 'react-dom': { flushSync: fn => { flushCalls.push(1); fn(); } } });
  let applied = 0;
  runViewTransition(() => applied++);
  assert.equal(applied, 1, 'without the API the update runs synchronously, once');
  const finished = Promise.withResolvers();
  const started = [];
  const fakeDocument = {
    visibilityState: 'visible',
    documentElement: { dataset: {} },
    startViewTransition: update => { started.push(update); return { finished: finished.promise, skipTransition() {} }; },
  };
  globalThis.document = fakeDocument;
  globalThis.window = { matchMedia: () => ({ matches: false }), setTimeout, clearTimeout };
  try {
    assert.equal(canUseViewTransition(), true);
    runViewTransition(() => applied++, 'page', { direction: 'back' });
    assert.equal(applied, 1, 'the update waits for the old snapshot');
    assert.equal(fakeDocument.documentElement.dataset.rfTransition, 'page');
    assert.equal(fakeDocument.documentElement.dataset.rfDirection, 'back');
    started[0](); started[0]();
    assert.equal(applied, 2, 'the update is applied exactly once inside flushSync');
    assert.equal(flushCalls.length, 1);
    finished.resolve(); await finished.promise; await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fakeDocument.documentElement.dataset.rfTransition, undefined, 'transition marker is cleared');
    assert.equal(fakeDocument.documentElement.dataset.rfDirection, undefined);
    const played = [];
    const surface = { getAnimations: () => [], animate: (frames, options) => { played.push({ frames, options }); return {}; } };
    playCardEnter(cardEnter.player, { querySelector: () => surface });
    assert.equal(played.length, 1);
    assert(played[0].frames.every(frame => Object.keys(frame).join() === 'transform'), 'card entry animates transform only, so glass keeps its backdrop');
    assert.equal(played[0].frames.at(-1).transform, 'none');
    assert.deepEqual(playCardEnter(cardEnter.player, { querySelector: () => null }), [], 'missing surfaces are skipped');
    globalThis.window = { matchMedia: () => ({ matches: true }), setTimeout, clearTimeout };
    runViewTransition(() => applied++);
    assert.equal(applied, 3, 'reduced motion skips the transition');
    assert.equal(started.length, 1);
    // Watchdog: a stalled snapshot capture must not freeze navigation.
    const stalled = Promise.withResolvers();
    let skipped = 0;
    fakeDocument.startViewTransition = () => ({ finished: stalled.promise, skipTransition: () => { skipped++; } });
    globalThis.window = { matchMedia: () => ({ matches: false }), setTimeout, clearTimeout };
    const beforeStall = applied;
    runViewTransition(() => applied++, 'section');
    assert.equal(applied, beforeStall, 'update waits for the capture');
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(applied, beforeStall + 1, 'watchdog applies the update when capture stalls');
    assert.equal(skipped, 1, 'and skips the stalled transition');
    stalled.resolve();
    fakeDocument.visibilityState = 'hidden';
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(canUseViewTransition(), false, 'hidden windows update without capturing snapshots');
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  assert(!appSource.includes("mode=\"wait\""), 'page swaps never wait for an exit before the next page appears');
  assert(!appSource.includes('pageMotion('), 'page-level live opacity animation is replaced by snapshot cross-fades');
  const librarySource = fs.readFileSync('src/components/Library.tsx', 'utf8');
  assert(!/delay: Math\.min\(index/.test(librarySource), 'grid and list items do not stagger in');
  assert(!librarySource.includes('displayedPlaylist.songs.findIndex'), 'playlist rows resolve indices in O(1)');
  const css = fs.readFileSync('src/index.css', 'utf8');
  assert(css.includes('clip-path: inset(56px 0 0 0 round 28px)'), 'the outgoing card leaves the title bar in place');
  const cardKeyframes = css.match(/@keyframes rf-card-(recede|drop) \{[\s\S]*?\n\}/g) || [];
  assert.equal(cardKeyframes.length, 2);
  assert(cardKeyframes.every(rule => !rule.includes('filter')), 'transition snapshots are never filtered (renders white in transparent windows)');
  assert(!/view-transition-name/.test(css + appSource), 'no glass surface is captured as a separate (backdrop-root) group');
  // Every transition: the new page is opaque from the first frame and only the
  // old snapshot animates. A two-sided cross-fade dims the whole window.
  const newRootRules = [...css.matchAll(/([^{}]*::view-transition-new\(root\)[^{}]*)\{([^}]*)\}/g)];
  assert(newRootRules.length > 0);
  assert(newRootRules.every(([, selector, body]) => /animation:\s*none/.test(body) || /prefers-reduced-motion/.test(selector)), 'the incoming page never fades in');
  assert(!/::view-transition-new\(root\)\s*\{[^}]*animation-duration/.test(css), 'no separate fade timing for the incoming page');
  console.log('PASS card transitions: one-shot update, direction markers, transform-only entry, title bar kept, fallback, reduced motion');
}

{
  const { parseCssColor, blobOffsetAt } = load('src/lib/streamerGL.ts');
  const near = (actual, expected) => actual.every((value, index) => Math.abs(value - expected[index]) < 0.01);
  assert(near(parseCssColor('rgb(38, 38, 38)'), [38 / 255, 38 / 255, 38 / 255]));
  assert(near(parseCssColor('hsl(0 100% 50%)'), [1, 0, 0]));
  assert(near(parseCssColor('hsl(210 30% 72%)'), [0.636, 0.72, 0.804]));
  assert(near(parseCssColor('#336699'), [0.2, 0.4, 0.6]));
  assert.equal(parseCssColor('transparent'), null);
  const blob = { left: '10%', top: '20%', size: 65, opacity: .85, duration: 100, phase: 0, xKeys: [0, 100, -50, 20, 0], yKeys: [0, 40, 80, -10, 0] };
  assert.deepEqual(blobOffsetAt(blob, 0, 1), [0, 0]);
  assert(near(blobOffsetAt(blob, 25, 1), [100, 40]), 'keyframe 25% matches the CSS path');
  assert(near(blobOffsetAt(blob, 50, 1), [-50, 80]));
  assert(near(blobOffsetAt(blob, 100, 1), [0, 0]), 'the loop closes without a seam');
  assert(near(blobOffsetAt({ ...blob, phase: 25 }, 0, 1), [100, 40]), 'phase acts as a negative delay');
  const bgSource = fs.readFileSync('src/components/Background.tsx', 'utf8');
  assert(!bgSource.includes('mode="wait"'), 'background swaps cross-fade instead of dipping to black');
  console.log('PASS WebGL light flow: CSS color parsing, keyframe parity, closed loops, cross-faded swaps');
}

{
  const { getRemainingPageOffsets } = load('src/hooks/useNetEase.ts', '', { react: { useCallback: f => f, useEffect() {}, useRef: v => ({ current: v }), useState: v => [v, () => {}] } });
  assert.deepEqual(getRemainingPageOffsets(200, 1150, 500), [200, 700]);
  assert.deepEqual(getRemainingPageOffsets(200, 200, 500), []);
  assert.deepEqual(getRemainingPageOffsets(null, 5000, 500), []);
  assert.equal(getRemainingPageOffsets(200, 10200, 500).length, 20);
  console.log('PASS playlist paging: remaining page plan for large playlists');
}

const netease = require('@neteasecloudmusicapienhanced/api');
const originalSongUrl = netease.song_url_v1;
const originalLegacySongUrl = netease.song_url;
const originalRegisterXeapiKey = netease.register_xeapikey;
const originalLoginStatus = netease.login_status;
const originalPlaylistDetail = netease.playlist_detail;
const originalSongDetail = netease.song_detail;
const originalQrKey = netease.login_qr_key;
const originalQrCheck = netease.login_qr_check;
const originalLogout = netease.logout;
const originalLyric = netease.lyric_new;
const originalSearch = netease.search;
const originalCloudSearch = netease.cloudsearch;
const originalArtists = netease.artists;
const originalArtistAlbums = netease.artist_album;
const originalAlbum = netease.album;
const originalNow = Date.now;
const playbackRequests = [];
let upstreamMode = 'rejected';
let nowOffset = 0;
let keyRequests = 0;
let playlistDetails = 0;
const response = body => ({ status: 200, body, cookie: [] });
let qrStarts = 0;
let qrChecks = 0;
let qrCode = 801;
let logoutCookie;
netease.login_qr_key = async () => response({ data: { unikey: `qr-${++qrStarts}` } });
netease.login_qr_check = async () => {
  qrChecks++;
  return response({ code: qrCode, ...(qrCode === 803 ? { cookie: 'MUSIC_U=test-page-b' } : {}) });
};
netease.logout = async ({ cookie }) => {
  logoutCookie = cookie;
  return response({ code: 200 });
};
netease.lyric_new = async ({ id }) => response({ lrc: { lyric: `[00:01.00]Track ${id}` } });
netease.search = async () => response({ result: { songs: [
  { id: 123, name: 'Fixture', artists: [{ name: 'Artist' }], album: { id: 77, name: 'Album' } },
] } });
netease.cloudsearch = netease.search;
netease.artists = async () => response({ artist: { id: 61, name: 'Artist' } });
netease.artist_album = async () => response({
  hotAlbums: [{ id: 77, name: 'Album', artist: { id: 61, name: 'Artist' } }],
  more: false,
});
netease.album = async () => response({
  album: { id: 77, name: 'Album', artist: { id: 61, name: 'Artist' } },
  songs: [{ id: 123, name: 'Fixture', ar: [{ id: 61, name: 'Artist' }], al: { id: 77, name: 'Album' } }],
});
const isSecondSession = query => query.cookie.includes('MUSIC_U=test-page-b');
netease.login_status = async query => response({ profile: { userId: isSecondSession(query) ? 2 : 1 } });
netease.playlist_detail = async query => {
  playlistDetails++;
  const firstId = isSecondSession(query) ? 31 : 11;
  return response({ playlist: {
    id: 9, name: 'Shared playlist', trackIds: [firstId, firstId + 1].map(id => ({ id })), trackCount: 2,
  } });
};
netease.song_detail = async query => response({
  songs: query.ids.split(',').reverse().map(id => ({ id, name: `Track ${id}` })),
});
netease.register_xeapikey = async () => {
  keyRequests++;
  throw new Error('Simulated key registration failure');
};
netease.song_url_v1 = async (query) => {
  playbackRequests.push(query);
  if (upstreamMode === 'rejected') throw { status: 400, body: { code: -460 } };
  if (upstreamMode === 'resolved') return { status: 200, body: { code: '460' } };
  if (upstreamMode === 'preview') {
    return { status: 200, body: { data: [{ url: 'https://invalid.example/preview', freeTrialInfo: {} }] } };
  }
  if (upstreamMode === 'available') {
    return { status: 200, body: { data: [{ url: mockAudioUrl, code: 200 }] } };
  }
  if (upstreamMode === 'failed') throw new Error('Simulated connection failure');
  if (upstreamMode.startsWith('missing-key')) throw new Error('xeapi public key is missing');
  return { status: 200, body: { data: [{ url: null }] } };
};
netease.song_url = async (query) => {
  playbackRequests.push(query);
  if (upstreamMode === 'missing-key-legacy-available') {
    return { status: 200, body: { data: [{ url: mockAudioUrl, code: 200 }] } };
  }
  return { status: 200, body: { data: [{ url: null }] } };
};
Date.now = () => originalNow() + nowOffset;
let playbackServer;
let mockAudioUrl;
const playbackFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiflow-playback-'));
try {
  const audioBytes = Buffer.from([1, 2, 3, 4]);
  fs.writeFileSync(path.join(playbackFixtureDir, 'fixture.mp3'), audioBytes);
  const { startServer } = await tsImport('../server.ts', import.meta.url);
  const started = await startServer({ port: 0, host: '127.0.0.1', mode: 'production', initialMusicDir: playbackFixtureDir });
  playbackServer = started.server;
  const persistedCookies = [];
  const android = await startServer({
    port: 0, mode: 'production', initialMusicDir: playbackFixtureDir,
    android: {
      token: 'regression-test-token',
      cookie: 'MUSIC_U=test-android',
      persistCookie: cookie => persistedCookies.push(cookie),
    },
  });
  try {
    const headers = { 'X-RadiFlow-Token': 'regression-test-token' };
    const request = (route, method = 'GET') => fetch(`${android.url}/api/netease/${route}`, { headers, method });
    const qrCheck = key => request(`login/qr/check?key=${encodeURIComponent(key)}`);
    const qrStart = () => request('login/qr/start', 'POST').then(result => result.json());
    assert.equal(android.host, '127.0.0.1');
    assert.equal((await fetch(`${android.url}/api/netease/search`)).status, 403);
    assert.equal((await request('search')).status, 400);
    assert.equal((await fetch(`${android.url}/api/music`, { headers })).status, 404);
    assert.equal((await request('session', 'POST')).status, 404, 'Android cannot inject a cookie from the renderer');
    const sessionResponse = await request('session');
    assert.equal(sessionResponse.status, 200, 'Android can read its session without a renderer-provided cookie');
    const initialSession = await sessionResponse.json();
    assert.equal(initialSession.account.userId, 1);
    assert.equal(initialSession.hasCookie, true);
    assert.equal(Object.hasOwn(initialSession, 'cookie'), false);
    const trackLyric = await (await request('lyric/123')).json();
    assert.equal(trackLyric.data.lrc, '[00:01.00]Track 123');
    const matchedLyric = await (await request('lyric?title=Fixture&artist=Artist')).json();
    assert.equal(matchedLyric.data.lrc, '[00:01.00]Track 123');
    assert.equal((await (await request('search?keywords=Fixture')).json()).songs[0].albumId, '77');
    const artist = (await (await request('artist/61')).json()).collection;
    assert.deepEqual(artist.albums, [{ id: '77', name: 'Album', artist: 'Artist' }]);
    assert.equal(artist.songs[0].albumId, '77');
    assert.equal((await request('lyric/abc')).status, 404);
    const androidStream = () => fetch(`${android.url}/api/netease/song/stream/123`, { headers });
    upstreamMode = 'unavailable';
    const unavailable = await androidStream();
    assert.equal(unavailable.status, 404);
    assert.equal((await unavailable.json()).code, 'NETEASE_TRACK_UNAVAILABLE');
    upstreamMode = 'preview';
    const preview = await androidStream();
    assert.equal(preview.status, 404);
    assert.equal((await preview.json()).code, 'NETEASE_PREVIEW_ONLY');
    upstreamMode = 'rejected';
    assert.equal((await androidStream()).status, 429);
    assert.match(playbackRequests.at(-1).cookie, /MUSIC_U=test-android/);

    assert.equal((await (await qrCheck('unissued')).json()).code, 800);
    assert.equal(qrChecks, 0, 'unissued challenges cannot reach NetEase');
    const expiredQr = await qrStart();
    assert(expiredQr.qrImage.startsWith('data:image/png;base64,'));
    assert.equal((await (await qrCheck(expiredQr.key)).json()).code, 801);
    nowOffset = 181_000;
    assert.equal((await (await qrCheck(expiredQr.key)).json()).code, 800);
    assert.equal(qrChecks, 1, 'expired challenges cannot reach NetEase');
    const supersededQr = await qrStart();
    const activeQr = await qrStart();
    assert.equal((await (await qrCheck(supersededQr.key)).json()).code, 800);
    qrCode = 803;
    const confirmedQr = await (await qrCheck(activeQr.key)).json();
    assert.equal(confirmedQr.code, 803);
    assert.equal(confirmedQr.account.userId, 2);
    assert.equal(JSON.stringify(confirmedQr).includes('MUSIC_U'), false, 'the native server keeps credentials private');
    assert.equal(Object.hasOwn(confirmedQr, 'cookie'), false);
    assert.deepEqual(persistedCookies, ['MUSIC_U=test-page-b']);
    assert.equal((await (await qrCheck(activeQr.key)).json()).code, 800, 'successful challenges cannot be replayed');
    const abandonedQr = await qrStart();
    const signedOut = await (await request('logout', 'POST')).json();
    assert.equal(signedOut.hasCookie, false);
    assert.match(logoutCookie, /MUSIC_U=test-page-b/);
    assert.deepEqual(persistedCookies, ['MUSIC_U=test-page-b', null]);
    assert.equal((await (await qrCheck(abandonedQr.key)).json()).code, 800, 'logout revokes outstanding challenges');
    assert.equal((await request('playlists')).status, 401);
  } finally {
    await new Promise((resolve, reject) => android.server.close(error => error ? reject(error) : resolve()));
    playbackRequests.length = 0;
    nowOffset = 0;
  }
  const stream = (id, options) => fetch(`${started.url}/api/netease/song/stream/${id}?level=exhigh`, options);
  const check = (id) => fetch(`${started.url}/api/netease/song/stream/${id}?level=exhigh&check=1`);

  const denied = await stream(123);
  assert.equal(denied.status, 429, 'an upstream -460 should produce a rate-limit response');
  assert.equal((await denied.json()).code, 'NETEASE_RISK_CONTROL');
  assert(Number(denied.headers.get('Retry-After')) > 0);
  assert.equal(playbackRequests.length, 1, 'risk control must stop the lookup immediately');
  assert.equal(playbackRequests[0].randomCNIP, false, 'playback opts out even when the SDK default is enabled');
  assert.equal(playbackRequests[0].timeout, 5_000, 'playback lookups pass a timeout to the SDK');
  assert.equal(playbackRequests[0].unblock, undefined);

  const blocked = await stream(456);
  assert.equal(blocked.status, 429);
  await blocked.json();
  assert.equal(playbackRequests.length, 1, 'cooldown also protects rapid changes to another track');

  nowOffset += 60_000;
  upstreamMode = 'resolved';
  const resolvedDenial = await stream(789);
  assert.equal(resolvedDenial.status, 429, 'recognize a resolved response with a string risk code');
  await resolvedDenial.json();
  assert.equal(playbackRequests.length, 2, 'a stream request can reach the upstream again after cooldown');

  nowOffset += 60_000;
  upstreamMode = 'preview';
  const preview = await check(789);
  assert.equal(preview.status, 404, 'a preview is not a full stream');
  assert.equal((await preview.json()).code, 'NETEASE_PREVIEW_ONLY');
  assert.equal(playbackRequests.length, 3);

  upstreamMode = 'unavailable';
  const unavailable = await check(789);
  assert.equal(unavailable.status, 404);
  assert.equal((await unavailable.json()).code, 'NETEASE_TRACK_UNAVAILABLE');
  assert.deepEqual(playbackRequests.slice(3).map(({ level, br }) => level ?? br),
    ['exhigh', 'higher', 'standard', 320000, 192000, 128000]);

  upstreamMode = 'available';
  mockAudioUrl = `${started.url}/music/fixture.mp3`;
  const beforeCheck = playbackRequests.length;
  assert.equal((await check(789)).status, 204, 'checking a playable track must not proxy its body');
  const proxied = await stream(789, { headers: { Range: 'bytes=0-1' } });
  assert.equal(proxied.status, 206);
  assert.deepEqual(Buffer.from(await proxied.arrayBuffer()), audioBytes.subarray(0, 2));
  assert.equal(playbackRequests.length, beforeCheck + 1, 'streaming reuses the verified URL');

  upstreamMode = 'failed';
  const brokenCheck = await check(321);
  assert.equal(brokenCheck.status, 502);
  assert.equal((await brokenCheck.json()).code, 'NETEASE_LOOKUP_FAILED');

  upstreamMode = 'missing-key';
  const uninitialized = await check(321);
  assert.equal(uninitialized.status, 502);
  assert.equal((await uninitialized.json()).code, 'NETEASE_SDK_INIT_FAILED');
  assert.equal(keyRequests, 1, 'library mode initializes only the missing playback key');
  assert.equal(playbackRequests.at(-1).br, 320000, 'an initialization failure can use the existing legacy lookup');

  upstreamMode = 'missing-key-legacy-available';
  assert.equal((await check(654)).status, 204, 'a full legacy stream is usable when XEAPI initialization fails');

  const setSession = async cookie => {
    const result = await fetch(`${started.url}/api/netease/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie }),
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  const page = async offset => {
    const result = await fetch(`${started.url}/api/netease/playlist/9?offset=${offset}&limit=1`);
    assert.equal(result.status, 200);
    return result.json();
  };
  assert.equal((await setSession('MUSIC_U=test-page-a')).account.userId, 1);
  const firstPage = await page(0);
  assert.equal(firstPage.songs[0].filename, 'netease:11');
  assert.equal(firstPage.nextOffset, 1);
  assert.equal((await page(1)).songs[0].filename, 'netease:12');
  assert.equal(playlistDetails, 1, 'later pages reuse the current session’s track IDs');
  assert.equal((await setSession('MUSIC_U=test-page-b')).account.userId, 2);
  const secondAccountPage = await page(1);
  assert.equal(secondAccountPage.songs[0].filename, 'netease:32');
  assert.equal(secondAccountPage.nextOffset, null);
  assert.equal(playlistDetails, 2, 'switching sessions invalidates the cached track IDs');
} finally {
  Date.now = originalNow;
  netease.song_url_v1 = originalSongUrl;
  netease.song_url = originalLegacySongUrl;
  netease.register_xeapikey = originalRegisterXeapiKey;
  netease.login_status = originalLoginStatus;
  netease.playlist_detail = originalPlaylistDetail;
  netease.song_detail = originalSongDetail;
  netease.login_qr_key = originalQrKey;
  netease.login_qr_check = originalQrCheck;
  netease.logout = originalLogout;
  netease.lyric_new = originalLyric;
  netease.search = originalSearch;
  netease.cloudsearch = originalCloudSearch;
  netease.artists = originalArtists;
  netease.artist_album = originalArtistAlbums;
  netease.album = originalAlbum;
  if (playbackServer) await new Promise(resolve => playbackServer.close(resolve));
  fs.unlinkSync(path.join(playbackFixtureDir, 'fixture.mp3'));
  fs.rmdirSync(playbackFixtureDir);
}
console.log('PASS NetEase playback: risk cooldown, unavailable tracks, previews, and reuse of a checked stream');
console.log('PASS NetEase playlist pagination: cached order and session isolation');

const bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiflow-node-test-'));
const bootstrap = path.join(bootstrapDir, 'bootstrap.mjs');
const preview = path.join(bootstrapDir, 'preview-cookie');
const selected = path.join(bootstrapDir, 'selected');
try {
  fs.copyFileSync('scripts/android-node-server.mjs', bootstrap);
  fs.writeFileSync(preview, 'MUSIC_U=synthetic-preview');
  fs.writeFileSync(path.join(bootstrapDir, 'server.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    export async function startServer({ initialMusicDir, android }) {
      fs.writeFileSync(path.join(path.dirname(initialMusicDir), 'selected'), android.cookie || '');
      if (process.argv[5] !== undefined) android.persistCookie(process.argv[5] || null);
      return { port: 12345 };
    }
  `);
  const restart = (...action) => {
    execFileSync(process.execPath, [bootstrap, bootstrapDir, 'synthetic-token', preview, ...action]);
    assert.equal(fs.readFileSync(path.join(bootstrapDir, 'server.port'), 'utf8'), '12345');
    return fs.readFileSync(selected, 'utf8');
  };
  assert.equal(restart('MUSIC_U=synthetic-qr'), 'MUSIC_U=synthetic-preview');
  assert.equal(restart(''), 'MUSIC_U=synthetic-qr', 'QR credentials take priority on restart');
  assert.equal(restart(), '', 'logout survives restart even if a debug preview cookie exists');
} finally {
  for (const name of ['bootstrap.mjs', 'preview-cookie', 'server.mjs', 'server.port', 'selected', 'netease-session']) {
    fs.rmSync(path.join(bootstrapDir, name), { force: true });
  }
  const nodeTmp = path.join(bootstrapDir, 'tmp');
  if (fs.existsSync(nodeTmp)) fs.rmdirSync(nodeTmp);
  fs.rmdirSync(bootstrapDir);
}
console.log('PASS Android NetEase: private QR persistence, logout across process restarts, online lyrics, and collection browsing');
