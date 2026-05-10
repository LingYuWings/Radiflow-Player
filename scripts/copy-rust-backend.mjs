import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const executableName = process.platform === 'win32' ? 'radiflow-backend.exe' : 'radiflow-backend';
const sourcePath = path.join(rootDir, 'rust-backend', 'target', 'release', executableName);
const targetDir = path.join(rootDir, 'dist-electron', 'native');
const targetPath = path.join(targetDir, executableName);

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Rust backend binary not found: ${sourcePath}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);

if (process.platform !== 'win32') {
  fs.chmodSync(targetPath, 0o755);
}
