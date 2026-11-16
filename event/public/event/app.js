'use strict';
/* Viðburðir – vefsíðan (kort, listi, Mitt svæði). Engin bókasöfn nema MapLibre. */

const BASE = location.pathname.startsWith('/event') ? '/event' : '';
const API = BASE + '/api';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let lang = store.get('lang', 'is');
const L = (is, en) => (lang === 'en' && en !== undefined ? en : is);

// Flokkar: aðalflokkar, og undirflokkar fyrir Tónlist og Leikhús.
const SUBS = { tonlist: ['tonleikar', 'ball', 'dj', 'trubador', 'tonlist_annad'], leikhus: ['leiksyning', 'songleikur', 'barnaleikrit', 'dans', 'leikhus_annad'] };
const TOPS = ['tonlist', 'leikhus', 'uppistand', 'pubquiz', 'list', 'annad'];
const PARENT = {}; Object.entries(SUBS).forEach(([t, xs]) => xs.forEach((x) => (PARENT[x] = t)));
const TAGS = TOPS;
const TAGL = {
  is: { tonlist: 'Tónlist', leikhus: 'Leikhús', uppistand: 'Uppistand', pubquiz: 'Pub quiz', list: 'List', annad: 'Annað',
    tonleikar: 'Tónleikar', ball: 'Ball', dj: 'DJ', trubador: 'Trúbador', tonlist_annad: 'Annað',
    leiksyning: 'Leiksýning', songleikur: 'Söngleikur', barnaleikrit: 'Barnaleikrit', dans: 'Dans', leikhus_annad: 'Annað' },
  en: { tonlist: 'Music', leikhus: 'Theatre', uppistand: 'Comedy', pubquiz: 'Pub quiz', list: 'Art', annad: 'Other',
    tonleikar: 'Concert', ball: 'Dance (ball)', dj: 'DJ', trubador: 'Troubadour', tonlist_annad: 'Other',
    leiksyning: 'Play', songleikur: 'Musical', barnaleikrit: "Children's play", dans: 'Dance', leikhus_annad: 'Other' },
};
const GENRES = ['rokk', 'metall', 'ponk', 'popp', 'hiphop', 'raf', 'djass', 'blus', 'kantri', 'thjodlaga', 'klassik', 'kor', 'abreidur'];
const GENL = {
  is: { rokk: 'Rokk', metall: 'Metall', ponk: 'Pönk', popp: 'Popp', hiphop: 'Hip hop', raf: 'Raftónlist', djass: 'Djass', blus: 'Blús', kantri: 'Kántrí', thjodlaga: 'Þjóðlagatónlist', trubador: 'Trúbador', klassik: 'Klassík', kor: 'Kór', abreidur: 'Ábreiður' },
  en: { rokk: 'Rock', metall: 'Metal', ponk: 'Punk', popp: 'Pop', hiphop: 'Hip hop', raf: 'Electronic', djass: 'Jazz', blus: 'Blues', kantri: 'Country', thjodlaga: 'Folk', trubador: 'Singer-songwriter', klassik: 'Classical', kor: 'Choir', abreidur: 'Covers' },
};
const KINDS = { band: 'Hljómsveit / listamaður', group: 'Kór, félag eða leikfélag', venue: 'Staður' };
const MN_IS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
const DN_IS = ['sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur'];
const MN_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DN_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtLong(s) {
  if (!s) return '';
  const d = parseISO(s), y = d.getFullYear() !== TODAY.getFullYear() ? ' ' + d.getFullYear() : '';
  return lang === 'en' ? `${DN_EN[d.getDay()]} ${d.getDate()} ${MN_EN[d.getMonth()]}${y}` : `${DN_IS[d.getDay()]} ${d.getDate()}. ${MN_IS[d.getMonth()]}${y}`;
}
function fmtShort(s) { const d = parseISO(s); return lang === 'en' ? `${d.getDate()} ${MN_EN[d.getMonth()].slice(0, 3)}` : `${d.getDate()}. ${MN_IS[d.getMonth()].slice(0, 3)}`; }
const priceStr = (e) => e.price === null || e.price === undefined ? '' : e.price === 0 ? L('Frítt inn', 'Free') : e.price.toLocaleString('de-DE') + ' kr.';
const ageStr = (e) => e.age_text || (e.age === 'fylgd' ? L('Börn í fylgd með fullorðnum', 'Children with adults') : e.age ? e.age + '+' : '');
const timeStr = (e) => esc(e.time || '') + (e.end_time ? '–' + esc(e.end_time) : '');
const tagStr = (e) => {
  const t = e.tags || [];
  const shown = t.filter((x) => !(SUBS[x] && SUBS[x].some((y) => t.includes(y))) && !/_annad$/.test(x));
  return [...shown.map((x) => (x === 'annad' && e.other_label ? e.other_label : TAGL[lang][x] || x)), ...(e.genres || []).map((g) => GENL[lang][g] || g)];
};
const posterUrl = (k) => (k ? `${API}/poster/${k}` : '');

/* ---------- Netsamskipti ---------- */
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  // Fyrir vafra sem gleyma kökum (t.d. Arc Search): aðgangsmiði og innskráning líka í hausum.
  const g = store.get('gateTok', null) || (() => { try { return localStorage.getItem('gate'); } catch { return null; } })(); if (g) o.headers['X-Gate'] = g;
  const sid = store.get('sid', null); if (sid) o.headers['X-Session'] = sid;
  if (opts.body !== undefined) {
    if (opts.body instanceof Blob) { o.body = opts.body; o.headers['Content-Type'] = opts.body.type; }
    else { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  }
  let r;
  try { r = await fetch(API + path, o); } catch { throw new Error(L('Ekkert netsamband. Reyndu aftur.', 'No connection. Try again.')); }
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && data.error === 'Lykilorð vantar.') { location.reload(); }
  if (!r.ok) throw new Error(data.error || L('Villa kom upp.', 'Something went wrong.'));
  return data;
}
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 4500 : 2600);
}

/* ---------- Gögn ---------- */
let GEO = null;        // places.json: regions, munis, towns
let AREAS = null;      // areas.geojson
let PLACES = [];       // staðir úr gagnagrunni
let PLACE = {};        // id -> staður
let EVENTS = [];
let ME = null;         // {user,pages,pending}
const F = { quick: 'all', from: null, to: null, q: '', placeId: null, inView: false, sel: null, region: null };
const SF = (() => { const v = store.get('filters2', {}); return { tags: new Set(v.tags || []), genres: new Set(v.genres || []), fam: !!v.fam, free: !!v.free, gOpen: false }; })();
const saveSF = () => store.set('filters2', { tags: [...SF.tags], genres: [...SF.genres], fam: SF.fam, free: SF.free });
const regionMatch = (e) => !F.region || (PLACE[e.place_id] && PLACE[e.place_id].region === F.region);
function typeMatch(e) {
  if (SF.fam && !e.fam) return false;
  if (SF.free && e.price !== 0) return false;
  if (!SF.tags.size) return true; // „Allt“
  const et = e.tags || [];
  return TOPS.some((top) => {
    if (!SF.tags.has(top) || !et.includes(top)) return false;
    const subs = (SUBS[top] || []).filter((x) => SF.tags.has(x));
    if (subs.length && !subs.some((x) => et.includes(x))) return false;
    if (top === 'tonlist' && SF.genres.size && !(e.genres || []).some((g) => SF.genres.has(g))) return false;
    return true;
  });
}

function regionName(id) { const r = GEO && GEO.regions.find((x) => x.id === id); return r ? L(r.n, r.en) : ''; }
function muniName(id) { return (GEO && GEO.munis[id] && GEO.munis[id].n) || ''; }
function placeLabel(p) {
  if (!p) return '';
  const where = p.town || [p.area, muniName(p.muni)].filter(Boolean).join(', ');
  return where && where !== p.name ? `${p.name} – ${where}` : p.name;
}

async function loadAll() {
  const [g, a, pl] = await Promise.all([
    fetch(BASE + '/data/places.json').then((r) => r.json()),
    fetch(BASE + '/data/areas.geojson').then((r) => r.json()),
    api('/places'),
  ]);
  GEO = g; AREAS = a;
  setPlaces(pl.places);
  await loadEvents();
}
function setPlaces(list) { PLACES = list; PLACE = {}; list.forEach((p) => (PLACE[p.id] = p)); assignPlaces(); }
// Bæir á kortinu: langt frá sjást bara stærri bæir („miðstöðvar“), nær allir bæir, svo staðirnir sjálfir.
const Z_HUB = 7, Z_TOWN = 10.5;
const HUBS = ['Reykjavík', 'Akureyri', 'Ísafjörður', 'Egilsstaðir', 'Höfn', 'Vík', 'Selfoss', 'Vestmannaeyjar'];
const MAJOR = new Set(HUBS);
let P2T = {}, P2H = {}, TOWNLL = {}, ABSORB = {};
function assignPlaces() {
  if (!GEO) return;
  TOWNLL = {}; GEO.towns.forEach((t) => (TOWNLL[t.n] = t.ll));
  const hubs = HUBS.filter((h) => TOWNLL[h]);
  const nearest = (ll, names) => { let b = null, bd = 1e9; for (const n of names) { const d = distKm(ll, TOWNLL[n]); if (d < bd) { bd = d; b = n; } } return b; };
  const allTowns = Object.keys(TOWNLL);
  // Smáhverfi alveg við stærri bæ (t.d. Árbæjarhverfi við Selfoss) teljast til stærri bæjarins.
  ABSORB = {};
  for (const t of GEO.towns) {
    if ((t.pop || 0) >= 1000 || MAJOR.has(t.n) || PROMOTE.has(t.n)) continue;
    let best = null, bd = 4;
    for (const u of GEO.towns) if (((u.pop || 0) >= 1000 || MAJOR.has(u.n)) && u.n !== t.n) { const d = distKm(t.ll, u.ll); if (d < bd) { bd = d; best = u.n; } }
    if (best) ABSORB[t.n] = best;
  }
  P2T = {}; P2H = {};
  const POP = {}; GEO.towns.forEach((t) => (POP[t.n] = t.pop || 0));
  for (const p of PLACES) {
    const ll = [p.lon, p.lat];
    let t = p.town && TOWNLL[p.town] ? p.town : null;
    if (!t) { const n = nearest(ll, allTowns); const lim = POP[n] > 20000 ? 8 : POP[n] > 2000 ? 3.5 : 1.8; if (distKm(ll, TOWNLL[n]) <= lim) t = n; }
    P2T[p.id] = t && ABSORB[t] ? ABSORB[t] : t; // null = úti í sveit: sést undir eigin nafni
    P2H[p.id] = p.region === 'hofudborg' ? 'Reykjavík' : nearest(ll, hubs);
  }
}
const PROMOTE = new Set([]); // bæir sem Júlíus vill færa upp um flokk, t.d. 'Kirkjubæjarklaustur'
const HUB_ANCHOR = { 'Reykjavík': 'bottom', 'Egilsstaðir': 'right', 'Vestmannaeyjar': 'right' }; // annars: nafn hægra megin við bóluna
const ANCH_OFF = { left: [1.5, 0], right: [-1.5, 0], bottom: [0, -1.6], top: [0, 1.6] };
function townTier(name) {
  if (MAJOR.has(name) || PROMOTE.has(name)) return 1;
  const t = GEO.towns.find((x) => x.n === name);
  return t && t.pop >= 1000 ? 2 : 3;
}
function aggGeo(kind) {
  const n = {};
  const rural = {};
  for (const e of eventsInDates()) {
    if (kind === 'hub') { const k = P2H[e.place_id]; if (k) n[k] = (n[k] || 0) + 1; continue; }
    const k = P2T[e.place_id];
    if (k) n[k] = (n[k] || 0) + 1; else if (PLACE[e.place_id]) rural[e.place_id] = (rural[e.place_id] || 0) + 1;
  }
  const names = kind === 'hub' ? HUBS : Object.keys(TOWNLL).filter((t) => !ABSORB[t]);
  const feats = names.filter((t) => TOWNLL[t]).map((t) => {
    const cnt = n[t] || 0, tier = kind === 'hub' ? 1 : townTier(t);
    const anchor = kind === 'hub' ? HUB_ANCHOR[t] || 'left' : 'left';
    return { type: 'Feature', geometry: { type: 'Point', coordinates: TOWNLL[t] },
      properties: { key: 't:' + t, name: t, n: cnt, major: MAJOR.has(t) ? 1 : 0, tier, keep: cnt > 0 || tier <= 2 ? 1 : 0, anchor, off: cnt > 0 ? ANCH_OFF[anchor] : [0, 0] } };
  });
  for (const [id, cnt] of Object.entries(rural)) {
    const p = PLACE[id];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { key: 'p:' + id, name: p.name, n: cnt, major: 0, tier: 3, keep: 1, anchor: 'left', off: ANCH_OFF.left } });
  }
  return { type: 'FeatureCollection', features: feats };
}
// Staðirnir sem bóla nær yfir (svo smellur sýni nákvæmlega viðburðina í henni).
function bubblePlaces(kind, key) {
  if (key.startsWith('p:')) return new Set([key.slice(2)]);
  const name = key.slice(2), map2 = kind === 'hub' ? P2H : P2T;
  return new Set(PLACES.filter((p) => map2[p.id] === name).map((p) => p.id));
}
async function loadEvents() {
  const r = await api('/events?from=' + iso(TODAY) + '&to=' + iso(addDays(TODAY, 365)));
  EVENTS = r.events;
}

/* ---------- Dagsetningasía ---------- */
function dateRange() {
  const t = TODAY;
  switch (F.quick) {
    case 'today': return [iso(t), iso(t)];
    case 'weekend': { const dow = t.getDay(); const fri = addDays(t, dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow); return [iso(fri < t ? t : fri), iso(addDays(fri, 2))]; }
    case 'week': return [iso(t), iso(addDays(t, 6))];
    case 'pick': return [F.from, F.to || F.from];
    default: return [iso(t), '9999-12-31'];
  }
}
function renderDateChips() {
  const chips = [['all', L('Allt framundan', 'All upcoming')], ['today', L('Í dag', 'Today')], ['weekend', L('Um helgina', 'This weekend')], ['week', L('Næstu 7 dagar', 'Next 7 days')]];
  const pick = F.quick === 'pick' ? '📅 ' + fmtShort(F.from) + (F.to && F.to !== F.from ? '–' + fmtShort(F.to) : '') : '📅 ' + L('Veldu dag', 'Pick a date');
  $('dateChips').innerHTML = chips.map(([k, t]) => `<span class="chip ${F.quick === k ? 'on' : ''}" data-q="${k}">${t}</span>`).join('') +
    `<span class="chip ${F.quick === 'pick' ? 'on' : ''}" data-q="pick">${esc(pick)}</span>` +
    `<span class="chip fbtn" data-q="filters">🎛️ ${L('Sía', 'Filter')}</span>` +
    (F.region && !isMobile() ? `<span class="chip on" data-q="clearregion">📍 ${esc(regionName(F.region))} ✕</span>` : '') +
    (F.sel ? `<span class="chip on" data-q="clearplace">📍 ${esc(F.sel.label)} ✕</span>` : F.placeId && PLACE[F.placeId] ? `<span class="chip on" data-q="clearplace">📍 ${esc(PLACE[F.placeId].name)} ✕</span>` : '');
  $('dateChips').querySelectorAll('[data-q]').forEach((c) => (c.onclick = () => {
    const q = c.dataset.q;
    if (q === 'clearregion') { F.region = null; store.set('region', null); fitIceland(); renderAll(); return; }
    if (q === 'clearplace') { F.placeId = null; F.sel = null; renderAll(); return; }
    if (q === 'filters') { $('filters').classList.toggle('open'); return; }
    if (q === 'pick') {
      openCal(F.from || iso(TODAY), { title: L('Frá', 'From'), min: iso(TODAY), onPick: (a) => {
        openCal(a, { title: L('Til (má sleppa)', 'To (optional)'), min: a, clearText: L('Bara þessi dagur', 'Just this day'), onPick: (b) => { F.quick = 'pick'; F.from = a; F.to = b; renderAll(); }, onClear: () => { F.quick = 'pick'; F.from = a; F.to = a; renderAll(); } });
      } });
      return;
    }
    F.quick = q; renderAll();
  }));
}

/* ---------- Síun ---------- */
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ö/g, 'o').replace(/[,.\-–]/g, ' ').replace(/\s+/g, ' ').trim(); }
function eventsInDates() {
  const [a, b] = dateRange();
  return EVENTS.filter((e) => e.date >= a && e.date <= b && typeMatch(e) && regionMatch(e));
}
function textMatch(e, q) {
  const p = PLACE[e.place_id] || {};
  return norm([e.title, e.page_name, p.name, p.town, p.area, muniName(p.muni), regionName(p.region), tagStr(e).join(' ')].join(' ')).includes(q);
}
function visibleEvents() {
  let list = eventsInDates();
  const q = norm(F.q);
  if (q) list = list.filter((e) => textMatch(e, q));
  if (F.sel) list = list.filter((e) => F.sel.ids.has(e.place_id));
  else if (F.placeId) list = list.filter((e) => e.place_id === F.placeId);
  else if (F.inView && map && mapReady) {
    const b = map.getBounds();
    list = list.filter((e) => { const p = PLACE[e.place_id]; return p && b.contains([p.lon, p.lat]); });
  }
  return list;
}

/* ---------- Listinn ---------- */
const DOW_IS = ['SUN', 'MÁN', 'ÞRI', 'MIÐ', 'FIM', 'FÖS', 'LAU'], DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function evRow(e) {
  const p = PLACE[e.place_id] || {};
  const d = parseISO(e.date);
  const today = e.date === iso(TODAY), tmrw = e.date === iso(addDays(TODAY, 1));
  const dow = today ? L('Í DAG', 'TODAY') : tmrw ? L('Á MORGUN', 'TMRW') : (lang === 'en' ? DOW_EN : DOW_IS)[d.getDay()];
  const money = [priceStr(e) && '💰 ' + priceStr(e), e.door && '🚪 ' + L('við hurð', 'at the door'), ageStr(e) && '🔞 ' + ageStr(e)].filter(Boolean);
  return `<button class="ev2 ${e.cancelled ? 'cx' : ''}" data-ev="${e.id}">
    <span class="when ${today ? 'today' : ''}"><span class="dow">${dow}</span><span class="dm">${esc(fmtShort(e.date))}</span><span class="tm">${esc(e.time)}</span></span>
    <span class="body">
      <span class="ti">${e.cancelled ? `<span class="cxl">${L('AFLÝST', 'CANCELLED')}</span> ` : ''}${esc(e.title)}</span>
      <span class="ln">📍 ${esc(placeLabel(p))}</span>
      ${money.length ? `<span class="ln">${money.map(esc).join(' &nbsp;·&nbsp; ')}</span>` : ''}
      ${e.time_changed ? `<span class="ln chg">🕘 ${L('Breyttur tími', 'Time changed')}</span>` : ''}
      <span class="tags">${tagStr(e).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${e.fam ? `<span class="tag">👨‍👩‍👧 ${L('Fjölskylduvænt', 'Family')}</span>` : ''}</span>
    </span>
    ${e.poster ? `<img src="${posterUrl(e.poster)}" alt="" loading="lazy">` : ''}</button>`;
}
function renderList() {
  const list = visibleEvents();
  $('list').innerHTML = list.map(evRow).join('') || `<div class="empty">${L('Engir viðburðir fundust.', 'No events found.')}${F.inView || F.placeId || F.sel || F.q ? '' : '<br>' + L('Vertu fyrst(ur) til að setja inn viðburð!', 'Be the first to post an event!')}</div>`;
  $('list').querySelectorAll('[data-ev]').forEach((b) => (b.onclick = () => openEvent(b.dataset.ev)));
  const n = list.length;
  const where = F.region ? regionName(F.region) : L('öllu landinu', 'all of Iceland');
  $('listInfo').textContent = F.sel ? `${n} ${L('viðburðir', 'events')}: ${F.sel.label}` : F.placeId ? `${n} ${L('viðburðir á', 'events at')} ${PLACE[F.placeId]?.name || ''}`
    : F.inView ? `${n} ${L('viðburðir á svæðinu sem sést á kortinu', 'events in the map area')}` : `${n} ${L('viðburðir', 'events')}: ${where}`;
  const showAll = $('showAll');
  showAll.classList.toggle('hidden', !(F.inView || F.placeId || F.sel));
  showAll.textContent = F.region ? L('Sýna allt svæðið', 'Show whole region') : L('Sýna allt landið', 'Show all of Iceland');
}
$('showAll').onclick = () => { F.placeId = null; F.sel = null; F.inView = false; F.region ? fitArea('region', F.region, true) : fitIceland(); renderAll(); };

function renderRegions() {
  const counts = {};
  for (const e of eventsInDates()) { const p = PLACE[e.place_id]; if (p) counts[p.region] = (counts[p.region] || 0) + 1; }
  $('regions').innerHTML = GEO.regions.map((r) => `<span class="chip" data-r="${r.id}">${esc(L(r.n, r.en))} <b>${counts[r.id] || 0}</b></span>`).join('');
  $('regions').querySelectorAll('[data-r]').forEach((c) => (c.onclick = () => fitArea('region', c.dataset.r)));
}

function renderFilters() {
  const inDates = (() => { const [a, b] = dateRange(); return EVENTS.filter((e) => e.date >= a && e.date <= b && regionMatch(e)); })();
  const cT = {}, cG = {};
  for (const e of inDates) { (e.tags || []).forEach((t) => (cT[t] = (cT[t] || 0) + 1)); (e.genres || []).forEach((g) => (cG[g] = (cG[g] || 0) + 1)); }
  const cb = (k, v, label, n, on, sub) => `<label class="cbx ${sub ? 'sub' : ''}"><input type="checkbox" data-${k}="${v}" ${on ? 'checked' : ''}><span>${label}</span><small>${n ?? ''}</small></label>`;
  let html = cb('fall', 1, '<b>' + L('Allt', 'Everything') + '</b>', inDates.length, !SF.tags.size) + '<hr>';
  for (const top of TOPS) {
    html += cb('ft', top, esc(TAGL[lang][top]), cT[top] || 0, SF.tags.has(top));
    if (SUBS[top] && SF.tags.has(top)) {
      html += SUBS[top].map((x) => cb('ft', x, esc(TAGL[lang][x]), cT[x] || 0, SF.tags.has(x), true)).join('');
      if (top === 'tonlist') {
        html += `<button class="glink" id="gToggle">${SF.gOpen || SF.genres.size ? '▾' : '▸'} ${L('Tónlistarstefna', 'Genre')}${SF.genres.size ? ` (${SF.genres.size})` : ''}</button>`;
        if (SF.gOpen || SF.genres.size) html += GENRES.map((g) => cb('fg', g, esc(GENL[lang][g]), cG[g] || 0, SF.genres.has(g), true)).join('');
      }
    }
  }
  html += '<hr>' + cb('ffam', 1, '👨‍👩‍👧 ' + L('Fjölskylduvænt', 'Family friendly'), inDates.filter((e) => e.fam).length, SF.fam)
    + cb('ffree', 1, '💸 ' + L('Frítt inn', 'Free entry'), inDates.filter((e) => e.price === 0).length, SF.free);
  $('filters').innerHTML = html;
  const active = SF.tags.size + (SF.fam ? 1 : 0) + (SF.free ? 1 : 0);
  const fb = document.querySelector('[data-q="filters"]');
  if (fb) fb.textContent = '🎛️ ' + L('Sía', 'Filter') + (active ? ` (${active})` : '');
  const R = $('filters');
  R.querySelector('[data-fall]').onchange = () => { SF.tags.clear(); SF.genres.clear(); saveSF(); renderAll(); };
  R.querySelectorAll('[data-ft]').forEach((b) => (b.onchange = () => {
    const t = b.dataset.ft;
    if (b.checked) { SF.tags.add(t); if (PARENT[t]) SF.tags.add(PARENT[t]); }
    else { SF.tags.delete(t); (SUBS[t] || []).forEach((x) => SF.tags.delete(x)); if (t === 'tonlist') SF.genres.clear(); }
    saveSF(); renderAll();
  }));
  R.querySelectorAll('[data-fg]').forEach((b) => (b.onchange = () => { const g = b.dataset.fg; b.checked ? SF.genres.add(g) : SF.genres.delete(g); saveSF(); renderAll(); }));
  R.querySelector('[data-ffam]').onchange = (ev) => { SF.fam = ev.target.checked; saveSF(); renderAll(); };
  R.querySelector('[data-ffree]').onchange = (ev) => { SF.free = ev.target.checked; saveSF(); renderAll(); };
  const gt = $('gToggle'); if (gt) gt.onclick = () => { SF.gOpen = !(SF.gOpen || SF.genres.size); if (!SF.gOpen) { SF.genres.clear(); saveSF(); } renderAll(); };
}
function renderAll() { renderDateChips(); renderFilters(); renderRegions(); renderList(); updateMapData(); if (isMobile()) renderMobileBars(); }

/* ---------- Kortið ---------- */
const ICELAND = [[-24.6, 63.25], [-13.4, 66.6]];
let map = null, mapReady = false, hoverId = null;

const STYLES = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/liberty' };
let mapTheme = store.get('mapTheme', 'dark');
async function pickStyle() {
  for (const s of [STYLES[mapTheme], STYLES.dark, STYLES.light]) {
    try { const r = await fetch(s); if (r.ok) return s; } catch {}
  }
  return null;
}
// Stækka texta (líka þegar stærðin fer eftir aðdrætti).
function scaleSize(v, k) {
  if (typeof v === 'number') return +(v * k).toFixed(2);
  if (Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'interpolate-hcl') && Array.isArray(v[2]) && v[2][0] === 'zoom') {
    const out = v.slice(0, 3);
    for (let i = 3; i < v.length; i += 2) out.push(v[i], typeof v[i + 1] === 'number' ? +(v[i + 1] * k).toFixed(2) : v[i + 1]);
    return out;
  }
  if (Array.isArray(v) && v[0] === 'step' && Array.isArray(v[1]) && v[1][0] === 'zoom') {
    return v.map((x, i) => (i >= 2 && i % 2 === 0 && typeof x === 'number' ? +(x * k).toFixed(2) : x));
  }
  return null;
}
// Dökka kortið gert læsilegt: bjartari götur og hús, stærri og skýrari nöfn.
function tuneMap() {
  const dark = mapTheme === 'dark';
  for (const l of map.getStyle().layers) {
    const sl = l['source-layer'] || '';
    try {
      if (l.type === 'symbol' && sl === 'place' && /country|state|city|town|village|capital/.test(l.id)) { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
      if (l.type === 'symbol' && map.getLayoutProperty(l.id, 'text-field') !== undefined) {
        const sz = scaleSize(map.getLayoutProperty(l.id, 'text-size') ?? 16, sl === 'transportation_name' ? 1.35 : 1.2);
        if (sz !== null) map.setLayoutProperty(l.id, 'text-size', sz);
        if (dark) {
          map.setPaintProperty(l.id, 'text-color', sl === 'transportation_name' ? '#f6e9e2' : '#f2e2dc');
          map.setPaintProperty(l.id, 'text-halo-color', '#120a0b');
          map.setPaintProperty(l.id, 'text-halo-width', 1.6);
        }
      }
      if (!dark) continue;
      if (l.type === 'line' && sl === 'transportation') {
        const major = /motorway|trunk|primary|secondary/.test(l.id);
        map.setPaintProperty(l.id, 'line-color', major ? '#c9a48c' : '#9a857e');
        map.setPaintProperty(l.id, 'line-opacity', 1);
      }
      if (l.type === 'fill' && sl === 'building') { map.setPaintProperty(l.id, 'fill-color', '#5a4544'); map.setPaintProperty(l.id, 'fill-opacity', 1); try { map.setPaintProperty(l.id, 'fill-outline-color', '#8c706c'); } catch {} }
      if (l.type === 'fill-extrusion' && sl === 'building') map.setPaintProperty(l.id, 'fill-extrusion-color', '#5a4544');
      if (l.type === 'fill' && sl === 'water') map.setPaintProperty(l.id, 'fill-color', '#16222b');
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#2a2021');
      if (l.type === 'fill' && (sl === 'landcover' || sl === 'landuse' || sl === 'park')) map.setPaintProperty(l.id, 'fill-opacity', 0.35);
    } catch {}
  }
}
class ThemeControl {
  onAdd() {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.el.innerHTML = `<button type="button" style="width:auto;padding:0 10px;font-size:14px;font-weight:700;color:#222"></button>`;
    const b = this.el.querySelector('button');
    const label = () => { b.textContent = mapTheme === 'dark' ? '☀️ ' + L('Ljóst kort', 'Light map') : '🌙 ' + L('Dökkt kort', 'Dark map'); };
    label();
    b.onclick = () => { mapTheme = mapTheme === 'dark' ? 'light' : 'dark'; store.set('mapTheme', mapTheme); label(); mapReady = false; hoverId = null; map.setStyle(STYLES[mapTheme]); };
    return this.el;
  }
  onRemove() { this.el.remove(); }
}
function bboxOf(geom) {
  let a = 180, b = 90, c = -180, d = -90;
  const walk = (x) => { if (typeof x[0] === 'number') { a = Math.min(a, x[0]); b = Math.min(b, x[1]); c = Math.max(c, x[0]); d = Math.max(d, x[1]); } else x.forEach(walk); };
  walk(geom.coordinates);
  return [[a, b], [c, d]];
}
function fitIceland() { if (map) map.fitBounds(ICELAND, { padding: 40, animate: false }); }
function fitArea(kind, id, keepView) {
  const f = AREAS.features.find((x) => x.properties.kind === kind && x.properties.id === id);
  if (!f || !map) return;
  F.placeId = null; F.sel = null; F.inView = !keepView;
  map.fitBounds(bboxOf(f.geometry), { padding: 30, maxZoom: 11 });
}
function pointsGeo(withEvents) {
  const n = {};
  for (const e of eventsInDates()) n[e.place_id] = (n[e.place_id] || 0) + 1;
  return {
    type: 'FeatureCollection',
    features: PLACES.filter((p) => (withEvents ? n[p.id] : !n[p.id])).map((p) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id, name: p.name, n: n[p.id] || 0 },
    })),
  };
}
function updateMapData() {
  if (!mapReady) return;
  map.getSource('pl').setData(pointsGeo(true));
  map.getSource('pl0').setData(pointsGeo(false));
  map.getSource('hub').setData(aggGeo('hub'));
  map.getSource('town').setData(aggGeo('town'));
}

async function initMap() {
  const style = await pickStyle();
  if (!style || !window.maplibregl) { $('map').innerHTML = `<div class="empty">${L('Kortið náði ekki að hlaðast.', 'The map could not load.')}</div>`; return; }
  map = new maplibregl.Map({
    container: 'map', style, bounds: ICELAND, fitBoundsOptions: { padding: 20 },
    maxBounds: [[-45, 55], [8, 73]], dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.once('load', () => (F.region ? fitArea('region', F.region, true) : fitIceland()));
  new ResizeObserver(() => { map.resize(); if (!F.inView && !F.placeId && !F.sel) (F.region ? fitArea('region', F.region, true) : fitIceland()); }).observe($('map'));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ThemeControl(), 'top-left');
  let wired = false;
  map.on('style.load', () => {
    tuneMap();
    const A = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#de8a5a';
    map.addSource('areas', { type: 'geojson', data: AREAS, generateId: true });
    map.addLayer({ id: 'reg-fill', type: 'fill', source: 'areas', maxzoom: 7.5, filter: ['==', ['get', 'kind'], 'region'],
      paint: { 'fill-color': A, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.28, 0.07] } });
    map.addLayer({ id: 'reg-line', type: 'line', source: 'areas', filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': A, 'line-opacity': 0.55, 'line-width': 1.2 } });
    map.addLayer({ id: 'muni-line', type: 'line', source: 'areas', minzoom: 7, filter: ['==', ['get', 'kind'], 'muni'], paint: { 'line-color': A, 'line-opacity': 0.35, 'line-width': 1, 'line-dasharray': [2, 2] } });

    map.addSource('pl0', { type: 'geojson', data: pointsGeo(false) });
    map.addLayer({ id: 'pt0', type: 'circle', source: 'pl0', minzoom: 12, paint: { 'circle-radius': 5, 'circle-color': '#8a6a64', 'circle-stroke-width': 1, 'circle-stroke-color': '#1d1214' } });
    map.addLayer({ id: 'pt0-l', type: 'symbol', source: 'pl0', minzoom: 12, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top' }, paint: { 'text-color': '#b9958d', 'text-halo-color': '#1d1214', 'text-halo-width': 1.2 } });

    map.addSource('pl', { type: 'geojson', data: pointsGeo(true), cluster: true, clusterRadius: 42, clusterMaxZoom: 15, clusterProperties: { n: ['+', ['get', 'n']] } });
    map.addLayer({ id: 'cl', minzoom: Z_TOWN, type: 'circle', source: 'pl', filter: ['has', 'point_count'],
      paint: { 'circle-color': A, 'circle-opacity': 0.92, 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(222,138,90,.35)',
        'circle-radius': ['step', ['get', 'n'], 14, 5, 18, 20, 23, 50, 28] } });
    map.addLayer({ id: 'cl-n', minzoom: Z_TOWN, type: 'symbol', source: 'pl', filter: ['has', 'point_count'],
      layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': true }, paint: { 'text-color': '#2a1208' } });
    map.addLayer({ id: 'pt', minzoom: Z_TOWN, type: 'circle', source: 'pl', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': A, 'circle-radius': ['step', ['get', 'n'], 9, 3, 11, 10, 13], 'circle-stroke-width': 2, 'circle-stroke-color': '#1d1214' } });
    map.addLayer({ id: 'pt-n', minzoom: Z_TOWN, type: 'symbol', source: 'pl', filter: ['!', ['has', 'point_count']],
      layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#2a1208' } });
    map.addLayer({ id: 'pt-l', minzoom: Z_TOWN, type: 'symbol', source: 'pl', filter: ['!', ['has', 'point_count']],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1.1, 'text-optional': true },
      paint: { 'text-color': '#f2e2dc', 'text-halo-color': '#1d1214', 'text-halo-width': 1.5 } });

    // Bæjabólur: miðstöðvar langt frá, allir bæir nær.
    const bubble = (id, src, minz, maxz) => {
      map.addSource(src, { type: 'geojson', data: aggGeo(src) });
      map.addLayer({ id: id + '-c', type: 'circle', source: src, minzoom: minz, maxzoom: maxz, filter: ['>', ['get', 'n'], 0],
        paint: { 'circle-color': A, 'circle-opacity': 0.95, 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(222,138,90,.35)', 'circle-radius': ['step', ['get', 'n'], 12, 5, 15, 20, 19, 50, 24] } });
      const size = ['match', ['get', 'tier'], 1, 17, 2, 15, 13];
      const color = ['case', ['>', ['get', 'n'], 0], '#f6e9e2', '#a88f88'];
      // Litlir bæir án viðburða mega víkja þegar þröngt er…
      map.addLayer({ id: id + '-l2', type: 'symbol', source: src, minzoom: minz, maxzoom: maxz, filter: ['==', ['get', 'keep'], 0],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': size, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.3 },
        paint: { 'text-color': color, 'text-halo-color': '#120a0b', 'text-halo-width': 1.6 } });
      // …en bæir með viðburði og stærri bæir víkja aldrei.
      map.addLayer({ id: id + '-l', type: 'symbol', source: src, minzoom: minz, maxzoom: maxz, filter: ['==', ['get', 'keep'], 1],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': size, 'text-anchor': ['get', 'anchor'], 'text-offset': ['get', 'off'],
          'text-allow-overlap': true, 'symbol-sort-key': ['-', 0, ['get', 'n']] },
        paint: { 'text-color': color, 'text-halo-color': '#120a0b', 'text-halo-width': 1.8 } });
      map.addLayer({ id: id + '-n', type: 'symbol', source: src, minzoom: minz, maxzoom: maxz, filter: ['>', ['get', 'n'], 0],
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#2a1208' } });
    };
    bubble('hub', 'hub', 0, Z_HUB);
    bubble('town', 'town', Z_HUB, Z_TOWN);

    if (!wired) { wired = true;
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    map.on('mousemove', 'reg-fill', (ev) => {
      const f = ev.features[0];
      if (hoverId !== null) map.setFeatureState({ source: 'areas', id: hoverId }, { hover: false });
      hoverId = f.id; map.setFeatureState({ source: 'areas', id: hoverId }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      tip.setLngLat(ev.lngLat).setHTML(`<b>${esc(L(f.properties.n, f.properties.en))}</b>`).addTo(map);
    });
    map.on('mouseleave', 'reg-fill', () => { if (hoverId !== null) map.setFeatureState({ source: 'areas', id: hoverId }, { hover: false }); hoverId = null; map.getCanvas().style.cursor = ''; tip.remove(); });
    map.on('click', (ev) => {
      const hits = map.queryRenderedFeatures(ev.point, { layers: ['hub-c', 'town-c', 'cl', 'pt', 'pt0', 'reg-fill'].filter((l) => map.getLayer(l)) });
      if (!hits.length) return;
      const f = hits[0];
      if (f.layer.id === 'hub-c' || f.layer.id === 'town-c') {
        tip.remove();
        const kind = f.layer.id === 'hub-c' ? 'hub' : 'town';
        const ids = bubblePlaces(kind, f.properties.key);
        F.placeId = null; F.inView = false; F.sel = { label: f.properties.name + (kind === 'hub' && f.properties.name !== 'Reykjavík' ? ' ' + L('og nágrenni', 'and surroundings') : ''), ids };
        const withEv = new Set(eventsInDates().filter((e) => ids.has(e.place_id)).map((e) => e.place_id));
        const pts = [...withEv].map((id) => PLACE[id]).filter(Boolean);
        if (pts.length) {
          const b = [[Math.min(...pts.map((p) => p.lon)), Math.min(...pts.map((p) => p.lat))], [Math.max(...pts.map((p) => p.lon)), Math.max(...pts.map((p) => p.lat))]];
          map.fitBounds(b, { padding: 60, maxZoom: 14 });
        }
        renderAll();
        if (innerWidth < 900) $('list').scrollIntoView({ behavior: 'smooth' });
      } else if (f.layer.id === 'cl') {
        map.getSource('pl').getClusterExpansionZoom(f.properties.cluster_id).then((z) => { F.inView = true; map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.3, 17) }); });
      } else if (f.layer.id === 'pt' || f.layer.id === 'pt0') {
        F.sel = null; F.placeId = f.properties.id; renderAll();
        if (innerWidth < 900) $('list').scrollIntoView({ behavior: 'smooth' });
      } else if (f.layer.id === 'reg-fill' && map.getZoom() < 7.5) {
        tip.remove(); fitArea('region', f.properties.id);
      }
    });
    ['hub-c', 'town-c', 'cl', 'pt', 'pt0'].forEach((l) => { map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', l, () => (map.getCanvas().style.cursor = '')); });
    map.on('dragstart', () => { F.inView = true; });
    map.on('zoomstart', (ev) => { if (ev.originalEvent) F.inView = true; });
    map.on('moveend', () => { if (F.inView) renderList(); });
    }
    mapReady = true;
    updateMapData();
  });
}

/* ---------- Leit efst ---------- */
function searchItems(q) {
  q = norm(q);
  if (q.length < 2) return [];
  const out = [];
  for (const r of GEO.regions) if (norm(r.n + ' ' + r.en).includes(q)) out.push({ k: 'region', id: r.id, t: L(r.n, r.en), s: L('Landshluti', 'Region') });
  for (const [id, m] of Object.entries(GEO.munis)) if (norm(m.n).includes(q)) out.push({ k: 'muni', id, t: m.n, s: L('Sveitarfélag', 'Municipality') });
  for (const t of GEO.towns) if (norm(t.n).startsWith(q) || norm(t.n).includes(' ' + q)) out.push({ k: 'town', t: t.n, ll: t.ll, s: muniName(t.m) });
  for (const p of PLACES) if (norm(placeLabel(p)).includes(q)) out.push({ k: 'place', id: p.id, t: p.name, s: p.town || muniName(p.muni) });
  return out.slice(0, 12);
}
function wireSearch() {
  const inp = $('q'), box = $('qSuggest');
  let items = [], sel = -1;
  const show = () => {
    items = searchItems(inp.value);
    box.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${i === sel ? 'on' : ''}">${esc(it.t)} <small>${esc(it.s || '')}</small></button>`).join('');
    box.classList.toggle('hidden', !items.length);
    box.querySelectorAll('[data-i]').forEach((b) => (b.onmousedown = (ev) => { ev.preventDefault(); choose(items[+b.dataset.i]); }));
  };
  const choose = (it) => {
    box.classList.add('hidden'); inp.value = ''; F.q = '';
    if (it.k === 'region' || it.k === 'muni') fitArea(it.k, it.id);
    else if (it.k === 'town') { F.placeId = null; F.sel = null; F.inView = true; map && map.flyTo({ center: it.ll, zoom: 12.5 }); }
    else if (it.k === 'place') { F.sel = null; F.placeId = it.id; const p = PLACE[it.id]; map && map.flyTo({ center: [p.lon, p.lat], zoom: 14 }); }
    renderAll();
  };
  inp.oninput = () => { sel = -1; F.q = inp.value; show(); renderList(); };
  inp.onkeydown = (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); show(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(sel - 1, -1); show(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { if (sel >= 0 && items[sel]) choose(items[sel]); else box.classList.add('hidden'); }
    else if (ev.key === 'Escape') box.classList.add('hidden');
  };
  inp.onblur = () => setTimeout(() => box.classList.add('hidden'), 150);
}

/* ---------- Gluggar ---------- */
function openModal(html, opts = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog"><button class="x" aria-label="${L('Loka', 'Close')}">×</button>${html}</div>`;
  const close = () => { ov.remove(); opts.onClose && opts.onClose(); };
  ov.querySelector('.x').onclick = close;
  ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) close(); });
  $('overlays').appendChild(ov);
  return { el: ov.querySelector('.modal'), close };
}

function eventDetailHtml(e) {
  const p = PLACE[e.place_id] || {};
  return `${e.cancelled ? `<div class="note bad"><b>${L('AFLÝST', 'CANCELLED')}</b>${e.cancel_note ? ' – ' + esc(e.cancel_note) : ''}</div>` : ''}
   <h2>${esc(e.title)}</h2>
   <div class="role">${esc(e.page_name)}</div>
   ${e.poster ? `<img class="poster" src="${posterUrl(e.poster)}" alt="">` : ''}
   <div class="kv">
    <div>📅 ${L('Hvenær', 'When')}</div><div>${esc(fmtLong(e.date))}, ${L('kl.', '')} ${timeStr(e)}${e.time_changed && e.old_time ? `<br><span class="chg">${L('Breyttur tími', 'Time changed')}</span> <s class="role">${esc(fmtShort(e.old_time.slice(0, 10)))} ${esc(e.old_time.slice(11))}</s>` : ''}</div>
    <div>📍 ${L('Hvar', 'Where')}</div><div>${esc(placeLabel(p))}${p.region ? `<br><span class="role">${esc(regionName(p.region))}</span>` : ''}</div>
    ${priceStr(e) ? `<div>💰 ${L('Verð', 'Price')}</div><div>${esc(priceStr(e))}${e.door ? ` · ${L('selt inn við hurð', 'pay at the door')}` : ''}</div>` : e.door ? `<div>🚪</div><div>${L('Selt inn við hurð', 'Pay at the door')}</div>` : ''}
    ${ageStr(e) ? `<div>🔞 ${L('Aldur', 'Age')}</div><div>${esc(ageStr(e))}</div>` : ''}
    <div>🏷️</div><div>${tagStr(e).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${e.fam ? `<span class="tag">👨‍👩‍👧 ${L('Fjölskylduvænt', 'Family friendly')}</span>` : ''}</div>
   </div>
   ${e.descr ? `<p style="white-space:pre-wrap">${esc(e.descr)}</p>` : ''}
   <div class="row">${e.ticket ? `<a class="btn primary" href="${esc(e.ticket)}" target="_blank" rel="noopener">🎟️ ${L('Kaupa miða', 'Buy tickets')}</a>` : ''}
    <button class="btn" data-share>🔗 ${L('Afrita hlekk', 'Copy link')}</button>
    ${p.lat ? `<button class="btn" data-onmap>🗺️ ${L('Sýna á korti', 'Show on map')}</button>` : ''}</div>`;
}
async function openEvent(id) {
  let e = EVENTS.find((x) => x.id === id);
  if (!e) { try { e = (await api('/events/' + id)).event; } catch (er) { toast(er.message, true); return; } }
  const m = openModal(eventDetailHtml(e), { onClose: () => history.replaceState(null, '', BASE + '/') });
  history.replaceState(null, '', BASE + '/?e=' + id);
  m.el.querySelector('[data-share]').onclick = async () => {
    const url = location.origin + BASE + '/?e=' + id;
    try { await navigator.clipboard.writeText(url); toast(L('Hlekkur afritaður', 'Link copied')); } catch { prompt(L('Afritaðu hlekkinn:', 'Copy the link:'), url); }
  };
  const om = m.el.querySelector('[data-onmap]');
  if (om) om.onclick = () => { m.close(); showPublic(); const p = PLACE[e.place_id]; F.sel = null; F.placeId = p.id; renderAll(); map && map.flyTo({ center: [p.lon, p.lat], zoom: 14 }); };
}

/* ---------- Dagatal (íslenskt, mánudagur fyrst) ---------- */
function openCal(cur, opts = {}) {
  const view = parseISO(cur || opts.min || iso(TODAY)); view.setDate(1);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.alignItems = 'center';
  $('overlays').appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) close(); });
  const draw = () => {
    const y = view.getFullYear(), mo = view.getMonth();
    const first = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const s = iso(new Date(y, mo, d));
      const past = (opts.min && s < opts.min);
      cells += `<button class="d ${past ? 'past' : ''} ${s === cur ? 'sel' : ''} ${s === iso(TODAY) ? 'today' : ''}" data-d="${s}" ${past && !opts.allowPast ? 'disabled' : ''}>${d}</button>`;
    }
    ov.innerHTML = `<div class="cal"><div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${esc(opts.title || '')}</b><button class="btn sm ghost" data-close>✕</button></div>
      <div class="head"><button class="btn sm" data-m="-1">‹</button><span>${lang === 'en' ? MN_EN[mo] : MN_IS[mo]} ${y}</span><button class="btn sm" data-m="1">›</button></div>
      <div class="grid">${(lang === 'en' ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : ['Má', 'Þr', 'Mi', 'Fi', 'Fö', 'La', 'Su']).map((x) => `<span class="dn">${x}</span>`).join('')}${cells}</div>
      ${opts.onClear ? `<div style="margin-top:10px"><button class="btn sm" data-clear>${esc(opts.clearText || L('Hreinsa', 'Clear'))}</button></div>` : ''}</div>`;
    ov.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { view.setMonth(view.getMonth() + +b.dataset.m); draw(); }));
    ov.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { close(); opts.onPick && opts.onPick(b.dataset.d); }));
    ov.querySelector('[data-close]').onclick = close;
    const c = ov.querySelector('[data-clear]'); if (c) c.onclick = () => { close(); opts.onClear(); };
  };
  draw();
}

/* ---------- Innskráning ---------- */
function loginHtml() {
  return `<h2>Mitt svæði</h2>
  <p>Hér setja staðir, bönd og félög inn viðburði. Þú þarft ekki að skrá þig inn til að skoða.</p>
  <form id="loginForm"><div class="f"><label>Netfangið þitt</label><input type="email" name="email" required autocomplete="email" placeholder="nafn@dæmi.is"></div>
  <button class="btn primary big">📧 Senda mér innskráningarhlekk</button>
  <p class="role">Þú færð tölvupóst með hlekk. Smelltu á hann og þú ert kominn inn – engin lykilorð. Þú helst innskráð(ur) á þessu tæki.</p>
  <div id="loginMsg"></div></form>`;
}
function wireLogin(root) {
  const f = root.querySelector('#loginForm');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: { email: f.email.value } });
      root.querySelector('#loginMsg').innerHTML = `<div class="note">✅ Póstur sendur á <b>${esc(f.email.value)}</b>. Opnaðu hann og smelltu á hlekkinn. (Kíktu í ruslpóstinn ef hann kemur ekki.)</div>`;
    } catch (e) { root.querySelector('#loginMsg').innerHTML = `<p class="err">${esc(e.message)}</p>`; btn.disabled = false; }
  };
}

/* ---------- Mitt svæði ---------- */
async function loadMe() {
  try { ME = await api('/me'); } catch { ME = { user: null }; }
  const n = ME.user ? ME.pending : 0;
  $('mineBadge').textContent = n; $('mineBadge').classList.toggle('hidden', !n);
}
function showPublic() { $('publicView').classList.remove('hidden'); $('mineView').classList.add('hidden'); $('dateChips').classList.remove('hidden'); if (map) { map.resize(); if (!F.inView && !F.placeId && !F.sel) fitIceland(); } }
async function showMine() {
  $('publicView').classList.add('hidden'); $('mineView').classList.remove('hidden'); $('dateChips').classList.add('hidden');
  await renderMine();
}
$('mineBtn').onclick = showMine;
$('logo').onclick = () => { showPublic(); if (isMobile()) showHome(); };

async function renderMine() {
  const root = $('mineView');
  await loadMe();
  if (!ME.user) { root.innerHTML = `<div class="dash"><div class="card">${loginHtml()}</div></div>`; wireLogin(root); return; }
  root.innerHTML = `<div class="dash"><p class="role">Hleð…</p></div>`;
  const [reqs, mine] = await Promise.all([api('/requests'), api('/my-events')]);
  const u = ME.user, pages = ME.pages;
  const venueIds = new Set(pages.filter((p) => p.kind === 'venue').map((p) => p.id));
  const isAdminSomewhere = u.owner || pages.some((p) => p.role === 'admin');
  const upcoming = mine.events.filter((e) => e.date >= iso(TODAY)).reverse();
  const past = mine.events.filter((e) => e.date < iso(TODAY));

  root.innerHTML = `<div class="dash">
   <div class="row" style="justify-content:space-between"><h1>Mitt svæði</h1><div class="row"><button class="btn" id="backBtn">← Til baka á kortið</button><button class="btn ghost sm" id="logoutBtn">Skrá út</button></div></div>
   <p class="role">Innskráð(ur) sem ${esc(u.email)}</p>

   ${reqs.requests.length ? `<div class="sec"><h2>🔴 Beiðnir sem bíða (${reqs.requests.length})</h2>${reqs.requests.map(reqCard).join('')}</div>` : ''}

   <div class="sec"><button class="btn primary big" id="newEv" ${pages.length ? '' : 'disabled'}>➕ Setja inn viðburð</button>
     ${pages.length ? '' : '<p class="role">Þú þarft fyrst að ganga í síðu (staður, band eða félag) með kóða hér fyrir neðan.</p>'}</div>

   <div class="sec"><h2>📅 Viðburðirnir mínir</h2>${upcoming.length ? upcoming.map(myEvCard).join('') : '<p class="role">Engir viðburðir framundan.</p>'}
     ${past.length ? `<details><summary class="role" style="cursor:pointer">🗂️ Liðnir viðburðir (${past.length})</summary>${past.map(myEvCard).join('')}</details>` : ''}</div>

   <div class="sec"><h2>👥 Síðurnar mínar</h2>
     ${pages.map((p) => `<div class="card"><div class="row" style="justify-content:space-between"><div><h3>${esc(p.name)}</h3><span class="role">${esc(KINDS[p.kind])} · ${p.role === 'admin' ? 'stjórnandi' : 'meðlimur'}${p.status !== 'approved' ? ' · bíður samþykkis' : ''}</span></div>
        ${p.code ? `<div class="role">Kóði til að bjóða: <span class="code">${esc(p.code)}</span></div>` : ''}</div>
        <div class="row" style="margin-top:8px">${p.role === 'admin' || u.owner ? `<button class="btn sm" data-members="${p.id}">Meðlimir${p.kind === 'venue' ? ' og traust' : ''}</button>` : ''}
        ${p.kind === 'venue' && p.place_id && (p.role === 'admin' || u.owner) ? `<button class="btn sm" data-moveplace="${p.place_id}">📍 Laga staðsetningu</button>` : ''}
        <button class="btn sm ghost" data-leave="${p.id}">Hætta í síðu</button></div><div data-memlist="${p.id}"></div></div>`).join('') || '<p class="role">Þú ert ekki í neinni síðu enn.</p>'}
     <form id="joinForm" class="card"><label>Ganga í síðu með kóða</label><div class="row"><input class="inp" name="code" placeholder="t.d. KUSK88" style="max-width:200px" autocomplete="off"><button class="btn primary">Ganga í síðu</button></div><div id="joinMsg"></div></form>
   </div>

   <div class="sec"><h2>🙋 Nafnið þitt</h2><form id="nameForm" class="row"><input class="inp" name="name" value="${esc(u.name || '')}" placeholder="Fullt nafn" style="max-width:320px"><button class="btn">Vista</button></form>
     <p class="role">Sést bara hjá stjórnendum síðna sem þú ert í.</p></div>

   ${isAdminSomewhere ? `<div class="sec"><h2>📍 Staðir</h2><button class="btn" id="addPlace">📍 Skrá nýjan stað</button>
     <p class="role">Ef staðurinn finnst ekki þegar viðburður er settur inn, t.d. samkomuhús úti í sveit.</p></div>` : ''}

   ${u.owner ? `<div class="sec"><h2>🛠️ Stjórnborð eiganda</h2><div id="ownerBox"><p class="role">Hleð…</p></div></div>` : ''}
  </div>`;

  $('backBtn').onclick = showPublic;
  $('logoutBtn').onclick = async () => { await api('/logout', { method: 'POST' }); store.set('sid', null); ME = null; await renderMine(); };
  const ne = $('newEv'); if (ne) ne.onclick = () => openEventForm(null);
  $('joinForm').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const r = await api('/join', { method: 'POST', body: { code: ev.target.code.value } }); toast(r.already ? `Þú ert nú þegar í ${r.page}` : `✅ Þú ert kominn í ${r.page}`); await renderMine(); }
    catch (e) { $('joinMsg').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('nameForm').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/me', { method: 'POST', body: { name: ev.target.elements.name.value } }); toast('Vistað'); } catch (e) { toast(e.message, true); } };
  const ap = $('addPlace'); if (ap) ap.onclick = () => openPlaceForm(null, () => renderMine());
  root.querySelectorAll('[data-leave]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Ertu viss um að þú viljir hætta í þessari síðu?')) return;
    try { await api(`/pages/${b.dataset.leave}/leave`, { method: 'POST' }); await renderMine(); } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-moveplace]').forEach((b) => (b.onclick = () => openPlaceForm(PLACE[b.dataset.moveplace], () => renderMine())));
  root.querySelectorAll('[data-members]').forEach((b) => (b.onclick = () => showMembers(b.dataset.members, venueIds.has(b.dataset.members))));
  wireReqCards(root);
  wireMyEvCards(root, mine.events);
  if (u.owner) renderOwner();
}

function reqCard(e) {
  const p = PLACE[e.place_id] || {};
  return `<div class="card req" data-req="${e.id}"><div><b>${esc(e.page_name)}</b> vilja setja inn viðburð á <b>${esc(p.name || '')}</b></div>
   <div style="margin:6px 0"><b>${esc(e.title)}</b><br><span class="role">${esc(fmtLong(e.date))} · ${timeStr(e)}${priceStr(e) ? ' · ' + esc(priceStr(e)) : ''}</span></div>
   <div class="col" style="max-width:420px">
    <button class="btn primary" data-a="approve">✓ Samþykkja þennan viðburð</button>
    <button class="btn" data-a="always">🤝 Samþykkja alltaf frá ${esc(e.page_name)}</button>
    <button class="btn danger" data-a="reject">✕ Hafna</button></div></div>`;
}
function wireReqCards(root) {
  root.querySelectorAll('[data-req]').forEach((card) => card.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, id = card.dataset.req;
    try {
      await api('/requests/' + id, { method: 'POST', body: { action: a } });
      await loadEvents(); renderAll();
      if (a === 'approve') {
        const name = card.querySelector('b').textContent;
        card.innerHTML = `<div>✅ Samþykkt</div><p>Samþykkja líka alltaf frá <b>${esc(name)}</b>?</p><div class="row"><button class="btn primary" data-y>🤝 Já</button><button class="btn" data-n>Nei takk</button></div>`;
        card.querySelector('[data-y]').onclick = async () => { await api('/requests/' + id, { method: 'POST', body: { action: 'trust' } }).catch((e) => toast(e.message, true)); renderMine(); };
        card.querySelector('[data-n]').onclick = () => renderMine();
      } else { toast(a === 'reject' ? 'Hafnað' : '✅ Samþykkt – og alltaf héðan í frá'); renderMine(); }
    } catch (e) { toast(e.message, true); }
  })));
}

function myEvCard(e) {
  const p = PLACE[e.place_id] || {};
  const st = e.status === 'pending' ? `<span class="chg">⏳ Bíður samþykkis hjá ${esc(p.name || 'staðnum')}</span>` : e.status === 'rejected' ? '<span class="err">✕ Hafnað</span>' : '';
  return `<div class="card" data-my="${e.id}"><div class="row" style="justify-content:space-between"><div>
     ${e.cancelled ? `<span class="cxl">AFLÝST</span>` : ''}<b>${esc(e.title)}</b><br>
     <span class="role">${esc(fmtLong(e.date))} · ${timeStr(e)} · ${esc(placeLabel(p))} · ${esc(e.page_name)}</span><br>${st}</div></div>
   <div class="row" style="margin-top:8px"><button class="btn sm" data-x="edit">✏️ Breyta</button><button class="btn sm" data-x="copy">📄 Afrita</button>
   ${e.cancelled ? '<button class="btn sm" data-x="uncancel">↩️ Hætta við aflýsingu</button>' : '<button class="btn sm" data-x="cancel">❌ Aflýsa</button>'}
   <button class="btn sm danger" data-x="delete">🗑️ Eyða</button></div></div>`;
}
function wireMyEvCards(root, list) {
  root.querySelectorAll('[data-my]').forEach((card) => card.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => {
    const e = list.find((x) => x.id === card.dataset.my);
    const x = b.dataset.x;
    try {
      if (x === 'edit') return openEventForm(e);
      if (x === 'copy') return openEventForm({ ...e, id: null, date: '' }, true);
      if (x === 'cancel') {
        const note = prompt('Aflýsa viðburðinum? Skrifaðu skýringu (má sleppa):', '');
        if (note === null) return;
        await api(`/events/${e.id}/cancel`, { method: 'POST', body: { note } });
      }
      if (x === 'uncancel') await api(`/events/${e.id}/uncancel`, { method: 'POST' });
      if (x === 'delete') { if (!confirm(`Ertu viss um að þú viljir eyða „${e.title}“? Það er ekki hægt að afturkalla.`)) return; await api('/events/' + e.id, { method: 'DELETE' }); }
      await loadEvents(); renderAll(); renderMine();
    } catch (er) { toast(er.message, true); }
  })));
}

async function showMembers(pageId, isVenue) {
  const box = document.querySelector(`[data-memlist="${pageId}"]`);
  if (box.innerHTML) { box.innerHTML = ''; return; }
  try {
    const r = await api(`/pages/${pageId}/members`);
    box.innerHTML = `<div style="margin-top:10px">${r.members.map((m) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:6px 0">
       <span>${esc(m.name || m.email)} <span class="role">${m.role === 'admin' ? 'stjórnandi' : 'meðlimur'}</span></span>
       <span class="row"><button class="btn sm" data-r="${m.role === 'admin' ? 'member' : 'admin'}" data-u="${m.id}">${m.role === 'admin' ? 'Gera að meðlim' : 'Gera að stjórnanda'}</button>
       <button class="btn sm danger" data-r="remove" data-u="${m.id}">Fjarlægja</button></span></div>`).join('')}
     ${isVenue ? `<p class="lbl" style="margin-top:12px">🤝 Samþykkt alltaf frá:</p>${r.trusts.map((t) => `<div class="row" style="justify-content:space-between"><span>${esc(t.name)}</span><button class="btn sm" data-untrust="${t.id}">Hætta að treysta</button></div>`).join('') || '<p class="role">Engum enn.</p>'}` : ''}</div>`;
    box.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.r === 'remove' && !confirm('Ertu viss?')) return;
      try { await api(`/pages/${pageId}/role`, { method: 'POST', body: { user: b.dataset.u, role: b.dataset.r } }); box.innerHTML = ''; showMembers(pageId, isVenue); } catch (e) { toast(e.message, true); }
    }));
    box.querySelectorAll('[data-untrust]').forEach((b) => (b.onclick = async () => {
      try { await api(`/pages/${pageId}/untrust`, { method: 'POST', body: { page: b.dataset.untrust } }); box.innerHTML = ''; showMembers(pageId, isVenue); } catch (e) { toast(e.message, true); }
    }));
  } catch (e) { toast(e.message, true); }
}

async function renderOwner() {
  const box = $('ownerBox');
  const r = await api('/admin/pages');
  box.innerHTML = `<form id="newPage" class="card"><h3>➕ Búa til síðu</h3>
     <div class="two"><div class="f"><label>Nafn</label><input type="text" name="name" required placeholder="t.d. Pakkhúsið"></div>
     <div class="f"><label>Tegund</label><select name="kind"><option value="band">${KINDS.band}</option><option value="group">${KINDS.group}</option><option value="venue">${KINDS.venue}</option></select></div></div>
     <div class="f hidden" id="npPlace"><label>Staðurinn</label>${placeFieldHtml('np', null)}</div>
     <label class="check"><input type="checkbox" name="join"> Ég verð líka stjórnandi síðunnar</label>
     <div style="margin-top:10px"><button class="btn primary">Búa til</button></div><div id="npMsg"></div></form>
   <div class="card"><h3>🧪 Prufugögn</h3><p class="role">Tilbúnir staðir, bönd og viðburðir um allt land til að sjá síðuna í notkun. Allt prufudót er merkt og hægt að eyða í einu.</p>
     <div class="row"><button class="btn" id="demoAdd">➕ Setja inn prufuviðburði</button><button class="btn danger" id="demoDel">🗑️ Eyða öllum prufugögnum</button></div></div>
   <div class="card"><h3>Allar síður (${r.pages.filter((p) => !p.id.startsWith('demo-')).length})</h3>${r.pages.filter((p) => !p.id.startsWith('demo-')).map((p) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:6px 0">
     <span><b>${esc(p.name)}</b> <span class="role">${esc(KINDS[p.kind])}${p.place_name ? ' · ' + esc(p.place_name) : ''} · ${p.n} meðlimir</span></span><span class="code">${esc(p.code)}</span></div>`).join('')}</div>`;
  const demo = async (method) => {
    if (method === 'DELETE' && !confirm('Eyða öllum prufugögnum? Alvöru gögn haldast.')) return;
    try {
      const r = await api('/admin/demo', { method });
      toast(method === 'POST' ? `✅ ${r.events} prufuviðburðir á ${r.places} stöðum` : '🗑️ Prufugögnum eytt');
      setPlaces((await api('/places')).places); await loadEvents(); renderAll(); renderMine();
    } catch (e) { toast(e.message, true); }
  };
  $('demoAdd').onclick = () => demo('POST');
  $('demoDel').onclick = () => demo('DELETE');
  const f = $('newPage');
  const pf = wirePlaceField(f, 'np');
  f.kind.onchange = () => $('npPlace').classList.toggle('hidden', f.kind.value !== 'venue');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const res = await api('/admin/pages', { method: 'POST', body: { name: f.elements.name.value, kind: f.kind.value, place_id: pf.value(), join: f.join.checked } });
      toast('✅ Síða búin til'); await renderMine();
      openModal(`<h2>Síðan er tilbúin</h2><p>Kóðinn til að ganga í <b>${esc(f.elements.name.value)}</b> er:</p><p style="font-size:28px"><span class="code">${esc(res.code)}</span></p><p class="role">Sendu hann þeim sem eiga að stjórna síðunni. Þeir skrá sig inn og slá kóðann inn undir „Ganga í síðu“. Fyrsti sem gengur í síðuna verður meðlimur – þú getur gert hann að stjórnanda.</p>`);
    } catch (e) { $('npMsg').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
}

/* ---------- Staðareitur (leit: „Staður – Bær“) ---------- */
function placeFieldHtml(key, placeId) {
  return `<div class="search" style="max-width:none"><input type="hidden" name="${key}_place" value="${esc(placeId || '')}">
   <input class="inp" data-pq="${key}" autocomplete="off" placeholder="Byrjaðu að skrifa, t.d. Hafið Höfn" value="${esc(placeId && PLACE[placeId] ? placeLabel(PLACE[placeId]) : '')}">
   <div class="suggest hidden" data-ps="${key}"></div></div>`;
}
function wirePlaceField(root, key, onPick) {
  const hid = root.querySelector(`[name="${key}_place"]`), inp = root.querySelector(`[data-pq="${key}"]`), list = root.querySelector(`[data-ps="${key}"]`);
  const recent = store.get('recentPlaces', []);
  const show = () => {
    const q = norm(inp.value);
    let items = PLACES.filter((p) => !q || norm(placeLabel(p) + ' ' + muniName(p.muni)).includes(q));
    items.sort((a, b) => { const ra = recent.indexOf(a.id), rb = recent.indexOf(b.id); return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || a.name.localeCompare(b.name, 'is'); });
    items = items.slice(0, 10);
    list.innerHTML = items.map((p) => `<button type="button" data-pid="${p.id}">${esc(placeLabel(p))}${recent.includes(p.id) ? ' <small>nýlega notað</small>' : ''}</button>`).join('') ||
      `<div class="role" style="padding:10px 14px">Finnst ekki. ${ME && ME.user && (ME.user.owner || ME.pages.some((p) => p.role === 'admin')) ? 'Þú getur skráð staðinn undir „📍 Skrá nýjan stað“ á Mitt svæði.' : 'Biddu stjórnanda um að skrá staðinn.'}</div>`;
    list.classList.remove('hidden');
    list.querySelectorAll('[data-pid]').forEach((b) => (b.onmousedown = (ev) => {
      ev.preventDefault(); hid.value = b.dataset.pid; inp.value = placeLabel(PLACE[b.dataset.pid]); list.classList.add('hidden');
      store.set('recentPlaces', [b.dataset.pid, ...recent.filter((x) => x !== b.dataset.pid)].slice(0, 8));
      onPick && onPick(b.dataset.pid);
    }));
  };
  inp.oninput = () => { hid.value = ''; show(); };
  inp.onfocus = show;
  inp.onblur = () => setTimeout(() => list.classList.add('hidden'), 150);
  return { value: () => hid.value };
}

/* ---------- Tími: stórir takkar + „Annað“ ---------- */
function parseTime(s) {
  s = String(s || '').trim().replace(/^kl\.?\s*/i, ''); if (!s) return null;
  let h, m;
  const a = s.match(/^(\d{1,2})\s*[:.,]\s*(\d{1,2})$/);
  if (a) { h = +a[1]; m = +a[2]; }
  else if (/^\d{1,4}$/.test(s)) { if (s.length <= 2) { h = +s; m = 0; } else { h = +s.slice(0, s.length - 2); m = +s.slice(-2); } }
  else return null;
  if (h === 24 && m === 0) h = 0;
  if (h > 23 || m > 59) return null;
  return pad(h) + ':' + pad(m);
}
function timeFieldHtml(name, val, optional) {
  const quick = optional ? ['23:00', '00:00', '01:00', '03:00'] : ['20:00', '21:00', '22:00', '23:00'];
  const other = !!val && !quick.includes(val);
  return `<div data-tf="${name}"><input type="hidden" name="${name}" value="${esc(val || '')}">
   <div class="tagpick">${optional ? `<span class="chip ${!val ? 'on' : ''}" data-tq="">Ekkert</span>` : ''}${quick.map((q) => `<span class="chip ${val === q ? 'on' : ''}" data-tq="${q}">${q}</span>`).join('')}<span class="chip ${other ? 'on' : ''}" data-tq="__other">Annað</span></div>
   <div class="${other ? '' : 'hidden'}" data-tother style="margin-top:8px"><input class="inp" data-tin inputmode="numeric" autocomplete="off" placeholder="t.d. 23:59" value="${other ? esc(val) : ''}" style="max-width:160px"> <span class="role" data-tmsg></span></div></div>`;
}
function wireTime(root, name) {
  const box = root.querySelector(`[data-tf="${name}"]`), hid = box.querySelector(`[name="${name}"]`), oth = box.querySelector('[data-tother]'), inp = box.querySelector('[data-tin]'), msg = box.querySelector('[data-tmsg]');
  const set = (v) => {
    box.querySelectorAll('[data-tq]').forEach((c) => c.classList.toggle('on', c.dataset.tq === v || (v === '__other' && c.dataset.tq === '__other')));
  };
  box.querySelectorAll('[data-tq]').forEach((c) => (c.onclick = () => {
    const v = c.dataset.tq;
    if (v === '__other') { set('__other'); oth.classList.remove('hidden'); inp.focus(); hid.value = parseTime(inp.value) || ''; }
    else { set(v); oth.classList.add('hidden'); hid.value = v; }
  }));
  inp.oninput = () => { const t = parseTime(inp.value); hid.value = t || ''; msg.textContent = inp.value ? (t ? '→ ' + t : 'Skrifaðu t.d. 2359 eða 23:59') : ''; };
  return { set: (v) => { if (!v) { const n = box.querySelector('[data-tq=""]'); n ? n.click() : 0; return; } const c = box.querySelector(`[data-tq="${v}"]`); if (c) c.click(); else { box.querySelector('[data-tq="__other"]').click(); inp.value = v; inp.oninput(); } } };
}

/* ---------- Líma texta → fylla út (reglur, engin gervigreind) ---------- */
const MON_RX = [['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['maí', 4], ['mai', 4], ['may', 4], ['jún', 5], ['jun', 5], ['júl', 6], ['jul', 6], ['ág', 7], ['ag', 7], ['aug', 7], ['sep', 8], ['okt', 9], ['oct', 9], ['nóv', 10], ['nov', 10], ['des', 11], ['dec', 11]];
function parseEventText(txt) {
  const r = {}; const low = txt.toLowerCase();
  let m = low.match(/(\d{1,2})\.?\s*(janúar|febrúar|mars|apríl|maí|júní|júlí|ágúst|september|október|nóvember|desember|january|february|march|april|may|june|july|august|october|november|december|jan|feb|mar|apr|jún|júl|ág|ágú|sep|okt|nóv|des|jun|jul|aug|oct|nov|dec)\b/);
  let day = null, mon = null;
  if (m) { day = +m[1]; for (const [p, i] of MON_RX) if (m[2].startsWith(p)) { mon = i; break; } }
  else { m = low.match(/\b(\d{1,2})[./](\d{1,2})\b(?![./]\d{3})/); if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) { day = +m[1]; mon = +m[2] - 1; } }
  if (day && mon != null) { let d = new Date(TODAY.getFullYear(), mon, day); if (d < TODAY) d = new Date(TODAY.getFullYear() + 1, mon, day); r.date = iso(d); }
  m = low.match(/(?:kl\.?\s*)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:-|–|—|til)\s*(\d{1,2}(?:[:.]\d{2})?)(?!\s*(?:kr|\.\d{3}))/);
  const s1 = m && parseTime(m[1]), s2 = m && parseTime(m[2]);
  if (m && s1 && s2 && /kl|:|\./.test(m[0])) { r.time = s1; r.end_time = s2; }
  else { m = low.match(/kl\.?\s*(\d{1,2}(?:[:.]\d{2})?)/) || low.match(/\b(\d{1,2}:\d{2})\b/); if (m) { const v = parseTime(m[1]); if (v) r.time = v; } }
  if (/frítt inn|ókeypis|aðgangur frír|frír aðgangur|free entry|\bfrítt\b/.test(low)) r.price = 0;
  m = low.match(/(\d{1,3}(?:\.\d{3})+|\d{3,6})\s*(?:kr|krónur|isk)/); if (m) r.price = +m[1].replace(/\./g, '');
  m = low.match(/(\d{2})\s*ára\s*aldurstakmark|aldurstakmark\s*(?:er\s*)?(\d{2})|\b(1[2-9]|20)\s*\+/); if (m) r.age = m[1] || m[2] || m[3];
  m = txt.match(/https?:\/\/[^\s)]+/g); if (m) { const tk = m.find((u) => /tix\.is|svid\.is|midi|miði|ticket|harpa\.is/i.test(u)); if (tk) r.ticket = tk; }
  if (/við hurð|við dyr|við innganginn|at the door/.test(low)) r.door = true;
  return r;
}

/* ---------- Plakat: minnkað í tækinu, svo sent ---------- */
function shrinkImage(file, maxSide = 1600, q = 0.82) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Myndin opnaðist ekki.')); };
    img.src = url;
  });
}

/* ---------- Setja inn / breyta viðburði ---------- */
const AGES = ['', '12', '16', '18', '20', 'fylgd'];
function openEventForm(ev, isCopy) {
  const editing = !!(ev && ev.id);
  ev = ev || {};
  const pages = ME.pages.filter((p) => p.status === 'approved');
  const tags = new Set(ev.tags || []);
  const ageCur = ev.age_text ? '__other' : ev.age || '';
  const m = openModal(`<h2>${editing ? '✏️ Breyta viðburði' : '➕ Setja inn viðburð'}</h2>
  <form id="evForm">
   ${editing ? '' : `<details class="paste"><summary>📋 Fljótleg leið: líma texta af Facebook</summary>
     <textarea class="inp" id="pasteText" rows="4" placeholder="Afritaðu textann af viðburðinum og límdu hann hér"></textarea>
     <button class="btn primary sm" type="button" id="pasteGo">✨ Fylla út</button> <span class="role" id="pasteMsg"></span></details>`}
   ${pages.length > 1 && !editing ? `<div class="f"><label>Setja inn sem</label><select name="page_id">${pages.map((p) => `<option value="${p.id}" ${p.id === ev.page_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` : `<input type="hidden" name="page_id" value="${esc(ev.page_id || (pages[0] && pages[0].id) || '')}">`}
   <div class="f"><label>📍 Staður</label>${placeFieldHtml('ev', ev.place_id || (pages.length === 1 && pages[0].kind === 'venue' ? pages[0].place_id : ''))}</div>
   <div class="f"><label>Heiti viðburðar</label><input type="text" name="title" required maxlength="140" value="${esc(ev.title || '')}"></div>
   <div class="f"><label>📅 Dagsetning</label><input type="hidden" name="date" value="${esc(ev.date || '')}"><button type="button" class="btn" id="dateBtn">${ev.date ? esc(fmtLong(ev.date)) : 'Veldu dagsetningu'}</button>
     <div class="note warn hidden" id="pastWarn">⚠️ Þessi dagsetning er liðin. Ýttu aftur á vista ef þú vilt vista samt.</div></div>
   <div class="f"><label>🕘 Byrjar</label>${timeFieldHtml('time', ev.time || '21:00')}</div>
   <div class="f"><label>⏱️ Lýkur (má sleppa)</label>${timeFieldHtml('end_time', ev.end_time || '', true)}</div>
   <div class="f"><label>🏷️ Hvernig viðburður?</label><div class="tagpick">${TOPS.map((t) => `<span class="chip ${tags.has(t) ? 'on' : ''}" data-tag="${t}">${TAGL.is[t]}</span>`).join('')}</div>
     ${Object.entries(SUBS).map(([top, xs]) => `<div data-subbox="${top}" class="${tags.has(top) ? '' : 'hidden'}" style="margin-top:10px"><span class="role">${TAGL.is[top]}, nánar:</span>
       <div class="tagpick" style="margin-top:6px">${xs.map((x) => `<span class="chip ${tags.has(x) ? 'on' : ''}" data-sub="${x}">${TAGL.is[x]}</span>`).join('')}</div></div>`).join('')}
     <div id="genreBox" class="${tags.has('tonlist') ? '' : 'hidden'}" style="margin-top:10px"><span class="role">🎸 Tónlistarstefna (má sleppa, max 4):</span>
       <div class="tagpick" style="margin-top:6px">${GENRES.map((g) => `<span class="chip ${(ev.genres || []).includes(g) ? 'on' : ''}" data-genre="${g}">${GENL.is[g]}</span>`).join('')}</div></div>
     <input type="text" name="other_label" class="${tags.has('annad') ? '' : 'hidden'}" style="margin-top:8px" maxlength="40" placeholder="Hvað er þetta? t.d. fundur eða bingó" value="${esc(ev.other_label || '')}"></div>
   <div class="two"><div class="f"><label>💰 Verð (kr.)</label><input type="number" name="price" min="0" step="1" inputmode="numeric" placeholder="0 = frítt inn" value="${ev.price ?? ''}"></div>
     <div class="f"><label>&nbsp;</label><label class="check"><input type="checkbox" name="door" ${ev.door ? 'checked' : ''}> 🚪 Selt inn við hurð</label></div></div>
   <div class="f"><label>🎟️ Slóð til að kaupa miða (tix.is, svid.is o.s.frv., ef á við)</label><input type="url" name="ticket" placeholder="https://" value="${esc(ev.ticket || '')}"></div>
   <div class="f"><label>🔞 Aldurstakmark</label><input type="hidden" name="age" value="${esc(ageCur === '__other' ? '' : ageCur)}">
     <div class="tagpick">${AGES.map((a) => `<span class="chip ${ageCur === a ? 'on' : ''}" data-age="${a}">${a === '' ? 'Ekkert' : a === 'fylgd' ? 'Börn í fylgd með fullorðnum' : a + '+'}</span>`).join('')}<span class="chip ${ageCur === '__other' ? 'on' : ''}" data-age="__other">Annað</span></div>
     <input type="text" name="age_text" class="${ageCur === '__other' ? '' : 'hidden'}" style="margin-top:8px" maxlength="80" placeholder="t.d. 14 ára nema í fylgd" value="${esc(ev.age_text || '')}"></div>
   <div class="f"><label class="check"><input type="checkbox" name="fam" ${ev.fam ? 'checked' : ''}> 👨‍👩‍👧 Fjölskylduvænt</label></div>
   <div class="f"><label>📝 Lýsing (má sleppa)</label><textarea name="descr" rows="4" maxlength="3000">${esc(ev.descr || '')}</textarea></div>
   <div class="f"><label>🖼️ Plakat (má sleppa)</label><input type="hidden" name="poster" value="${esc(ev.poster || '')}">
     <div id="posterPrev">${ev.poster ? `<img class="poster" style="max-height:220px" src="${posterUrl(ev.poster)}">` : ''}</div>
     <div class="row"><label class="btn sm" style="margin:0">📷 Velja mynd<input type="file" accept="image/*" id="posterFile" hidden></label>${ev.poster ? '<button type="button" class="btn sm ghost" id="posterDel">Fjarlægja</button>' : ''}<span class="role" id="posterMsg"></span></div></div>
   ${editing ? `<div class="f hidden" id="hlBox"><label class="check"><input type="checkbox" name="highlight_change" checked> 🕘 Gera breyttan tíma meira áberandi („Breyttur tími“)</label></div>` :
     `<div class="f"><label>🔁 Endurtaka vikulega</label><select name="repeat_weeks">${[1, 2, 3, 4, 6, 8, 12].map((n) => `<option value="${n}">${n === 1 ? 'Nei, bara einu sinni' : n + ' vikur í röð'}</option>`).join('')}</select></div>`}
   <div id="evErr"></div>
   <button class="btn primary big" id="evSave">${editing ? '💾 Vista breytingar' : '✅ Setja inn viðburðinn'}</button>
  </form>`);
  const f = m.el.querySelector('#evForm');
  const pf = wirePlaceField(f, 'ev');
  const tStart = wireTime(f, 'time'), tEnd = wireTime(f, 'end_time');
  let pastOk = false;
  const setDate = (s) => { f.date.value = s; $('dateBtn').textContent = fmtLong(s); pastOk = false; $('pastWarn').classList.add('hidden'); checkChange(); };
  $('dateBtn').onclick = () => openCal(f.date.value || iso(TODAY), { title: 'Dagsetning', min: iso(TODAY), allowPast: true, onPick: setDate });
  const checkChange = () => { const hb = $('hlBox'); if (hb) hb.classList.toggle('hidden', !(ev.status === 'approved' && (f.date.value !== ev.date || f.time.value !== ev.time))); };
  f.querySelectorAll('[data-tf="time"] [data-tq]').forEach((c) => c.addEventListener('click', checkChange));
  f.querySelectorAll('[data-tag]').forEach((c) => (c.onclick = () => { c.classList.toggle('on'); f.other_label.classList.toggle('hidden', !f.querySelector('[data-tag="annad"].on')); $('genreBox').classList.toggle('hidden', !f.querySelector('[data-tag="tonlist"].on')); f.querySelectorAll('[data-subbox]').forEach((bx) => bx.classList.toggle('hidden', !f.querySelector(`[data-tag="${bx.dataset.subbox}"].on`))); }));
  f.querySelectorAll('[data-sub]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
  f.querySelectorAll('[data-genre]').forEach((c) => (c.onclick = () => { if (!c.classList.contains('on') && f.querySelectorAll('[data-genre].on').length >= 4) return toast('Mest 4 stefnur', true); c.classList.toggle('on'); }));
  const setAge = (a) => {
    const known = AGES.includes(String(a));
    f.querySelectorAll('[data-age]').forEach((x) => x.classList.toggle('on', x.dataset.age === (known ? String(a) : '__other')));
    f.age_text.classList.toggle('hidden', known); f.age.value = known ? String(a) : ''; if (!known) f.age_text.value = a + '+';
  };
  f.querySelectorAll('[data-age]').forEach((c) => (c.onclick = () => {
    const o = c.dataset.age === '__other';
    f.querySelectorAll('[data-age]').forEach((x) => x.classList.remove('on')); c.classList.add('on');
    f.age_text.classList.toggle('hidden', !o); f.age.value = o ? '' : c.dataset.age; if (o) f.age_text.focus(); else f.age_text.value = '';
  }));
  const pg = $('pasteGo');
  if (pg) pg.onclick = () => {
    const r = parseEventText($('pasteText').value || '');
    const got = [];
    if (r.date) { setDate(r.date); got.push('dagsetning'); }
    if (r.time) { tStart.set(r.time); got.push('tími'); }
    if (r.end_time) { tEnd.set(r.end_time); got.push('lokatími'); }
    if (r.price !== undefined) { f.price.value = r.price; got.push('verð'); }
    if (r.age) { setAge(r.age); got.push('aldur'); }
    if (r.ticket) { f.ticket.value = r.ticket; got.push('miðaslóð'); }
    if (r.door) { f.door.checked = true; got.push('við hurð'); }
    if (!f.descr.value) f.descr.value = ($('pasteText').value || '').trim().slice(0, 3000);
    $('pasteMsg').textContent = got.length ? '✅ Fann: ' + got.join(', ') + '. Athugaðu og veldu heiti og tegund sjálf(ur).' : 'Fann ekkert – fylltu út hér fyrir neðan.';
  };
  $('posterFile').onchange = async (e2) => {
    const file = e2.target.files[0]; if (!file) return;
    $('posterMsg').textContent = 'Sendi…';
    try {
      const blob = await shrinkImage(file);
      const r = await api('/poster', { method: 'POST', body: blob });
      f.poster.value = r.key; $('posterPrev').innerHTML = `<img class="poster" style="max-height:220px" src="${URL.createObjectURL(blob)}">`; $('posterMsg').textContent = '✅';
    } catch (er) { $('posterMsg').textContent = er.message; }
  };
  const pd = $('posterDel'); if (pd) pd.onclick = () => { f.poster.value = ''; $('posterPrev').innerHTML = ''; pd.remove(); };

  f.onsubmit = async (e2) => {
    e2.preventDefault();
    const errBox = $('evErr'); errBox.innerHTML = '';
    const tagsSel = [...f.querySelectorAll('[data-tag].on')].map((c) => c.dataset.tag);
    tagsSel.push(...[...f.querySelectorAll('[data-sub].on')].filter((c) => tagsSel.includes(PARENT[c.dataset.sub])).map((c) => c.dataset.sub));
    const body = {
      page_id: f.page_id.value, place_id: pf.value(), title: f.elements.title.value, date: f.date.value, time: f.time.value, end_time: f.end_time.value,
      price: f.price.value === '' ? null : Number(f.price.value), door: f.door.checked, ticket: f.ticket.value, age: f.age.value, age_text: f.age_text.value,
      tags: tagsSel, genres: [...f.querySelectorAll('[data-genre].on')].map((c) => c.dataset.genre), other_label: f.other_label.value, fam: f.fam.checked, descr: f.descr.value, poster: f.poster.value,
      repeat_weeks: f.repeat_weeks ? Number(f.repeat_weeks.value) : 1, highlight_change: f.highlight_change ? f.highlight_change.checked : false,
    };
    const fail = (msg) => { errBox.innerHTML = `<p class="err">${esc(msg)}</p>`; };
    if (!body.place_id) return fail('Veldu stað úr listanum.');
    if (!body.date) return fail('Veldu dagsetningu.');
    if (!body.time) return fail('Veldu tíma (eða skrifaðu hann rétt undir „Annað“).');
    if (!tagsSel.length) return fail('Veldu hvernig viðburður þetta er.');
    if (body.date < iso(TODAY) && !pastOk) { pastOk = true; $('pastWarn').classList.remove('hidden'); return; }
    const btn = $('evSave'); btn.disabled = true;
    try {
      const r = editing ? await api('/events/' + ev.id, { method: 'PUT', body }) : await api('/events', { method: 'POST', body });
      m.close();
      toast(r.status === 'pending' ? `⏳ Sent til ${r.venue || 'staðarins'} til samþykkis` : editing ? '✅ Vistað' : '✅ Viðburðurinn er kominn inn');
      await loadEvents(); renderAll(); if (!$('mineView').classList.contains('hidden')) renderMine();
    } catch (er) { fail(er.message); btn.disabled = false; }
  };
  if (isCopy) toast('Afrit – veldu nýja dagsetningu');
}

/* ---------- Skrá stað / laga staðsetningu ---------- */
let ADDR = null;
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function muniAt(ll) {
  for (const f of AREAS.features) if (f.properties.kind === 'muni' && f.geometry.coordinates.some((poly) => pointInRing(ll, poly[0]))) return f.properties;
  return null;
}
function distKm(a, b) { const dx = (a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180) * 111.3, dy = (a[1] - b[1]) * 111.3; return Math.hypot(dx, dy); }
function whereAt(ll) {
  const mu = muniAt(ll);
  let town = '', best = 99;
  for (const t of GEO.towns) { const d = distKm(ll, t.ll); const lim = t.pop > 20000 ? 8 : t.pop > 2000 ? 3.5 : 1.8; if (d < lim && d < best) { best = d; town = t.n; } }
  return { town, muni: mu ? mu.id : '', region: mu ? mu.r : '' };
}
async function openPlaceForm(place, done) {
  const editing = !!place;
  const m = openModal(`<h2>📍 ${editing ? 'Laga staðsetningu' : 'Skrá nýjan stað'}</h2>
   <form id="plForm">
    <div class="f"><label>1. 🔎 Leita að heimilisfangi, bæ eða húsi</label>
     <div class="search" style="max-width:none"><input class="inp" id="adrQ" autocomplete="off" placeholder="t.d. Fundarhús Lónmanna 781"><div class="suggest hidden" id="adrS"></div></div></div>
    <div class="f"><label>2. 🗺️ Smelltu á kortið til að færa punktinn</label><div id="miniMap"></div><div class="role" id="plWhere"></div></div>
    <div class="f"><label>3. ✏️ Heiti staðarins</label><input type="text" name="name" required maxlength="100" value="${esc(place ? place.name : '')}" placeholder="t.d. Hrollaugsstaðir"></div>
    <div class="f"><label>Sveit (má sleppa)</label><input type="text" name="area" maxlength="80" value="${esc(place ? place.area : '')}" placeholder="t.d. Suðursveit"></div>
    <div id="plErr"></div><button class="btn primary big">💾 Vista stað</button></form>`, { wide: true });
  const f = m.el.querySelector('#plForm');
  let ll = place ? [place.lon, place.lat] : null;
  const mm = new maplibregl.Map({ container: 'miniMap', style: map ? map.getStyle() : await pickStyle(), bounds: ll ? undefined : ICELAND, center: ll || undefined, zoom: ll ? 15 : undefined, dragRotate: false, attributionControl: { compact: true } });
  mm.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  const mk = new maplibregl.Marker({ color: '#de8a5a', draggable: true });
  const setLL = (p, fly) => {
    ll = [+p[0].toFixed(6), +p[1].toFixed(6)]; mk.setLngLat(ll).addTo(mm);
    if (fly) mm.flyTo({ center: ll, zoom: 15 });
    const w = whereAt(ll);
    $('plWhere').textContent = [w.town, muniName(w.muni), regionName(w.region)].filter(Boolean).join(' · ') || 'Utan sveitarfélaga?';
  };
  if (ll) setLL(ll);
  mm.on('click', (e) => setLL([e.lngLat.lng, e.lngLat.lat]));
  mk.on('dragend', () => { const p = mk.getLngLat(); setLL([p.lng, p.lat]); });
  const q = $('adrQ'), s = $('adrS');
  q.oninput = async () => {
    if (!ADDR) { s.innerHTML = '<div class="role" style="padding:10px">Hleð heimilisföngum…</div>'; s.classList.remove('hidden'); ADDR = await fetch(BASE + '/data/addr.json').then((r) => r.json()); }
    const n = norm(q.value); if (n.length < 2) { s.classList.add('hidden'); return; }
    const words = n.split(' ');
    const hits = [];
    for (const t of GEO.towns) if (words.every((w) => norm(t.n).includes(w))) hits.push({ t: t.n, s: muniName(t.m), ll: t.ll, z: 13 });
    for (const a of ADDR) { if (hits.length > 14) break; const hay = norm(a[0] + ' ' + a[1]); if (words.every((w) => hay.includes(w))) hits.push({ t: a[0], s: a[1], ll: [a[2], a[3]], z: 16, name: a[0] }); }
    s.innerHTML = hits.map((h, i) => `<button type="button" data-i="${i}">${esc(h.t)} <small>${esc(h.s)}</small></button>`).join('') || '<div class="role" style="padding:10px">Ekkert fannst. Smelltu frekar á kortið.</div>';
    s.classList.remove('hidden');
    s.querySelectorAll('[data-i]').forEach((b) => (b.onmousedown = (ev) => {
      ev.preventDefault(); const h = hits[+b.dataset.i]; s.classList.add('hidden'); q.value = h.t;
      setLL(h.ll); mm.flyTo({ center: h.ll, zoom: h.z }); if (h.name && !f.elements.name.value) f.elements.name.value = h.name;
    }));
  };
  q.onblur = () => setTimeout(() => s.classList.add('hidden'), 150);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!ll) { $('plErr').innerHTML = '<p class="err">Veldu staðsetningu á kortinu.</p>'; return; }
    const w = whereAt(ll);
    const body = { name: f.elements.name.value, area: f.area.value, lon: ll[0], lat: ll[1], ...w };
    try {
      if (editing) await api('/places/' + place.id, { method: 'PUT', body }); else await api('/places', { method: 'POST', body });
      setPlaces((await api('/places')).places); renderAll();
      m.close(); toast('✅ Staðurinn er vistaður'); done && done();
    } catch (e) { $('plErr').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
}

/* ---------- Sími: „Hvað langar þig að gera?“ ---------- */
const isMobile = () => matchMedia('(max-width: 899px)').matches;
const ICON = { tonlist: '🎸', leikhus: '🎭', uppistand: '😂', pubquiz: '🧠', list: '🎨', annad: '✨' };
const SUBICON = { tonleikar: '🎤', ball: '💃', dj: '🎧', trubador: '🪕', tonlist_annad: '🎶', leiksyning: '🎭', songleikur: '🎶', barnaleikrit: '🧸', dans: '🩰', leikhus_annad: '🎟️' };
function flow(html) {
  const el = $('mflow'); el.innerHTML = html; el.classList.remove('hidden'); el.scrollTop = 0;
  document.body.classList.add('m-flow');
  return el;
}
function closeFlow() { $('mflow').classList.add('hidden'); document.body.classList.remove('m-flow'); }
function showHome() {
  const el = flow(`<div class="mf"><h1>${L('Hvað langar þig að gera?', 'What do you feel like doing?')}</h1>
    <div class="tiles">${TOPS.map((t) => `<button class="tile" data-c="${t}"><span class="ic">${ICON[t]}</span>${esc(TAGL[lang][t])}</button>`).join('')}</div>
    <button class="btn primary big" data-c="all">${L('Sýna mér allt', 'Show me everything')} →</button></div>`);
  el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
    const c = b.dataset.c;
    SF.tags.clear(); SF.genres.clear(); if (c !== 'all') SF.tags.add(c); saveSF();
    if (SUBS[c]) showSub(c); else goWhere();
  }));
}
function showSub(top) {
  const el = flow(`<div class="mf"><button class="back" data-back>← ${L('Til baka', 'Back')}</button><h1>${ICON[top]} ${esc(TAGL[lang][top])}</h1>
    <button class="btn primary big" data-s="">${L('Allt', 'Everything')} (${esc(TAGL[lang][top]).toLowerCase()})</button>
    <div class="tiles">${SUBS[top].map((x) => `<button class="tile" data-s="${x}"><span class="ic">${SUBICON[x]}</span>${esc(TAGL[lang][x])}</button>`).join('')}</div></div>`);
  el.querySelector('[data-back]').onclick = showHome;
  el.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { if (b.dataset.s) SF.tags.add(b.dataset.s); saveSF(); goWhere(); }));
}
function goWhere() { const r = store.get('region', undefined); if (r === undefined) showWhere(); else showResults(r); }
function showWhere() {
  const el = flow(`<div class="mf"><button class="back" data-back>← ${L('Til baka', 'Back')}</button><h1>📍 ${L('Hvar?', 'Where?')}</h1>
    <button class="btn primary big" data-r="">${L('Allt landið', 'All of Iceland')}</button>
    <div class="tiles">${GEO.regions.map((r) => `<button class="tile sm" data-r="${r.id}">${esc(L(r.n, r.en))}</button>`).join('')}</div></div>`);
  el.querySelector('[data-back]').onclick = showHome;
  el.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { const r = b.dataset.r || null; store.set('region', r); showResults(r); }));
}
function showResults(region) {
  closeFlow();
  F.region = region || null; F.placeId = null; F.sel = null; F.inView = false;
  setMView('list');
  renderAll();
  if (map) F.region ? fitArea('region', F.region, true) : fitIceland();
}
function setMView(v) { document.body.classList.toggle('m-map', v === 'map'); document.body.classList.toggle('m-list', v !== 'map'); renderMobileBars(); if (v === 'map' && map) setTimeout(() => map.resize(), 50); }
function renderMobileBars() {
  const what = SF.tags.size ? [...SF.tags].filter((t) => !PARENT[t] || true).map((t) => TAGL[lang][t]).filter(Boolean).slice(0, 2).join(' · ') : L('Allt', 'Everything');
  $('mbar').innerHTML = `<button class="chip" data-m="home">← ${L('Byrja', 'Start')}</button>
    <button class="chip on" data-m="home">${esc(what)}</button>
    <button class="chip on" data-m="where">📍 ${esc(F.region ? regionName(F.region) : L('Allt landið', 'All of Iceland'))} ▾</button>`;
  $('mbar').querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => (b.dataset.m === 'home' ? showHome() : showWhere())));
  const isMap = document.body.classList.contains('m-map');
  const active = SF.tags.size + (SF.fam ? 1 : 0) + (SF.free ? 1 : 0);
  $('mtoggle').innerHTML = `<button class="${!isMap ? 'on' : ''}" data-v="list">📋 ${L('Listi', 'List')}</button><button class="${isMap ? 'on' : ''}" data-v="map">🗺️ ${L('Kort', 'Map')}</button><button data-v="filter">🎛️ ${L('Sía', 'Filter')}${active ? ` (${active})` : ''}</button>`;
  $('mtoggle').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => {
    if (b.dataset.v === 'filter') { $('filters').classList.toggle('open'); return; }
    $('filters').classList.remove('open'); setMView(b.dataset.v);
  }));
}

/* ---------- Tungumál ---------- */
$('langBtn').onclick = () => { lang = lang === 'is' ? 'en' : 'is'; store.set('lang', lang); applyLang(); renderAll(); };
function applyLang() {
  document.documentElement.lang = lang;
  $('langBtn').textContent = lang === 'is' ? 'EN' : 'IS';
  $('q').placeholder = L('Leita að stað, bæ eða viðburði', 'Search for a place, town or event');
  $('mineBtn').firstChild.textContent = L('Mitt svæði', 'My area');
}

/* ---------- Ræsing ---------- */
(async function start() {
  // Aðgangsmiði (?g=) og innskráning (#s=) geymd fyrir vafra sem gleyma kökum.
  { const u = new URL(location.href); const g = u.searchParams.get('g');
    if (g) { store.set('gateTok', g); u.searchParams.delete('g'); }
    const m = /[#&]s=([0-9a-f]{64})/.exec(u.hash); if (m) { store.set('sid', m[1]); u.hash = ''; }
    try { const pend = localStorage.getItem('sidPending'); if (pend) { store.set('sid', pend); localStorage.removeItem('sidPending'); } } catch {}
    history.replaceState(null, '', u.pathname + u.search); }
  applyLang();
  wireSearch();
  F.region = isMobile() ? store.get('region', null) || null : null;
  document.body.classList.add('m-list');
  try { await loadAll(); } catch (e) { $('list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  renderAll();
  initMap();
  loadMe();
  const sp = new URLSearchParams(location.search);
  const lg = sp.get('login');
  if (lg) {
    history.replaceState(null, '', BASE + '/');
    if (lg === 'ok') { toast('✅ Þú ert innskráð(ur)'); showMine(); }
    else toast(lg === 'utrunnid' ? 'Hlekkurinn er útrunninn eða búið að nota hann. Biddu um nýjan.' : 'Innskráning tókst ekki.', true);
  }
  if (sp.get('e')) openEvent(sp.get('e'));
  else if (isMobile() && !lg) showHome();
})();
