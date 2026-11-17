'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  getEpg: () => ipcRenderer.invoke('epg:get'),
  updatePer: (patch) => ipcRenderer.invoke('per:update', patch),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  activate: (id) => ipcRenderer.invoke('playlist:activate', id),
  refresh: () => ipcRenderer.invoke('playlist:refresh'),
  removePlaylist: (id) => ipcRenderer.invoke('playlist:remove', id),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  info: () => ipcRenderer.invoke('app:info'),
  vod: (kind, force) => ipcRenderer.invoke('vod:get', kind, force),
  series: (id) => ipcRenderer.invoke('vod:series', id),
  vodProbe: (url) => ipcRenderer.invoke('vod:probe', url),
  vodRange: (url) => ipcRenderer.invoke('vod:range', url),
  vodUrl: (url, at) => ipcRenderer.invoke('vod:url', url, at),
  vodStop: () => ipcRenderer.invoke('vod:stop'),
  ffmpegBase: () => ipcRenderer.invoke('ffmpeg:base'),
  sports: () => ipcRenderer.invoke('sports:get'),
  sportsRefresh: (date) => ipcRenderer.invoke('sports:refresh', date),
  sportsConfig: (patch) => ipcRenderer.invoke('sports:config', patch),
  openGames: () => ipcRenderer.invoke('games:open'),
  playChannel: (idx) => ipcRenderer.send('play:channel', idx),
  openGroup: (g) => ipcRenderer.send('open:group', g),
  setPlaying: (on) => ipcRenderer.send('playing', !!on),
  log: (line) => ipcRenderer.send('log', line),
  openLog: () => ipcRenderer.invoke('log:open'),
  on: (ch, fn) => {
    const ok = ['state:changed', 'epg:changed', 'epg:status', 'sports:changed', 'play:idx', 'open:group'];
    if (!ok.includes(ch)) return;
    ipcRenderer.on(ch, (_e, payload) => fn(payload));
  }
});
