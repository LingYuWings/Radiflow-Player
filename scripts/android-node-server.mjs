import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const [dataDir, token, debugCookiePath] = process.argv.slice(2);
const portFile = path.join(dataDir, 'server.port');
const sessionFile = path.join(dataDir, 'netease-session');
const tmp = path.join(dataDir, 'tmp');
fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
process.env.TMPDIR = tmp;
process.env.HOME = dataDir;
process.env.DOTENV_CONFIG_QUIET = 'true';
// Some upstream error objects contain HTTP headers and cookies.
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

function persistCookie(cookie) {
  const temporary = sessionFile + '.' + randomUUID();
  try {
    // An empty file records logout and takes precedence over any debug seed.
    fs.writeFileSync(temporary, cookie ?? '', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, sessionFile);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function main() {
  const cookiePath = fs.existsSync(sessionFile) ? sessionFile : debugCookiePath;
  const cookie = cookiePath && fs.existsSync(cookiePath) ? fs.readFileSync(cookiePath, 'utf8').trim() : undefined;
  const { startServer } = await import('./server.mjs');
  const { port } = await startServer({
    mode: 'production',
    initialMusicDir: path.join(dataDir, 'music'),
    android: { token, cookie, persistCookie },
  });
  fs.writeFileSync(portFile + '.new', String(port), { mode: 0o600 });
  fs.renameSync(portFile + '.new', portFile);
}

main().catch(error => {
  const code = /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'BOOTSTRAP';
  const builtin = code === 'ERR_UNKNOWN_BUILTIN_MODULE' ? /node:[a-z_/]+/.exec(error.message)?.[0] : undefined;
  fs.writeFileSync(portFile + '.new', 'error:' + code + (builtin ? ':' + builtin : ''), { mode: 0o600 });
  fs.renameSync(portFile + '.new', portFile);
});
