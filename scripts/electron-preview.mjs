import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const nodeExecutable = process.execPath;
const tsxCliPath = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const electronCliPath = path.join(rootDir, 'node_modules', 'electron', 'cli.js');
const previewPort = process.env.ELECTRON_PREVIEW_PORT ?? '4173';
const previewUrl = `http://127.0.0.1:${previewPort}`;
const previewUserDataDir = path.join(rootDir, '.electron-preview');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (url, attempts = 60) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore connection errors while the server starts.
    }

    await sleep(500);
  }

  throw new Error(`Preview server did not start in time: ${url}`);
};

const serverProcess = spawn(nodeExecutable, [tsxCliPath, 'server.ts'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DISABLE_HMR: 'true',
    PORT: previewPort,
  },
});

let electronProcess;
let shuttingDown = false;

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }

  process.exit(exitCode);
};

serverProcess.on('exit', (code) => {
  if (!shuttingDown) {
    shutdown(code ?? 1);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

try {
  await waitForServer(previewUrl);

  electronProcess = spawn(nodeExecutable, [electronCliPath, '.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_START_URL: previewUrl,
      ELECTRON_DISABLE_DEVTOOLS: 'true',
      ELECTRON_USER_DATA_DIR: previewUserDataDir,
    },
  });

  electronProcess.on('exit', (code) => {
    shutdown(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}