'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
    bufferSec: 60,         // buffer target in seconds: covers a 60 sek drop without a stop
    growSlow: true,        // grow the buffer by playing 5% slower until the target is reached
    sortAZ: true,          // sort channels A–Ö inside folders
    mergeVariants: true,   // HD/FHD/4K/backup of the same channel shown as one row
    userAgent: '',         // empty = default
    format: 'ts',          // xtream stream format: ts | hls
    refreshHours: 12,      // auto refresh playlist + EPG
    webPort: 8899,
    nickname: '',
    syncRoom: '',          // herbergiskóði "Horfa saman": geymdur, en appið tengist honum ALDREI sjálft
    epgOffsetMin: 0,
    liveRelay: 'always'     // live channels through the local ffmpeg relay: survives a network drop
  },
  sports: {
    leagues: null,         // null = defaults (see lib/sports.js)
    teams: [],             // favourite team names (ESPN displayName)
    countries: null,       // null = defaults
    tvKey: ''              // optional TheSportsDB premium key (TV listings per country)
  },
  playlists: [],           // {id,name,type:'url'|'file'|'xtream',url,server,username,password,epgUrl}
  activePlaylist: null,
  per: {}                  // playlistId -> {favorites:[], recent:[], groupOrder:[], hiddenGroups:[], lastChannel}
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.filesDir = path.join(dir, 'files');
    this.cacheDir = path.join(dir, 'cache');
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { }
    this.data = { ...structuredClone(DEFAULTS), ...data };
    this.data.settings = { ...DEFAULTS.settings, ...(data.settings || {}) };
    // 1.5.3: the buffer target went from 45 to 60 sek – a 60 sek Wi-Fi drop then costs no
    // freeze at all (a stored 45, the old default, moves up once; the slider still rules)
    if (this.data.settings.bufferSec === 45) {
      this.data.settings.bufferSec = 60;
      try { this.save(); } catch { }
    }
    this.data.sports = { ...DEFAULTS.sports, ...(data.sports || {}) };
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  per(id) {
    if (!this.data.per[id]) this.data.per[id] = { favorites: [], recent: [], groupOrder: [], hiddenGroups: [], lastChannel: null };
    const p = this.data.per[id];
    // 1.5.4: per-channel health (yellow/red mark after a failed stream)
    if (!p.chanHealth || typeof p.chanHealth !== 'object') p.chanHealth = {};
    return p;
  }
  readCache(name) {
    try { return JSON.parse(fs.readFileSync(path.join(this.cacheDir, name), 'utf8')); } catch { return null; }
  }
  writeCache(name, obj) {
    fs.writeFileSync(path.join(this.cacheDir, name), JSON.stringify(obj));
  }
  removePlaylistFiles(id) {
    for (const f of [path.join(this.filesDir, id + '.m3u'), path.join(this.cacheDir, `pl-${id}.json`), path.join(this.cacheDir, `epg-${id}.json`)]) {
      try { fs.unlinkSync(f); } catch { }
    }
  }
}

module.exports = { Store };
