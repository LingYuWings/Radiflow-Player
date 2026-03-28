import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = 'RadiFlow Player';
const MIN_WINDOW_WIDTH = 1200;
const MIN_WINDOW_HEIGHT = 880;

let mainWindow;
let tray;
let musicPath = path.join(process.cwd(), 'music');
const startUrl = process.env.ELECTRON_START_URL;
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

if (customUserDataPath) {
  fs.mkdirSync(customUserDataPath, { recursive: true });
  app.setPath('userData', customUserDataPath);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: APP_NAME,
    backgroundColor: '#050505',
    frame: false,
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
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', false);
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

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAppUserModelId('com.radiflow.player');
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
