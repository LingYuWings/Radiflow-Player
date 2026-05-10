import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const nodeExecutable = process.execPath;
const npmExecPath = process.env.npm_execpath;
const electronDevScriptPath = path.join(rootDir, 'scripts', 'electron-dev.mjs');

const runNodeScript = (scriptPath, args = []) => new Promise((resolve, reject) => {
  const child = spawn(nodeExecutable, [scriptPath, ...args], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`Command failed with exit code ${code ?? 'null'}: node ${scriptPath}`));
  });
});

const runNpmCommand = (args) => {
  if (npmExecPath) {
    return runNodeScript(npmExecPath, args);
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? 'null'}: npm ${args.join(' ')}`));
    });
  });
};

if (!fs.existsSync(path.join(rootDir, 'node_modules'))) {
  console.log('node_modules/ not found, running npm install...');
  await runNpmCommand(['install']);
}

console.log('Starting RadiFlow quick start...');
await runNodeScript(electronDevScriptPath);