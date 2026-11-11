// Desktop lyrics preload: the lyrics window runs isolated (no Node access) and
// only gets this narrow bridge for receiving playback state and sending UI intents.
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('radiflowDesktopLyrics', {
  onTrack: (callback) => subscribe('desktop-lyrics:track', callback),
  onClock: (callback) => subscribe('desktop-lyrics:clock', callback),
  onLocked: (callback) => subscribe('desktop-lyrics:locked', callback),
  ready: () => ipcRenderer.send('desktop-lyrics:ready'),
  setLocked: (locked) => ipcRenderer.send('desktop-lyrics:set-locked', Boolean(locked)),
  setIgnoreMouse: (ignore) => ipcRenderer.send('desktop-lyrics:set-ignore-mouse', Boolean(ignore)),
  control: (command) => ipcRenderer.send('desktop-lyrics:control', String(command)),
  close: () => ipcRenderer.send('desktop-lyrics:close'),
});
