import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { build } from 'esbuild';

const runtimeDir = path.resolve('android/.node-runtime');
const release = '24.22.1-0';
const archiveName = 'nodejs-mobile-android-lite-' + release + '.zip';
const repository = 'https://github.com/fogtape/nodejs-mobile';
const ndkVersion = '28.2.13676358';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const hosts = { win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' };
const host = hosts[process.platform];
if (!host) throw new Error('Unsupported Android build host: ' + process.platform);
const compiler = process.platform === 'win32' ? 'clang++.exe' : 'clang++';
const ndk = process.env.ANDROID_NDK_HOME || path.join(sdk || '', 'ndk', ndkVersion);
const binDir = path.join(ndk, 'toolchains/llvm/prebuilt', host, 'bin');
if (!fs.existsSync(path.join(binDir, compiler))) {
  throw new Error('Set ANDROID_HOME and install Android NDK ' + ndkVersion + ' before running the Android build.');
}

fs.mkdirSync(runtimeDir, { recursive: true });
async function download(name, url, expectedHash) {
  const file = path.join(runtimeDir, name);
  const sha256 = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if (fs.existsSync(file) && sha256(file) === expectedHash) return file;
  const temporary = file + '.download';
  try {
    const result = await fetch(url);
    if (!result.ok) throw new Error('Download failed: ' + name + ' (HTTP ' + result.status + ')');
    await pipeline(result.body, fs.createWriteStream(temporary));
    if (sha256(temporary) !== expectedHash) throw new Error('Checksum mismatch: ' + name);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return file;
}

const archive = await download(archiveName, repository + '/releases/download/v' + release + '/' + archiveName,
  '87ac319660b9dbff1c3a878d5dec2e15560a42f04d7660c8ddaf87c24627ac82');
const license = await download('node-LICENSE.txt',
  'https://raw.githubusercontent.com/fogtape/nodejs-mobile/v' + release + '/LICENSE',
  'c373dabed995013e091b1908996a69a1647ef19d400e6c1fd4b7fb06d8bc0f66');

const unpacked = fs.mkdtempSync(path.join(runtimeDir, 'unpacked-'));
try {
  if (os.platform() === 'win32') {
    execFileSync('tar.exe', ['-xf', archive, '-C', unpacked, 'bin'], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', archive, 'bin/*', '-d', unpacked], { stdio: 'inherit' });
  }
  const targets = {
    'arm64-v8a': ['aarch64-linux-android24', 'aarch64-linux-android'],
    'armeabi-v7a': ['armv7a-linux-androideabi24', 'arm-linux-androideabi'],
    'x86_64': ['x86_64-linux-android24', 'x86_64-linux-android'],
  };
  for (const [abi, [target, sysrootTarget]] of Object.entries(targets)) {
    const output = path.join(runtimeDir, 'jniLibs', abi);
    fs.mkdirSync(output, { recursive: true });
    const libnode = path.join(output, 'libnode.so');
    fs.copyFileSync(path.join(unpacked, 'bin', abi, 'libnode.so'), libnode);
    fs.copyFileSync(path.join(binDir, '../sysroot/usr/lib', sysrootTarget, 'libc++_shared.so'),
      path.join(output, 'libc++_shared.so'));
    execFileSync(path.join(binDir, compiler), [
      '--target=' + target, '-std=c++17', '-shared', '-Os',
      '-Wl,--no-undefined', '-Wl,-z,max-page-size=16384',
      'android/app/src/main/cpp/embedded-node.cpp', libnode,
      '-o', path.join(output, 'libradiflow_node.so'),
    ], { stdio: 'inherit' });
  }
} finally {
  fs.rmSync(unpacked, { recursive: true, force: true });
}

const project = path.join(runtimeDir, 'project');
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });
fs.copyFileSync(license, path.join(project, 'node-LICENSE.txt'));
fs.copyFileSync('scripts/android-node-server.mjs', path.join(project, 'bootstrap.mjs'));

const dependencies = ['express', 'music-metadata', '@neteasecloudmusicapienhanced/api'];
await build({
  entryPoints: ['server.ts'],
  outfile: path.join(project, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: [...dependencies, 'vite'],
});

// Copy the runtime dependency closure with the same nesting as npm ci.
// The NetEase library discovers modules and data with filesystem reads.
const packages = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages;
const copied = new Set();
function copyPackage(name, parent, optional = false) {
  let directory = parent;
  let relative;
  for (;;) {
    const candidate = path.posix.join(directory, 'node_modules', name);
    if (packages[candidate] && fs.existsSync(path.join(candidate, 'package.json'))) {
      relative = candidate;
      break;
    }
    if (!directory) break;
    const boundary = directory.lastIndexOf('/node_modules/');
    directory = boundary === -1 ? '' : directory.slice(0, boundary);
  }
  if (!relative) {
    if (optional) return;
    throw new Error('Missing runtime package ' + name + '. Run npm ci.');
  }
  if (copied.has(relative)) return;
  copied.add(relative);
  const source = path.resolve(relative);
  fs.cpSync(source, path.join(project, relative), {
    recursive: true,
    filter: filename => path.relative(source, filename).split(path.sep)[0] !== 'node_modules',
  });
  const manifest = packages[relative];
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    if (!Object.hasOwn(manifest.optionalDependencies || {}, dependency)) copyPackage(dependency, relative);
  }
  for (const dependency of Object.keys(manifest.optionalDependencies || {})) copyPackage(dependency, relative, true);
  for (const dependency of Object.keys(manifest.peerDependencies || {})) {
    copyPackage(dependency, relative, Boolean(manifest.peerDependenciesMeta?.[dependency]?.optional));
  }
}
for (const dependency of dependencies) copyPackage(dependency, '');
console.log('Prepared embedded Node.js ' + release + ' and ' + copied.size + ' runtime packages.');
