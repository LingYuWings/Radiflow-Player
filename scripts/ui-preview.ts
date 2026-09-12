// Isolated UI QA data. No login, user library or external music service is used.
import express from 'express';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const app = express();
const titles = ['晚风与海', 'After the Rain', '夜间航行', 'Somewhere Quiet', '月光散步', 'Blue Hour'];
const songs = Array.from({ length: 200 }, (_, index) => ({
  filename: `sample-${index}.wav`, fileUrl: `/sample.wav?id=${index}`, title: `${titles[index % titles.length]} ${String(index + 1).padStart(3, '0')}`,
  artist: index % 2 ? 'RadiFlow Sessions' : '夜航电台', album: index % 2 ? '静谧时刻' : 'Night Drive', cover: '/logo.svg', duration: 60,
}));
const audio = Buffer.alloc(44 + 8000 * 2 * 60);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
app.get('/sample.wav', (req, res) => {
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
  res.set('Content-Type', 'audio/wav').set('Accept-Ranges', 'bytes');
  if (start > end || start >= audio.length) { res.sendStatus(416); return; }
  if (range) res.status(206).set('Content-Range', `bytes ${start}-${end}/${audio.length}`);
  res.send(audio.subarray(start, end + 1));
});
app.get('/api/music', (_req, res) => res.json({ songs, folder: 'UI preview · simulated library' }));
const previewYrc = ['夜色慢慢落下来', '把喧嚣留在窗外', '让音乐陪你走过', '每一个安静的夜晚', 'The city falls asleep', 'A little room to breathe', '星光依然在远方', '沿着旋律继续走', '再听一首喜欢的歌', '明天会有新的日出', 'Hold on to this moment'].map((text, index) => {
  const words = text.includes(' ') ? text.match(/\S+\s*/g)! : Array.from(text);
  const duration = Math.floor(4800 / words.length);
  return `[${index * 5000},5000]` + words.map((word, wordIndex) => `(${index * 5000 + wordIndex * duration},${duration},0)${word}`).join('');
}).join('\n');
app.get('/api/lyrics', (_req, res) => res.json({ code: 200, data: { yrc: previewYrc, lrc: '[00:00.00]夜色慢慢落下来\n[00:05.00]把喧嚣留在窗外\n[00:10.00]让音乐陪你走过\n[00:15.00]每一个安静的夜晚\n[00:20.00]The city falls asleep\n[00:25.00]A little room to breathe\n[00:30.00]星光依然在远方\n[00:35.00]沿着旋律继续走\n[00:40.00]再听一首喜欢的歌\n[00:45.00]明天会有新的日出\n[00:50.00]Hold on to this moment', tlyric: '[00:20.00]城市渐渐入睡\n[00:25.00]留一点呼吸的空间\n[00:50.00]留住此刻' } }));
app.get('/api/netease/session', (_req, res) => res.json({ isLoggedIn: false, isConfigured: true, hasCookie: false, account: null }));
app.get('/api/netease/favorites', (_req, res) => res.json({ songs: [], albums: [] }));
app.get('/api/netease/search/hot/detail', (_req, res) => res.json({ items: [{ keyword: '夜航' }, { keyword: 'offline' }] }));
app.get('/api/netease/search', (req, res) => {
  if (req.query.keywords === 'offline') { res.status(502).json({ error: 'Simulated offline response' }); return; }
  const offset = Number(req.query.offset) || 0;
  res.json({ songs: songs.slice(offset, offset + 30), artists: [], albums: [], total: songs.length });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not available in UI preview' }));
const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'radiflow-ui-'));
const vite = await createServer({ cacheDir, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
app.use(vite.middlewares);
app.use(async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, await fs.readFile('index.html', 'utf8'))));
const previewServer = app.listen(0, '127.0.0.1', () => {
  const address = previewServer.address();
  if (address && typeof address !== 'string') console.log(`Isolated UI preview: http://127.0.0.1:${address.port}`);
});
