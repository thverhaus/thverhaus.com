'use strict';
/* Viðburðir – vefsíðan (kort, listi, Mitt svæði). Engin bókasöfn nema MapLibre. */

const BASE = location.pathname.startsWith('/event') ? '/event' : '';
const API = BASE + '/api';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
let TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
/* ---------- Tími viðburða: byrjaður / búinn ----------
   Viðburður sést þar til hann klárast: lokatími ef skráður (yfir miðnætti ef hann er fyrir byrjun),
   annars 3 klst. eftir byrjun; kvöldviðburðir (frá kl. 18) a.m.k. til kl. 03 um nóttina. */
const hm = (t) => { const m = /^(\d{1,2})[:.](\d{2})/.exec(t || ''); return m ? [+m[1], +m[2]] : null; };
function evStart(e) { const d = new Date(e.date + 'T00:00:00'); const t = hm(e.time); if (t) d.setHours(t[0], t[1], 0, 0); return d; }
/* Hátíðir: standa frá date til end_date. */
const isFest = (e) => (e.tags || []).includes('hatid');
const festEnd = (e) => e.end_date || e.date;
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
function evEnd(e) {
  if (e.end_date) { // marga daga: til lokatíma síðasta dagsins, annars til kl. 03 nóttina eftir
    const d = new Date(e.end_date + 'T00:00:00'), et2 = hm(e.end_time);
    if (et2 && et2[0] >= 5) d.setHours(et2[0], et2[1], 0, 0); else { d.setDate(d.getDate() + 1); d.setHours(et2 ? et2[0] : 3, et2 ? et2[1] : 0, 0, 0); }
    return d;
  }
  const s = evStart(e), t = hm(e.time), et = hm(e.end_time);
  if (et) { const d = new Date(e.date + 'T00:00:00'); d.setHours(et[0], et[1], 0, 0); if (d <= s) d.setDate(d.getDate() + 1); return d; }
  if (!t) { const d = new Date(e.date + 'T00:00:00'); d.setDate(d.getDate() + 1); return d; } // enginn tími: allur dagurinn
  let end = new Date(s.getTime() + 3 * 3600e3);
  if (t[0] >= 18) { const n3 = new Date(e.date + 'T00:00:00'); n3.setDate(n3.getDate() + 1); n3.setHours(3, 0, 0, 0); if (n3 > end) end = n3; }
  return end;
}
const isLive = (e) => { const n = Date.now(); return !e.cancelled && evStart(e).getTime() <= n && n < evEnd(e).getTime(); };
const isOver = (e) => Date.now() >= evEnd(e).getTime();
// Dagurinn sem viðburður birtist undir: ball frá því í gær sem er enn í gangi birtist undir „Í dag“.
const dayKey = (e) => (e.date < iso(TODAY) ? iso(TODAY) : e.date);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) {} } };

let lang = store.get('lang', 'is');
const L = (is, en) => (lang === 'en' && en !== undefined ? en : is);

// Flokkar: aðalflokkar, og undirflokkar fyrir Tónlist og Leikhús.
const SUBS = { tonlist: ['tonleikar', 'ball', 'dj', 'trubador', 'tonlist_annad'], leikhus: ['leiksyning', 'songleikur', 'barnaleikrit', 'dans', 'leikhus_annad'], hatid: ['tonleikahatid', 'baejarhatid'] };
const TOPS = ['hatid', 'tonlist', 'leikhus', 'uppistand', 'pubquiz', 'list', 'annad']; // Hátíð efst (Júlíus 17. nóv)
const PARENT = {}; Object.entries(SUBS).forEach(([t, xs]) => xs.forEach((x) => (PARENT[x] = t)));
const TAGS = TOPS;
const TAGL = {
  is: { tonlist: 'Tónlist', leikhus: 'Leikhús', uppistand: 'Uppistand', pubquiz: 'Pub quiz', list: 'List', annad: 'Annað', hatid: 'Hátíð', tonleikahatid: 'Tónleikahátíð', baejarhatid: 'Bæjarhátíð',
    tonleikar: 'Tónleikar', ball: 'Ball', dj: 'DJ', trubador: 'Trúbador', tonlist_annad: 'Annað',
    leiksyning: 'Leiksýning', songleikur: 'Söngleikur', barnaleikrit: 'Barnaleikrit', dans: 'Dans', leikhus_annad: 'Annað' },
  en: { tonlist: 'Music', leikhus: 'Theatre', uppistand: 'Comedy', pubquiz: 'Pub quiz', list: 'Art', annad: 'Other', hatid: 'Festival', tonleikahatid: 'Music festival', baejarhatid: 'Town festival',
    tonleikar: 'Concert', ball: 'Dance (ball)', dj: 'DJ', trubador: 'Troubadour', tonlist_annad: 'Other',
    leiksyning: 'Play', songleikur: 'Musical', barnaleikrit: "Children's play", dans: 'Dance', leikhus_annad: 'Other' },
};
const GENRES = ['rokk', 'metall', 'ponk', 'popp', 'hiphop', 'raf', 'djass', 'blus', 'kantri', 'thjodlaga', 'klassik', 'kor', 'abreidur'];
const GENL = {
  is: { rokk: 'Rokk', metall: 'Metall', ponk: 'Pönk', popp: 'Popp', hiphop: 'Hip hop', raf: 'Raftónlist', djass: 'Djass', blus: 'Blús', kantri: 'Kántrí', thjodlaga: 'Þjóðlagatónlist', trubador: 'Trúbador', klassik: 'Klassík', kor: 'Kór', abreidur: 'Ábreiður' },
  en: { rokk: 'Rock', metall: 'Metal', ponk: 'Punk', popp: 'Pop', hiphop: 'Hip hop', raf: 'Electronic', djass: 'Jazz', blus: 'Blues', kantri: 'Country', thjodlaga: 'Folk', trubador: 'Singer-songwriter', klassik: 'Classical', kor: 'Choir', abreidur: 'Covers' },
};
const KINDS = { band: 'Hljómsveit / listamaður', group: 'Félag / hátíð / skipuleggjandi (kór, leikfélag o.fl.)', venue: 'Staður' };
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
  const g = store.get('gateTok', null) || (() => { try { return localStorage.getItem('gate'); } catch (_e) { return null; } })(); if (g) o.headers['X-Gate'] = g;
  const sid = store.get('sid', null); if (sid) o.headers['X-Session'] = sid;
  if (opts.body !== undefined) {
    if (opts.body instanceof Blob) { o.body = opts.body; o.headers['Content-Type'] = opts.body.type; }
    else { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  }
  let r;
  try { r = await fetch(API + path, o); } catch (_e) { throw new Error(L('Ekkert netsamband. Reyndu aftur.', 'No connection. Try again.')); }
  let data = {};
  try { data = await r.json(); } catch (_e) {}
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
  // Tónleikahátíð birtist líka undir Tónlist (nema þrengt sé niður í t.d. Ball eða stefnu).
  if (SF.tags.has('tonlist') && et.includes('tonleikahatid') && !SUBS.tonlist.some((x) => SF.tags.has(x)) && !SF.genres.size) return true;
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
const Z_HUB = 7, Z_TOWN = 10; // undir Z_HUB: bara 8 bæjanöfn alltaf; frá Z_TOWN: staðirnir sjálfir
const NEAR_KM = 15; // staðir úti í sveit innan 15 km frá aðalbæ sveitarfélagsins teljast „og nágrenni“
const HUBS = ['Reykjavík', 'Akureyri', 'Ísafjörður', 'Egilsstaðir', 'Höfn', 'Vík', 'Selfoss', 'Vestmannaeyjar'];
const MAJOR = new Set(HUBS);
let P2T = {}, TOWNLL = {}, ABSORB = {}, NEAR = new Set();
function assignPlaces() {
  if (!GEO) return;
  TOWNLL = {}; GEO.towns.forEach((t) => (TOWNLL[t.n] = t.ll));
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
  P2T = {}; NEAR = new Set();
  const POP = {}; GEO.towns.forEach((t) => (POP[t.n] = t.pop || 0));
  // Aðalbær hvers sveitarfélags = fjölmennasti bærinn í því.
  const MAIN = {}; for (const t of GEO.towns) if (!MAIN[t.m] || (t.pop || 0) > (POP[MAIN[t.m]] || 0)) MAIN[t.m] = t.n;
  for (const p of PLACES) {
    const ll = [p.lon, p.lat];
    let t = p.town && TOWNLL[p.town] ? p.town : null;
    if (!t) { const n = nearest(ll, allTowns); const lim = POP[n] > 20000 ? 8 : POP[n] > 2000 ? 3.5 : 1.8; if (distKm(ll, TOWNLL[n]) <= lim) t = n; }
    if (t && ABSORB[t]) t = ABSORB[t];
    if (!t) { const mt = MAIN[p.muni]; if (mt && distKm(ll, TOWNLL[mt]) <= NEAR_KM) { t = mt; NEAR.add(mt); } }
    P2T[p.id] = t; // null = sér bóla undir eigin nafni (aldrei sett undir annað sveitarfélag eða bæ)
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
  for (const e of eventsInDates(true)) {
    const k = P2T[e.place_id];
    if (k) n[k] = (n[k] || 0) + 1; else if (PLACE[e.place_id]) rural[e.place_id] = (rural[e.place_id] || 0) + 1;
  }
  const names = Object.keys(TOWNLL).filter((t) => !ABSORB[t]);
  const feats = names.filter((t) => TOWNLL[t]).map((t) => {
    const cnt = n[t] || 0, tier = townTier(t);
    const anchor = MAJOR.has(t) ? HUB_ANCHOR[t] || 'left' : 'left';
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
function bubbleGeo() { const g = aggGeo(); g.features = g.features.filter((f) => f.properties.n > 0); return g; }
// Staðirnir sem bóla nær yfir (svo smellur sýni nákvæmlega viðburðina í henni).
function bubblePlaces(kind, key) {
  if (key.startsWith('p:')) return new Set([key.slice(2)]);
  const name = key.slice(2);
  return new Set(PLACES.filter((p) => P2T[p.id] === name).map((p) => p.id));
}
async function loadEvents() {
  // Frá því í gær, svo viðburðir sem standa yfir miðnætti haldist inni.
  const r = await api('/events?from=' + iso(addDays(TODAY, -1)) + '&to=' + iso(addDays(TODAY, 365)));
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
// allRegions: kortið sýnir alltaf allt landið; valinn landshluti síar bara listann.
function eventsInDates(allRegions) {
  const [a, b] = dateRange();
  return EVENTS.filter((e) => {
    const inRange = e.end_date ? e.date <= b && e.end_date >= a : (() => { const k = dayKey(e); return k >= a && k <= b; })();
    return inRange && !isOver(e) && typeMatch(e) && (allRegions || regionMatch(e));
  });
}
function textMatch(e, q) {
  const p = PLACE[e.place_id] || {};
  return norm([e.title, e.page_name, p.name, p.town, p.area, muniName(p.muni), regionName(p.region), tagStr(e).join(' ')].join(' ')).includes(q);
}
function visibleEvents() {
  // Ef notandinn valdi bólu/stað eða færði kortið sjálfur ræður það, ekki valinn landshluti.
  let list = eventsInDates(!!(F.sel || F.placeId || (F.inView && map && mapReady)));
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
  const fest = e.festival_id && EVENTS.find((x) => x.id === e.festival_id);
  const meta = [fest && '🎪 ' + L('Hluti af ', 'Part of ') + fest.title, '📍 ' + placeLabel(p), priceStr(e) && '💰 ' + priceStr(e), e.door && '🚪 ' + L('við hurð', 'at the door'), ageStr(e) && '🔞 ' + ageStr(e)].filter(Boolean);
  const multi = isFest(e) && e.end_date;
  // Dagurinn stendur í fyrirsögn yfir hópnum; hér bara tíminn. Staður, verð og aldur í einni línu
  // (hver hluti brotnar ekki í sundur). Merkin sjást þegar viðburður er opnaður.
  const live = isLive(e);
  return `<button class="ev2 ${e.cancelled ? 'cx' : ''} ${live ? 'live' : ''} ${isFest(e) ? 'fest' : ''}" data-ev="${e.id}">
    <span class="when"><span class="tm">${multi && dayKey(e) > e.date ? `<small style="font-size:13px">${L('Dagur', 'Day')} ${daysBetween(e.date, dayKey(e)) + 1}</small>` : esc(e.time)}</span></span>
    <span class="body">
      <span class="ti">${e.cancelled ? `<span class="cxl">${L('AFLÝST', 'CANCELLED')}</span> ` : ''}${live ? `<span class="livel">● ${L('Í gangi', 'On now')}</span> ` : ''}${isFest(e) ? '🎪 ' : ''}${esc(e.title)}${multi ? ` <span class="fdays">${daysBetween(e.date, e.end_date) + 1} ${L('dagar', 'days')} · ${L('til', 'until')} ${esc(fmtShort(e.end_date))}</span>` : ''}</span>
      <span class="ln">${meta.map((x) => (x.length < 26 ? `<span class="nw">${esc(x)}</span>` : esc(x))).join(' · ')}</span>
      ${e.time_changed ? `<span class="ln chg">🕘 ${L('Breyttur tími', 'Time changed')}</span>` : ''}
    </span>
    ${e.poster ? `<img src="${posterUrl(e.poster)}" alt="" loading="lazy">` : ''}</button>`;
}
function dayLabel(d) {
  if (d === iso(TODAY)) return [L('Í dag', 'Today'), fmtLong(d)];
  if (d === iso(addDays(TODAY, 1))) return [L('Á morgun', 'Tomorrow'), fmtLong(d)];
  const s = fmtLong(d);
  return [s.charAt(0).toUpperCase() + s.slice(1), ''];
}
/* ---------- Auglýsingar (prufa: bull) ----------
   Eins og í prufusíðunni: heillitir borðar í listanum á 5 viðburða fresti, auglýsing undir síunni (300×250)
   og lítil í viðburðarglugganum. Alltaf merkt, engir sprettigluggar, engar áfengisauglýsingar (0% bjór í lagi). */
const ADS = [
  { e: '🥫', t: 'Heiðars Remúlaði', d: 'Á pylsuna. Á franskarnar. Á allt.', bg: '#7a5a12', fg: '#fff4d6' },
  { e: '🍺', t: 'Núlli Fús', d: '0% bjór. 100% Fús.', bg: '#1f3b4d', fg: '#e3f2ff' },
  { e: '🍗', t: 'Hafnarbúðin', d: 'Kjúlli Fús og Coke Zero · 3.000 kr.', bg: '#6b2318', fg: '#ffe6dc' },
  { e: '🚗', t: 'Bílaþvottur Bjössa', d: 'Við þvoum bílinn. Og hundinn ef þú biður fallega.', bg: '#1d4a3a', fg: '#dcf5ea' },
  { e: '🧶', t: 'Prjónastofan Lopi', d: 'Lopapeysur á alla hljómsveitina. Afsláttur fyrir trommara.', bg: '#4a2d5c', fg: '#f1e3fa' },
  { e: '🎸', t: 'Gítarviðgerðir Gunnu', d: 'Slitinn strengur? Brotinn háls? Gunna lagar allt nema lagið.', bg: '#5c3a1e', fg: '#fbe8d6' },
];
let adStart = Math.floor(Math.random() * ADS.length);
function adHtml(i, kind) {
  const a = ADS[(adStart + i) % ADS.length];
  return `<div class="kyn ${kind || ''}" style="background:${a.bg};color:${a.fg}"><span class="kynl">${L('Auglýsing', 'Ad')}</span><div class="art">${a.e}</div><div><div class="h">${esc(a.t)}</div><div class="s">${esc(a.d)}</div></div></div>`;
}
function renderSideAd() { const el = $('hlidBox'); if (el) el.innerHTML = adHtml(ADS.length - 1, 'box'); }
function renderList() {
  let list = visibleEvents();
  // Viðburðir sem eru „hluti af hátíð“ birtast ekki stakir: þeir fara inn í dagslínu hátíðarinnar
  // (aðalatriði dagsins nefnt + „+2 fleiri“), svo hátíð drekki ekki listanum.
  const subsBy = {}, addF = [];
  list = list.filter((e) => {
    const f = e.festival_id && EVENTS.find((x) => x.id === e.festival_id);
    if (!f || isOver(f)) return true;
    const k = dayKey(e);
    ((subsBy[f.id] = subsBy[f.id] || {})[k] = subsBy[f.id][k] || []).push(e);
    if (!addF.includes(f)) addF.push(f);
    return false;
  });
  addF.forEach((f) => { if (!list.includes(f)) list.push(f); }); // hátíðin sést ef hún á viðburð sem passar við síuna
  const headOf = (arr) => arr && arr.length ? (arr.find((x) => x.headline) || arr.slice().sort((a, b) => ((a.time || '') < (b.time || '') ? 1 : -1))[0]) : null;
  const festExtra = (e, k) => {
    const arr = (subsBy[e.id] || {})[k], h = headOf(arr);
    return h ? ` · ⭐ ${esc(h.title)} ${L('kl.', '')} ${esc(h.time || '')}${arr.length > 1 ? ` · +${arr.length - 1} ${L('fleiri', 'more')}` : ''}` : '';
  };
  // Hátíðir: stórt spjald fyrsta daginn sem sést, svo bara mjó lína hina dagana („dagur 2 af 4“).
  const [ra, rb] = dateRange();
  const items = [];
  for (const e of list) {
    if (!isFest(e)) { items.push({ k: dayKey(e), t: e.time || '', e }); continue; }
    const first = [e.date, ra, iso(TODAY)].sort()[2], end = festEnd(e), last = end < rb ? end : rb, total = daysBetween(e.date, end) + 1;
    items.push({ k: first, t: e.time || '', e, extra: festExtra(e, first) });
    for (let d = iso(addDays(parseISO(first), 1)), n = 0; d <= last && n < 21; d = iso(addDays(parseISO(d), 1)), n++) items.push({ k: d, t: '', slim: true, e, n: daysBetween(e.date, d) + 1, total, extra: festExtra(e, d) });
  }
  items.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : (y.slim ? 1 : 0) - (x.slim ? 1 : 0) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0)));
  // Hópað eftir dögum; fyrirsögn dagsins festist efst þar til næsti dagur ýtir henni upp.
  let html = '', day = null, ai = 0, full = 0;
  const fulls = items.filter((x) => !x.slim).length;
  items.forEach((it) => {
    if (it.k !== day) {
      if (day !== null) html += '</section>';
      day = it.k;
      const [a, b] = dayLabel(day);
      html += `<section class="day"><h3 class="dh ${day === iso(TODAY) ? 'today' : ''}">${esc(a)}${b ? ` <small>${esc(b)}</small>` : ''}</h3>`;
    }
    if (it.slim) {
      const p = PLACE[it.e.place_id] || {};
      html += `<button class="fline" data-ev="${it.e.id}"><span>🎪 <b>${esc(it.e.title)}</b> – ${L('dagur', 'day')} ${it.n} ${L('af', 'of')} ${it.total}${it.extra}</span><span class="r">${esc(p.town || p.name || '')} ›</span></button>`;
      return;
    }
    html += it.extra ? evRow(it.e).replace('</span>\n      <span class="ln">', `</span>\n      <span class="ln fx">${it.extra.slice(3)}</span>\n      <span class="ln">`) : evRow(it.e);
    full++;
    if (full % 5 === 0 && full < fulls) html += adHtml(ai++);
  });
  if (day !== null) html += '</section>';
  $('list').innerHTML = html || `<div class="empty">${L('Engir viðburðir fundust.', 'No events found.')}${F.inView || F.placeId || F.sel || F.q ? '' : '<br>' + L('Vertu fyrst(ur) til að setja inn viðburð!', 'Be the first to post an event!')}</div>`;
  $('list').querySelectorAll('[data-ev]').forEach((b) => (b.onclick = () => openEvent(b.dataset.ev)));
  const n = list.length;
  const where = F.region ? regionName(F.region) : L('öllu landinu', 'all of Iceland');
  $('listInfo').textContent = F.sel ? `${n} ${L('viðburðir', 'events')}: ${F.sel.label}` : F.placeId ? `${n} ${L('viðburðir á', 'events at')} ${(PLACE[F.placeId] && PLACE[F.placeId].name) || ''}`
    : F.inView ? `${n} ${L('viðburðir á svæðinu sem sést á kortinu', 'events in the map area')}` : `${n} ${L('viðburðir', 'events')}: ${where}`;
  const showAll = $('showAll');
  showAll.classList.toggle('hidden', !(F.inView || F.placeId || F.sel));
  showAll.textContent = F.region ? L('Sýna allt svæðið', 'Show whole region') : L('Sýna allt landið', 'Show all of Iceland');
}
$('showAll').onclick = () => { F.placeId = null; F.sel = null; F.inView = false; F.region ? fitArea('region', F.region, true) : fitIceland(); renderAll(); };

function renderRegions() {
  const counts = {};
  for (const e of eventsInDates(true)) { const p = PLACE[e.place_id]; if (p) counts[p.region] = (counts[p.region] || 0) + 1; }
  $('regions').innerHTML = GEO.regions.map((r) => `<span class="chip" data-r="${r.id}">${esc(L(r.n, r.en))} <b>${counts[r.id] || 0}</b></span>`).join('');
  $('regions').querySelectorAll('[data-r]').forEach((c) => (c.onclick = () => fitArea('region', c.dataset.r)));
}

function renderFilters() {
  const inDates = (() => { const [a, b] = dateRange(); return EVENTS.filter((e) => e.date >= a && e.date <= b && regionMatch(e)); })();
  const cT = {}, cG = {};
  for (const e of inDates) { (e.tags || []).forEach((t) => (cT[t] = (cT[t] || 0) + 1)); (e.genres || []).forEach((g) => (cG[g] = (cG[g] || 0) + 1)); }
  const cb = (k, v, label, n, on, sub) => `<label class="cbx ${sub ? 'sub' : ''}"><input type="checkbox" data-${k}="${v}" ${on ? 'checked' : ''}><span>${label}</span><small>${n == null ? '' : n}</small></label>`;
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
    try { const r = await fetch(s); if (r.ok) return s; } catch (_e) {}
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
        const sz = scaleSize((map.getLayoutProperty(l.id, 'text-size') != null ? map.getLayoutProperty(l.id, 'text-size') : 16), sl === 'transportation_name' ? 1.35 : 1.2);
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
      if (l.type === 'fill' && sl === 'building') { map.setPaintProperty(l.id, 'fill-color', '#5a4544'); map.setPaintProperty(l.id, 'fill-opacity', 1); try { map.setPaintProperty(l.id, 'fill-outline-color', '#8c706c'); } catch (_e) {} }
      if (l.type === 'fill-extrusion' && sl === 'building') map.setPaintProperty(l.id, 'fill-extrusion-color', '#5a4544');
      if (l.type === 'fill' && sl === 'water') map.setPaintProperty(l.id, 'fill-color', '#16222b');
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#2a2021');
      if (l.type === 'fill' && (sl === 'landcover' || sl === 'landuse' || sl === 'park')) map.setPaintProperty(l.id, 'fill-opacity', 0.35);
    } catch (_e) {}
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
  if (!f) return;
  if (!map) { // Varakort: sía listann í stað þess að færa kortið.
    F.placeId = null; F.inView = false;
    if (kind === 'region') { F.sel = null; F.region = F.region === id && !keepView ? null : id; }
    else F.sel = { label: f.properties.n, ids: new Set(PLACES.filter((p) => p.muni === id).map((p) => p.id)) };
    if (!keepView) renderAll();
    return;
  }
  F.placeId = null; F.sel = null; F.inView = !keepView;
  map.fitBounds(bboxOf(f.geometry), { padding: 30, maxZoom: 11 });
}
function pointsGeo(withEvents) {
  const n = {};
  for (const e of eventsInDates(true)) n[e.place_id] = (n[e.place_id] || 0) + 1;
  return {
    type: 'FeatureCollection',
    features: PLACES.filter((p) => (withEvents ? n[p.id] : !n[p.id])).map((p) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id, name: p.name, n: n[p.id] || 0 },
    })),
  };
}
function updateMapData() {
  if (simpleMap) return drawSimpleMap();
  if (!mapReady) return;
  map.getSource('pl').setData(pointsGeo(true));
  map.getSource('pl0').setData(pointsGeo(false));
  NMDATA = aggGeo(); map.getSource('nm').setData(NMDATA); relayout();
}

/* Nöfn sem verða að sjást: velja stað við bæinn (8 áttir) sem rekst ekki á bólur, önnur nöfn eða brún kortsins. */
let NMDATA = null, MERGED = [];
// Stærð bólu eftir fjölda (stærri tala = stærri bóla, talan passar alltaf). Minni þegar kortið er lítið (sími).
function bubbleR(n, town, z) {
  const r = n >= 1000 ? 19 : n >= 100 ? 16 : n >= 10 ? 13 : 10;
  return town ? r + 2 : r * Math.min(1, Math.max(0.8, 0.8 + (z - 4.5) * 0.2 / 1.5));
}
const NAME_SIZE = { 1: 17, 2: 15 };
/* Bólur: hver bær/staður sína bólu. Bólur renna saman EINGÖNGU ef þær myndu lenda hver ofan á annarri
   á skjánum núna; þá stendur stærsta bólan kyrr á sínum bæ og fær fjöldann, án bæjarnafns.
   Reiknað upp á nýtt eftir hvert zoom, svo þær skiptast þegar zoomað er inn. */
function relayout() {
  if (!mapReady || !map.getSource('bub')) return;
  const z = map.getZoom(), town = z >= Z_HUB, out = [];
  MERGED = [];
  if (z < Z_TOWN) {
    const items = bubbleGeo().features.map((f) => ({ f, p: map.project(f.geometry.coordinates), n: f.properties.n }))
      .sort((a, b) => b.n - a.n);
    const used = new Set();
    for (const it of items) {
      if (used.has(it)) continue;
      used.add(it);
      const g = [it];
      let n = it.n, grew = true;
      while (grew) {
        grew = false;
        const R = bubbleR(n, town, z);
        for (const o of items) {
          if (used.has(o)) continue;
          if (Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < R + bubbleR(o.n, town, z) + 2) { used.add(o); g.push(o); n += o.n; grew = true; }
        }
      }
      const mi = MERGED.push(g.map((x) => x.f.properties)) - 1;
      out.push({ type: 'Feature', geometry: it.f.geometry, properties: { mi, n, key: it.f.properties.key, r: bubbleR(n, town, z), ts: town ? 13 : z < 5.2 ? 11 : 12, x: it.p.x, y: it.p.y } });
    }
  }
  map.getSource('bub').setData({ type: 'FeatureCollection', features: out });
  placeNames(out.map((f) => ({ x: f.properties.x, y: f.properties.y, r: f.properties.r + 3 })));
}
/* Nöfn sem verða að sjást: velja stað við bæinn (8 áttir) sem rekst ekki á bólur, önnur nöfn eða brún kortsins. */
function placeNames(circles) {
  const src = map && map.getSource('fixn');
  if (!src || !NMDATA) return;
  const z = map.getZoom();
  if (z >= Z_TOWN) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
  const town = z >= Z_HUB, cv = map.getCanvas(), W = cv.clientWidth, H = cv.clientHeight;
  const want = NMDATA.features.filter((f) => (town ? f.properties.keep : f.properties.major))
    .sort((a, b) => (b.properties.major - a.properties.major) || ((b.properties.n > 0) - (a.properties.n > 0)) || (a.properties.tier - b.properties.tier) || (b.properties.n - a.properties.n));
  const rects = [], out = [];
  const ov = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  // anchor -> stefna textans frá punktinum
  const DIRS = [['left', 1, 0], ['right', -1, 0], ['top', 0, 1], ['bottom', 0, -1], ['bottom-left', 0.75, -0.75], ['top-left', 0.75, 0.75], ['bottom-right', -0.75, -0.75], ['top-right', -0.75, 0.75]];
  for (const f of want) {
    const pr = f.properties, p = map.project(f.geometry.coordinates);
    if (p.x < -60 || p.y < -30 || p.x > W + 60 || p.y > H + 30) continue;
    const size = NAME_SIZE[pr.tier] || 13, w = pr.name.length * size * 0.56 + 4, h = size * 1.2;
    const cov = circles.find((c) => Math.hypot(c.x - p.x, c.y - p.y) <= c.r);
    const o = cov || p, R = cov ? cov.r + 1 : 4;
    let best = null;
    DIRS.forEach(([an, dx, dy], i) => {
      const ax = o.x + dx * R, ay = o.y + dy * R;
      const x1 = an.includes('left') ? ax : an.includes('right') ? ax - w : ax - w / 2;
      const y1 = an.startsWith('top') ? ay : an.startsWith('bottom') ? ay - h : ay - h / 2;
      const r = { x1, y1, x2: x1 + w, y2: y1 + h };
      let sc = i * 2;
      for (const c of circles) sc += 4 * ov(r, { x1: c.x - c.r, y1: c.y - c.r, x2: c.x + c.r, y2: c.y + c.r });
      for (const q of rects) sc += 4 * ov(r, q);
      sc += 6 * (w * h - ov(r, { x1: 2, y1: 2, x2: W - 2, y2: H - 2 }));
      if (!best || sc < best.sc) best = { sc, r, an, off: [(ax - p.x) / size, (ay - p.y) / size] };
    });
    rects.push(best.r);
    out.push({ type: 'Feature', geometry: f.geometry, properties: { name: pr.name, n: pr.n, size, anchor: best.an, off: best.off } });
  }
  src.setData({ type: 'FeatureCollection', features: out });
}

/* Varakort: einfalt Íslandskort (SVG) fyrir gömul tæki eða ef kortið hleðst ekki.
   Virkar í öllum vöfrum; smellt á landshluta síar listann. */
let simpleMap = false;
function useSimpleMap(why) {
  if (map) { try { map.remove(); } catch (e) {} map = null; }
  mapReady = false; simpleMap = true;
  console.warn('Varakort notað:', why);
  drawSimpleMap();
}
function drawSimpleMap() {
  const el = $('map');
  if (!el || !AREAS) return;
  const K = Math.cos(65 * Math.PI / 180), X0 = -26.6, Y1 = 66.6, S = 100;
  // Nafnastaðir: höfuðborg og Suðurnes út í sjó til vinstri svo nöfn rekist ekki á.
  const POS = { hofudborg: [-22.25, 64.3, 'end'], sudurnes: [-22.85, 63.72, 'end'], vesturland: [-21.3, 64.9], sudurland: [-19.6, 64.05], vestfirdir: [-22.6, 65.75], nlv: [-19.9, 65.45], nle: [-17.2, 65.55], austurland: [-15.2, 64.95] };
  const px = (c) => ((c[0] - X0) * K * S).toFixed(1) + ',' + ((Y1 - c[1]) * S).toFixed(1);
  const counts = {};
  for (const e of eventsInDates(true)) { const p = PLACE[e.place_id]; if (p) counts[p.region] = (counts[p.region] || 0) + 1; }
  const regs = AREAS.features.filter((f) => f.properties.kind === 'region');
  let paths = '', labels = '';
  for (const f of regs) {
    const id = f.properties.id;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = '', big = null, bigN = 0;
    for (const poly of polys) for (const ring of poly) {
      d += 'M' + ring.map(px).join('L') + 'Z';
      if (ring.length > bigN) { bigN = ring.length; big = ring; }
    }
    paths += `<path data-r="${id}" class="sr${F.region === id ? ' on' : ''}" d="${d}"><title>${esc(L(f.properties.n, f.properties.en))}</title></path>`;
    let cx = 0, cy = 0;
    for (const c of big) { cx += c[0]; cy += c[1]; }
    const ps = POS[id] || [cx / big.length, cy / big.length];
    const pt = px(ps).split(','), an = ps[2] ? ` style="text-anchor:${ps[2]}"` : '';
    labels += `<g class="sl" data-r="${id}"><text x="${pt[0]}" y="${pt[1]}"${an}>${esc(L(f.properties.n, f.properties.en))}</text><text class="c" x="${pt[0]}" y="${+pt[1] + 26}"${an}>${counts[id] || 0}</text></g>`;
  }
  const w = (13.2 * K * S).toFixed(0), h = (3.35 * S).toFixed(0);
  el.classList.add('simple');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${L('Kort af Íslandi', 'Map of Iceland')}">${paths}${labels}</svg>
    <div class="simplenote">${L('Einfalt kort. Smelltu á landshluta til að sjá viðburði þar.', 'Simple map. Click a region to see its events.')}</div>`;
  el.querySelectorAll('[data-r]').forEach((n) => (n.onclick = () => fitArea('region', n.getAttribute('data-r'))));
}

async function initMap() {
  if (!window.maplibregl) return useSimpleMap('ekkert kortaforrit');
  const style = await pickStyle();
  if (!style) return useSimpleMap('kortagögn náðust ekki');
  try {
    map = new maplibregl.Map({
      container: 'map', style, bounds: ICELAND, fitBoundsOptions: { padding: 20 },
      maxBounds: [[-45, 55], [8, 73]], dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true },
    });
  } catch (e) { return useSimpleMap(e && e.message); }
  map.on('error', (ev) => { if (!mapReady && ev && ev.error && /webgl/i.test(String(ev.error.message || ev.error))) useSimpleMap(ev.error.message); });
  map.touchZoomRotate.disableRotation();
  map.once('load', () => (F.region ? fitArea('region', F.region, true) : fitIceland()));
  const onResize = () => { if (!map) return; map.resize(); if (!F.inView && !F.placeId && !F.sel) (F.region ? fitArea('region', F.region, true) : fitIceland()); };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('map')); else addEventListener('resize', onResize);
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

    // Bæjabólur. Bólur (bara með viðburði) renna saman EINGÖNGU þegar þær lenda hver ofan á annarri;
    // sameinuð bóla fær ekkert bæjarnafn, bara fjölda, og skiptist þegar zoomað er inn.
    // Nöfn koma úr sér lagi og standa alltaf við bæinn sjálfan.
    map.addSource('bub', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    NMDATA = aggGeo();
    map.addSource('nm', { type: 'geojson', data: NMDATA });
    // Nöfn fyrst (undir bólunum). Tölurnar í bólunum eru settar fyrst og nöfnin finna sér stað þar sem
    // engin bóla er: hægra megin, vinstra megin, fyrir ofan, neðan eða á ská.
    const size = ['match', ['get', 'tier'], 1, 17, 2, 15, 13];
    const color = ['case', ['>', ['get', 'n'], 0], '#f6e9e2', '#a88f88'];
    const ANCH = ['left', 'right', 'top', 'bottom', 'bottom-left', 'top-left', 'bottom-right', 'top-right'];
    const nameLayer = (id, minz, maxz, filter, bold) => map.addLayer({ id, type: 'symbol', source: 'nm', minzoom: minz, maxzoom: maxz, filter,
      layout: { 'text-field': ['get', 'name'], 'text-font': [bold ? 'Noto Sans Bold' : 'Noto Sans Regular'], 'text-size': size,
        'text-variable-anchor': ANCH, 'text-radial-offset': ['case', ['>', ['get', 'n'], 0], 1.05, 0.4], 'text-padding': 1, 'symbol-sort-key': ['-', 0, ['get', 'n']] },
      paint: { 'text-color': color, 'text-halo-color': '#120a0b', 'text-halo-width': 1.8 } });
    // Zoomað út: bara 8 bæjanöfn.
    // Aðrir bæir (án viðburða, undir 1.000) bara þegar pláss er.
    nameLayer('town-l2', Z_HUB, Z_TOWN, ['==', ['get', 'keep'], 0], false);
    // Nöfn sem verða ALLTAF að sjást (8 bæir langt úti; nær: bæir með viðburð og yfir 1.000).
    // Staðsetning reiknuð í placeNames() svo þau lendi hvorki á bólu, hvert á öðru né út af kortinu.
    map.addSource('fixn', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fix-l', type: 'symbol', source: 'fixn', maxzoom: Z_TOWN,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['get', 'size'], 'text-anchor': ['get', 'anchor'], 'text-offset': ['get', 'off'], 'text-allow-overlap': true },
      paint: { 'text-color': color, 'text-halo-color': '#120a0b', 'text-halo-width': 1.8 } });
    map.addLayer({ id: 'bub-c', type: 'circle', source: 'bub', maxzoom: Z_TOWN,
      paint: { 'circle-color': A, 'circle-opacity': 0.95, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#1d1214', 'circle-radius': ['get', 'r'] } });
    // Talan sýnist alltaf og tekur pláss frá öðrum nöfnum.
    map.addLayer({ id: 'bub-n', type: 'symbol', source: 'bub', maxzoom: Z_TOWN,
      layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': ['get', 'ts'], 'text-allow-overlap': true, 'text-padding': 6 }, paint: { 'text-color': '#2a1208' } });

    if (!wired) { wired = true;
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const btip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'btip' });
    // Hvaða bæir eru í bólu (sameinuð bóla = margir).
    const bubbleInfo = (f) => {
      return Promise.resolve((MERGED[f.properties.mi] || []).slice().sort((x, y) => y.n - x.n));
    };
    const namesStr = (ps) => ps.length <= 4 ? ps.map((x) => x.name).join(', ') : ps.slice(0, 3).map((x) => x.name).join(', ') + ' ' + L('og', 'and') + ' ' + (ps.length - 3) + ' ' + L('í viðbót', 'more');
    let tipFor = null;
    const bubbleTip = (f) => {
      const key = f.layer.id + ':' + f.properties.mi;
      if (tipFor === key && btip.isOpen()) return;
      tipFor = key;
      bubbleInfo(f).then((ps) => { if (tipFor !== key) return; btip.setLngLat(f.geometry.coordinates).setHTML(`<b>${esc(namesStr(ps))}</b> · ${f.properties.n} ${L('viðburðir', 'events')}`).addTo(map); });
    };
    ['bub-c'].forEach((l) => {
      map.on('mousemove', l, (ev) => { tip.remove(); bubbleTip(ev.features[0]); });
      map.on('mouseleave', l, () => { tipFor = null; btip.remove(); });
    });
    map.on('movestart', (ev) => { if (ev.originalEvent) btip.remove(); });
    map.on('mousemove', 'reg-fill', (ev) => {
      if (map.queryRenderedFeatures(ev.point, { layers: ['bub-c'] }).length) { tip.remove(); return; }
      const f = ev.features[0];
      if (hoverId !== null) map.setFeatureState({ source: 'areas', id: hoverId }, { hover: false });
      hoverId = f.id; map.setFeatureState({ source: 'areas', id: hoverId }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      tip.setLngLat(ev.lngLat).setHTML(`<b>${esc(L(f.properties.n, f.properties.en))}</b>`).addTo(map);
    });
    map.on('mouseleave', 'reg-fill', () => { if (hoverId !== null) map.setFeatureState({ source: 'areas', id: hoverId }, { hover: false }); hoverId = null; map.getCanvas().style.cursor = ''; tip.remove(); });
    map.on('click', (ev) => {
      const hits = map.queryRenderedFeatures(ev.point, { layers: ['bub-c', 'cl', 'pt', 'pt0', 'reg-fill'].filter((l) => map.getLayer(l)) });
      if (!hits.length) return;
      const f = hits[0];
      if (f.layer.id === 'bub-c') {
        tip.remove(); tipFor = null; bubbleTip(f);
        bubbleInfo(f).then((ps) => {
        const ids = new Set();
        ps.forEach((x) => bubblePlaces(null, x.key).forEach((id) => ids.add(id)));
        const one = ps.length === 1 ? ps[0] : null;
        F.placeId = null; F.inView = false;
        F.sel = { label: one ? one.name + (NEAR.has(one.name) && one.key.startsWith('t:') ? ' ' + L('og nágrenni', 'and surroundings') : '') : namesStr(ps), ids };
        const withEv = new Set(eventsInDates(true).filter((e) => ids.has(e.place_id)).map((e) => e.place_id));
        const pts = [...withEv].map((id) => PLACE[id]).filter(Boolean);
        if (pts.length) {
          const b = [[Math.min(...pts.map((p) => p.lon)), Math.min(...pts.map((p) => p.lat))], [Math.max(...pts.map((p) => p.lon)), Math.max(...pts.map((p) => p.lat))]];
          map.fitBounds(b, { padding: 60, maxZoom: 14 });
        }
        renderAll();
        if (innerWidth < 900) $('list').scrollIntoView({ behavior: 'smooth' });
        });
      } else if (f.layer.id === 'cl') {
        map.getSource('pl').getClusterExpansionZoom(f.properties.cluster_id).then((z) => { F.inView = true; map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.3, 17) }); });
      } else if (f.layer.id === 'pt' || f.layer.id === 'pt0') {
        F.sel = null; F.placeId = f.properties.id; renderAll();
        if (innerWidth < 900) $('list').scrollIntoView({ behavior: 'smooth' });
      } else if (f.layer.id === 'reg-fill' && map.getZoom() < 7.5) {
        tip.remove(); fitArea('region', f.properties.id);
      }
    });
    ['bub-c', 'cl', 'pt', 'pt0'].forEach((l) => { map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', l, () => (map.getCanvas().style.cursor = '')); });
    map.on('dragstart', () => { F.inView = true; });
    map.on('zoomstart', (ev) => { if (ev.originalEvent) F.inView = true; });
    map.on('moveend', () => { relayout(); if (F.inView) renderList(); });
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
    else if (it.k === 'town') {
      F.placeId = null; F.sel = null; F.inView = !!map;
      if (map) map.flyTo({ center: it.ll, zoom: 12.5 });
      else F.sel = { label: it.t, ids: new Set(PLACES.filter((p) => p.town === it.t).map((p) => p.id)) };
    }
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
    <div>📅 ${L('Hvenær', 'When')}</div><div>${e.end_date ? `${esc(fmtLong(e.date))} – ${esc(fmtLong(e.end_date))} <span class="fdays">${daysBetween(e.date, e.end_date) + 1} ${L('dagar', 'days')}</span><br>${L('Byrjar kl.', 'Starts')} ${esc(e.time || '')}` : `${esc(fmtLong(e.date))}, ${L('kl.', '')} ${timeStr(e)}`}${e.time_changed && e.old_time ? `<br><span class="chg">${L('Breyttur tími', 'Time changed')}</span> <s class="role">${esc(fmtShort(e.old_time.slice(0, 10)))} ${esc(e.old_time.slice(11))}</s>` : ''}</div>
    <div>📍 ${L('Hvar', 'Where')}</div><div>${esc(placeLabel(p))}${p.region ? `<br><span class="role">${esc(regionName(p.region))}</span>` : ''}</div>
    ${priceStr(e) ? `<div>💰 ${L('Verð', 'Price')}</div><div>${esc(priceStr(e))}${e.door ? ` · ${L('selt inn við hurð', 'pay at the door')}` : ''}</div>` : e.door ? `<div>🚪</div><div>${L('Selt inn við hurð', 'Pay at the door')}</div>` : ''}
    ${ageStr(e) ? `<div>🔞 ${L('Aldur', 'Age')}</div><div>${esc(ageStr(e))}</div>` : ''}
    <div>🏷️</div><div>${tagStr(e).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${e.fam ? `<span class="tag">👨‍👩‍👧 ${L('Fjölskylduvænt', 'Family friendly')}</span>` : ''}</div>
   </div>
   ${(() => { const f = e.festival_id && EVENTS.find((x) => x.id === e.festival_id); return f ? `<p><button class="btn sm" data-fest="${f.id}">🎪 ${L('Hluti af', 'Part of')} ${esc(f.title)} ›</button></p>` : ''; })()}
   ${e.descr ? `<p style="white-space:pre-wrap">${esc(e.descr)}</p>` : ''}
   ${isFest(e) ? (() => { const subs = EVENTS.filter((x) => x.festival_id === e.id && !isOver(x)).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
      return (subs.length ? `<h3 style="margin:14px 0 6px">${L('Á síðunni hjá okkur', 'Listed here')}</h3>${subs.map((x) => `<button class="fline" data-sub="${x.id}"><span>${x.headline ? '⭐ ' : ''}<b>${esc(x.title)}</b> · ${esc(fmtShort(x.date))} ${L('kl.', '')} ${esc(x.time || '')}</span><span class="r">${esc((PLACE[x.place_id] || {}).name || '')} ›</span></button>`).join('')}` : '')
        + `<p class="role">${L('Dagskrána í heild finnurðu hjá hátíðinni sjálfri.', 'See the full programme on the festival’s own page.')}</p>`; })() : ''}
   <div class="row">${e.url ? `<a class="btn primary" href="${esc(e.url)}" target="_blank" rel="noopener">🌐 ${L('Heimasíða hátíðarinnar', 'Festival website')}</a>` : ''}${e.ticket ? `<a class="btn primary" href="${esc(e.ticket)}" target="_blank" rel="noopener">🎟️ ${L('Kaupa miða', 'Buy tickets')}</a>` : ''}
    <button class="btn" data-share>🔗 ${L('Afrita hlekk', 'Copy link')}</button>
    ${p.lat ? `<button class="btn" data-onmap>🗺️ ${L('Sýna á korti', 'Show on map')}</button>` : ''}</div>
   ${adHtml(String(e.id).length + String(e.title).length, 'small')}`;
}
async function openEvent(id) {
  let e = EVENTS.find((x) => x.id === id);
  if (!e) { try { e = (await api('/events/' + id)).event; } catch (er) { toast(er.message, true); return; } }
  const m = openModal(eventDetailHtml(e), { onClose: () => history.replaceState(null, '', BASE + '/') });
  history.replaceState(null, '', BASE + '/?e=' + id);
  m.el.querySelector('[data-share]').onclick = async () => {
    const url = location.origin + BASE + '/?e=' + id;
    try { await navigator.clipboard.writeText(url); toast(L('Hlekkur afritaður', 'Link copied')); } catch (_e) { prompt(L('Afritaðu hlekkinn:', 'Copy the link:'), url); }
  };
  m.el.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => { m.close(); openEvent(b.dataset.sub); }));
  const fb = m.el.querySelector('[data-fest]');
  if (fb) fb.onclick = () => { m.close(); openEvent(fb.dataset.fest); };
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
  const inv = store.get('inv'), from = store.get('invFrom');
  return `${inv ? `<div class="note invnote">🎁 <b>Þér hefur verið boðið${from ? ' af ' + esc(from) : ''}!</b> Skrifaðu netfangið þitt og þú færð innskráningarhlekk.</div>` : ''}<h2>Mitt svæði</h2>
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
      await api('/login', { method: 'POST', body: { email: f.email.value, invite: store.get('inv') || '' } });
      root.querySelector('#loginMsg').innerHTML = `<div class="note">✅ Póstur sendur á <b>${esc(f.email.value)}</b>. Opnaðu hann og smelltu á hlekkinn. (Kíktu í ruslpóstinn ef hann kemur ekki.)</div>`;
    } catch (e) { root.querySelector('#loginMsg').innerHTML = `<p class="err">${esc(e.message)}</p>`; btn.disabled = false; }
  };
}

/* ---------- Reglur (við fyrstu innskráningu) ---------- */
const RULES = [
  ['🎟️', 'Bara alvöru viðburðir. Ef þú setur inn bull getur stjórnandi bannað þig – og jafnvel þann sem bauð þér inn. Ekki vera fáviti.'],
  ['🤝', 'Verum næs.'],
  ['🔑', 'Bjóddu bara þeim sem auglýsa viðburði – tónlistarfólki, börum, veitingahúsum, félögum – og þú treystir. Þú berð ábyrgð á þeim. Þeir sem bara skoða síðuna þurfa engan aðgang.'],
  ['🍺', 'Engar áfengisauglýsingar (t.d. ekkert happy hour eða bjór á tilboði).'],
  ['🕘', 'Haltu viðburðunum þínum réttum. Breyttu eða aflýstu ef eitthvað breytist. Settu inn lokatíma ef hægt er – það er betra að giska (t.d. 23:30) en að sleppa honum.'],
  ['📢', 'Bara viðburðir, engin önnur sala. Það má segja hvar miðar fást og setja hlekk á t.d. tix.is, midix.is eða svid.is.'],
  ['🚩', 'Sérðu bull? Láttu vita.'],
];
const rulesHtml = () => `<ol class="rules">${RULES.map(([e, t]) => `<li><span>${e}</span><span>${esc(t)}</span></li>`).join('')}</ol>`;
function showRules() {
  if (document.querySelector('.rulesModal')) return;
  const m = openModal(`<div class="rulesModal"><h2>Velkomin(n)! 👋</h2><p>Þessi síða er fyrir alla – litla bæinn, litlu hljómsveitina og stóra staðinn. Hún virkar bara ef við pössum hana saman:</p>
    ${rulesHtml()}<button class="btn primary big" id="rulesOk">✅ Ég er með</button></div>`, { onClose: () => { if (!ME.rulesOk) showPublic(); } });
  m.el.querySelector('#rulesOk').onclick = async () => {
    try { await api('/rules-ok', { method: 'POST' }); ME.rulesOk = true; m.close(); toast('Takk! Velkomin(n) 🎉'); } catch (e) { toast(e.message, true); }
  };
}

/* ---------- Boðslyklar ---------- */
const INVITE_NOTE = 'Boðslyklar eru bara fyrir þá sem setja inn viðburði, ekki fyrir þá sem nota síðuna til að skoða hvað er á döfinni. Bjóðum bara þeim sem auglýsa viðburði: tónlistarfólki, börum, veitingahúsum o.s.frv.';
const inviteUrl = (c) => location.origin + BASE + '/?inv=' + c;
async function loadInvites() {
  const box = $('invBox');
  if (!box) return;
  let r;
  try { r = await api('/invites'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const left = r.left;
  const open = r.items.filter((x) => !x.used_at), used = r.items.filter((x) => x.used_at);
  box.innerHTML = `<p class="role">${esc(INVITE_NOTE)}</p>
    <p>${left == null ? 'Þú getur boðið eins mörgum og þú vilt.' : `Þú átt <b>${left}</b> ${left === 1 ? 'boðslykil' : 'boðslykla'} eftir.`}</p>
    <div class="row">${left == null || left > 0 ? '<button class="btn primary" id="invNew">🎁 Búa til boðshlekk</button>' : ''}
    ${left != null && left <= 1 ? (r.request === 'pending' ? '<span class="role">⏳ Beiðni um fleiri boðslykla bíður samþykkis.</span>' : '<button class="btn" id="invMore">➕ Biðja um fleiri boðslykla</button>') : ''}</div>
    ${open.length ? `<h3>Ónotaðir boðshlekkir</h3>${open.map((x) => `<div class="card inv"><code>${esc(inviteUrl(x.code))}</code>
      <div class="row"><button class="btn sm" data-copy="${x.code}">📋 Afrita</button><button class="btn sm ghost" data-del="${x.code}">Hætta við</button></div></div>`).join('')}` : ''}
    ${used.length ? `<h3>Komnir inn í gegnum þig</h3>${used.map((x) => `<div class="role">✅ ${esc(x.name || x.email || '')} · ${esc(fmtLong(iso(new Date(x.used_at))))}</div>`).join('')}` : ''}`;
  const nb = $('invNew');
  if (nb) nb.onclick = async () => {
    try { const c = (await api('/invites', { method: 'POST' })).code; await copyText(inviteUrl(c)); toast('🎁 Boðshlekkur búinn til og afritaður. Sendu hann t.d. á Messenger.'); loadInvites(); }
    catch (e) { toast(e.message, true); }
  };
  const mb = $('invMore');
  if (mb) mb.onclick = async () => { try { await api('/invites/request', { method: 'POST' }); toast('Beiðnin er send.'); loadInvites(); } catch (e) { toast(e.message, true); } };
  box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { await copyText(inviteUrl(b.dataset.copy)); toast('📋 Afritað'); }));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { try { await api('/invites/' + b.dataset.del, { method: 'DELETE' }); loadInvites(); } catch (e) { toast(e.message, true); } }));
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch (_e) { prompt('Afritaðu hlekkinn:', t); } }
// Eigandi: beiðnir um fleiri lykla og hver bauð hverjum (hægt að loka á notanda eða heila grein).
async function loadUsersAdmin() {
  const box = $('usersBox');
  if (!box) return;
  let r;
  try { r = await api('/admin/users'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const kids = {};
  r.users.forEach((u) => { (kids[u.invited_by || ''] = kids[u.invited_by || ''] || []).push(u); });
  const ids = new Set(r.users.map((u) => u.id));
  const roots = r.users.filter((u) => !u.invited_by || !ids.has(u.invited_by));
  const row = (u, d) => `<div class="urow ${u.blocked ? 'blocked' : ''}" style="margin-left:${Math.min(d, 6) * 18}px">
      <span>${d ? '↳ ' : ''}${u.blocked ? '🚫 ' : ''}<b>${esc(u.name || u.email)}</b> <span class="role">${u.name ? esc(u.email) : ''}${u.is_owner ? ' · eigandi' : ` · ${u.invites_left} lyklar eftir`}</span></span>
      ${u.is_owner ? '' : `<span class="row">${u.blocked ? `<button class="btn sm" data-ub="${u.id}" data-a="unblock">Opna</button>` : `<button class="btn sm ghost danger" data-ub="${u.id}" data-a="block">🚫 Loka</button>`}
      ${(kids[u.id] || []).length ? `<button class="btn sm ghost danger" data-ub="${u.id}" data-a="${u.blocked ? 'unblock-branch' : 'block-branch'}">${u.blocked ? 'Opna alla greinina' : '🚫 Loka á alla greinina'}</button>` : ''}</span>`}</div>`;
  const tree = (list, d) => list.map((u) => row(u, d) + tree(kids[u.id] || [], d + 1)).join('');
  box.innerHTML = `${r.requests.length ? `<h3>➕ Beiðnir um fleiri boðslykla</h3>${r.requests.map((q) => `<div class="card"><b>${esc(q.name || q.email)}</b> <span class="role">${esc(q.email)}</span>
      <div class="row"><button class="btn sm primary" data-rq="${q.id}" data-a="approve">✓ Gefa 5 í viðbót</button><button class="btn sm ghost" data-rq="${q.id}" data-a="reject">✕ Hafna</button></div></div>`).join('')}` : ''}
    <h3>👥 Notendur – hver bauð hverjum</h3>${tree(roots, 0)}`;
  box.querySelectorAll('[data-rq]').forEach((b) => (b.onclick = async () => { try { await api(`/admin/invite-requests/${b.dataset.rq}/${b.dataset.a}`, { method: 'POST' }); await loadMe(); loadUsersAdmin(); } catch (e) { toast(e.message, true); } }));
  box.querySelectorAll('[data-ub]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a.startsWith('block') && !confirm(a === 'block-branch' ? 'Loka á þennan notanda OG alla sem hann bauð inn (og þá sem þeir buðu)? Viðburðir þeirra hverfa af síðunni.' : 'Loka á þennan notanda? Viðburðir hans hverfa af síðunni.')) return;
    try { const x = await api(`/admin/users/${b.dataset.ub}/${a}`, { method: 'POST' }); toast(`${a.startsWith('block') ? '🚫 Lokað' : '✅ Opnað'} (${x.count})`); loadUsersAdmin(); } catch (e) { toast(e.message, true); }
  }));
}

async function loadClaims() {
  const box = $('claimBox');
  if (!box) return;
  let r;
  try { r = await api('/admin/claims'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  box.innerHTML = r.items.map((c) => `<div class="card">${c.note === 'wrong' ? `<div class="note">⚠️ Segir skráða netfangið rangt${c.current ? ` (skráð: ${esc(c.current)})` : ''}.${c.suggest ? ` Rétta netfangið: <b>${esc(c.suggest)}</b> – vistast ef þú samþykkir.` : ''}</div>` : ''}<b>${esc(c.name || c.email)}</b> ${c.name ? `<span class="role">${esc(c.email)}</span>` : ''} vill sjá um <b>${esc(c.place)}</b>${c.town ? ' – ' + esc(c.town) : ''}
      <div class="row" style="margin:8px 0">${c.web ? `<a class="btn sm ghost" href="${esc(c.web)}" target="_blank" rel="noopener">🌐 Heimasíða</a>` : ''}${c.fb ? `<a class="btn sm ghost" href="${esc(c.fb)}" target="_blank" rel="noopener">📘 Facebook</a>` : ''}
      <a class="btn sm ghost" href="https://www.google.com/search?q=${encodeURIComponent(c.place + ' ' + (c.town || '') + ' netfang')}" target="_blank" rel="noopener">🔎 Leita</a></div>
      <div class="row"><button class="btn sm primary" data-cl="${c.id}" data-a="approve">✓ Samþykkja</button><button class="btn sm ghost" data-cl="${c.id}" data-a="reject">✕ Hafna</button></div></div>`).join('') || '<p class="role">Engar beiðnir.</p>';
  box.querySelectorAll('[data-cl]').forEach((b) => (b.onclick = async () => { try { await api(`/admin/claims/${b.dataset.cl}/${b.dataset.a}`, { method: 'POST' }); await loadMe(); loadClaims(); } catch (e) { toast(e.message, true); } }));
}

/* ---------- Mitt svæði ---------- */
async function loadMe() {
  try { ME = await api('/me'); } catch (_e) { ME = { user: null }; }
  const n = ME.user ? ME.pending + (ME.feedbackUnread || 0) + (ME.inviteRequests || 0) + (ME.claimRequests || 0) : 0;
  $('mineBadge').textContent = n; $('mineBadge').classList.toggle('hidden', !n);
}
function showPublic() { $('publicView').classList.remove('hidden'); $('mineView').classList.add('hidden'); $('dateChips').classList.remove('hidden'); if (map) { map.resize(); if (!F.inView && !F.placeId && !F.sel) fitIceland(); } }
async function showMine() {
  $('publicView').classList.add('hidden'); $('mineView').classList.remove('hidden'); $('dateChips').classList.add('hidden');
  await renderMine();
  if (ME.user && !ME.rulesOk) showRules();
}
$('mineBtn').onclick = showMine;
// Hæð hausins (fyrir fastar dagsfyrirsagnir og hæð síðunnar í tölvu).
function setHH() { document.documentElement.style.setProperty('--hh', document.querySelector('header').offsetHeight + 'px'); }
setHH(); addEventListener('resize', setHH);
if (window.ResizeObserver) new ResizeObserver(setHH).observe(document.querySelector('header'));
// Síðan uppfærir sig sjálf: á 5 mínútna fresti (byrjaðir/búnir viðburðir) og yfir miðnætti (nýr dagur).
let liveSig = '';
const sigNow = () => EVENTS.filter((e) => isLive(e) || isOver(e)).map((e) => e.id + (isLive(e) ? 'L' : 'O')).join();
function tick() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (t.getTime() !== TODAY.getTime()) { TODAY = t; liveSig = ''; loadEvents().then(renderAll).catch(() => {}); return; }
  const sig = sigNow();
  if (sig !== liveSig) { liveSig = sig; renderAll(); }
}
setInterval(tick, 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
$('fbLink').onclick = () => { store.set('goFeedback', 1); showMine(); };
$('logo').onclick = () => { showPublic(); if (isMobile()) showHome(); };

async function loadFeedback() {
  const box = $('fbList');
  if (!box) return;
  let r;
  try { r = await api('/feedback'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const unread = r.items.filter((x) => !x.seen).length;
  box.innerHTML = (unread ? `<p class="role">${unread} ólesnar</p>` : '') + (r.items.map((x) => `<div class="card fb ${x.seen ? 'seen' : ''}">
      <div class="role">${x.seen ? '' : '🔴 '}${esc(fmtLong(iso(new Date(x.created))))} · ${x.anon ? 'Nafnlaust' : esc((x.name ? x.name + ' – ' : '') + (x.email || ''))}</div>
      <p style="white-space:pre-wrap;margin:8px 0">${esc(x.text)}</p>
      <div class="row"><button class="btn sm" data-fb="${x.id}" data-a="${x.seen ? 'unseen' : 'seen'}">${x.seen ? 'Merkja ólesið' : '✓ Lesið'}</button>
      <button class="btn sm ghost danger" data-fb="${x.id}" data-a="delete">🗑️ Eyða</button></div></div>`).join('') || '<p class="role">Engar athugasemdir enn.</p>');
  box.querySelectorAll('[data-fb]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.a === 'delete' && !confirm('Ertu viss um að þú viljir eyða þessari athugasemd?')) return;
    try { await api(`/feedback/${b.dataset.fb}/${b.dataset.a}`, { method: 'POST' }); await loadMe(); loadFeedback(); } catch (e) { toast(e.message, true); }
  }));
}
async function renderMine() {
  const root = $('mineView');
  await loadMe();
  if (!ME.user) {
    root.innerHTML = `<div class="dash">${store.get('goFeedback') ? '<p class="note">💬 Skráðu þig inn til að senda athugasemd. Þú færð hlekk í tölvupósti.</p>' : ''}<div class="card">${loginHtml()}</div></div>`;
    wireLogin(root); return;
  }
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

   ${u.owner ? `<div class="sec" id="fbOwner"><h2>💬 Athugasemdir frá prófurum</h2><div id="fbList"><p class="role">Hleð…</p></div></div>` : ''}

   <div class="sec" id="claimSec"><h2>🏠 Staðurinn minn</h2>
     <form id="claimForm" class="card"><p>Sérðu um bar, veitingahús, félagsheimili eða annan stað? Finndu hann hér. Við sendum staðfestingu á <b>netfangið sem staðurinn birtir</b> – sá sem opnar þann póst fær að stjórna staðnum.</p>
       ${placeFieldHtml('cl', null)}<div class="row" style="margin-top:10px"><button class="btn primary">🏠 Þetta er minn staður</button></div><div id="claimMsg"></div></form></div>

   ${u.owner ? `<div class="sec" id="claimAdmin"><h2>🏠 Beiðnir um staði (ekkert netfang fannst)</h2><div id="claimBox"><p class="role">Hleð…</p></div></div>` : ''}

   ${u.owner ? `<div class="sec"><h2>👥 Notendur og boðslyklar</h2><div id="usersBox"><p class="role">Hleð…</p></div></div>` : ''}

   <div class="sec" id="invSec"><h2>🎁 Bjóða einhverjum</h2><div id="invBox"><p class="role">Hleð…</p></div>
     <details class="paste"><summary>📜 Reglurnar</summary>${rulesHtml()}</details></div>

   <div class="sec" id="fbSec"><h2>💬 Senda athugasemd</h2>
     <form id="fbForm" class="card"><label>Hvað mætti laga eða bæta við síðuna?</label>
       <textarea name="text" rows="4" maxlength="4000" placeholder="Skrifaðu hér…"></textarea>
       <label class="cbx" style="margin-top:8px"><input type="checkbox" name="anon"><span>Senda nafnlaust</span></label>
       <div class="row" style="margin-top:8px"><button class="btn primary">Senda</button></div>
       <p class="role">Fer beint til þeirra sem sjá um síðuna. Nafnlaust: þeir sjá hvorki nafn né netfang.</p></form></div>

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
  $('fbForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try { await api('/feedback', { method: 'POST', body: { text: f.elements.text.value, anon: f.anon.checked } }); f.reset(); toast('✅ Takk! Athugasemdin er komin til skila.'); if (u.owner) loadFeedback(); }
    catch (e) { toast(e.message, true); }
  };
  if (u.owner) { loadFeedback(); loadUsersAdmin(); loadClaims(); }
  const cf = $('claimForm'), cpf = wirePlaceField(cf, 'cl');
  cf.onsubmit = async (ev) => {
    ev.preventDefault();
    const id = cpf.value();
    if (!id) { toast('Veldu staðinn fyrst', true); return; }
    try {
      const pv = await api('/claim', { method: 'POST', body: { place_id: id, preview: true } });
      if (pv.already) { $('claimMsg').innerHTML = '<div class="note">✅ Þú sérð þegar um þennan stað.</div>'; return; }
      const nm = esc(pv.place) + (pv.town ? ' – ' + esc(pv.town) : '');
      const ok = await new Promise((res) => {
        const m = openModal(`<h2>🏠 ${nm}</h2>
          ${pv.to ? `<p>📧 Staðfestingarpóstur verður sendur á <b>${esc(pv.to)}</b> – netfangið sem staðurinn birtir.</p><p>Sá sem opnar þann póst og smellir á hlekkinn fær að stjórna staðnum.</p>`
            : `<p>Við fundum ekkert netfang fyrir staðinn. Beiðnin fer til umsjónarmanns síðunnar, sem staðfestir hana.</p>`}
          <p><b>Ertu viss?</b></p><div class="row"><button class="btn primary" data-y>${pv.to ? '📧 Já, senda' : 'Já, halda áfram'}</button><button class="btn ghost" data-n>Hætta við</button></div>
          ${pv.to ? `<p style="margin-top:14px"><button class="btn sm ghost" data-w>❓ Þetta er ekki rétt netfang</button></p>
          <div data-wbox class="hidden"><label>Rétta netfang staðarins (má sleppa)</label><input class="inp" type="email" data-sug placeholder="t.d. info@stadurinn.is">
            <p class="role">Beiðnin fer þá til umsjónarmanns síðunnar, sem staðfestir hana.</p><button class="btn primary" data-ws>Senda beiðni</button></div>` : ''}`, { onClose: () => res(false) });
        m.el.querySelector('[data-y]').onclick = () => { res(true); m.close(); };
        m.el.querySelector('[data-n]').onclick = () => m.close();
        const w = m.el.querySelector('[data-w]');
        if (w) {
          w.onclick = () => { m.el.querySelector('[data-wbox]').classList.remove('hidden'); w.classList.add('hidden'); m.el.querySelector('[data-sug]').focus(); };
          m.el.querySelector('[data-ws]').onclick = () => { res({ wrong: true, suggest: m.el.querySelector('[data-sug]').value.trim() }); m.close(); };
        }
      });
      if (!ok) return;
      const r = await api('/claim', { method: 'POST', body: Object.assign({ place_id: id }, ok === true ? {} : ok) });
      $('claimMsg').innerHTML = r.already ? '<div class="note">✅ Þú sérð þegar um þennan stað.</div>'
        : r.manual ? `<div class="note">${r.wrong ? 'Takk! ' : 'Við fundum ekkert netfang fyrir þennan stað. '}Beiðnin er komin til umsjónarmanns síðunnar, sem staðfestir hana.</div>`
        : `<div class="note">📧 Við sendum staðfestingu á <b>${esc(r.sentTo)}</b> – netfangið sem staðurinn birtir. Opnaðu þann póst og smelltu á hlekkinn.</div>`;
    } catch (e) { $('claimMsg').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  loadInvites();
  if (store.get('goFeedback')) { store.set('goFeedback', null); setTimeout(() => { $('fbSec').scrollIntoView({ behavior: 'smooth' }); $('fbForm').elements.text.focus(); }, 50); }
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
      if (x === 'copy') return openEventForm(Object.assign({}, e, { id: null, date: '' }), true);
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
   <div class="card"><h3>📧 Netföng staða</h3><p class="role">Finnur heimasíður sem vantar (Google) og sækir netföngin af þeim. Gert einu sinni – svo staðir geti staðfest sig sjálfir.</p>
     <div id="ctStats" class="role">Hleð…</div><div class="row"><button class="btn primary" id="ctRun">🔎 Finna heimasíður og netföng</button></div></div>
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
  const ctShow = (x) => { $('ctStats').innerHTML = `Farið yfir <b>${x.checked}</b> af ${x.total} stöðum · 📧 <b>${x.email}</b> með netfang · 🌐 ${x.web} með heimasíðu · 📘 ${x.fb} með Facebook${x.googleUsed != null ? ` · Google-fyrirspurnir í mánuðinum: ${x.googleUsed}/900` : ''}${x.hasKey ? '' : ' · ⚠️ Google-lykil vantar'}`; };
  api('/admin/contacts').then(ctShow).catch(() => {});
  $('ctRun').onclick = async () => {
    const b = $('ctRun'); b.disabled = true; b.textContent = '⏳ Í gangi – ekki loka síðunni…';
    try {
      for (;;) {
        const x = await api('/admin/contacts', { method: 'POST' });
        ctShow(x);
        if (x.errors && x.errors.length) { $('ctStats').insertAdjacentHTML('beforeend', `<p class="err">⚠️ ${esc(x.errors[0])}</p>`); break; }
        if (x.done) { toast('✅ Búið'); break; }
      }
    } catch (e) { $('ctStats').insertAdjacentHTML('beforeend', `<p class="err">⚠️ ${esc(e.message)}</p>`); }
    b.disabled = false; b.textContent = '🔎 Halda áfram';
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
    let items = PLACES.filter((p) => p.cat !== 'town' && (!q || norm(placeLabel(p) + ' ' + muniName(p.muni)).includes(q)));
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
     <div id="festFields" class="${tags.has('hatid') ? '' : 'hidden'}" style="margin-top:10px">
       <label>📍 Hvar er hátíðin?</label>
       <div class="row" style="margin-bottom:8px"><label class="cbx"><input type="radio" name="fwhere" value="place" ${String(ev.place_id || '').startsWith('town:') ? '' : 'checked'}><span>Á einum stað (valinn efst)</span></label>
         <label class="cbx"><input type="radio" name="fwhere" value="town" ${String(ev.place_id || '').startsWith('town:') ? 'checked' : ''}><span>🏘️ Um allan bæinn</span></label></div>
       <div id="ftownBox" class="${String(ev.place_id || '').startsWith('town:') ? '' : 'hidden'}" style="margin-bottom:8px"><input class="inp" name="ftown" list="ftownList" placeholder="Bær, t.d. Höfn" value="${esc(String(ev.place_id || '').startsWith('town:') ? ev.place_id.slice(5) : '')}">
         <datalist id="ftownList">${(GEO ? GEO.towns : []).map((t) => `<option value="${esc(t.n)}">`).join('')}</datalist></div>
       <label>📅 Síðasti dagur hátíðarinnar</label><input type="hidden" name="end_date" value="${esc(ev.end_date || '')}"><button type="button" class="btn" id="endDateBtn">${ev.end_date ? esc(fmtLong(ev.end_date)) : 'Veldu síðasta dag'}</button>
       <label style="margin-top:8px">🌐 Heimasíða eða Facebook-síða hátíðarinnar (þar er dagskráin)</label><input type="url" name="url" placeholder="https://" value="${esc(ev.url || '')}"></div>
     <div id="festPick" style="margin-top:10px"></div>
     <input type="text" name="other_label" class="${tags.has('annad') ? '' : 'hidden'}" style="margin-top:8px" maxlength="40" placeholder="Hvað er þetta? t.d. fundur eða bingó" value="${esc(ev.other_label || '')}"></div>
   <div class="two"><div class="f"><label>💰 Verð (kr.)</label><input type="number" name="price" min="0" step="1" inputmode="numeric" placeholder="0 = frítt inn" value="${ev.price == null ? '' : ev.price}"></div>
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
  // „Hluti af hátíð?“: hátíðir sem standa yfir á völdum degi í sama sveitarfélagi.
  const refreshFest = () => {
    const box = $('festPick'); if (!box) return;
    const isH = !!f.querySelector('[data-tag="hatid"].on'), d = f.date.value, pl = PLACE[pf ? pf.value() : ''];
    const cands = isH || !d || !pl ? [] : EVENTS.filter((x) => isFest(x) && x.id !== ev.id && x.date <= d && festEnd(x) >= d && PLACE[x.place_id] && PLACE[x.place_id].muni === pl.muni);
    const cur = ev.festival_id || '';
    const mine = (x) => ME.user && (ME.user.owner || (ME.pages || []).some((p) => p.id === x.page_id));
    box.innerHTML = cands.map((x) => `<label class="cbx"><input type="checkbox" name="fest_${x.id}" data-fid="${x.id}" ${x.id === cur ? 'checked' : ''}><span>🎪 Hluti af ${esc(x.title)}</span></label>`
      + (mine(x) ? `<label class="cbx" style="margin-left:26px"><input type="checkbox" data-head="${x.id}" ${x.id === cur && ev.headline ? 'checked' : ''}><span>⭐ Aðalatriði dagsins á hátíðinni (nefnt í dagslínunni)</span></label>` : '')).join('');
    box.querySelectorAll('[data-fid]').forEach((c) => (c.onchange = () => { if (c.checked) box.querySelectorAll('[data-fid]').forEach((o) => { if (o !== c) o.checked = false; }); }));
  };
  const pf = wirePlaceField(f, 'ev', () => setTimeout(refreshFest, 0));
  const tStart = wireTime(f, 'time'), tEnd = wireTime(f, 'end_time');
  let pastOk = false;
  const setDate = (s) => { f.date.value = s; $('dateBtn').textContent = fmtLong(s); pastOk = false; $('pastWarn').classList.add('hidden'); checkChange(); refreshFest(); };
  refreshFest();
  f.querySelectorAll('[name=fwhere]').forEach((r) => (r.onchange = () => $('ftownBox').classList.toggle('hidden', f.fwhere.value !== 'town')));
  $('endDateBtn').onclick = () => openCal(f.end_date.value || f.date.value || iso(TODAY), { title: 'Síðasti dagur hátíðarinnar', min: f.date.value || iso(TODAY), onPick: (s) => { f.end_date.value = s; $('endDateBtn').textContent = fmtLong(s); } });
  $('dateBtn').onclick = () => openCal(f.date.value || iso(TODAY), { title: 'Dagsetning', min: iso(TODAY), allowPast: true, onPick: setDate });
  const checkChange = () => { const hb = $('hlBox'); if (hb) hb.classList.toggle('hidden', !(ev.status === 'approved' && (f.date.value !== ev.date || f.time.value !== ev.time))); };
  f.querySelectorAll('[data-tf="time"] [data-tq]').forEach((c) => c.addEventListener('click', checkChange));
  f.querySelectorAll('[data-tag]').forEach((c) => (c.onclick = () => { c.classList.toggle('on'); f.other_label.classList.toggle('hidden', !f.querySelector('[data-tag="annad"].on')); $('genreBox').classList.toggle('hidden', !f.querySelector('[data-tag="tonlist"].on')); f.querySelectorAll('[data-subbox]').forEach((bx) => bx.classList.toggle('hidden', !f.querySelector(`[data-tag="${bx.dataset.subbox}"].on`))); $('festFields').classList.toggle('hidden', !f.querySelector('[data-tag="hatid"].on')); refreshFest(); }));
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
      page_id: f.page_id.value, place_id: f.querySelector('[data-tag="hatid"].on') && f.fwhere.value === 'town' ? (f.ftown.value.trim() ? 'town:' + f.ftown.value.trim() : '') : pf.value(), title: f.elements.title.value, date: f.date.value, time: f.time.value, end_time: f.end_time.value,
      price: f.price.value === '' ? null : Number(f.price.value), door: f.door.checked, ticket: f.ticket.value, age: f.age.value, age_text: f.age_text.value,
      end_date: f.end_date.value, url: f.url.value, festival_id: ((f.querySelector('[data-fid]:checked') || {}).dataset || {}).fid || '',
      headline: !!f.querySelector('[data-head]:checked'),
      tags: tagsSel, genres: [...f.querySelectorAll('[data-genre].on')].map((c) => c.dataset.genre), other_label: f.other_label.value, fam: f.fam.checked, descr: f.descr.value, poster: f.poster.value,
      repeat_weeks: f.repeat_weeks ? Number(f.repeat_weeks.value) : 1, highlight_change: f.highlight_change ? f.highlight_change.checked : false,
    };
    const fail = (msg) => { errBox.innerHTML = `<p class="err">${esc(msg)}</p>`; };
    if (!body.place_id) return fail(f.querySelector('[data-tag="hatid"].on') && f.fwhere.value === 'town' ? 'Skrifaðu bæinn.' : 'Veldu stað úr listanum.');
    if (body.place_id.startsWith('town:') && !(GEO && GEO.towns.some((t) => t.n === body.place_id.slice(5)))) return fail('Veldu bæ úr listanum, t.d. Höfn.');
    if (!body.date) return fail('Veldu dagsetningu.');
    if (!body.time) return fail('Veldu tíma (eða skrifaðu hann rétt undir „Annað“).');
    if (!tagsSel.length) return fail('Veldu hvernig viðburður þetta er.');
    if (body.date < iso(TODAY) && !pastOk) { pastOk = true; $('pastWarn').classList.remove('hidden'); return; }
    const btn = $('evSave'); btn.disabled = true;
    try {
      const r = editing ? await api('/events/' + ev.id, { method: 'PUT', body }) : await api('/events', { method: 'POST', body });
      m.close();
      toast(r.status === 'pending' ? `⏳ Sent til ${r.venue || 'staðarins'} til samþykkis` : editing ? '✅ Vistað' : '✅ Viðburðurinn er kominn inn');
      if (body.place_id.startsWith('town:') && !PLACE[body.place_id]) setPlaces((await api('/places')).places);
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
    const body = Object.assign({ name: f.elements.name.value, area: f.area.value, lon: ll[0], lat: ll[1] }, w);
    try {
      if (editing) await api('/places/' + place.id, { method: 'PUT', body }); else await api('/places', { method: 'POST', body });
      setPlaces((await api('/places')).places); renderAll();
      m.close(); toast('✅ Staðurinn er vistaður'); done && done();
    } catch (e) { $('plErr').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
}

/* ---------- Sími: „Hvað langar þig að gera?“ ---------- */
const isMobile = () => matchMedia('(max-width: 899px)').matches;
const ICON = { tonlist: '🎸', leikhus: '🎭', uppistand: '😂', pubquiz: '🧠', list: '🎨', hatid: '🎪', annad: '✨' };
const SUBICON = { tonleikahatid: '🎸', baejarhatid: '🏘️', tonleikar: '🎤', ball: '💃', dj: '🎧', trubador: '🪕', tonlist_annad: '🎶', leiksyning: '🎭', songleikur: '🎶', barnaleikrit: '🧸', dans: '🩰', leikhus_annad: '🎟️' };
function flow(html) {
  const el = $('mflow'); el.innerHTML = html; el.classList.remove('hidden'); el.scrollTop = 0;
  document.body.classList.add('m-flow');
  return el;
}
function closeFlow() { $('mflow').classList.add('hidden'); document.body.classList.remove('m-flow'); }
function showHome() {
  const sel = new Set();
  const el = flow(`<div class="mf"><h1>${L('Hvað langar þig að gera?', 'What do you feel like doing?')}</h1>
    <p class="role" style="margin:-8px 0 6px">${L('Veldu eitt eða fleira', 'Pick one or more')}</p>
    <div class="tiles">${TOPS.map((t) => `<button class="tile" data-c="${t}"><span class="ic">${ICON[t]}</span>${esc(TAGL[lang][t])}</button>`).join('')}</div>
    <button class="btn primary big hidden" id="mfNext">${L('Áfram', 'Next')} →</button>
    <button class="btn big" id="mfAll" style="margin-top:10px">${L('Sýna mér allt', 'Show me everything')} →</button></div>`);
  el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
    const c = b.dataset.c; sel.has(c) ? sel.delete(c) : sel.add(c); b.classList.toggle('on', sel.has(c));
    $('mfNext').classList.toggle('hidden', !sel.size);
  }));
  $('mfAll').onclick = () => { SF.tags.clear(); SF.genres.clear(); saveSF(); goWhere(); };
  $('mfNext').onclick = () => {
    SF.tags.clear(); SF.genres.clear(); sel.forEach((c) => SF.tags.add(c)); saveSF();
    const withSubs = [...sel].filter((c) => SUBS[c]);
    if (withSubs.length) showSub(withSubs); else goWhere();
  };
}
function showSub(tops) {
  const el = flow(`<div class="mf"><button class="back" data-back>← ${L('Til baka', 'Back')}</button>
    <h1>${L('Nánar?', 'More specific?')}</h1><p class="role" style="margin:-8px 0 6px">${L('Veldu eða slepptu – ekkert valið = allt', 'Pick or skip – nothing picked = everything')}</p>
    ${tops.map((top) => `<h2 style="font-size:21px;margin:18px 0 0">${ICON[top]} ${esc(TAGL[lang][top])}</h2>
      <div class="tiles">${SUBS[top].map((x) => `<button class="tile sm" data-s="${x}"><span class="ic" style="font-size:30px">${SUBICON[x]}</span>${esc(TAGL[lang][x])}</button>`).join('')}</div>`).join('')}
    <button class="btn primary big" id="mfNext2">${L('Áfram', 'Next')} →</button></div>`);
  el.querySelector('[data-back]').onclick = showHome;
  el.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => b.classList.toggle('on')));
  $('mfNext2').onclick = () => { el.querySelectorAll('[data-s].on').forEach((b) => SF.tags.add(b.dataset.s)); saveSF(); goWhere(); };
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
    try { const pend = localStorage.getItem('sidPending'); if (pend) { store.set('sid', pend); localStorage.removeItem('sidPending'); } } catch (_e) {}
    history.replaceState(null, '', u.pathname + u.search); }
  applyLang();
  wireSearch();
  F.region = isMobile() ? store.get('region', null) || null : null;
  document.body.classList.add('m-list');
  try { await loadAll(); } catch (e) { $('list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  renderAll();
  renderSideAd();
  initMap();
  await loadMe();
  const sp = new URLSearchParams(location.search);
  const inv = sp.get('inv');
  if (inv) {
    history.replaceState(null, '', BASE + '/');
    try {
      const r = await api('/invite/' + encodeURIComponent(inv));
      if (r.ok) { store.set('inv', inv); store.set('invFrom', r.from || ''); if (!ME.user) showMine(); else toast('Þú ert þegar með aðgang 🙂'); }
      else toast(r.error, true);
    } catch (e) { toast(e.message, true); }
  }
  const cl = sp.get('claim');
  if (cl) {
    history.replaceState(null, '', BASE + '/');
    if (cl === 'ok') { toast('✅ Staðfest! Þú sérð nú um staðinn.'); if (ME.user) showMine(); }
    else toast(cl === 'utrunnid' ? 'Staðfestingarhlekkurinn er útrunninn eða búið að nota hann.' : 'Staðfesting tókst ekki.', true);
  }
  const lg = sp.get('login');
  if (lg) {
    history.replaceState(null, '', BASE + '/');
    if (lg === 'ok') { store.set('inv', null); store.set('invFrom', null); toast('✅ Þú ert innskráð(ur)'); showMine(); }
    else toast(lg === 'utrunnid' ? 'Hlekkurinn er útrunninn eða búið að nota hann. Biddu um nýjan.' : lg === 'bodnotad' ? 'Boðslykillinn hefur þegar verið notaður. Biddu um nýjan.' : 'Innskráning tókst ekki.', true);
  }
  if (sp.get('e')) openEvent(sp.get('e'));
  else if (isMobile() && !lg) showHome();
})();
