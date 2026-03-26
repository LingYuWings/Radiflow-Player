import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = 'RadiFlow Player';

let mainWindow;
let tray;
let musicPath = path.join(process.cwd(), 'music');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    backgroundColor: '#050505',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
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
  // Use a generic icon or a placeholder if you don't have one
  // For now, we'll just use a simple template
  tray = new Tray(path.join(__dirname, 'public/favicon.ico')); // Fallback to favicon
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
  createWindow();
  // createTray(); // Disabled by default as we might not have the icon file yet
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
