import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = 'RadiFlow Player';
const MIN_WINDOW_WIDTH = 1200;
const MIN_WINDOW_HEIGHT = 880;
const DEFAULT_WINDOW_WIDTH = MIN_WINDOW_WIDTH;
const DEFAULT_WINDOW_HEIGHT = MIN_WINDOW_HEIGHT;
const WINDOW_CORNER_RADIUS = 24;
const DEFAULT_WINDOW_BACKGROUND_COLOR = '#050505';
const TRANSPARENT_WINDOW_BACKGROUND_COLOR = '#00000000';
const SHELL_PREFERENCES_FILE_NAME = 'shell-preferences.json';

let mainWindow;
let tray;
let musicPath = path.join(process.cwd(), 'music');
let packagedServer;
let packagedServerUrl;
const startUrl = process.env.ELECTRON_START_URL;
const isDev = !app.isPackaged;
const shouldOpenDevTools = isDev && process.env.ELECTRON_DISABLE_DEVTOOLS !== 'true' && !startUrl;
const customUserDataPath = process.env.ELECTRON_USER_DATA_DIR;

const resolveAppIcon = () => {
  const iconCandidates = [
    path.join(__dirname, 'logo.ico'),
    path.join(__dirname, 'logo.png'),
  ];

  for (const iconPath of iconCandidates) {
    if (!fs.existsSync(iconPath)) {
      continue;
    }

    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return undefined;
};

const appIcon = resolveAppIcon();

// Taskbar thumbnail toolbar icons (20×20 white-on-transparent PNG, base64 encoded)
const THUMBAR_ICON_PLAY   = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAASElEQVR4nO3OwQ0AIAgEQfpvGvVnDOjBET+6BUxW5DfSXjlYiupSOUijFkjBOzCFnsAwjIIwfP0QhhAwjHlgCvJACptBGnqjBvgKUrwixhObAAAAAElFTkSuQmCC';
const THUMBAR_ICON_PAUSE  = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAHklEQVR4nGNgGAX/0QCp8qMGjho4auCogcQZOPwBAE+QvlDSK5bqAAAAAElFTkSuQmCC';
const THUMBAR_ICON_PREV   = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAASklEQVR4nOXQQQoAIAhEUe9/aduGiM04RVB/rQ/R7O98itnZAkKzKOghCYxYG8ygNlhhNLjCKBDB7l545IcI2gIrWAIzVAbZ2ccbRwXyHOtSMyYAAAAASUVORK5CYII=';
const THUMBAR_ICON_NEXT   = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAASklEQVR4nGNgGAX/gYBYdTBAlEKqG0hIIVkG4lNMtoG4NFFsILpGqhiIrJlqBhJy+cC6EJc6sgzEp44kA4lRR7SB1FBH/bw8/AEA5YzCTPEG4HoAAAAASUVORK5CYII=';

function updateThumbarButtons(isPlaying, hasActiveSong) {
  if (!mainWindow || process.platform !== 'win32') return;
  const flags = hasActiveSong ? [] : ['disabled'];
  mainWindow.setThumbarButtons([
    {
      tooltip: '上一曲',
      icon: nativeImage.createFromBuffer(Buffer.from(THUMBAR_ICON_PREV, 'base64')),
      click: () => mainWindow?.webContents.send('player-control', 'prev'),
      flags,
    },
    {
      tooltip: isPlaying ? '暂停' : '播放',
      icon: nativeImage.createFromBuffer(Buffer.from(isPlaying ? THUMBAR_ICON_PAUSE : THUMBAR_ICON_PLAY, 'base64')),
      click: () => mainWindow?.webContents.send('player-control', 'toggle-play'),
      flags,
    },
    {
      tooltip: '下一曲',
      icon: nativeImage.createFromBuffer(Buffer.from(THUMBAR_ICON_NEXT, 'base64')),
      click: () => mainWindow?.webContents.send('player-control', 'next'),
      flags,
    },
  ]);
}

function updateTaskbarProgress(currentTime, duration) {
  if (!mainWindow || process.platform !== 'win32') return;
  if (!duration || duration <= 0) {
    mainWindow.setProgressBar(-1);
  } else {
    mainWindow.setProgressBar(currentTime / duration);
  }
}

if (customUserDataPath) {
  fs.mkdirSync(customUserDataPath, { recursive: true });
  app.setPath('userData', customUserDataPath);
}

function getShellPreferencesPath() {
  return path.join(app.getPath('userData'), SHELL_PREFERENCES_FILE_NAME);
}

function normalizeShellPreferences(value) {
  return {
    transparentWindow: Boolean(value?.transparentWindow),
  };
}

function readShellPreferences() {
  try {
    const rawPreferences = fs.readFileSync(getShellPreferencesPath(), 'utf8');
    return normalizeShellPreferences(JSON.parse(rawPreferences));
  } catch {
    return normalizeShellPreferences(null);
  }
}

function writeShellPreferences(value) {
  const nextPreferences = normalizeShellPreferences(value);
  const shellPreferencesPath = getShellPreferencesPath();
  fs.mkdirSync(path.dirname(shellPreferencesPath), { recursive: true });
  fs.writeFileSync(shellPreferencesPath, JSON.stringify(nextPreferences));
  return nextPreferences;
}

let shellPreferences = readShellPreferences();

function getBackgroundMaterialSupport() {
  const systemVersion = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release();
  const buildSegment = systemVersion.split('.').at(-1) ?? '0';
  const buildNumber = Number.parseInt(buildSegment, 10);
  const supported = process.platform === 'win32'
    && Number.isFinite(buildNumber)
    && buildNumber >= 22621
    && typeof BrowserWindow.prototype.setBackgroundMaterial === 'function';

  return {
    supported,
    systemVersion,
    minimumVersion: 'Windows 11 22H2 (build 22621)',
  };
}

function setWindowBackgroundMaterial(mode = 'none') {
  const support = getBackgroundMaterialSupport();
  if (!mainWindow) {
    return false;
  }

  if (mode === 'none') {
    if (support.supported && typeof mainWindow.setBackgroundMaterial === 'function') {
      try {
        mainWindow.setBackgroundMaterial('none');
      } catch {
        // Fall through and still restore the window background color.
      }
    }

    mainWindow.setBackgroundColor(
      shellPreferences.transparentWindow
        ? TRANSPARENT_WINDOW_BACKGROUND_COLOR
        : DEFAULT_WINDOW_BACKGROUND_COLOR
    );
    return true;
  }

  if (!shellPreferences.transparentWindow) {
    return false;
  }

  if (!support.supported || typeof mainWindow.setBackgroundMaterial !== 'function') {
    return false;
  }

  try {
    mainWindow.setBackgroundMaterial(mode);
    return true;
  } catch {
    return false;
  }
}

function buildRoundedWindowShape(width, height, radius) {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const safeRadius = Math.max(0, Math.min(Math.floor(radius), Math.floor(safeWidth / 2), Math.floor(safeHeight / 2)));

  if (safeRadius === 0) {
    return [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
  }

  const rects = [];

  for (let row = 0; row < safeRadius; row += 1) {
    const delta = safeRadius - row - 0.5;
    const inset = Math.max(0, Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - delta * delta))));
    const rowWidth = Math.max(1, safeWidth - inset * 2);

    rects.push({ x: inset, y: row, width: rowWidth, height: 1 });
    rects.push({ x: inset, y: safeHeight - row - 1, width: rowWidth, height: 1 });
  }

  if (safeHeight > safeRadius * 2) {
    rects.push({ x: 0, y: safeRadius, width: safeWidth, height: safeHeight - safeRadius * 2 });
  }

  return rects;
}

function updateWindowShape() {
  if (!mainWindow || process.platform !== 'win32' || typeof mainWindow.setShape !== 'function') {
    return;
  }

  const [width, height] = mainWindow.getSize();
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    mainWindow.setShape([{ x: 0, y: 0, width, height }]);
    return;
  }

  mainWindow.setShape(buildRoundedWindowShape(width, height, WINDOW_CORNER_RADIUS));
}

const PACKAGED_SERVER_HOST = '127.0.0.1';
const PACKAGED_SERVER_PREFERRED_PORT = 37531;
const PACKAGED_SERVER_PORT_RANGE = 20;
const PACKAGED_SERVER_PORT_FILE = 'server-port.json';

function readPackagedServerPort() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), PACKAGED_SERVER_PORT_FILE), 'utf8');
    const value = JSON.parse(raw)?.port;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePackagedServerPort(port) {
  try {
    const filePath = path.join(app.getPath('userData'), PACKAGED_SERVER_PORT_FILE);
    fs.writeFileSync(filePath, JSON.stringify({ port }));
  } catch {
    // Non-critical, ignore
  }
}

async function startPackagedLocalServer() {
  if (packagedServerUrl) {
    return packagedServerUrl;
  }

  const serverEntryPath = path.join(__dirname, 'dist-electron', 'server.js');
  if (!fs.existsSync(serverEntryPath)) {
    throw new Error(`Missing packaged server entry: ${serverEntryPath}`);
  }

  const serverModule = await import(pathToFileURL(serverEntryPath).href);
  if (typeof serverModule.startServer !== 'function') {
    throw new Error('Packaged server entry does not export startServer().');
  }

  // Build candidate port list: try last-used port first, then preferred range, then random
  const lastUsedPort = readPackagedServerPort();
  const candidatePorts = [];
  if (lastUsedPort && lastUsedPort !== PACKAGED_SERVER_PREFERRED_PORT) {
    candidatePorts.push(lastUsedPort);
  }
  for (let i = 0; i < PACKAGED_SERVER_PORT_RANGE; i++) {
    candidatePorts.push(PACKAGED_SERVER_PREFERRED_PORT + i);
  }
  candidatePorts.push(0); // Random fallback

  let lastError;
  for (const candidatePort of candidatePorts) {
    try {
      const startedServer = await serverModule.startServer({
        port: candidatePort,
        host: PACKAGED_SERVER_HOST,
        mode: 'production',
        staticRoot: __dirname,
        initialMusicDir: musicPath,
      });

      packagedServer = startedServer.server;
      packagedServerUrl = startedServer.url;
      writePackagedServerPort(startedServer.port);
      return packagedServerUrl;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EADDRINUSE') {
        throw error;
      }
      // Port in use — try next candidate
    }
  }

  throw lastError ?? new Error('Could not find an available port for the packaged server.');
}

function createWindow() {
  const useTransparentWindow = shellPreferences.transparentWindow;

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: APP_NAME,
    backgroundColor: useTransparentWindow ? TRANSPARENT_WINDOW_BACKGROUND_COLOR : DEFAULT_WINDOW_BACKGROUND_COLOR,
    transparent: useTransparentWindow,
    frame: false,
    roundedCorners: true,
    thickFrame: false,
    hasShadow: true,
    accentColor: false,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else if (packagedServerUrl) {
    mainWindow.loadURL(packagedServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools();
  }

  setWindowBackgroundMaterial('none');
  updateWindowShape();

  if (process.platform === 'win32' && typeof mainWindow.setAccentColor === 'function') {
    mainWindow.setAccentColor(false);
  }

  mainWindow.once('ready-to-show', () => {
    updateWindowShape();
    updateThumbarButtons(false, false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
    updateWindowShape();
  });

  mainWindow.on('maximize', () => {
    updateWindowShape();
    mainWindow?.webContents.send('window:maximized-state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    updateWindowShape();
    mainWindow?.webContents.send('window:maximized-state-changed', false);
  });

  mainWindow.on('restore', () => {
    updateWindowShape();
  });
}

function createTray() {
  if (!appIcon) {
    return;
  }

  tray = new Tray(appIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '播放/暂停', click: () => mainWindow?.webContents.send('player-control', 'toggle-play') },
    { label: '下一曲', click: () => mainWindow?.webContents.send('player-control', 'next') },
    { label: '上一曲', click: () => mainWindow?.webContents.send('player-control', 'prev') },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
}

function registerGlobalShortcuts() {
  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('player-control', 'toggle-play');
  });
  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('player-control', 'next');
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('player-control', 'prev');
  });
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  app.setAppUserModelId('com.radiflow.player');

  if (!startUrl && !isDev) {
    try {
      await startPackagedLocalServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('RadiFlow Player startup failed', `Unable to start the packaged local service.\n\n${message}`);
    }
  }

  createWindow();
  createTray();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  packagedServer?.close();
  globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.handle('select-music-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    musicPath = result.filePaths[0];
    return musicPath;
  }
  return null;
});

ipcMain.handle('get-music-folder', () => {
  return musicPath;
});

ipcMain.handle('open-music-folder', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
  } else {
    shell.openPath(musicPath);
  }
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }

  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('window:set-background-material', (event, mode) => {
  const nextMode = mode === 'acrylic' || mode === 'mica' || mode === 'tabbed' || mode === 'auto' ? mode : 'none';
  return {
    ...getBackgroundMaterialSupport(),
    applied: nextMode === 'none' ? true : setWindowBackgroundMaterial(nextMode),
    mode: nextMode,
  };
});

ipcMain.handle('window:get-background-material-support', () => {
  return getBackgroundMaterialSupport();
});

ipcMain.handle('window:get-shell-state', () => {
  return {
    ...getBackgroundMaterialSupport(),
    transparentWindow: shellPreferences.transparentWindow,
  };
});

ipcMain.handle('window:restart-with-shell-mode', async (event, transparentWindow) => {
  shellPreferences = writeShellPreferences({ transparentWindow });
  app.relaunch();
  app.exit(0);
  return true;
});

ipcMain.on('media:update-playback-state', (_event, { isPlaying, hasActiveSong, currentTime, duration }) => {
  updateThumbarButtons(isPlaying, hasActiveSong);
  updateTaskbarProgress(currentTime, duration);
});
