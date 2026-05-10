import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const nodeExecutable = process.execPath;
const tsxCliPath = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCliPath = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const electronCliPath = path.join(rootDir, 'node_modules', 'electron', 'cli.js');
const backendUrl = 'http://127.0.0.1:3000/api/settings/music-dir';
const rendererUrl = 'http://127.0.0.1:5173';

const spawnNodeProcess = (scriptPath, args) => (
  spawn(nodeExecutable, [scriptPath, ...args], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  })
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCondition = async (check, label, attempts = 120) => {
  for (let index = 0; index < attempts; index += 1) {
    if (await check()) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`Server did not start in time: ${label}`);
};

const isBackendReady = async () => {
  try {
    const response = await fetch(backendUrl, { method: 'GET' });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return typeof payload?.path === 'string';
  } catch {
    return false;
  }
};

const isRendererReady = async () => {
  try {
    const response = await fetch(rendererUrl, { method: 'GET' });
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    return html.includes('<title>RadiFlow Player</title>');
  } catch {
    return false;
  }
};

let backendProcess = null;
let rendererProcess = null;
let electronProcess;
let shuttingDown = false;

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of [electronProcess, rendererProcess, backendProcess]) {
    if (child && !child.killed) {
      child.kill();
    }
  }

  process.exit(exitCode);
};

const attachFailureHandler = (child) => {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

try {
  if (!(await isBackendReady())) {
    backendProcess = spawnNodeProcess(tsxCliPath, ['server.ts']);
    attachFailureHandler(backendProcess);
    await waitForCondition(isBackendReady, backendUrl);
  }

  if (!(await isRendererReady())) {
    rendererProcess = spawnNodeProcess(viteCliPath, ['--host', '127.0.0.1', '--port', '5173', '--strictPort']);
    attachFailureHandler(rendererProcess);
    await waitForCondition(isRendererReady, rendererUrl);
  }

  electronProcess = spawn(nodeExecutable, [electronCliPath, '.'], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_START_URL: rendererUrl,
    },
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve, reject) => {
    electronProcess.on('error', reject);
    electronProcess.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });

  shutdown(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
