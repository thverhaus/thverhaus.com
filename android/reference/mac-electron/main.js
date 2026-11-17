'use strict';
const { app, BrowserWindow, ipcMain, session, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const { loadPlaylist, loadVod, loadSeries } = require('./lib/playlists');
const { fetchEpg, norm, looseNorm } = require('./lib/epg');
const { startWebServer, lanAddresses } = require('./lib/webserver');
const sports = require('./lib/sports');
const { VodProxy } = require('./lib/vodproxy');

const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';

let win = null;
let store = null;
let web = { port: null, error: null };
let sleepBlocker = null;
let gamesWin = null;
const sportsState = { today: [], todayDate: null, viewDate: null, viewFx: [], ufc: [], ufcAt: 0, error: null, loading: false, fetchedAt: 0 };

// in-memory data for the active playlist
const live = {
  id: null, channels: [], groups: [], epgUrl: '', fetchedAt: 0, expires: null,
  loading: false, error: null,
  epg: { programmes: {}, chanMap: [], fetchedAt: 0, loading: false, error: null }
};

const ua = () => store.data.settings.userAgent || DEFAULT_UA;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const newId = () => crypto.randomBytes(5).toString('hex');

function publicPlaylists() {
  return store.data.playlists.map(p => ({
    id: p.id, name: p.name, type: p.type, url: p.url || '', server: p.server || '',
    username: p.username || '', hasPassword: !!p.password, epgUrl: p.epgUrl || '',
    active: p.id === store.data.activePlaylist,
    count: p.id === live.id ? live.channels.length : (p.lastCount || null),
    error: p.id === live.id ? live.error : null,
    loading: p.id === live.id ? live.loading : false
  }));
}

function stateSnapshot(includeChannels = true) {
  return {
    settings: store.data.settings,
    playlists: publicPlaylists(),
    activePlaylist: store.data.activePlaylist,
    per: live.id ? store.per(live.id) : null,
    web: { port: web.port, error: web.error, addresses: web.port ? lanAddresses(web.port) : [] },
    data: {
      id: live.id, loading: live.loading, error: live.error, fetchedAt: live.fetchedAt, expires: live.expires,
      groups: live.groups,
      channels: includeChannels ? live.channels : undefined
    }
  };
}

function notify(includeChannels = true) { send('state:changed', stateSnapshot(includeChannels)); }

function buildChanMap() {
  const ids = new Set(Object.keys(live.epg.programmes));
  const lowerIds = new Map([...ids].map(i => [i.toLowerCase(), i]));
  const nameToId = live.epg.nameToId || {};
  const nameToIdLoose = live.epg.nameToIdLoose || {};
  live.epg.chanMap = live.channels.map(c => {
    if (c.tvgId && ids.has(c.tvgId)) return c.tvgId;
    if (c.tvgId && lowerIds.has(c.tvgId.toLowerCase())) return lowerIds.get(c.tvgId.toLowerCase());
    // exact name first, then the loose name ("UK: Sky Sports Main Event FHD B" ↔ "Sky Sports Main Event")
    return nameToId[norm(c.tvgName)] || nameToId[norm(c.name)]
      || nameToIdLoose[looseNorm(c.tvgName)] || nameToIdLoose[looseNorm(c.name)] || null;
  });
}

async function refreshEpg(force = false) {
  if (!live.id || !live.epgUrl || live.epg.loading) return;
  const ageH = (Date.now() - (live.epg.fetchedAt || 0)) / 3600e3;
  if (!force && ageH < store.data.settings.refreshHours) return;
  live.epg.loading = true; live.epg.error = null;
  send('epg:status', { loading: true });
  const id = live.id;
  try {
    const wantIds = new Set();
    const wantNames = new Set();
    const wantLoose = new Set();
    for (const c of live.channels) {
      if (c.tvgId) { wantIds.add(c.tvgId); wantIds.add(c.tvgId.toLowerCase()); }
      wantNames.add(norm(c.tvgName)); wantNames.add(norm(c.name));
      wantLoose.add(looseNorm(c.tvgName)); wantLoose.add(looseNorm(c.name));
    }
    wantNames.delete('');
    wantLoose.delete('');
    const r = await fetchEpg(live.epgUrl, ua(), wantIds, wantNames, wantLoose);
    if (id !== live.id) return;
    live.epg.programmes = r.programmes;
    live.epg.nameToId = r.nameToId;
    live.epg.nameToIdLoose = r.nameToIdLoose;
    live.epg.fetchedAt = Date.now();
    store.writeCache(`epg-${id}.json`, { programmes: r.programmes, nameToId: r.nameToId, nameToIdLoose: r.nameToIdLoose, fetchedAt: live.epg.fetchedAt });
  } catch (e) {
    live.epg.error = e.message;
  } finally {
    live.epg.loading = false;
    buildChanMap();
    send('epg:changed', epgSnapshot());
    if (sportsState.fetchedAt) refreshSports();
  }
}

function epgSnapshot() {
  return { programmes: live.epg.programmes, chanMap: live.epg.chanMap, fetchedAt: live.epg.fetchedAt, error: live.epg.error, loading: live.epg.loading };
}

async function activate(id, { forceRefresh = false } = {}) {
  const pl = store.data.playlists.find(p => p.id === id);
  if (!pl) { live.id = null; live.channels = []; live.groups = []; notify(); return; }
  store.data.activePlaylist = id; store.save();
  const switching = live.id !== id;
  live.id = id;
  if (switching) {
    const cached = store.readCache(`pl-${id}.json`);
    live.channels = cached ? cached.channels : [];
    live.groups = cached ? cached.groups : [];
    live.epgUrl = cached ? cached.epgUrl : '';
    live.fetchedAt = cached ? cached.fetchedAt : 0;
    live.expires = cached ? cached.expires : null;
    const ce = store.readCache(`epg-${id}.json`);
    live.epg = { programmes: ce ? ce.programmes : {}, nameToId: ce ? ce.nameToId : {}, nameToIdLoose: ce ? ce.nameToIdLoose : {}, fetchedAt: ce ? ce.fetchedAt : 0, chanMap: [], loading: false, error: null };
    live.error = null;
    buildChanMap();
    notify();
    send('epg:changed', epgSnapshot());
  }
  const stale = (Date.now() - live.fetchedAt) / 3600e3 >= store.data.settings.refreshHours;
  if (forceRefresh || stale || !live.channels.length) await refreshPlaylist();
  refreshEpg(forceRefresh);
}

async function refreshPlaylist() {
  const id = live.id;
  const pl = store.data.playlists.find(p => p.id === id);
  if (!pl || live.loading) return;
  live.loading = true; live.error = null; notify(false);
  try {
    const r = await loadPlaylist(pl, { ...store.data.settings, userAgent: ua() }, store.filesDir);
    if (id !== live.id) return;
    Object.assign(live, { channels: r.channels, groups: r.groups, epgUrl: r.epgUrl, fetchedAt: r.fetchedAt, expires: r.expires });
    pl.lastCount = r.channels.length; store.save();
    store.writeCache(`pl-${id}.json`, r);
    buildChanMap();
  } catch (e) {
    live.error = e.message || String(e);
  } finally {
    live.loading = false;
    notify();
  }
}

// ---- playlist management (used by the web page and the app) ----
const manager = {
  list: () => ({ playlists: publicPlaylists() }),
  async add(body) {
    const type = body.type === 'xtream' ? 'xtream' : 'url';
    const pl = { id: newId(), type, name: (body.name || '').trim() || (type === 'xtream' ? 'Xtream' : 'Playlist'), epgUrl: (body.epgUrl || '').trim() };
    if (type === 'xtream') {
      if (!body.server || !body.username) throw new Error('Vantar netþjón og notandanafn');
      Object.assign(pl, { server: body.server.trim(), username: body.username.trim(), password: body.password || '' });
    } else {
      if (!/^https?:\/\//i.test(body.url || '')) throw new Error('Slóðin þarf að byrja á http:// eða https://');
      pl.url = body.url.trim();
    }
    store.data.playlists.push(pl); store.save();
    await activate(pl.id, { forceRefresh: true });
    return { ok: true, id: pl.id, error: live.error, count: live.channels.length };
  },
  async addFile(name, text, epgUrl) {
    if (!/#EXTINF/i.test(text)) throw new Error('Skráin lítur ekki út eins og M3U playlist');
    const pl = { id: newId(), type: 'file', name: name.replace(/\.(m3u8?|txt)$/i, '') || 'Playlist', epgUrl: (epgUrl || '').trim() };
    require('fs').writeFileSync(path.join(store.filesDir, pl.id + '.m3u'), text);
    store.data.playlists.push(pl); store.save();
    await activate(pl.id, { forceRefresh: true });
    return { ok: true, id: pl.id, error: live.error, count: live.channels.length };
  },
  async update(id, body) {
    const pl = store.data.playlists.find(p => p.id === id);
    if (!pl) throw new Error('Playlisti fannst ekki');
    for (const k of ['name', 'url', 'server', 'username', 'epgUrl']) if (typeof body[k] === 'string') pl[k] = body[k].trim();
    if (typeof body.password === 'string' && body.password) pl.password = body.password;
    store.data.playlists = store.data.playlists.map(p => p.id === id ? pl : p); store.save();
    if (live.id === id) await activate(id, { forceRefresh: true }); else notify(false);
    return { ok: true };
  },
  async remove(id) {
    store.data.playlists = store.data.playlists.filter(p => p.id !== id);
    delete store.data.per[id];
    store.removePlaylistFiles(id);
    if (store.data.activePlaylist === id) {
      store.data.activePlaylist = store.data.playlists[0] ? store.data.playlists[0].id : null;
      live.id = null;
      store.save();
      await activate(store.data.activePlaylist);
    } else { store.save(); notify(false); }
    return { ok: true };
  },
  async activate(id) { await activate(id); return { ok: true }; },
  async refresh(id) {
    if (live.id !== id) await activate(id, { forceRefresh: true });
    else { await refreshPlaylist(); refreshEpg(true); }
    return { ok: true, error: live.error, count: live.channels.length };
  }
};

function applyUserAgent() {
  session.defaultSession.setUserAgent(ua());
}

// ---------- sports: today's matches ----------
const todayStr = () => new Date().toISOString().slice(0, 10);
function sportsCfg() {
  const c = store.data.sports;
  return { ...c, leagues: c.leagues || sports.DEFAULT_LEAGUES, countries: c.countries || sports.DEFAULT_COUNTRIES };
}
function sportsSnapshot() {
  const cfg = sportsCfg();
  const viewIsToday = !sportsState.viewDate || sportsState.viewDate === todayStr();
  return {
    date: viewIsToday ? todayStr() : sportsState.viewDate,
    fixtures: viewIsToday ? sportsState.today : sportsState.viewFx,
    today: sportsState.today,
    ufc: sportsState.ufc,
    error: sportsState.error, loading: sportsState.loading, fetchedAt: sportsState.fetchedAt,
    cfg: { ...cfg, tvKey: cfg.tvKey ? '••••' : '' }, hasTvKey: !!cfg.tvKey,
    leaguesAll: sports.LEAGUES, countriesAll: sports.COUNTRIES.map(c => ({ id: c.id, name: c.name }))
  };
}
function broadcastSports() {
  const snap = sportsSnapshot();
  send('sports:changed', snap);
  if (gamesWin && !gamesWin.isDestroyed()) gamesWin.webContents.send('sports:changed', snap);
}
async function loadDay(date, isLive) {
  const cfg = sportsCfg();
  const fixtures = await sports.fetchFixtures(date, cfg.leagues, { live: isLive });
  await sports.attachBroadcasts(fixtures, cfg.countries);
  const hidden = new Set(live.id ? (store.per(live.id).hiddenGroups || []) : []);
  sports.matchChannels(fixtures, live.channels, (i) => !hidden.has(live.channels[i].group), live.epg,
    cfg.countries, (Number(store.data.settings.epgOffsetMin) || 0) * 60000);
  const fav = new Set(cfg.teams);
  fixtures.forEach(f => { f.fav = fav.has(f.home.name) || fav.has(f.away.name); });
  return fixtures;
}
// date omitted = today. A different date is only for browsing in the games window.
async function refreshSports(date) {
  const today = todayStr();
  if (date && date !== today) {
    sportsState.viewDate = date; sportsState.loading = true; broadcastSports();
    try { sportsState.viewFx = await loadDay(date, false); sportsState.error = null; }
    catch (e) { sportsState.error = e.message || String(e); }
    finally { sportsState.loading = false; broadcastSports(); }
    return;
  }
  if (date === today) sportsState.viewDate = today;
  if (sportsState.loading) return;
  sportsState.loading = true;
  try {
    const isLive = sportsState.today.some(f => f.state === 'in');
    sportsState.today = await loadDay(today, isLive);
    // UFC: next 30 days (refreshed at most every 10 min)
    if (Date.now() - sportsState.ufcAt > 10 * 60e3 || isLive) {
      try {
        const cfg = sportsCfg();
        const ev = await sports.fetchUfc(today, 30);
        const hidden = new Set(live.id ? (store.per(live.id).hiddenGroups || []) : []);
        await sports.matchUfc(ev, live.channels, (i) => !hidden.has(live.channels[i].group), live.epg, cfg.countries, (Number(store.data.settings.epgOffsetMin) || 0) * 60000);
        sportsState.ufc = ev; sportsState.ufcAt = Date.now();
      } catch (e) { /* keep last list */ }
    }
    sportsState.todayDate = today;
    sportsState.error = null; sportsState.fetchedAt = Date.now();
  } catch (e) {
    sportsState.error = e.message || String(e);
  } finally {
    sportsState.loading = false;
    broadcastSports();
  }
}
function sportsLoop() {
  // every minute while a match is live or about to start, otherwise every 15 min
  const now = Date.now();
  const busy = sportsState.today.some(f => f.state === 'in' || (f.state === 'pre' && f.start - now < 30 * 60e3 && f.start - now > -3 * 3600e3));
  const age = now - sportsState.fetchedAt;
  if (sportsState.todayDate !== todayStr() || age > (busy ? 55e3 : 15 * 60e3)) refreshSports();
}
function openGamesWindow() {
  if (gamesWin && !gamesWin.isDestroyed()) { gamesWin.show(); gamesWin.focus(); return; }
  gamesWin = new BrowserWindow({
    width: 520, height: 760, minWidth: 420, minHeight: 400, title: 'Leikir dagsins',
    backgroundColor: '#0f1115', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  gamesWin.loadFile(path.join(__dirname, 'renderer', 'games.html'));
  gamesWin.on('closed', () => { gamesWin = null; });
  sportsState.viewDate = todayStr();
  if (Date.now() - sportsState.fetchedAt > 60e3) refreshSports();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380, height: 860, minWidth: 900, minHeight: 560,
    title: 'Mulehead',
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,          // IPTV servers rarely send CORS headers
      backgroundThrottling: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const t = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu', label: 'Breyta' },
    {
      label: 'Skoða', submenu: [
        { role: 'togglefullscreen', label: 'Fullur skjár' },
        { type: 'separator' },
        { role: 'reload', label: 'Endurhlaða' },
        { role: 'toggleDevTools', label: 'Þróunartól' }
      ]
    },
    { role: 'windowMenu', label: 'Gluggi' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  applyUserAgent();
  // Some IPTV servers reject requests carrying a browser Origin/Referer
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (/^https?:/i.test(details.url) && !/hivemq|mosquitto|fotmob|framundanibeinni|espn\.com|thesportsdb/i.test(details.url)) {
      delete h['Origin']; delete h['Referer'];
      h['User-Agent'] = ua();
    }
    cb({ requestHeaders: h });
  });

  ipcMain.handle('state:get', () => stateSnapshot(true));
  ipcMain.handle('epg:get', () => epgSnapshot());
  ipcMain.handle('per:update', (_e, patch) => {
    if (!live.id) return null;
    Object.assign(store.per(live.id), patch); store.save();
    return store.per(live.id);
  });
  ipcMain.handle('settings:update', async (_e, patch) => {
    const before = { ...store.data.settings };
    Object.assign(store.data.settings, patch); store.save();
    if (patch.userAgent !== undefined) applyUserAgent();
    const pl = store.data.playlists.find(p => p.id === live.id);
    if (patch.format && patch.format !== before.format && pl && pl.type === 'xtream') await refreshPlaylist();
    return store.data.settings;
  });
  ipcMain.handle('playlist:activate', (_e, id) => manager.activate(id));
  ipcMain.handle('playlist:refresh', () => live.id ? manager.refresh(live.id) : null);
  ipcMain.handle('playlist:remove', (_e, id) => manager.remove(id));
  ipcMain.handle('open:external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  const logDir = path.join(app.getPath('documents'), 'Mulehead');
  const writeLog = (line) => {
    try {
      require('fs').mkdirSync(logDir, { recursive: true });
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      const t = d.toLocaleTimeString('is-IS', { hour12: false });
      require('fs').appendFileSync(path.join(logDir, `dagbok-${day}.txt`), `${t}  ${String(line).slice(0, 500)}\n`);
    } catch { }
  };
  ipcMain.on('log', (_e, line) => writeLog(line));
  // movies & episodes through ffmpeg (one provider connection at a time)
  const vod = new VodProxy({ resourcesPath: app.isPackaged ? process.resourcesPath : null, getUserAgent: ua, log: writeLog });
  const vodReady = vod.start();
  ipcMain.handle('vod:probe', async (_e, url) => { await vodReady; if (!vod.available()) return { noFfmpeg: true }; return vod.probe(url); });
  ipcMain.handle('vod:range', async (_e, url) => { await vodReady; if (!vod.available()) return true; return vod.rangeSupport(url); });
  ipcMain.handle('vod:url', async (_e, url, at) => { await vodReady; return vod.available() ? vod.url(url, at) : url; });
  ipcMain.handle('vod:stop', async () => { await vod.stop(); });
  ipcMain.handle('ffmpeg:base', async () => { await vodReady; return vod.available() ? vod.base() : null; });
  ipcMain.handle('log:open', () => { require('fs').mkdirSync(logDir, { recursive: true }); shell.openPath(logDir); });
  const vodMem = {};
  ipcMain.handle('vod:get', async (_e, kind, force) => {
    const pl = store.data.playlists.find(p => p.id === live.id);
    if (!pl) return { categories: [], items: [] };
    const key = `vod-${kind}-${pl.id}.json`;
    const mem = vodMem[key] || store.readCache(key);
    if (mem && !force && Date.now() - (mem.fetchedAt || 0) < store.data.settings.refreshHours * 3600e3) { vodMem[key] = mem; return mem; }
    try {
      const r = await loadVod(pl, { ...store.data.settings, userAgent: ua() }, kind, live.channels);
      r.fetchedAt = Date.now();
      vodMem[key] = r; store.writeCache(key, r);
      return r;
    } catch (e) {
      if (mem) return { ...mem, error: e.message };
      return { categories: [], items: [], error: e.message || String(e) };
    }
  });
  ipcMain.handle('vod:series', async (_e, seriesId) => {
    const pl = store.data.playlists.find(p => p.id === live.id);
    if (!pl) return null;
    try { return await loadSeries(pl, { ...store.data.settings, userAgent: ua() }, seriesId); }
    catch (e) { return { error: e.message || String(e), seasons: [] }; }
  });
  ipcMain.handle('sports:get', () => sportsSnapshot());
  ipcMain.handle('sports:refresh', (_e, date) => refreshSports(date));
  ipcMain.handle('sports:config', async (_e, patch) => {
    const c = store.data.sports;
    for (const k of ['leagues', 'teams', 'countries']) if (patch[k] !== undefined) c[k] = patch[k];
    if (typeof patch.tvKey === 'string' && patch.tvKey !== '••••') c.tvKey = patch.tvKey.trim();
    store.save();
    if (patch.leagues || patch.countries || patch.tvKey !== undefined) { await refreshSports(); if (sportsState.viewDate && sportsState.viewDate !== todayStr()) await refreshSports(sportsState.viewDate); }
    else {
      const fav = new Set(c.teams);
      [...sportsState.today, ...sportsState.viewFx].forEach(f => { f.fav = fav.has(f.home.name) || fav.has(f.away.name); });
      broadcastSports();
    }
    return sportsSnapshot();
  });
  ipcMain.handle('games:open', () => openGamesWindow());
  ipcMain.on('play:channel', (_e, idx) => { if (win && !win.isDestroyed()) { win.webContents.send('play:idx', idx); win.focus(); } });
  ipcMain.on('open:group', (_e, g) => { if (win && !win.isDestroyed()) { win.webContents.send('open:group', g); win.focus(); } });
  ipcMain.on('playing', (_e, on) => {
    if (on && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
  });

  buildMenu();
  createWindow();

  web = await startWebServer(store.data.settings.webPort, manager);
  if (store.data.activePlaylist) activate(store.data.activePlaylist);
  else notify();

  setTimeout(() => refreshSports(), 4000);
  setInterval(sportsLoop, 20000);

  // periodic refresh check
  setInterval(() => {
    if (!live.id) return;
    const stale = (Date.now() - live.fetchedAt) / 3600e3 >= store.data.settings.refreshHours;
    if (stale) refreshPlaylist().then(() => refreshEpg());
    else refreshEpg();
  }, 30 * 60e3);

  app.on('activate', () => { if (!win) { createWindow(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
