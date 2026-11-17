'use strict';
// Loads channels for a playlist (M3U URL, uploaded M3U file, or Xtream Codes).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseM3U } = require('./m3u');

const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';

async function httpGet(url, ua, { timeoutMs = 60000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua || DEFAULT_UA, 'Accept': '*/*' },
      redirect: 'follow',
      signal: ctl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} frá ${new URL(url).host}`);
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

function cleanServer(server) {
  let s = (server || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '').replace(/\/(player_api\.php|get\.php).*$/i, '');
}

function xtreamApi(pl, action) {
  const base = cleanServer(pl.server);
  const q = `username=${encodeURIComponent(pl.username)}&password=${encodeURIComponent(pl.password)}`;
  return `${base}/player_api.php?${q}${action ? '&action=' + action : ''}`;
}

async function loadXtream(pl, settings) {
  const ua = settings.userAgent;
  const info = JSON.parse((await httpGet(xtreamApi(pl, ''), ua)).toString('utf8'));
  if (!info || !info.user_info || String(info.user_info.auth) === '0') {
    throw new Error('Innskráning tókst ekki – athugaðu notandanafn og lykilorð');
  }
  const cats = JSON.parse((await httpGet(xtreamApi(pl, 'get_live_categories'), ua)).toString('utf8')) || [];
  const streams = JSON.parse((await httpGet(xtreamApi(pl, 'get_live_streams'), ua, { timeoutMs: 120000 })).toString('utf8')) || [];
  const catName = new Map(cats.map(c => [String(c.category_id), c.category_name]));
  const base = cleanServer(pl.server);
  const ext = settings.format === 'hls' ? 'm3u8' : 'ts';
  const u = encodeURIComponent(pl.username), p = encodeURIComponent(pl.password);
  const channels = streams.map(s => ({
    name: s.name || 'Rás',
    tvgId: s.epg_channel_id || '',
    tvgName: s.name || '',
    logo: s.stream_icon || '',
    group: catName.get(String(s.category_id)) || 'Án flokks',
    url: `${base}/live/${u}/${p}/${s.stream_id}.${ext}`,
    kind: 'live',
    catchup: s.tv_archive ? 'xc' : '',
    catchupDays: s.tv_archive_duration || ''
  }));
  const groupOrder = cats.map(c => c.category_name);
  const epgUrl = pl.epgUrl || `${base}/xmltv.php?username=${u}&password=${p}`;
  let expires = null;
  if (info.user_info.exp_date) expires = Number(info.user_info.exp_date) * 1000;
  return { channels, groupOrder, epgUrl, expires };
}

async function loadM3U(pl, settings, filesDir) {
  let text;
  if (pl.type === 'file') {
    text = fs.readFileSync(path.join(filesDir, pl.id + '.m3u'), 'utf8');
  } else {
    text = (await httpGet(pl.url, settings.userAgent, { timeoutMs: 180000 })).toString('utf8');
  }
  if (!/#EXTINF/i.test(text) && !/^https?:\/\//m.test(text)) {
    throw new Error('Þetta lítur ekki út eins og M3U playlist');
  }
  const { epgUrl, channels } = parseM3U(text);
  return { channels, groupOrder: null, epgUrl: pl.epgUrl || epgUrl };
}

// Recognise Xtream Codes M3U links (get.php?username=..&password=..) like TiviMate does
function xtreamFromUrl(url) {
  try {
    const u = new URL(url);
    const user = u.searchParams.get('username'), pass = u.searchParams.get('password');
    if (!user || !pass || !/\/(get|player_api)\.php$/i.test(u.pathname)) return null;
    return { server: u.origin + u.pathname.replace(/\/(get|player_api)\.php$/i, ''), username: user, password: pass };
  } catch { return null; }
}

async function loadPlaylist(pl, settings, filesDir) {
  let r = null;
  if (pl.type === 'xtream') r = await loadXtream(pl, settings);
  else {
    const xc = pl.type === 'url' ? xtreamFromUrl(pl.url) : null;
    if (xc) {
      try { r = await loadXtream({ ...pl, ...xc }, settings); } catch { r = null; }
      if (r && !r.channels.length) r = null;
    }
    if (!r) r = await loadM3U(pl, settings, filesDir);
  }
  // number channels & build group list in order of first appearance (or provider order)
  const seen = new Map();
  if (r.groupOrder) r.groupOrder.forEach(g => seen.set(g, 0));
  r.channels.forEach((c, i) => {
    c.n = i + 1;
    seen.set(c.group, (seen.get(c.group) || 0) + 1);
  });
  const groups = [...seen.entries()].filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
  return { channels: r.channels, groups, epgUrl: r.epgUrl || '', expires: r.expires || null, fetchedAt: Date.now() };
}

module.exports = { loadPlaylist, httpGet, cleanServer, xtreamFromUrl };

// ---------- VOD (movies & series) ----------
async function xtreamJson(pl, settings, action, extra = '') {
  const buf = await httpGet(xtreamApi(pl, action) + extra, settings.userAgent, { timeoutMs: 120000 });
  return JSON.parse(buf.toString('utf8') || 'null');
}
function xcCreds(pl) {
  return { base: cleanServer(pl.server), u: encodeURIComponent(pl.username), p: encodeURIComponent(pl.password) };
}
function xtreamFrom(pl) {
  if (pl.type === 'xtream') return pl;
  if (pl.type === 'url') { const x = xtreamFromUrl(pl.url); if (x) return { ...pl, ...x }; }
  return null;
}

// kind: 'movies' | 'series'. Returns { categories:[{id,name,count}], items:[{id,name,cat,poster,rating,year,url?}] }
async function loadVod(pl, settings, kind, m3uChannels) {
  const xc = xtreamFrom(pl);
  if (xc) {
    try {
      const { base, u, p } = xcCreds(xc);
      const catAction = kind === 'movies' ? 'get_vod_categories' : 'get_series_categories';
      const listAction = kind === 'movies' ? 'get_vod_streams' : 'get_series';
      const [cats, list] = await Promise.all([xtreamJson(xc, settings, catAction), xtreamJson(xc, settings, listAction)]);
      const items = (list || []).map(s => kind === 'movies' ? {
        id: String(s.stream_id), name: s.name || '?', cat: String(s.category_id), poster: s.stream_icon || '',
        rating: s.rating || s.rating_5based * 2 || '', year: String(s.year || s.releaseDate || s.release_date || ((/\((19|20)\d\d\)/.exec(s.name || '') || [''])[0].replace(/[()]/g, ''))).slice(0, 4), added: Number(s.added) || 0,
        url: `${base}/movie/${u}/${p}/${s.stream_id}.${s.container_extension || 'mp4'}`
      } : {
        id: String(s.series_id), name: s.name || '?', cat: String(s.category_id), poster: s.cover || '',
        rating: s.rating || s.rating_5based * 2 || '', year: String(s.releaseDate || s.release_date || s.year || '').slice(0, 4), added: Number(s.last_modified) || 0
      });
      const count = new Map(); items.forEach(i => count.set(i.cat, (count.get(i.cat) || 0) + 1));
      const categories = (cats || []).map(c => ({ id: String(c.category_id), name: c.category_name, count: count.get(String(c.category_id)) || 0 })).filter(c => c.count);
      return { categories, items, source: 'xtream' };
    } catch (e) {
      if (pl.type === 'xtream') throw e;
    }
  }
  // M3U: entries whose URL looks like /movie/ or /series/
  const want = kind === 'movies' ? 'movie' : 'series';
  const items = [], catIdx = new Map(), categories = [];
  (m3uChannels || []).forEach((c, i) => {
    if (c.kind !== want) return;
    if (!catIdx.has(c.group)) { catIdx.set(c.group, String(categories.length)); categories.push({ id: String(categories.length), name: c.group, count: 0 }); }
    const cat = catIdx.get(c.group);
    categories[+cat].count++;
    items.push({ id: 'm' + i, name: c.name, cat, poster: c.logo || '', rating: '', year: ((/\((19|20)\d\d\)/.exec(c.name) || [''])[0].replace(/[()]/g, '')), added: i, url: c.url, episode: kind === 'series' });
  });
  return { categories, items, source: 'm3u' };
}

// Seasons and episodes of one Xtream series
async function loadSeries(pl, settings, seriesId) {
  const xc = xtreamFrom(pl);
  if (!xc) throw new Error('Þættir eru bara studdir fyrir Xtream áskriftir');
  const { base, u, p } = xcCreds(xc);
  const j = await xtreamJson(xc, settings, 'get_series_info', `&series_id=${encodeURIComponent(seriesId)}`);
  const info = (j && j.info) || {};
  const eps = (j && j.episodes) || {};
  const seasons = Object.keys(eps).sort((a, b) => Number(a) - Number(b)).map(s => ({
    season: s,
    episodes: (eps[s] || []).map(e => ({
      id: String(e.id), title: e.title || `Þáttur ${e.episode_num}`, num: e.episode_num,
      plot: (e.info && e.info.plot) || '', duration: (e.info && e.info.duration) || '',
      poster: (e.info && e.info.movie_image) || '',
      url: `${base}/series/${u}/${p}/${e.id}.${e.container_extension || 'mp4'}`
    }))
  }));
  return { name: info.name || '', plot: info.plot || '', cover: info.cover || '', seasons };
}

module.exports.loadVod = loadVod;
module.exports.loadSeries = loadSeries;
