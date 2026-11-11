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
