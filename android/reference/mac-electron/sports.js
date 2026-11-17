'use strict';
// Today's matches, live status (incl. half-time) and which channels show them.
// Fixtures/status: ESPN's public scoreboard JSON (no key needed).
// TV channels per country: TheSportsDB (optional premium key) + the playlist's own EPG.

const { norm } = require('./epg');

// id = ESPN slug (fallback source), fm = FotMob league id (main source)
const LEAGUES = [
  { id: 'eng.1', fm: 47, name: 'Premier League' },
  { id: 'uefa.champions', fm: 42, name: 'Champions League' },
  { id: 'uefa.europa', fm: 73, name: 'Europa League' },
  { id: 'uefa.europa.conf', fm: 10216, name: 'Conference League' },
  { id: 'eng.2', fm: 48, name: 'Championship' },
  { id: 'eng.3', fm: 108, name: 'League One' },
  { id: 'eng.fa', fm: 132, name: 'FA Cup' },
  { id: 'eng.league_cup', fm: 133, name: 'Carabao Cup' },
  { id: 'esp.1', fm: 87, name: 'La Liga' },
  { id: 'ger.1', fm: 54, name: 'Bundesliga' },
  { id: 'ita.1', fm: 55, name: 'Serie A' },
  { id: 'fra.1', fm: 53, name: 'Ligue 1' },
  { id: 'sco.1', fm: 64, name: 'Scottish Premiership' },
  { id: 'ned.1', fm: 57, name: 'Eredivisie' },
  { id: 'por.1', fm: 61, name: 'Liga Portugal' },
  { id: 'isl.1', fm: 215, name: 'Besta deildin' },
  { id: 'uefa.nations', fm: 9806, name: 'Nations League' },
  { id: 'fifa.world', fm: 77, name: 'HM' },
  { id: 'uefa.euro', fm: 50, name: 'EM' }
];
const DEFAULT_LEAGUES = ['eng.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'eng.2', 'esp.1', 'ger.1', 'ita.1', 'fra.1'];

// cc = FotMob country code for TV listings
const COUNTRIES = [
  { id: 'iceland', cc: 'IS', name: 'Ísland', prefixes: ['IS', 'ICE', 'ISL'], groupWords: ['iceland', 'island'], strip: ['iceland', 'island', 'nord'] },
  { id: 'united_kingdom', cc: 'GB', name: 'Bretland (UK)', prefixes: ['UK', 'GB', 'ENG'], groupWords: ['united kingdom', 'uk', 'england'], strip: ['uk', 'gb'] },
  { id: 'usa', cc: 'US', name: 'Bandaríkin', prefixes: ['US', 'USA'], groupWords: ['usa', 'united states', 'us'], strip: ['us', 'usa'] },
  { id: 'australia', cc: 'AU', name: 'Ástralía', prefixes: ['AU', 'AUS'], groupWords: ['australia'], strip: ['au', 'australia'] },
  { id: 'new_zealand', cc: 'NZ', name: 'Nýja-Sjáland', prefixes: ['NZ'], groupWords: ['new zealand', 'nz'], strip: ['nz', 'new zealand'] },
  { id: 'ireland', cc: 'IE', name: 'Írland', prefixes: ['IE', 'IRE'], groupWords: ['ireland'], strip: ['ie', 'ireland'] },
  { id: 'canada', cc: 'CA', name: 'Kanada', prefixes: ['CA', 'CAN'], groupWords: ['canada'], strip: ['ca', 'canada'] },
  { id: 'arabic', cc: 'QA', name: 'Arabíska (beIN)', prefixes: ['AR', 'ARA'], groupWords: ['arabic', 'bein'], strip: ['mena', 'arabia'] }
];
const DEFAULT_COUNTRIES = ['iceland', 'united_kingdom', 'usa', 'australia', 'new_zealand'];

// Common nick-names used by TV guides. Keys are normalised full names.
const ALIASES = {
  'manchester united': ['man utd', 'man united', 'manchester utd', 'man u'],
  'manchester city': ['man city', 'manchester c'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'brighton & hove albion': ['brighton'],
  'brighton and hove albion': ['brighton'],
  'newcastle united': ['newcastle'],
  'west ham united': ['west ham'],
  'nottingham forest': ['nottm forest', 'nott m forest', 'nottingham'],
  'afc bournemouth': ['bournemouth'],
  'leeds united': ['leeds'],
  'leicester city': ['leicester'],
  'sheffield united': ['sheffield utd', 'sheff utd'],
  'sheffield wednesday': ['sheff wed', 'sheffield wed'],
  'west bromwich albion': ['west brom', 'wba'],
  'queens park rangers': ['qpr'],
  'paris saint-germain': ['psg', 'paris sg', 'paris saint germain'],
  'bayern munich': ['bayern', 'bayern munchen', 'fc bayern'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'bayer leverkusen': ['leverkusen'],
  'internazionale': ['inter', 'inter milan'],
  'inter milan': ['inter'],
  'ac milan': ['milan'],
  'atletico madrid': ['atletico', 'atl madrid', 'atleti'],
  'real madrid': ['r madrid'],
  'crystal palace': ['c palace', 'palace'],
  'aston villa': ['villa'],
  'ipswich town': ['ipswich'],
  'luton town': ['luton'],
  'norwich city': ['norwich'],
  'stoke city': ['stoke'],
  'swansea city': ['swansea'],
  'cardiff city': ['cardiff'],
  'hull city': ['hull'],
  'coventry city': ['coventry'],
  'birmingham city': ['birmingham'],
  'preston north end': ['preston'],
  'blackburn rovers': ['blackburn'],
  'bristol city': ['bristol c'],
  'wrexham': ['wrexham afc']
};

const words = s => ' ' + norm2(s) + ' ';
// like epg.norm but keeps spaces so we can match whole words
function norm2(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(fc|afc|cf|sc)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function teamNames(t) {
  const out = new Set();
  for (const n of [t.name, t.short, t.abbr && t.abbr.length > 3 ? t.abbr : null, t.location]) {
    if (n) out.add(norm2(n));
  }
  const full = norm2(t.name);
  for (const [k, list] of Object.entries(ALIASES)) {
    if (norm2(k) === full || list.map(norm2).includes(full)) { out.add(norm2(k)); list.forEach(a => out.add(norm2(a))); }
  }
  // "Liverpool FC" -> "liverpool"; "Wrexham AFC" -> "wrexham"
  out.delete('');
  return [...out].filter(n => n.length >= 3);
}
const mentions = (text, names) => names.some(n => text.includes(' ' + n + ' '));

// ---------- fetching ----------
const cache = new Map(); // key -> {t, data}
// Use Chromium's network stack inside the app (looks like a normal browser to sites); plain fetch in tests
let netFetch = null;
try { const { net } = require('electron'); if (net && net.fetch) netFetch = (u, o) => net.fetch(u, o); } catch { }
async function getJson(url, headers = {}, ttlMs = 60000) {
  const c = cache.get(url);
  if (c && Date.now() - c.t < ttlMs) return c.data;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await (netFetch || fetch)(url, { headers: { 'User-Agent': 'Mozilla/5.0 Mulehead', ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    cache.set(url, { t: Date.now(), data });
    return data;
  } finally { clearTimeout(timer); }
}

const ymd = (d, sep = '') => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join(sep);

function parseEspnEvent(ev, league) {
  const comp = (ev.competitions || [])[0] || {};
  const cs = comp.competitors || [];
  const side = (h) => {
    const c = cs.find(x => x.homeAway === h) || {};
    const t = c.team || {};
    return { name: t.displayName || t.name || '?', short: t.shortDisplayName || t.name || '', abbr: t.abbreviation || '', location: t.location || '', logo: t.logo || '', score: c.score != null ? String(c.score) : '' };
  };
  const st = (comp.status || ev.status || {});
  const type = st.type || {};
  return {
    id: 'espn:' + ev.id,
    league: league.id, leagueName: league.name,
    start: Date.parse(ev.date || comp.date || 0),
    home: side('home'), away: side('away'),
    state: type.state || 'pre',              // pre | in | post
    status: type.name || '',                 // e.g. STATUS_HALFTIME, STATUS_FIRST_HALF, STATUS_FULL_TIME
    detail: type.shortDetail || type.detail || '',
    clock: st.displayClock || '',
    period: st.period || 0,
    halftime: /HALFTIME|HALF_TIME/i.test(type.name || '') || /^HT$/i.test(type.shortDetail || '')
  };
}

// ---------- FotMob (main source: fixtures, live status, TV per country) ----------
const FM = process.env.MULEHEAD_FOTMOB_BASE || 'https://www.fotmob.com';
const FM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36',
  'Accept': 'application/json'
};
function parseFmMatch(x, league) {
  const st = x.status || {};
  const lt = st.liveTime || {};
  const halfs = st.halfs || {};
  const state = st.finished ? 'post' : (st.started || st.ongoing) ? 'in' : 'pre';
  const ltShort = String(lt.short || '').replace(/[\u200e\u200f]/g, '');
  const halftime = state === 'in' && (/^(HT|PA|Hálfl)/i.test(ltShort) || /HT|half/i.test((st.reason && st.reason.short) || '') ||
    (!!halfs.firstHalfStarted && !halfs.secondHalfStarted && !/\d/.test(ltShort)));
  return {
    id: 'fm:' + x.id, fmId: String(x.id),
    league: league.id, leagueName: league.name,
    start: Date.parse(st.utcTime || 0),
    home: { name: x.home.name, short: x.home.shortName || '', abbr: '', logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${x.home.id}_small.png`, score: x.home.score != null ? String(x.home.score) : '' },
    away: { name: x.away.name, short: x.away.shortName || '', abbr: '', logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${x.away.id}_small.png`, score: x.away.score != null ? String(x.away.score) : '' },
    state, status: halftime ? 'HALFTIME' : state, detail: ltShort, clock: halftime ? 'HT' : ltShort, halftime
  };
}
async function fetchFotmob(dateStr, leagueIds, ttl) {
  const d = dateStr.replace(/-/g, '');
  const j = await getJson(`${FM}/api/data/matches?date=${d}&timezone=Atlantic%2FReykjavik&ccode3=ISL`, FM_HEADERS, ttl);
  const byFm = new Map(LEAGUES.filter(l => leagueIds.includes(l.id)).map(l => [l.fm, l]));
  const out = [];
  for (const lg of (j.leagues || [])) {
    const L = byFm.get(lg.primaryId) || byFm.get(lg.id);
    if (!L) continue;
    for (const x of (lg.matches || [])) out.push(parseFmMatch(x, L));
  }
  if (!j.leagues) throw new Error('FotMob svaraði ekki rétt');
  return out;
}
// { fotmobMatchId: [channel names] } for one country
async function fetchFmTv(cc) {
  try { return await getJson(`${FM}/api/data/liveTvChannels?countryCode=${cc}&ids=`, FM_HEADERS, 15 * 60e3); }
  catch { return {}; }
}

// ---------- framundanibeinni.is (Iceland: exact channel per match) ----------
const FIB = process.env.MULEHEAD_FIB_BASE || 'https://www.framundanibeinni.is';
async function fetchIceland() {
  try {
    const j = await getJson(`${FIB}/api/schedule`, { Accept: 'application/json' }, 15 * 60e3);
    return Object.values(j.schedule || {}).flat().filter(e => e.sportGroup === 'football' || /fotbolt|football|league|deild|cup|bikar/i.test(e.sport || ''));
  } catch { return []; }
}
// framundanibeinni channel code -> channel names as they appear in playlists (normalised)
function icelandChannelNames(code) {
  const c = String(code || '').toLowerCase();
  let m;
  if (c === 'synsport') return ['syn sport', 'syn sport 1', 'stod 2 sport'];
  if ((m = /^synsport(\d)$/.exec(c))) return [`syn sport ${m[1]}`, `stod 2 sport ${m[1]}`];
  if (c === 'synsportisland') return ['syn sport island', 'syn sport island 1'];
  if ((m = /^synsportisland(\d)$/.exec(c))) return [`syn sport island ${m[1]}`];
  if (c === 'synsportviaplay') return ['syn sport viaplay', 'stod 2 sport viaplay'];
  if (c === 'ruv') return ['ruv', 'ruv 1'];
  if ((m = /^ruv(\d)$/.exec(c))) return [`ruv ${m[1]}`];
  if ((m = /^eurosport(\d)$/.exec(c))) return [`eurosport ${m[1]}`];
  return [];
}
const SERVICE_WORDS = ['viaplay', 'disney', 'livey', 'siminn', 'prime', 'amazon', 'peacock', 'paramount', 'dazn', 'hbo max', 'fubo', 'stan', 'optus', 'kayo', 'discovery'];

// local (Iceland = UTC) day window
function dayWindow(dateStr) {
  const d0 = Date.parse(dateStr + 'T00:00:00Z');
  return [d0, d0 + 86400000];
}

async function fetchFixtures(dateStr, leagueIds, { live = false } = {}) {
  const [from, to] = dayWindow(dateStr);
  const ttl = live ? 50000 : (dateStr === new Date().toISOString().slice(0, 10) ? 60000 : 30 * 60e3);
  try {
    const fm = await fetchFotmob(dateStr, leagueIds, ttl);
    return fm.filter(m => m.start >= from && m.start < to).sort((a, b) => a.start - b.start);
  } catch (e) { /* fall back to ESPN */ }
  // ESPN's "dates" is in US time; ask for the day and the day before, then filter
  const days = [new Date(from - 86400000), new Date(from)].map(d => ymd(d));
  const today = ymd(new Date());
  const jobs = [];
  for (const id of leagueIds) {
    const league = LEAGUES.find(l => l.id === id) || { id, name: id };
    for (const day of days) {
      const url = `${process.env.MULEHEAD_SPORTS_BASE || 'https://site.api.espn.com'}/apis/site/v2/sports/soccer/${id}/scoreboard?dates=${day}&limit=200`;
      const ttl = (day >= today || live) ? 60000 : 3600e3;
      jobs.push(getJson(url, {}, ttl).then(j => (j.events || []).map(e => parseEspnEvent(e, league))).catch(() => []));
    }
  }
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return all.filter(m => m.start >= from && m.start < to && !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.start - b.start);
}

// TheSportsDB TV listings for a day (premium key). Returns [{event, channel, country, start}]
async function fetchTv(dateStr, key) {
  if (!key) return [];
  try {
    const j = await getJson(`https://www.thesportsdb.com/api/v2/json/filter/tv/day/${dateStr}`, { 'X-API-KEY': key }, 30 * 60e3);
    const list = j.filter || j.tvevents || j.tvevent || j.list || [];
    return list.filter(x => !x.strSport || /soccer|football/i.test(x.strSport)).map(x => ({
      event: x.strEvent || '', channel: x.strChannel || '', country: (x.strCountry || '').toLowerCase().replace(/\s+/g, '_'),
      start: x.strTimeStamp ? Date.parse(x.strTimeStamp.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(x.strTimeStamp) ? x.strTimeStamp : x.strTimeStamp + 'Z') : null
    }));
  } catch { return []; }
}

// Attach f.broadcasts = [{country, channel, code?}] from FotMob (per country) and framundanibeinni (Iceland)
async function attachBroadcasts(fixtures, countries) {
  const sel = COUNTRIES.filter(c => (countries || []).includes(c.id));
  const [tvByCountry, isl] = await Promise.all([
    Promise.all(sel.map(c => fetchFmTv(c.cc).then(t => [c.id, t]))),
    sel.some(c => c.id === 'iceland') ? fetchIceland() : Promise.resolve([])
  ]);
  for (const f of fixtures) {
    const list = [];
    for (const [cid, t] of tvByCountry) {
      const names = f.fmId ? t[f.fmId] : null;
      if (names) names.forEach(n => list.push({ country: cid, channel: n }));
    }
    if (isl.length) {
      const hn = teamNames(f.home), an = teamNames(f.away);
      for (const e of isl) {
        const t = Date.parse(`${e.date}T${e.time}Z`);   // Iceland time = UTC
        if (!(t > f.start - 90 * 60e3 && t < f.start + 30 * 60e3)) continue;
        const text = words(e.name);
        if (!(mentions(text, hn) && mentions(text, an))) continue;
        list.push({ country: 'iceland', channel: prettyIceland(e.channel, e.provider), code: e.channel, provider: e.provider });
      }
    }
    // de-duplicate
    const seen = new Set();
    f.broadcasts = list.filter(b => { const k = b.country + '|' + norm2(b.channel); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  return fixtures;
}
function prettyIceland(code, provider) {
  const n = icelandChannelNames(code)[0];
  if (n) return n.replace(/\b\w/g, ch => ch.toUpperCase()).replace('Syn', 'Sýn').replace('Ruv', 'RÚV').replace('Island', 'Ísland');
  const p = { viaplay: 'Viaplay', disney: 'Disney+', livey: 'Livey', siminn: 'Síminn', amazon: 'Prime Video', eurosport: 'Eurosport', ruv: 'RÚV', syn: 'Sýn' }[provider];
  return p || code;
}

// ---------- matching fixtures to playlist channels ----------
const RADIO_RE = /\b(radio|fm|talksport|5 live|live 5)\b/i;
const NOT_CHANNEL_RE = /\b(sky go|now tv|now\b|app|website|youtube|player|dazn app|streaming)\b/i;

function stripChannel(name, extraWords = []) {
  // "UK: Sky Sports Main Event FHD B" -> "sky sport main event"
  let n = norm2(String(name).replace(/^[A-Z]{2,4}\s*[:|]\s*/, '').replace(/\((uk|us|gb|nz|au)\)/gi, ' '));
  n = n.replace(/\b(f?hd|uhd|sd|4k|8k|hdr|hevc|h265|raw|b|backup|alt|\d{3,4}p|\d\dfps|vip|plus|tv)\b/g, ' ')
    .replace(/\bsports\b/g, 'sport');
  for (const w of extraWords) n = n.replace(new RegExp('\\b' + w + '\\b', 'g'), ' ');
  return n.replace(/\s+/g, ' ').trim();
}

function channelCountry(c) {
  const m = /^([A-Z]{2,4})\s*[:|]/.exec(c.name);
  const pre = m ? m[1] : '';
  const g = ' ' + norm2(c.group) + ' ';
  for (const k of COUNTRIES) {
    if (pre && k.prefixes.includes(pre)) return k.id;
    if (k.groupWords.some(w => g.includes(' ' + w + ' '))) return k.id;
  }
  return null;
}

/**
 * Finds the playlist channels that show each fixture.
 * @param fixtures  list from fetchFixtures (+ attachBroadcasts)
 * @param channels  playlist channels
 * @param visible   (idx) => boolean   – only folders the user has not hidden
 * @param epg       { programmes, chanMap }
 * @param countries selected country ids
 */
function matchChannels(fixtures, channels, visible, epg, countries, epgOffsetMs = 0) {
  const want = new Set(countries || []);
  // playlist channels indexed by country + stripped name
  const index = new Map();      // country|name -> [idx]
  const groupsByCountry = new Map();
  channels.forEach((c, i) => {
    if (!visible(i) || (c.kind && c.kind !== 'live')) return;
    const cc = channelCountry(c) || '?';
    const co = COUNTRIES.find(x => x.id === cc);
    const k = cc + '|' + stripChannel(c.name, co ? co.strip : []);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(i);
    if (!groupsByCountry.has(cc)) groupsByCountry.set(cc, new Set());
    groupsByCountry.get(cc).add(c.group);
  });
  const epgToIdx = new Map();
  (epg.chanMap || []).forEach((id, i) => { if (id && visible(i)) { if (!epgToIdx.has(id)) epgToIdx.set(id, []); epgToIdx.get(id).push(i); } });

  for (const f of fixtures) {
    const hn = teamNames(f.home), an = teamNames(f.away);
    const found = new Map(); // idx -> {score, why}
    const add = (i, score, why) => { const o = found.get(i); if (!o || o.score < score) found.set(i, { score, why }); };
    const folders = new Map(); // group -> service label

    // 1) official broadcasters per country (FotMob / framundanibeinni)
    for (const b of (f.broadcasts || [])) {
      if (want.size && !want.has(b.country)) continue;
      const co = COUNTRIES.find(x => x.id === b.country);
      const label = co ? co.name : b.country;
      const names = b.code ? icelandChannelNames(b.code) : [stripChannel(b.channel, co ? co.strip : [])];
      let hit = false;
      for (const n of names) {
        const idxs = index.get(b.country + '|' + n);
        if (idxs) { idxs.forEach(i => add(i, 4, `${b.channel} (${label})`)); hit = true; }
      }
      if (!hit && names[0] && names[0].length >= 6) {
        // e.g. "Stan Sport" -> "Stan Sport 1", "Stan Sport 2" (only when it narrows to a few channels)
        const pre = b.country + '|' + names[0] + ' ';
        const near = [...index.entries()].filter(([k]) => k.startsWith(pre) && /^\d+$/.test(k.slice(pre.length)));
        if (near.length && near.length <= 4) { near.forEach(([, idxs]) => idxs.forEach(i => add(i, 2, `${b.channel} (${label})`))); hit = true; }
      }
      if (!hit) {
        // a streaming service rather than a channel: point to a matching folder
        const svc = SERVICE_WORDS.find(w => norm2(b.channel).includes(w) || (b.provider && b.provider.includes(w.split(' ')[0])));
        if (svc) {
          for (const g of (groupsByCountry.get(b.country) || [])) {
            if (norm2(g).includes(svc)) folders.set(g, b.channel);
          }
        }
      }
    }

    // 2) EPG: programme around kick-off mentioning both teams
    for (const [id, progs] of Object.entries(epg.programmes || {})) {
      const idxs = epgToIdx.get(id); if (!idxs) continue;
      for (const p of progs) {
        const s = p[0] + epgOffsetMs, e = p[1] + epgOffsetMs;
        if (e < f.start - 10 * 60e3 || s > f.start + 45 * 60e3) continue;
        const text = words(p[2] + ' ' + (p[3] || '').slice(0, 200));
        const h = mentions(text, hn), a = mentions(text, an);
        if (h && a) idxs.forEach(i => add(i, 3, 'Dagskrá'));
        else if ((h || a) && Math.abs(s - f.start) < 20 * 60e3 && /\b(v|vs|gegn)\b| - /.test(' ' + p[2] + ' ')) idxs.forEach(i => add(i, 1, 'Dagskrá (annað liðið)'));
      }
    }
    f.channels = [...found.entries()].sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
      .map(([i, o]) => ({ idx: i, name: channels[i].name, group: channels[i].group, why: o.why, score: o.score }));
    f.folders = [...folders.entries()].map(([group, service]) => ({ group, service }));
  }
  return fixtures;
}

// ---------- UFC ----------
// Standing UFC rights per country (2026). Names as they tend to appear in playlists.
const UFC_RIGHTS = {
  united_kingdom: { label: 'TNT Sports', channels: ['tnt sport 1', 'tnt sport 2', 'tnt sport 3', 'tnt sport 4', 'tnt sport box office', 'tnt sport ultimate'] },
  usa: { label: 'Paramount+ / CBS', channels: ['cbs'], services: ['paramount'] },
  australia: { label: 'Paramount+ / Network 10 / Main Event', channels: ['main event', 'foxtel main event', 'network 10', 'ten', '10'], services: ['paramount', 'kayo'] },
  new_zealand: { label: 'TVNZ DUKE / Sky Sport', channels: ['tvnz duke', 'duke', 'sky arena', 'sky sport 1', 'sky sport 2'], services: ['tvnz'] },
  iceland: { label: 'Viaplay', channels: [], services: ['viaplay'] }
};

async function fetchUfc(fromDate, days = 30) {
  const d0 = fromDate.replace(/-/g, '');
  const d1 = new Date(Date.parse(fromDate + 'T00:00:00Z') + days * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
  const base = process.env.MULEHEAD_SPORTS_BASE || 'https://site.api.espn.com';
  const j = await getJson(`${base}/apis/site/v2/sports/mma/ufc/scoreboard?dates=${d0}-${d1}`, {}, 10 * 60e3);
  return (j.events || []).map(e => {
    const cs = e.competitions || [];
    const last = cs[cs.length - 1] || {};
    const fighters = (last.competitors || []).map(c => (c.athlete && (c.athlete.displayName || c.athlete.shortName)) || '?');
    const st = (e.status && e.status.type) || {};
    const start = Date.parse(e.date || (cs[0] && cs[0].date) || 0);
    const mainAt = Date.parse(last.date || e.date || 0);
    return {
      id: 'ufc:' + e.id, sport: 'ufc', name: e.name || 'UFC', short: e.shortName || 'UFC',
      start, mainAt, end: mainAt + 2 * 3600e3,
      fighters, state: st.state || 'pre', detail: st.shortDetail || '',
      bouts: cs.length
    };
  }).filter(e => e.end > Date.parse(fromDate + 'T00:00:00Z')).sort((a, b) => a.start - b.start);
}

// channels showing a UFC event: Iceland from framundanibeinni.is, other countries from the
// standing rights table, plus any channel whose EPG says UFC during the event
async function matchUfc(events, channels, visible, epg, countries, epgOffsetMs = 0) {
  const want = new Set(countries || []);
  const isl = want.has('iceland') ? (await fetchIcelandAll()).filter(e => /ufc/i.test((e.sport || '') + ' ' + (e.name || ''))) : [];
  const index = new Map(), groupsByCountry = new Map();
  channels.forEach((c, i) => {
    if (!visible(i) || (c.kind && c.kind !== 'live')) return;
    const cc = channelCountry(c) || '?';
    const co = COUNTRIES.find(x => x.id === cc);
    const k = cc + '|' + stripChannel(c.name, co ? co.strip : []);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(i);
    if (!groupsByCountry.has(cc)) groupsByCountry.set(cc, new Set());
    groupsByCountry.get(cc).add(c.group);
  });
  const epgToIdx = new Map();
  (epg.chanMap || []).forEach((id, i) => { if (id && visible(i)) { if (!epgToIdx.has(id)) epgToIdx.set(id, []); epgToIdx.get(id).push(i); } });
  const lastNames = (ev) => ev.fighters.map(f => norm2(f).split(' ').pop()).filter(n => n.length > 2);

  for (const ev of events) {
    const found = new Map(), folders = new Map(), broadcasts = [];
    const add = (i, score, why) => { const o = found.get(i); if (!o || o.score < score) found.set(i, { score, why }); };
    const names = lastNames(ev);
    // Iceland: exact listing
    for (const e of isl) {
      const t = Date.parse(`${e.date}T${e.time}Z`);
      if (!(t > ev.start - 2 * 3600e3 && t < ev.end)) continue;
      const txt = words(e.name);
      if (names.length && !names.some(n => txt.includes(' ' + n + ' ')) && !/ufc/i.test(e.name)) continue;
      broadcasts.push({ country: 'iceland', channel: prettyIceland(e.channel, e.provider), code: e.channel, provider: e.provider });
    }
    // other countries: standing rights
    for (const cid of want) {
      const r = UFC_RIGHTS[cid]; if (!r || cid === 'iceland') continue;
      broadcasts.push({ country: cid, channel: r.label, rights: true });
      const co = COUNTRIES.find(x => x.id === cid);
      for (const n of r.channels) {
        const idxs = index.get(cid + '|' + n);
        if (idxs) idxs.forEach(i => add(i, 2, `${r.label} (${co ? co.name : cid})`));
      }
    }
    // Iceland codes / services -> channels or folders
    for (const b of broadcasts) {
      if (b.code) {
        for (const n of icelandChannelNames(b.code)) { const idxs = index.get('iceland|' + n); if (idxs) idxs.forEach(i => add(i, 4, `${b.channel} (Ísland)`)); }
      }
      const svcs = b.code ? [b.provider] : ((UFC_RIGHTS[b.country] || {}).services || []);
      for (const svc of svcs) for (const g of (groupsByCountry.get(b.country) || [])) if (svc && norm2(g).includes(svc)) folders.set(g, b.channel);
    }
    // EPG mentioning UFC during the event
    for (const [id, progs] of Object.entries(epg.programmes || {})) {
      const idxs = epgToIdx.get(id); if (!idxs) continue;
      for (const p of progs) {
        const s = p[0] + epgOffsetMs, e = p[1] + epgOffsetMs;
        if (e < ev.start || s > ev.end) continue;
        const text = words(p[2] + ' ' + (p[3] || '').slice(0, 200));
        if (!text.includes(' ufc ')) continue;
        const both = names.length >= 2 && names.every(n => text.includes(' ' + n + ' '));
        idxs.forEach(i => add(i, both ? 3 : 2, 'Dagskrá'));
      }
    }
    ev.broadcasts = broadcasts;
    ev.channels = [...found.entries()].sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
      .map(([i, o]) => ({ idx: i, name: channels[i].name, group: channels[i].group, why: o.why, score: o.score }));
    ev.folders = [...folders.entries()].map(([group, service]) => ({ group, service }));
  }
  return events;
}
async function fetchIcelandAll() {
  try {
    const j = await getJson(`${FIB}/api/schedule`, { Accept: 'application/json' }, 15 * 60e3);
    return Object.values(j.schedule || {}).flat();
  } catch { return []; }
}

module.exports = { LEAGUES, DEFAULT_LEAGUES, COUNTRIES, DEFAULT_COUNTRIES, fetchFixtures, attachBroadcasts, matchChannels, teamNames, norm2, stripChannel, parseEspnEvent, parseFmMatch, icelandChannelNames, fetchUfc, matchUfc, UFC_RIGHTS };
