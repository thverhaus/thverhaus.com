'use strict';
/* global Player, SyncRoom */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROW = 56;

const S = {
  snap: null, channels: [], groups: [], per: { favorites: [], recent: [], groupOrder: [], hiddenGroups: [], chanHealth: {} },
  epg: { programmes: {}, chanMap: [] },
  group: '__all', search: '', list: [], sel: -1, current: -1,
  hs: [], tops: [], marks: new Set(), markAnchor: -1, mkGroup: '', clean: { name: '', sec: 0 },
  bank: null, chFollow: false,
  settings: {}
};

// ---------- helpers ----------
const fmtTime = (t) => new Date(t).toLocaleTimeString('is-IS', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayName = (t) => {
  const d = new Date(t), today = new Date();
  const diff = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 864e5);
  if (diff === 0) return 'Í dag';
  if (diff === 1) return 'Á morgun';
  if (diff === -1) return 'Í gær';
  return d.toLocaleDateString('is-IS', { weekday: 'long', day: 'numeric', month: 'long' });
};
const epgOff = () => (Number(S.settings.epgOffsetMin) || 0) * 60000;

function progsFor(idx) {
  const id = S.epg.chanMap ? S.epg.chanMap[idx] : null;
  return id ? (S.epg.programmes[id] || []) : [];
}
function nowNext(idx) {
  const list = progsFor(idx);
  if (!list.length) return { now: null, next: null };
  const t = Date.now() - epgOff();
  let lo = 0, hi = list.length - 1, pos = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= t) { pos = m; lo = m + 1; } else hi = m - 1; }
  const now = pos >= 0 && list[pos][1] > t ? list[pos] : null;
  const next = list[pos + 1] || null;
  return { now, next };
}
const shifted = (p) => p ? [p[0] + epgOff(), p[1] + epgOff(), p[2], p[3]] : null;

function initials(name) {
  return (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

// ---------- groups ----------
function orderedGroups() {
  const order = S.per.groupOrder || [];
  const byName = new Map(S.groups.map(g => [g.name, g]));
  const out = [];
  for (const n of order) if (byName.has(n)) { out.push(byName.get(n)); byName.delete(n); }
  for (const g of S.groups) if (byName.has(g.name)) out.push(g);
  return out;
}
const isLiveCh = (c) => !c.kind || c.kind === 'live';
function visibleGroups() {
  const hidden = new Set(S.per.hiddenGroups || []);
  return orderedGroups().filter(g => !hidden.has(g.name) && (!S.liveGroups || S.liveGroups.has(g.name)));
}

function renderGroups() {
  if (S.mode !== 'live') return renderVodGroups();
  const fav = new Set(S.per.favorites || []);
  const favCount = S.channels.filter(c => fav.has(c.name)).length;
  const hidden = new Set(S.per.hiddenGroups || []);
  const allCount = S.channels.filter(c => !hidden.has(c.group) && isLiveCh(c)).length;
  const items = [
    { key: '__fav', label: '⭐ Uppáhalds', c: favCount },
    { key: '__recent', label: '🕘 Nýlegt', c: (S.per.recent || []).length },
    { key: '__all', label: '📺 Allar rásir', c: allCount },
    { key: '__today', label: '⚽ Beint í dag', c: todayFav().length },
    'sep',
    ...visibleGroups().map(g => ({ key: g.name, label: g.name, c: g.count }))
  ];
  $('#groups').innerHTML = items.map(it => it === 'sep' ? '<div class="gsep"></div>' :
    `<div class="grp ${S.group === it.key && !S.search ? 'sel' : ''}" data-g="${esc(it.key)}"><span class="nm">${esc(it.label)}</span><span class="c">${it.c}</span></div>`).join('');
}

$('#groups').addEventListener('click', (e) => {
  const el = e.target.closest('.grp'); if (!el) return;
  S.group = el.dataset.g; S.search = ''; S.searchAll = false; $('#search').value = '';
  S.per.lastGroup = S.group; window.api.updatePer({ lastGroup: S.group });
  buildList(); renderGroups();
  $('#chlist').scrollTop = 0;
});

// ---------- channel list ----------
// A list row = one channel, or several variants of the same channel (HD/FHD/4K/backup)
// merged into one line. row = { v: [channel idx…], p: primary idx, base: display name }
const QUAL_RE = /(?:\s+|^)(?:F?HD|UHD|SD|4K|8K|HDR|HEVC|H\.?265|RAW|B|BACKUP|ALT|P\d{2}|\d{3,4}[PI]|\d{2}FPS|ᴴᴰ|ᶠᴴᴰ|ᵁᴴᴰ|[\(\[][^\)\]]{1,14}[\)\]])$/i;
const COUNTRY_RE = /^[A-Z]{2,4}\s*[:|]\s*/;
// Icelandic alphabetical order (á after a, ð after d, þ æ ö last) with natural number order.
// Done by hand because the built-in Icelandic collation isn't available in every build.
const IS_ORDER = 'aábcdðeéfghiíjklmnoópqrstuúvwxyýzþæø';
const IS_RANK = new Map([...IS_ORDER].map((c, i) => [c, i]));
IS_RANK.set('ö', IS_RANK.get('ø') + 1); IS_RANK.set('ä', IS_RANK.get('æ')); IS_RANK.set('å', IS_RANK.get('a') + 0.5);
function isTokens(str) {
  return String(str).toLowerCase().match(/\d+|./gu) || [];
}
const coll = {
  compare(a, b) {
    const x = isTokens(a), y = isTokens(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const p = x[i], q = y[i];
      if (p === q) continue;
      const pd = /^\d/.test(p), qd = /^\d/.test(q);
      if (pd && qd) return Number(p) - Number(q);
      if (pd !== qd) return pd ? -1 : 1;
      const pr = IS_RANK.has(p) ? IS_RANK.get(p) : (p < 'a' ? -100 + p.charCodeAt(0) / 1000 : 1000 + p.charCodeAt(0));
      const qr = IS_RANK.has(q) ? IS_RANK.get(q) : (q < 'a' ? -100 + q.charCodeAt(0) / 1000 : 1000 + q.charCodeAt(0));
      if (pr !== qr) return pr - qr;
    }
    return x.length - y.length;
  }
};

function splitName(name) {
  let base = name.trim(), tags = [];
  for (let i = 0; i < 6; i++) {
    const m = QUAL_RE.exec(base);
    if (!m || m.index === 0) break;
    const rest = base.slice(0, m.index).trim();
    if (rest.replace(COUNTRY_RE, '').length < 2) break;   // don't eat the whole name
    tags.unshift(m[0].trim().replace(/[\(\)\[\]]/g, ''));
    base = base.slice(0, m.index).trim();
  }
  return { base, tag: tags.join(' ') };
}
function variantRank(tag) {
  const t = tag.toUpperCase();
  let r = 2;
  if (/\bFHD\b|1080/.test(t)) r = 0;
  else if (/\bHD\b|ᴴᴰ|720/.test(t)) r = 1;
  else if (/UHD|4K|8K|2160/.test(t)) r = 3;
  else if (/\bSD\b/.test(t)) r = 4;
  if (/\bB\b|BACKUP|ALT/.test(t)) r += 10;
  if (/SKY ?GO/.test(t)) r += 5;
  return r;
}
const sortKey = (base) => base.replace(COUNTRY_RE, '');
// "UK: Sky Sport Main Events" and "UK: SKY SPORT MAIN EVENT" are the same channel
const normWords = (base) => base.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9: ]+/g, ' ').split(/\s+/).filter(Boolean)
  .map(w => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const mergeKey = (base) => normWords(base).join(' ');
// An abbreviation at the end of a name is the same channel as the words it stands for:
// "UK: Sky Sport PL" = "UK: Sky Sport Premier League" (same schedule, checked by hand 9. nóv.).
// It only counts when the shorter name is really spelled out somewhere: the words before the
// abbreviation must be identical, the missing words must all be real words, and exactly one
// name may fit (otherwise "… BC" could mean Birmingham City or Bristol City).
function nameInfo(idx) {
  const c = S.channels[idx];
  const sp = splitName(c.name);
  const words = normWords(sp.base);
  return { idx, name: sp.base, words, group: c.group, key: c.group + '\u0000' + words.join(' ') };
}
function buildNameIndex(idxs) {
  const names = new Map(), collapsed = new Map();
  for (const i of idxs) {
    const n = nameInfo(i);
    if (!names.has(n.key)) names.set(n.key, n);
    for (let k = 2; k <= 4 && k < n.words.length; k++) {
      const tail = n.words.slice(n.words.length - k);
      if (tail.some(w => !/^[a-z]{2,}$/.test(w))) continue;      // numbers are not initials
      const ck = n.group + '\u0000' + n.words.slice(0, n.words.length - k).join(' ') + ' ' + tail.map(w => w[0]).join('');
      if (!collapsed.has(ck)) collapsed.set(ck, new Set());
      collapsed.get(ck).add(n.key);
    }
  }
  const alias = new Map();     // short key -> the key of the spelled-out name
  for (const [key, n] of names) {
    const w = n.words, abbr = w[w.length - 1];
    if (!/^[a-z]{2,4}$/.test(abbr)) continue;
    const set = collapsed.get(n.group + '\u0000' + w.slice(0, -1).join(' ') + ' ' + abbr);
    if (!set || set.size !== 1) continue;                        // nobody or more than one fits
    const other = names.get([...set][0]);
    if (!other || other.key === key || other.words.length <= w.length) continue;
    alias.set(key, other.key);
  }
  return { names, alias };
}

// idxs (in provider order) -> rows, merged + sorted per settings, grouped by folder
function makeRows(idxs, { merge = S.settings.mergeVariants !== false, sort = S.settings.sortAZ !== false } = {}) {
  const rows = [], byKey = new Map();
  const index = merge ? buildNameIndex(idxs) : null;
  for (const i of idxs) {
    const c = S.channels[i];
    const sp = splitName(c.name);
    const k0 = c.group + '\u0000' + mergeKey(sp.base);
    const key = index ? (index.alias.get(k0) || k0) : 'x' + i;
    let row = byKey.get(key);
    if (!row) {
      const shown = index && index.names.get(key);
      row = { v: [], base: shown ? shown.name : sp.base, group: c.group, first: rows.length };
      byKey.set(key, row); rows.push(row);
    }
    row.v.push(i);
  }
  for (const row of rows) {
    if (row.v.length > 1) row.v.sort((a, b) => variantRank(splitName(S.channels[a].name).tag) - variantRank(splitName(S.channels[b].name).tag) || a - b);
    else row.base = S.channels[row.v[0]].name;
    row.p = row.v[0];
  }
  if (sort) {
    const gRank = new Map(); rows.forEach(r => { if (!gRank.has(r.group)) gRank.set(r.group, gRank.size); });
    rows.sort((a, b) => gRank.get(a.group) - gRank.get(b.group) || coll.compare(sortKey(a.base), sortKey(b.base)) || a.first - b.first);
  }
  return rows;
}
const single = (idxs) => idxs.map(i => ({ v: [i], p: i, base: S.channels[i].name, group: S.channels[i].group }));
const rowOf = (idx) => S.list.findIndex(r => r.v && r.v.includes(idx));
const todayFav = () => ((S.sports && S.sports.today) || []).filter(f => f.fav && f.state !== 'post' || (f.fav && Date.now() - f.start < 3 * 3600e3));
S.openMatches = new Set();
const isRealGroup = (g) => g && !g.startsWith('__');
function folderMode(g) {
  const m = (S.per.folderSort || {})[g];
  return m || (S.settings.sortAZ !== false ? 'az' : 'provider');
}
function saveFolderOrder(bases) {
  S.per.folderOrder = { ...(S.per.folderOrder || {}), [S.group]: bases };
  S.per.folderSort = { ...(S.per.folderSort || {}), [S.group]: 'custom' };
  window.api.updatePer({ folderOrder: S.per.folderOrder, folderSort: S.per.folderSort });
}

function buildList() {
  if (S.mode !== 'live') return buildVodList();
  const q = S.search.trim().toLowerCase();
  const hidden = new Set(S.per.hiddenGroups || []);
  let rows = [];
  let title = '';
  S.favEdit = S.favEdit && (S.group === '__fav' || isRealGroup(S.group)) && !q;
  // marks belong to one list: leaving the folder or the arrange mode clears them
  if (!S.favEdit) { S.marks.clear(); S.markAnchor = -1; }
  if (S.mkGroup !== S.group) { S.marks.clear(); S.markAnchor = -1; S.mkGroup = S.group; }
  if (q) {
    const words = q.split(/\s+/);
    const inGroup = isRealGroup(S.group) && !S.searchAll;
    const idxs = [];
    S.channels.forEach((c, i) => {
      if (!isLiveCh(c) || (inGroup ? c.group !== S.group : hidden.has(c.group))) return;
      const n = c.name.toLowerCase(); if (words.every(w => n.includes(w))) idxs.push(i);
    });
    rows = makeRows(idxs);
    title = inGroup ? `Leit í „${S.group}“` : `Leit: „${S.search.trim()}“`;
  } else if (S.group === '__fav') {
    const pos = new Map((S.per.favorites || []).map((n, i) => [n, i]));
    const idxs = [];
    const seen = new Set();
    S.channels.forEach((c, i) => { if (pos.has(c.name) && !seen.has(c.name)) { seen.add(c.name); idxs.push(i); } });
    idxs.sort((a, b) => pos.get(S.channels[a].name) - pos.get(S.channels[b].name));
    rows = single(idxs);
    title = '⭐ Uppáhalds';
  } else if (S.group === '__recent') {
    const byName = new Map(); S.channels.forEach((c, i) => { if (!byName.has(c.name)) byName.set(c.name, i); });
    rows = single((S.per.recent || []).map(n => byName.get(n)).filter(i => i !== undefined));
    title = '🕘 Nýlegt';
  } else if (S.group === '__today') {
    for (const f of todayFav()) {
      rows.push({ type: 'm', f });
      if (S.openMatches.has(f.id)) {
        const sub = makeRows((f.channels || []).map(c => c.idx).filter(i => S.channels[i]), { sort: false });
        sub.forEach(r => { r.sub = true; rows.push(r); });
        if (!sub.length) rows.push({ type: 'none' });
      }
    }
    title = '⚽ Beint í dag';
  } else if (S.group === '__all') {
    const order = visibleGroups().map(g => g.name);
    const rank = new Map(order.map((g, i) => [g, i]));
    const idxs = [];
    S.channels.forEach((c, i) => { if (!hidden.has(c.group) && isLiveCh(c)) idxs.push(i); });
    idxs.sort((a, b) => (rank.get(S.channels[a].group) ?? 1e9) - (rank.get(S.channels[b].group) ?? 1e9) || a - b);
    rows = makeRows(idxs);
    title = '📺 Allar rásir';
  } else {
    const idxs = [];
    S.channels.forEach((c, i) => { if (c.group === S.group && isLiveCh(c)) idxs.push(i); });
    const mode = folderMode(S.group);
    rows = makeRows(idxs, { sort: mode === 'az' });
    if (mode === 'custom') {
      const order = ((S.per.folderOrder || {})[S.group]) || [];
      const pos = new Map(order.map((b, i) => [b, i]));
      rows = rows.map((r, i) => [r, pos.has(r.base) ? pos.get(r.base) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    }
    title = S.group;
  }
  S.list = rows;
  S.hs = [];                       // heights are estimated below, then measured
  $('#listTitle').textContent = title;
  renderHead(q);
  layoutRows();
  S.sel = Math.max(0, rowOf(S.current));
  renderEmpty();
  renderRows(true);
}

// the right side of the list header: sort picker, arrange button and the mark toolbar
function renderHead(q) {
  const n = S.list.filter(r => r.v).length;
  // arranging needs more than one row and a folder/favourites list – leaving that (a search,
  // a single row left) must end the mode, or a click would mark rows with no way back
  const canArrange = n > 1 && !q && (S.group === '__fav' || isRealGroup(S.group));
  if (S.favEdit && !canArrange) { S.favEdit = false; S.marks.clear(); S.markAnchor = -1; }
  let extra = '';
  if (q && isRealGroup(S.group)) extra = `<button class="mini" id="searchScope">${S.searchAll ? 'Bara í möppu' : 'Leita í öllum'}</button>`;
  else if (S.group === '__fav' && !q && n > 1) extra = `<button class="mini ${S.favEdit ? 'on' : ''}" id="favEdit">${S.favEdit ? '✓ Búið' : '↕ Raða'}</button>`;
  else if (isRealGroup(S.group) && !q && n > 1) {
    const m = folderMode(S.group);
    extra = `<select class="mini" id="folderSort" title="Röðun í þessari möppu"><option value="az" ${m === 'az' ? 'selected' : ''}>A–Ö</option><option value="provider" ${m === 'provider' ? 'selected' : ''}>Eins og áskriftin</option><option value="custom" ${m === 'custom' ? 'selected' : ''}>Mín röð</option></select><button class="mini ${S.favEdit ? 'on' : ''}" id="favEdit">${S.favEdit ? '✓ Búið' : '↕ Raða'}</button>`;
  }
  if (S.favEdit) {
    const marked = S.marks.size;
    // nothing marked yet: say how to mark instead of showing dead buttons
    extra += marked
      ? `<span class="mcount">${marked} valdar</span><button class="mini" id="mkTop" title="Setja valdar rásir efst">⤒ Efst</button><button class="mini" id="mkClear" title="Afmerkja allt">✕</button>`
      : `<span class="mcount hint">smelltu á rás</span>`;
  }
  $('#listCount').innerHTML = (S.group === '__today' && !q ? `${todayFav().length} leikir ` : n ? `${n} rásir ` : '') + extra;
  const sc = $('#searchScope'); if (sc) sc.onclick = () => { S.searchAll = !S.searchAll; buildList(); };
  const fe = $('#favEdit'); if (fe) fe.onclick = () => {
    S.favEdit = !S.favEdit;
    if (!S.favEdit) S.marks.clear();
    // starting to arrange a folder by hand switches it to "Mín röð", starting from what is shown now
    if (S.favEdit && isRealGroup(S.group) && folderMode(S.group) !== 'custom') saveFolderOrder(S.list.map(r => r.base));
    buildList();
  };
  const fs = $('#folderSort'); if (fs) fs.onchange = (e) => {
    const m = e.target.value;
    if (m === 'custom' && !((S.per.folderOrder || {})[S.group] || []).length) saveFolderOrder(S.list.map(r => r.base));
    S.per.folderSort = { ...(S.per.folderSort || {}), [S.group]: m };
    window.api.updatePer({ folderSort: S.per.folderSort });
    buildList();
  };
  const mt = $('#mkTop'); if (mt) mt.onclick = () => moveMarked(S.sel, 'top');
  const mc = $('#mkClear'); if (mc) mc.onclick = () => { S.marks.clear(); renderHead(q); renderRows(true); };
}

function renderEmpty() {
  const el = $('#emptyList');
  const snap = S.snap;
  let html = '';
  if (snap && !snap.playlists.length) {
    const addr = (snap.web.addresses[0] || `http://localhost:${snap.web.port || 8899}`);
    html = `<div style="font-size:40px">🐴</div><b>Velkominn í Mulehead!</b><br>Settu inn playlista í gegnum vafra:<br>
      <code>${esc(addr)}</code><br><small>Virkar líka úr símanum ef hann er á sama neti.</small><br>
      <button class="primary" id="emptyOpen">🌐 Opna vefsíðuna</button>`;
  } else if (snap && snap.data.loading && !S.channels.length) {
    html = '<div class="spinner" style="margin:0 auto 12px"></div>Sæki playlista…';
  } else if (!S.list.length && (S.channels.length || S.group === '__today')) {
    html = S.search ? 'Engin rás fannst.' : (S.group === '__fav' ? 'Engar uppáhaldsrásir ennþá.<br>Smelltu á ☆ við rás til að bæta henni við.'
      : S.group === '__today' ? ((S.sports && S.sports.cfg && S.sports.cfg.teams.length) ? 'Liðin þín spila ekki í dag. ⚽' : 'Engin uppáhaldslið ennþá.<br>Opnaðu <b>⚽ Leikir</b> og smelltu á ☆ við lið.') : 'Ekkert hér.');
  }
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
  const b = $('#emptyOpen'); if (b) b.onclick = openWeb;
}

function rowEpgIdx(row) { return row.v.find(i => progsFor(i).length) ?? row.p; }
// ---------- chips ----------
// The small quality chips on a merged row. "Main" = the version the provider lists without
// any quality word (checked 9. nóv.: those are 720p and 1080p, so "SD" would be a lie), and
// a word that is already in the channel name is dropped ("SkyGo" on "Sky Sport …" → "Go").
function chipLabel(v) {
  const c = S.channels[v];
  if (!c) return '';
  const sp = splitName(c.name);
  const t = sp.tag || 'Main';
  const base = sp.base.toLowerCase();
  const words = t.replace(/([a-záéíóúýðþæö])([A-ZÁÉÍÓÚÝÐÞÆÖ])/g, '$1 $2').split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const keep = words.filter(w => w.length < 3 || !base.includes(w.toLowerCase()));
    if (keep.length) return keep.join(' ');
  }
  return t;
}

// ---------- channel health ----------
// A stream that fails is remembered: yellow the first time, red when it happens again, and
// the mark wears off again on its own (10 min of clean playback takes one point back, and
// nothing older than a week is kept). Only real playback trouble counts – a provider that
// refuses the connection is talking about the subscription, not about this channel.
const HEALTH_KEEP_MS = 7 * 864e5;
const HEALTH_KEEP_N = 200;
const CLEAN_CREDIT_SEC = 600;
const GREEN_OK_SEC = 1800;     // half an hour without a single problem earns a green mark
function healthOf(name) { return (S.per.chanHealth || {})[name] || null; }
function healthLevel(name) {
  const h = healthOf(name);
  if (!h) return 0;
  if (h.n >= 2) return 2;      // red: trouble more than once
  if (h.n === 1) return 1;     // yellow: trouble once
  return (h.ok || 0) >= GREEN_OK_SEC ? 3 : 0;   // green: stable for half an hour
}
function saveHealth(map) {
  const now = Date.now();
  const keep = Object.entries(map).filter(([, h]) => h && (h.n > 0 || (h.ok || 0) >= GREEN_OK_SEC) && now - (h.last || 0) < HEALTH_KEEP_MS)
    .sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, HEALTH_KEEP_N);
  S.per.chanHealth = Object.fromEntries(keep);
  window.api.updatePer({ chanHealth: S.per.chanHealth });
}
function markTrouble(info) {
  const c = S.channels[S.current];
  if (!c) return;
  const now = Date.now();
  const map = { ...(S.per.chanHealth || {}) };
  const prev = map[c.name];
  // a channel the player gave up on is red at once (severe), it does not wait for a second failure
  const severe = !!(info && info.severe);
  // one mark a minute is enough: a stream that fails ten times in a row is still one problem
  // (a green mark records no trouble, so the first failure after it always counts)
  if (!severe && prev && prev.n > 0 && now - (prev.last || 0) < 60000) return;
  const n = severe ? Math.max(2, (prev && prev.n) || 0) : ((prev && prev.n) || 0) + 1;
  map[c.name] = { n, last: now, why: (info && info.reason) || '' };
  saveHealth(map);
  log(`Athugasemd á ${c.name}: ${(info && info.reason) || 'vandi'} (${n}. sinn)`);
  renderRows(true);
}

// The player gave up on the channel (three failed attempts, see Player.dead): say so, mark it
// red in the list and let the overlay offer ↻ – no point in a spinner that never ends.
function onChannelDead(info) {
  const c = S.channels[S.current];
  markTrouble({ reason: (info && info.reason) || 'rásin er dauð', severe: true });
  toast(`${c ? c.name + ' – ' : ''}${(info && info.reason) || 'rásin svarar ekki'}`);
  log(`⛔ ${c ? c.name : 'Rás'} er merkt rauð – hætti að reyna`);
}
// clean playback wears the mark off again: one point per 10 minutes without trouble, and
// half an hour without a single problem earns the green "vel virk" mark (which is lost the
// moment the channel fails again – markTrouble writes yellow/red over it).
function creditClean() {
  if (S.current < 0 || player.state !== 'playing' || player.attempt > 0) { S.clean = { name: '', sec: 0 }; return; }
  // a paused picture, a buffer bank or a buffering stop is not clean time: nothing ran
  if (video.paused || player.hold || player.bank || player.bufferTimer) return;
  const name = S.channels[S.current] && S.channels[S.current].name;
  if (!name) return;
  if (S.clean.name !== name) S.clean = { name, sec: 0 };
  if (++S.clean.sec % CLEAN_CREDIT_SEC) return;
  const map = { ...(S.per.chanHealth || {}) };
  const h = map[name];
  if (!h) {
    if (S.clean.sec < GREEN_OK_SEC) return;
    map[name] = { n: 0, ok: S.clean.sec, last: Date.now() };
    saveHealth(map);
    log(`Grænt merki: ${name} (${Math.round(S.clean.sec / 60)} mín án vandræða)`);
    renderRows(true);
    return;
  }
  if (h.n > 1) { map[name] = { ...h, n: h.n - 1, last: Date.now() }; }
  else if (h.n === 1) delete map[name];
  else { map[name] = { ...h, ok: S.clean.sec, last: Date.now() }; }   // green stays green
  saveHealth(map);
  log(`Létt á merki: ${name} (${map[name] ? map[name].n : 0})`);
  renderRows(true);
}

// ---------- row heights ----------
// A merged row can carry more chips than fit on one line. Those wrap, so the row grows and
// every row below it moves down: the list keeps an array of heights/tops instead of one ROW.
function chipAreaWidth() {
  const box = $('#chlist');
  const w = (box && box.clientWidth) || 380;
  return Math.max(150, w - 150);
}
function estRowH(row) {
  if (!row || !row.v || row.v.length < 2) return ROW;
  let w = 0;
  for (const v of row.v) w += chipLabel(v).length * 6.1 + 16;   // text + padding + gap
  return ROW + (Math.max(1, Math.ceil(w / chipAreaWidth())) - 1) * 17;
}
function layoutRows() {
  const tops = [], hs = [];
  let y = 0;
  for (let r = 0; r < S.list.length; r++) {
    const h = S.hs[r] || estRowH(S.list[r]);
    hs[r] = h; tops[r] = y; y += h;
  }
  S.hs = hs; S.tops = tops;
  const sp = $('#chspacer'); if (sp) sp.style.height = y + 'px';
  return y;
}
// index of the first row whose bottom edge is below y
function rowAt(y) {
  const tops = S.tops, hs = S.hs, n = tops.length;
  if (!n) return 0;
  if (y <= 0) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tops[m] + hs[m] <= y) lo = m + 1; else hi = m; }
  return lo;
}
// a row can be taller than the guess (the chips wrapped): take the real height and re-lay out
function measureRows() {
  if (S.measurePass) return;
  let changed = false;
  for (const el of $('#chrows').children) {
    const r = +el.dataset.r;
    if (!(r >= 0) || !S.list[r] || !S.list[r].v) continue;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h > 20 && Math.abs(h - (S.hs[r] || ROW)) > 1) { S.hs[r] = h; changed = true; }
  }
  if (!changed) return;
  layoutRows();
  S.measurePass = true;
  try { renderRows(true); } finally { S.measurePass = false; }
}



function renderRows(force) {
  const box = $('#chlist');
  const top = box.scrollTop, h = box.clientHeight || 600;
  const first = Math.max(0, rowAt(top) - 5);
  const last = Math.min(S.list.length, rowAt(top + h) + 6);
  const key = first + ':' + last + ':' + S.hs.length;
  if (!force && renderRows.key === key) return;
  renderRows.key = key;
  const fav = new Set(S.per.favorites || []);
  let html = '';
  const pos = (r) => `top:${S.tops[r] || 0}px;min-height:${S.hs[r] || ROW}px`;
  for (let r = first; r < last; r++) {
    const row = S.list[r];
    if (row.type === 'm') {
      const f = row.f;
      const when = f.halftime ? '<div class="when ht">Hálfl.</div>' : f.state === 'in' ? `<div class="when live">${esc(f.clock || 'Í gangi')}</div>` : f.state === 'post' ? '<div class="when">Lokið</div>' : `<div class="when">${fmtTime(f.start)}</div>`;
      const sc = f.state !== 'pre' ? ` ${esc(f.home.score)}–${esc(f.away.score)}` : '';
      html += `<div class="ch match ${r === S.sel ? 'sel' : ''}" style="${pos(r)}" data-r="${r}" data-match="${esc(f.id)}">${when}
        <div class="nmatch">${esc(f.home.name)} – ${esc(f.away.name)}${sc}<small>${esc(f.leagueName)} · ${(f.channels || []).length ? '📺 ' + f.channels.length + ' rásir' : 'engin rás fannst'}</small></div>
        <div class="star">${S.openMatches.has(f.id) ? '▾' : '▸'}</div></div>`;
      continue;
    }
    if (row.type && row.type !== 'none') { html += vodRowHtml(row, r); continue; }
    if (row.type === 'none') { html += `<div class="ch sub" style="${pos(r)}"><span class="muted">Engin rás fannst í áskriftinni fyrir þennan leik.</span></div>`; continue; }
    const i = row.p, c = S.channels[i];
    const { now } = nowNext(rowEpgIdx(row));
    const sn = shifted(now);
    const pct = sn ? Math.max(0, Math.min(100, (Date.now() - sn[0]) / (sn[1] - sn[0]) * 100)) : 0;
    const playing = row.v.includes(S.current);
    const isFav = row.v.some(v => fav.has(S.channels[v].name));
    const marked = S.favEdit && S.marks.has(row.base);
    let chips = '';
    if (row.v.length > 1) {
      const seen = {};
      chips = `<div class="chips">${row.v.map(v => {
        let t = chipLabel(v);
        seen[t] = (seen[t] || 0) + 1;
        if (seen[t] > 1) t += ' ' + seen[t];
        const hl = healthLevel(S.channels[v].name);
        const hh = healthOf(S.channels[v].name);
        const why = hl === 3 ? ' · vel virk í 30 mín' : hl ? ` · ${hl >= 2 ? '⚠ vandamál' : 'vandamál einu sinni'}${hh && hh.why ? ' (' + esc(hh.why) + ')' : ''}` : '';
        const cls = hl >= 2 ? 'bad' : hl === 1 ? 'warn' : hl === 3 ? 'ok' : '';
        return `<span class="chip ${v === S.current ? 'on' : ''} ${cls}" data-play="${v}" title="${esc(S.channels[v].name)}${why}">${esc(t)}</span>`;
      }).join('')}</div>`;
    }
    // the whole row carries the worst mark of its versions, so a broken stream is visible
    // even when another version of the same channel plays fine (bad beats warn beats green)
    const lvls = row.v.map(v => healthLevel(S.channels[v].name));
    const lvl = lvls.includes(2) ? 2 : lvls.includes(1) ? 1 : lvls.includes(3) ? 3 : 0;
    const hlv = lvl === 3 ? 'ok' : lvl >= 2 ? 'bad' : lvl === 1 ? 'warn' : '';
    const right = S.favEdit
      ? `<div class="mv"><span data-top="${r}" title="Setja efst">⤒</span><span data-up="${r}" title="Upp">▲</span><span data-down="${r}" title="Niður">▼</span></div>`
      : `<div class="star ${isFav ? 'on' : ''}" data-star="${r}" title="Uppáhalds">${isFav ? '⭐' : '☆'}</div>`;
    html += `<div class="ch ${row.sub ? 'sub' : ''} ${r === S.sel ? 'sel' : ''} ${playing ? 'playing' : ''} ${hlv} ${marked ? 'mark' : ''}" style="${pos(r)}" data-r="${r}">
      <div class="num">${c.n}</div>
      <div class="logo">${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initials(sortKey(row.base)))}'}))">` : `<span>${esc(initials(sortKey(row.base)))}</span>`}</div>
      <div class="meta"><div class="name">${esc(row.base)}</div>${chips || (sn ? `<div class="prog">${esc(sn[2])}</div>` : '')}${sn ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
      ${right}
    </div>`;
  }
  $('#chrows').innerHTML = html;
  measureRows();
}
$('#chlist').addEventListener('scroll', () => renderRows(false));
window.addEventListener('resize', () => renderRows(true));

$('#chrows').addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (star) { toggleFav(S.list[+star.dataset.star]); return; }
  const mt = e.target.closest('[data-top]'), up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
  if (mt || up || down) {
    // ⤒ = the marked rows go to the top, ▲▼ = one step (marked rows move together)
    const el = mt || up || down;
    const r = +(el.dataset.top || el.dataset.up || el.dataset.down);
    moveMarked(r, mt ? 'top' : up ? -1 : 1);
    return;
  }
  const vrow = e.target.closest('[data-vr]');
  if (vrow) { S.sel = +vrow.dataset.vr; onVodRowClick(S.list[S.sel]); return; }
  const mrow = e.target.closest('[data-match]');
  if (mrow) { const id = mrow.dataset.match; if (S.openMatches.has(id)) S.openMatches.delete(id); else S.openMatches.add(id); buildList(); return; }
  const chip = e.target.closest('[data-play]');
  const row = e.target.closest('.ch'); if (!row || !S.list[+row.dataset.r] || !S.list[+row.dataset.r].v) return;
  S.sel = +row.dataset.r;
  if (chip) { playIdx(+chip.dataset.play); return; }
  if (S.favEdit) {
    if (e.shiftKey) markRange(S.sel);              // Shift = the whole range
    else { S.markAnchor = S.sel; toggleMark(S.sel); }
    return;
  }
  const rw = S.list[S.sel];
  playIdx(rw.v.includes(S.current) ? S.current : rw.p);
});
$('#chrows').addEventListener('mouseover', (e) => {
  const row = e.target.closest('.ch'); if (!row) return;
  const rw = S.list[+row.dataset.r];
  if (S.current < 0 && rw && rw.v) renderInfo(rowEpgIdx(rw));
});

function toggleFav(row) {
  if (!row) return;
  let fav = [...(S.per.favorites || [])];
  const names = row.v.map(v => S.channels[v].name);
  if (names.some(n => fav.includes(n))) fav = fav.filter(n => !names.includes(n));
  else fav.push(S.channels[row.p].name);
  S.per.favorites = fav;
  window.api.updatePer({ favorites: fav });
  if (S.group === '__fav') buildList(); else renderRows(true);
  renderGroups();
}

// ---------- arranging (mark rows, then move them) ----------
// Marking only works while the list is in arrange mode (↕ Raða), so a plain click still
// plays a channel the rest of the time. A plain click toggles one row, Shift+click takes the
// whole range from the last row clicked (a match weekend is 40 rows – clicking each is silly).
function toggleMark(r) {
  const row = S.list[r];
  if (!row || !row.v) return;
  if (S.marks.has(row.base)) S.marks.delete(row.base); else S.marks.add(row.base);
  S.sel = r;
  renderHead(S.search.trim().toLowerCase());
  renderRows(true);
}

function markRange(to) {
  const from = S.markAnchor >= 0 && S.markAnchor < S.list.length ? S.markAnchor : to;
  const a = Math.min(from, to), b = Math.max(from, to);
  for (let i = a; i <= b; i++) { const row = S.list[i]; if (row && row.v && row.base) S.marks.add(row.base); }
  S.sel = to;
  renderHead(S.search.trim().toLowerCase());
  renderRows(true);
}

// the marked rows (in list order) – or just the row of the arrow that was clicked
function markedRows(anchor) {
  const sel = [];
  S.list.forEach((row, i) => { if (row.v && row.v.length && S.marks.has(row.base)) sel.push([row, i]); });
  if (sel.length) return sel;
  const a = S.list[anchor];
  return a && a.v ? [[a, anchor]] : [];
}

function applyRowOrder(order) {
  if (S.group === '__fav') {
    const names = order.map(r => S.channels[r.p].name);
    // favourites that aren't part of this playlist stay where they were
    const rest = (S.per.favorites || []).filter(n => !names.includes(n));
    S.per.favorites = [...names, ...rest];
    window.api.updatePer({ favorites: S.per.favorites });
  } else saveFolderOrder(order.map(r => r.base));
}

// dir = -1 (up), 1 (down) or 'top'. Several marked rows move as one block and keep their
// own order; a row that has nothing marked just moves by itself.
function moveMarked(anchor, dir) {
  const sel = markedRows(anchor);
  if (!sel.length) return;
  const mine = new Set(sel.map(([, i]) => i));
  let order = S.list.slice();
  if (dir === 'top') {
    order = [...sel.map(([row]) => row), ...order.filter((_, i) => !mine.has(i))];
  } else {
    order = order.slice();
    const step = sel.map(([, i]) => i).sort((a, b) => dir < 0 ? a - b : b - a);
    for (const i of step) {
      const t = i + dir;
      if (t < 0 || t >= order.length || mine.has(t)) continue;
      [order[i], order[t]] = [order[t], order[i]];
      mine.delete(i); mine.add(t);
    }
  }
  if (order.every((row, i) => row === S.list[i])) return;       // already where it belongs
  applyRowOrder(order);
  const keep = sel[0][0].base;              // stay where the user was looking
  buildList();
  const nr = S.list.findIndex(row => row.base === keep);
  if (nr >= 0) { S.sel = nr; scrollToSel(); }
}

function scrollToSel() {
  const box = $('#chlist');
  const y = S.tops[S.sel] || 0, h = S.hs[S.sel] || ROW;
  if (y < box.scrollTop) box.scrollTop = y;
  else if (y + h > box.scrollTop + box.clientHeight) box.scrollTop = y + h - box.clientHeight;
  renderRows(true);
}

// ---------- playback ----------
const video = $('#video');
const log = (m) => { try { window.api.log(m); } catch { } };
const player = new Player(video, { onStatus: onPlayerStatus, log, onBank, onDead: onChannelDead });
// A channel played through the bundled ffmpeg (audio the player can't decode) keeps the
// provider connection open a moment longer. The player waits for it to let go before a
// new stream is opened – otherwise the provider sees two streams at the same time.
const releaseProvider = () => window.api.vodStop().catch(() => { });
let lastLogged = '';
setInterval(() => {
  if (S.current < 0 || player.state === 'idle') return;
  const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
  // frames + pause + stream clock: a frozen picture is visible here even when the buffer looks fine
  const fr = player.frozenFor ? player.frozenFor() : 0;
  // while banking the picture stands still on purpose: that is neither a pause nor a freeze
  const b = player.bank;
  log(`Staða: ${player.state}, buffer ${player.bufferedAhead().toFixed(1)} sek, ${video.videoHeight || '?'}p, tími ${video.currentTime.toFixed(0)}` +
    `${q ? `, birtir rammar ${q.totalVideoFrames}, töpuð ${q.droppedVideoFrames}` : ''}` +
    `${b ? `, HLEÐ BUFFER ${Math.round(b.ahead)}/${Math.round(b.from + b.want)} sek` : ''}` +
    `${video.paused && !b ? ', PAUSA' : ''}${!b && fr > 2.5 ? `, ENGINN RAMMI í ${fr.toFixed(1)} sek` : ''}`);
}, 60000);

function onPlayerStatus(state, msg) {
  const key = state + ':' + (state === 'buffering' ? '' : msg);
  if (key !== lastLogged) { lastLogged = key; if (state !== 'buffering' || !/%/.test(msg)) log(`→ ${state}${msg ? ' – ' + msg : ''}`); }
  const ov = $('#overlay');
  // 'dead': the player gave up (see Player.dead) – no spinner, one plain message and ↻
  const dead = state === 'dead';
  ov.classList.toggle('dead', dead);
  $('#overlayRetry').classList.toggle('hidden', !dead);
  $('#overlayOther').classList.toggle('hidden', !dead);
  if (state === 'playing' || state === 'idle') ov.classList.add('hidden');
  else { ov.classList.remove('hidden'); $('#overlayText').textContent = dead ? `⛔ ${msg}` : msg; }
  $('#idle').classList.toggle('hidden', state !== 'idle');
  window.api.setPlaying(state !== 'idle' && !dead);
}

function playIdx(idx) {
  const c = S.channels[idx]; if (!c) return;
  S.current = idx;
  if (S.vodPlaying) releaseProvider();     // a movie may still hold the provider connection
  S.vodPlaying = null; wrap.classList.remove('vod', 'vodx');
  const buf = Number(S.settings.bufferSec) || 60;
  log(`=== Spila: ${c.name} (${c.group}), buffer ${buf} sek ===`);
  player.play(c.url, {
    bufferSec: buf, growSlow: S.settings.growSlow !== false, ffmpegBase: S.ffmpegBase, release: releaseProvider,
    liveRelay: S.settings.liveRelay !== 'off', onTrouble: markTrouble, onDead: onChannelDead
  });
  const recent = [c.name, ...(S.per.recent || []).filter(n => n !== c.name)].slice(0, 40);
  S.per.recent = recent;
  const patch = { recent, lastChannel: c.name };
  // remember the folder the channel lives in, so the app reopens there (also after a search
  // or a pick from "Beint í dag" – the list should be waiting where the channel was found)
  if (isRealGroup(c.group) && S.per.lastGroup !== c.group) { S.per.lastGroup = c.group; patch.lastGroup = c.group; }
  window.api.updatePer(patch);
  renderRows(true); renderGroups(); renderInfo(idx); showOsd();
  document.title = `${c.name} – Mulehead`;
  // a room follows whoever changed channel last – but not an echo of their own change
  if (S.chFollow) S.chFollow = false;
  else if (sync.room) sync.setChannel();
}

function zap(dir) {
  if (!S.list.length) return;
  let r = rowOf(S.current);
  if (r < 0) r = S.sel;
  r = (r + dir + S.list.length) % S.list.length;
  for (let k = 0; k < S.list.length && !S.list[r].v; k++) r = (r + dir + S.list.length) % S.list.length;
  if (!S.list[r].v) return;
  S.sel = r; scrollToSel(); playIdx(S.list[r].p);
}

function renderInfo(idx) {
  const c = S.channels[idx];
  if (!c) { $('#nowInfo').innerHTML = ''; $('#epgList').innerHTML = ''; return; }
  const { now, next } = nowNext(idx);
  const sn = shifted(now), sx = shifted(next);
  $('#nowInfo').innerHTML = `<div class="t">${esc(c.name)} <span class="muted" style="font-weight:400;font-size:13px">· ${esc(c.group)}</span></div>
    ${sn ? `<div class="p">▶ ${fmtTime(sn[0])}–${fmtTime(sn[1])} &nbsp;<b>${esc(sn[2])}</b></div>${sn[3] ? `<div class="d">${esc(sn[3])}</div>` : ''}` : '<div class="p muted">Engin dagskrá fyrir þessa rás</div>'}
    ${sx ? `<div class="p muted">Næst: ${fmtTime(sx[0])} ${esc(sx[2])}</div>` : ''}`;
  const list = progsFor(idx).map(shifted).filter(p => p[1] > Date.now() - 2 * 3600e3).slice(0, 80);
  let html = '', lastDay = '';
  for (const p of list) {
    const d = dayName(p[0]);
    if (d !== lastDay) { html += `<div class="epday">${esc(d)}</div>`; lastDay = d; }
    const cls = p[1] < Date.now() ? 'past' : (p[0] <= Date.now() ? 'now' : '');
    html += `<div class="ep ${cls}"><div class="tm">${fmtTime(p[0])}</div><div><div class="ti">${esc(p[2])}</div>${p[3] && cls === 'now' ? `<div class="ds">${esc(p[3])}</div>` : ''}</div></div>`;
  }
  $('#epgList').innerHTML = html;
  const nowEl = $('#epgList .ep.now'); if (nowEl) nowEl.scrollIntoView({ block: 'center' });
}

let osdTimer = null;
function showOsd() {
  const c = S.channels[S.current]; if (!c) return;
  const { now, next } = nowNext(S.current);
  const sn = shifted(now), sx = shifted(next);
  const osd = $('#osd');
  osd.innerHTML = `${c.logo ? `<img src="${esc(c.logo)}" onerror="this.remove()">` : ''}<div><div class="t">${c.n}. ${esc(c.name)}</div>
    ${sn ? `<div class="p">${fmtTime(sn[0])}–${fmtTime(sn[1])} · ${esc(sn[2])}</div>` : ''}${sx ? `<div class="p muted">Næst: ${fmtTime(sx[0])} ${esc(sx[2])}</div>` : ''}</div>`;
  osd.classList.remove('hidden');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osd.classList.add('hidden'), 4000);
}

// a short message over the picture (channel follow, room announcements)
let toastTimer = null;
function toast(text) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast hidden'; wrap.appendChild(el); }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 5000);
}

// controls
const wrap = $('#playerWrap');
const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.requestFullscreen(); };
video.addEventListener('dblclick', toggleFull);
$('#cFull').onclick = toggleFull;
$('#cRetry').onclick = () => { player.retry(); showOsd(); };
$('#overlayRetry').onclick = () => { player.retry(); showOsd(); };
// the channel list sits right next to the picture, but in fullscreen it is hidden: leave
// fullscreen, put the selection on this channel's row and say what to do
$('#overlayOther').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  const r = rowOf(S.current);
  if (r >= 0) { S.sel = r; scrollToSel(); }
  toast('Veldu aðra rás í listanum');
};
$('#cBank').onclick = () => doBank();
$('#cPip').onclick = () => { if (document.pictureInPictureElement) document.exitPictureInPicture(); else video.requestPictureInPicture().catch(() => { }); };
$('#cMute').onclick = () => { video.muted = !video.muted; updVol(); };
$('#cVol').oninput = (e) => { video.volume = +e.target.value; video.muted = false; updVol(); localStorage.setItem('vol', e.target.value); };
function updVol() { $('#cMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; }
try { const v = localStorage.getItem('vol'); if (v !== null) { video.volume = +v; $('#cVol').value = v; } } catch { }
let ctlTimer = null;
wrap.addEventListener('mousemove', () => {
  wrap.classList.add('showctl'); clearTimeout(ctlTimer);
  ctlTimer = setTimeout(() => wrap.classList.remove('showctl'), 2500);
  if (document.fullscreenElement && S.current >= 0 && $('#osd').classList.contains('hidden')) showOsd();
});
setInterval(() => {
  const info = $('#cInfo'), bankBtn = $('#cBank');
  if (S.current < 0 || player.state !== 'playing') {
    info.textContent = ''; info.className = 'cinfo'; bankBtn.classList.add('hidden'); return;
  }
  const a = player.bufferedAhead();
  const w = video.videoWidth, h = video.videoHeight;
  // the feed went silent (Wi-Fi gone) while the picture keeps running from the buffer: count
  // down what is left instead of pretending that everything is fine
  const silent = player.state === 'playing' ? player.silentFor() : 0;
  if (silent > 2.5 && a > 0.5) {
    info.className = 'cinfo bad';
    info.textContent = `${h ? h + 'p · ' : ''}ekkert merki – ${Math.round(a)} sek eftir`;
  } else {
    // 3/4 of the target is a healthy cushion, a third is thin, below that the next hiccup stops the picture
    const mark = bankMark();
    const cls = a >= mark * 0.75 ? 'good' : a >= mark * 0.35 ? 'warn' : 'bad';
    const word = cls === 'good' ? 'gott' : cls === 'warn' ? 'þunnur' : 'hætta';
    info.className = 'cinfo ' + cls;
    info.textContent = `${w && h ? h + 'p · ' : ''}buffer ${Math.round(a)} sek · ${word}`;
  }
  // live only, and only while something is actually playing; a movie buffers by itself
  const live = !player.vod && player.state === 'playing' && !player.bufferTimer;
  bankBtn.classList.toggle('hidden', !live);
  const need = Math.max(0, Math.round(bankMark() - a));
  bankBtn.textContent = player.bank ? `▶ Spila núna` : (need > 2 ? `⏸ Hlaða ${need} sek` : '⏸ Hlaða');
}, 1000);
// clean playback wears a health mark off again (see creditClean)
setInterval(creditClean, 1000);

// keyboard
document.addEventListener('keydown', (e) => {
  const inInput = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (e.key === 'Escape') {
    if (inInput) { document.activeElement.blur(); return; }
    document.querySelectorAll('.modal:not(.hidden), .drawer:not(.hidden)').forEach(m => m.classList.add('hidden'));
    return;
  }
  if (inInput && !(document.activeElement === $('#search') && /ArrowUp|ArrowDown|Enter/.test(e.key))) return;
  const full = !!document.fullscreenElement;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    if (full) { zap(d); return; }
    S.sel = Math.max(0, Math.min(S.list.length - 1, S.sel + d));
    scrollToSel();
    if (S.current < 0 && S.list[S.sel] && S.list[S.sel].v) renderInfo(rowEpgIdx(S.list[S.sel]));
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault(); zap(e.key === 'PageDown' ? 1 : -1);
  } else if (e.key === 'Enter') {
    const rw = S.list[S.sel];
    if (rw && rw.type && rw.type !== 'm' && rw.type !== 'none') onVodRowClick(rw);
    else if (rw && rw.type === 'm') { const id = rw.f.id; if (S.openMatches.has(id)) S.openMatches.delete(id); else S.openMatches.add(id); buildList(); }
    else if (rw && rw.v) {
      if (S.favEdit) toggleMark(S.sel);                       // arrange mode: Enter marks the row
      else { playIdx(rw.p); if (inInput) document.activeElement.blur(); }
    }
  } else if (!inInput && e.key.toLowerCase() === 'f') { toggleFull(); }
  else if (!inInput && e.key.toLowerCase() === 'm') { video.muted = !video.muted; updVol(); }
  else if (!inInput && e.key.toLowerCase() === 'r') { player.retry(); showOsd(); }
  else if (!inInput && e.key.toLowerCase() === 'b') { doBank(); }
  else if (!inInput && e.key.toLowerCase() === 'i') { showOsd(); }
  else if (!inInput && e.key === '*') { if (S.current >= 0) toggleFav(S.current); }
});

$('#search').addEventListener('input', (e) => {
  S.search = e.target.value; buildList(); renderGroups(); $('#chlist').scrollTop = 0;
});

// ---------- state from main ----------
function applySnap(snap) {
  const prevId = S.snap && S.snap.data.id;
  S.snap = snap;
  S.settings = snap.settings;
  if (snap.per) S.per = snap.per;
  if (snap.data.channels) {
    const curName = S.channels[S.current] && S.channels[S.current].name;
    S.channels = snap.data.channels;
    S.groups = snap.data.groups;
    S.liveGroups = new Set(S.channels.filter(isLiveCh).map(c => c.group));
    S.vod = {};
    if (prevId !== snap.data.id) {
      S.current = -1;
      // reopen the folder that was open last time
      const lg = snap.per && snap.per.lastGroup;
      const hiddenG = new Set((snap.per && snap.per.hiddenGroups) || []);
      S.group = lg && (lg.startsWith('__') || (S.groups.some(g => g.name === lg) && !hiddenG.has(lg))) ? lg : '__all';
      if (player.url) player.stop();
      // preselect last channel
      const last = snap.per && snap.per.lastChannel;
      if (last) S.lastIdx = S.channels.findIndex(c => c.name === last);
    } else if (curName) {
      S.current = S.channels.findIndex(c => c.name === curName);
    }
  }
  // playlist dropdown
  $('#plSelect').innerHTML = snap.playlists.map(p => `<option value="${p.id}" ${p.active ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option>Enginn playlisti</option>';
  // banner
  const b = $('#banner');
  if (snap.data.error) { b.className = 'banner'; b.textContent = '⚠️ ' + snap.data.error; }
  else if (snap.data.loading && S.channels.length) { b.className = 'banner info'; b.textContent = '🔄 Uppfæri playlista…'; }
  else b.className = 'banner hidden';
  renderGroups(); buildList();
  if (S.lastIdx >= 0 && S.current < 0) {
    const r = rowOf(S.lastIdx); if (r >= 0) { S.sel = r; scrollToSel(); renderInfo(S.lastIdx); }
    S.lastIdx = -1;
  }
  if (!$('#settingsModal').classList.contains('hidden')) renderSettings();
}

window.api.on('state:changed', applySnap);
window.api.on('epg:changed', (epg) => { S.epg = epg; renderRows(true); if (S.current >= 0) renderInfo(S.current); });
window.api.on('epg:status', (st) => { if (st.loading && S.channels.length) { const b = $('#banner'); if (b.classList.contains('hidden')) { b.className = 'banner info'; b.textContent = '📺 Sæki dagskrá…'; setTimeout(() => { if (b.textContent.startsWith('📺')) b.className = 'banner hidden'; }, 15000); } } });

setInterval(() => { renderRows(true); if (S.current >= 0) renderInfo(S.current); }, 60000);

$('#plSelect').onchange = (e) => window.api.activate(e.target.value);
$('#btnRefresh').onclick = () => window.api.refresh();
function openWeb() {
  const port = S.snap && S.snap.web.port;
  if (port) window.api.openExternal(`http://localhost:${port}`);
}
$('#btnAdd').onclick = openWeb;
$('#btnGames').onclick = () => window.api.openGames();
window.api.on('open:group', (g) => {
  if (S.mode !== 'live') document.querySelector('[data-mode="live"]').click();
  S.group = g; S.search = ''; $('#search').value = '';
  renderGroups(); buildList(); $('#chlist').scrollTop = 0;
});
window.api.on('play:idx', (idx) => { if (S.channels[idx]) { if (S.mode !== 'live') document.querySelector('[data-mode="live"]').click(); playIdx(idx); const r = rowOf(idx); if (r >= 0) { S.sel = r; scrollToSel(); } } });
window.api.on('sports:changed', (snap) => { S.sports = snap; renderGroups(); if (S.group === '__today') buildList(); });

// ---------- modals ----------
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]'); if (c) { $('#' + c.dataset.close).classList.add('hidden'); if (c.dataset.close === 'groupsModal') saveGroups(); }
  if (e.target.classList.contains('modal')) { e.target.classList.add('hidden'); if (e.target.id === 'groupsModal') saveGroups(); }
});

// settings
const epgSel = $('#setEpgOff');
for (let h = -12; h <= 12; h++) epgSel.insertAdjacentHTML('beforeend', `<option value="${h * 60}">${h === 0 ? 'Engin hliðrun' : (h > 0 ? '+' : '') + h + ' klst'}</option>`);
$('#btnSettings').onclick = () => { renderSettings(); $('#settingsModal').classList.remove('hidden'); };
function renderSettings() {
  const st = S.settings;
  $('#setBuffer').value = st.bufferSec; $('#bufVal').textContent = st.bufferSec;
  $('#setFormat').value = st.format; $('#setUA').value = st.userAgent || '';
  $('#setRefresh').value = String(st.refreshHours); $('#setEpgOff').value = String(st.epgOffsetMin || 0);
  $('#setNick').value = st.nickname || '';
  $('#setRoom').value = st.syncRoom || '';
  $('#setGrow').checked = st.growSlow !== false;
  $('#setRelay').value = st.liveRelay === 'off' ? 'off' : 'always';
  $('#setSort').checked = st.sortAZ !== false;
  $('#setMerge').checked = st.mergeVariants !== false;
  const snap = S.snap;
  $('#plList').innerHTML = snap.playlists.map(p => `<div class="pl ${p.active ? 'act' : ''}">
      <div class="nm"><b>${esc(p.name)}</b><small>${p.type === 'xtream' ? 'Xtream · ' + esc(p.username) : p.type === 'file' ? 'Skrá' : 'Slóð'}${p.count ? ' · ' + p.count + ' rásir' : ''}</small></div>
      ${p.active ? '<span class="muted">Virkur</span>' : `<button data-act="${p.id}">Nota</button>`}
      <button class="danger" data-del="${p.id}" title="Eyða">🗑</button></div>`).join('') || '<p class="muted">Engir playlistar ennþá.</p>';
  const addrs = snap.web.addresses;
  $('#webInfo').innerHTML = snap.web.port ? `<p>Opnaðu í vafra til að bæta við eða breyta playlistum:</p>
      ${addrs.map(a => `<div class="webaddr">${esc(a)}</div>`).join('')}<div class="webaddr">http://localhost:${snap.web.port} <span class="muted">(á þessari tölvu)</span></div>
      <div class="row"><button class="primary" id="setOpenWeb">🌐 Opna vefsíðuna</button></div>`
    : `<p class="muted">Vefsíðan náði ekki að ræsa: ${esc(snap.web.error || '')}</p>`;
  const ow = $('#setOpenWeb'); if (ow) ow.onclick = openWeb;
  window.api.info().then(i => { $('#verInfo').textContent = `Mulehead ${i.version}`; });
}
$('#plList').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]'); if (a) { await window.api.activate(a.dataset.act); return; }
  const d = e.target.closest('[data-del]');
  if (d) {
    if (d.dataset.confirm) { await window.api.removePlaylist(d.dataset.del); }
    else { d.dataset.confirm = '1'; d.textContent = 'Eyða?'; setTimeout(() => { delete d.dataset.confirm; d.textContent = '🗑'; }, 3000); }
  }
});
const saveSetting = async (patch) => { S.settings = await window.api.updateSettings(patch); };
$('#setBuffer').oninput = (e) => { $('#bufVal').textContent = e.target.value; };
$('#setBuffer').onchange = (e) => { saveSetting({ bufferSec: +e.target.value }); player.opts.bufferSec = +e.target.value; };
$('#setFormat').onchange = (e) => saveSetting({ format: e.target.value });
$('#setUA').onchange = (e) => saveSetting({ userAgent: e.target.value.trim() });
$('#setRefresh').onchange = (e) => saveSetting({ refreshHours: +e.target.value });
$('#setEpgOff').onchange = async (e) => { await saveSetting({ epgOffsetMin: +e.target.value }); renderRows(true); if (S.current >= 0) renderInfo(S.current); };
$('#setGrow').onchange = (e) => { saveSetting({ growSlow: e.target.checked }); player.opts.growSlow = e.target.checked; };
$('#setRelay').onchange = (e) => saveSetting({ liveRelay: e.target.value });
$('#setSort').onchange = async (e) => { await saveSetting({ sortAZ: e.target.checked }); buildList(); };
$('#setMerge').onchange = async (e) => { await saveSetting({ mergeVariants: e.target.checked }); buildList(); };
$('#openLog').onclick = () => window.api.openLog();
$('#setNick').onchange = (e) => saveSetting({ nickname: e.target.value.trim() });
// The room code is remembered (so nobody has to type it again) but it is never joined on its
// own: the app shows it on the 🤝 button and waits for a click (see boot / paintSyncBtn).
$('#setRoom').onchange = (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  e.target.value = v;
  saveSetting({ syncRoom: v });
  S.settings.syncRoom = v;
  paintSyncBtn();
};

// group manager
let gmOrder = [], gmHidden = new Set();
let gmKind = 'live';
$('#btnGroups').onclick = () => {
  gmKind = S.mode;
  if (gmKind === 'live') {
    gmOrder = orderedGroups().map(g => g.name);
    gmHidden = new Set(S.per.hiddenGroups || []);
  } else {
    gmOrder = vodCategories(true).map(c => c.name);
    gmHidden = new Set(((S.per.vodHidden || {})[gmKind]) || []);
  }
  $('#gmFilter').value = '';
  renderGm();
  $('#groupsModal').classList.remove('hidden');
};
function gmFiltered() {
  const q = $('#gmFilter').value.trim().toLowerCase();
  return gmOrder.filter(n => !q || n.toLowerCase().includes(q));
}
function renderGm() {
  const counts = gmKind === 'live' ? new Map(S.groups.map(g => [g.name, g.count]))
    : new Map(((S.vod[gmKind] || {}).categories || []).map(c => [c.name, c.count]));
  $('#gmList').innerHTML = gmFiltered().map(n => `<div class="gm" data-n="${esc(n)}">
    <input type="checkbox" ${gmHidden.has(n) ? '' : 'checked'}>
    <span class="nm">${esc(n)}</span><span class="c">${counts.get(n) || 0}</span>
    <button data-mv="top" title="Efst">⤒</button><button data-mv="-1">↑</button><button data-mv="1">↓</button></div>`).join('');
}
$('#gmFilter').oninput = renderGm;
$('#gmShowAll').onclick = () => { gmFiltered().forEach(n => gmHidden.delete(n)); renderGm(); };
$('#gmHideAll').onclick = () => { gmFiltered().forEach(n => gmHidden.add(n)); renderGm(); };
$('#gmList').addEventListener('click', (e) => {
  const row = e.target.closest('.gm'); if (!row) return;
  const n = row.dataset.n;
  if (e.target.type === 'checkbox') { if (e.target.checked) gmHidden.delete(n); else gmHidden.add(n); return; }
  const mv = e.target.dataset.mv; if (!mv) return;
  const i = gmOrder.indexOf(n);
  gmOrder.splice(i, 1);
  if (mv === 'top') gmOrder.unshift(n);
  else {
    // move relative to neighbours in the filtered view
    const vis = gmFiltered();
    const vi = vis.indexOf(n) === -1 ? -1 : vis.indexOf(n);
    let target = i + (+mv);
    if (vi === -1) { const f = gmFiltered(); const nb = mv === '-1' ? f.filter(x => gmOrder.indexOf(x) < i).pop() : f.find(x => gmOrder.indexOf(x) >= i); target = nb === undefined ? i : gmOrder.indexOf(nb) + (mv === '-1' ? 0 : 1); }
    gmOrder.splice(Math.max(0, Math.min(gmOrder.length, target)), 0, n);
  }
  renderGm();
});
function saveGroups() {
  if (!gmOrder.length) return;
  if (gmKind !== 'live') {
    S.per.vodOrder = { ...(S.per.vodOrder || {}), [gmKind]: gmOrder };
    S.per.vodHidden = { ...(S.per.vodHidden || {}), [gmKind]: [...gmHidden] };
    window.api.updatePer({ vodOrder: S.per.vodOrder, vodHidden: S.per.vodHidden });
    const hiddenIds = new Set(((S.vod[gmKind] || {}).categories || []).filter(c => gmHidden.has(c.name)).map(c => c.id));
    if (hiddenIds.has(S.vodGroup)) S.vodGroup = '__all';
    gmOrder = [];
    renderGroups(); buildList();
    return;
  }
  S.per.groupOrder = gmOrder; S.per.hiddenGroups = [...gmHidden];
  window.api.updatePer({ groupOrder: gmOrder, hiddenGroups: [...gmHidden] });
  if (S.group !== '__all' && S.group.indexOf('__') !== 0 && gmHidden.has(S.group)) S.group = '__all';
  gmOrder = [];
  renderGroups(); buildList();
}

// ---------- watch together ----------
// The room identifies a channel by its merged name ("Sky Sport PL" = "Sky Sport Premier
// League"), not by group or index, so two playlists with different folders still agree.
let chKeyMemo = null;
// The alias rule of buildNameIndex() (…PL = …Premier League) applied to the prefix-free
// names, so "UK: Sky Sport PL" and "SKY: Sky Sport Premier League" still meet in a room.
function roomAlias(idxs) {
  const names = new Map(), collapsed = new Map();
  const words = idxs.map(i => roomName(S.channels[i].name).split(' ').filter(Boolean));
  const group = (n) => S.channels[idxs[n]].group;
  const keyOf = (n) => group(n) + '\u0000' + words[n].join(' ');
  idxs.forEach((_, n) => {
    const key = keyOf(n);
    if (!names.has(key)) names.set(key, words[n]);
    for (let k = 2; k <= 4 && k < words[n].length; k++) {
      const tail = words[n].slice(words[n].length - k);
      if (tail.some(x => !/^[a-z]{2,}$/.test(x))) continue;      // numbers are not initials
      const ck = group(n) + '\u0000' + words[n].slice(0, words[n].length - k).join(' ') + ' ' + tail.map(x => x[0]).join('');
      if (!collapsed.has(ck)) collapsed.set(ck, new Set());
      collapsed.get(ck).add(key);
    }
  });
  const alias = new Map();
  for (const [key, w] of names) {
    const abbr = w[w.length - 1];
    if (!/^[a-z]{2,4}$/.test(abbr)) continue;
    const g = key.slice(0, key.indexOf('\u0000') + 1);
    const set = collapsed.get(g + w.slice(0, -1).join(' ') + ' ' + abbr);
    if (!set || set.size !== 1) continue;                       // nobody or more than one fits
    const other = names.get([...set][0]);
    if (!other || [...set][0] === key || other.length <= w.length) continue;
    alias.set(key, [...set][0]);
  }
  return alias;
}
function chanIndex() {
  if (chKeyMemo && chKeyMemo.n === S.channels.length) return chKeyMemo;
  const idxs = S.channels.map((_, i) => i);
  const alias = roomAlias(idxs);
  const byKey = new Map(), byName = new Map();
  for (const i of idxs) {
    const c = S.channels[i];
    const k0 = c.group + '\u0000' + mergeKey(roomName(c.name));
    const k = (alias.get(k0) || k0).split('\u0000')[1];
    if (!byKey.has(k)) byKey.set(k, i);
    if (!byName.has(c.name)) byName.set(c.name, i);
  }
  chKeyMemo = { n: S.channels.length, alias, byKey, byName };
  return chKeyMemo;
}
// "UK: Sky Sport Premier League" -> "sky sport premier league": the country prefix is the
// playlist's own convention (UK / England / GBR), so it must not be part of the room key
function roomName(name) { return mergeKey(sortKey(splitName(name).base)); }
function chanKeyOf(ch) {
  if (!ch) return '';
  const k0 = ch.group + '\u0000' + roomName(ch.name);
  return ((chanIndex().alias.get(k0)) || k0).split('\u0000')[1];
}
// resolve a channel from a room key (or a plain name) to a row in the local playlist
function chanIdxFromRoom({ key, name }) {
  const ix = chanIndex();
  if (name && ix.byName.has(name)) return ix.byName.get(name);
  if (key && ix.byKey.has(key)) return ix.byKey.get(key);
  // last resort: the same words in another order / with extra prefixes
  const want = (key || '').split(' ').filter(Boolean);
  if (!want.length) return -1;
  for (let i = 0; i < S.channels.length; i++) {
    const w = new Set(mergeKey(splitName(S.channels[i].name).base).split(' '));
    if (want.every(x => w.has(x))) return i;
  }
  return -1;
}

const sync = new SyncRoom({
  player,
  getChannel: () => S.channels[S.current] || null,
  getChannelKey: chanKeyOf,
  getNickname: () => S.settings.nickname || 'Gestur',
  onUpdate: renderSync,
  onPeerChannel: followChannel,
  onPeerBank: onPeerBank
});

// A peer changed channel: follow (the newest change wins, see SyncRoom).
function followChannel({ key, name, by }) {
  const idx = chanIdxFromRoom({ key, name });
  if (idx < 0) {
    log(`🤝 ${by} setti á „${name}“ – rásin er ekki í þínum lista`);
    toast(`${by} setti á ${name} – rásin er ekki í þínum lista`);
    return;
  }
  const cur = S.channels[S.current];
  if (cur && chanKeyOf(cur) === chanKeyOf(S.channels[idx])) return;   // already there
  log(`🤝 ${by} setti á ${name} – fylgi`);
  S.group = S.channels[idx].group;
  buildList(); renderGroups();
  const r = rowOf(idx);
  if (r >= 0) { S.sel = r; scrollToSel(); }
  S.chFollow = true;                       // do not announce their change back as mine
  // The app never starts a stream on its own. When it has just opened (nothing has played yet in
  // this session) the channel is only *selected* – a restart or a crash must not put you on air
  // behind your back. The moment you press play, every later change switches over as usual.
  if (player.state === 'idle' && !player.url) {
    S.chFollow = false;
    renderInfo(idx);
    log(`🤝 ${by} er á ${name} – rásin valin, ekkert spilað (appið er í hvíld)`);
    toast(`🤝 ${by} er á ${name} – ýttu á Enter til að hoppa`);
    return;
  }
  playIdx(idx);
  toast(`${by} setti á ${name}`);
}

// A peer banks buffer: fill to the same cushion, so the room stays in step.
let pendingBank = null;                  // a room bank we could not pause for yet
let pendingTimer = null;
// everybody aims at the same "seconds ahead" mark; older apps only send the duration
function peerBank(mark, sec) {
  return Number(mark) >= 5 ? player.bankTo(Number(mark)) : player.bankFor(sec);
}
function onPeerBank({ sec, mark, by }) {
  if ((!sec || sec < 2) && !(Number(mark) >= 5)) return;
  if (player.bank) return;                 // already banking: theirs is not shorter
  const who = by || 'Vinur';
  S.bankBy = who;                          // the badge reads this; bankTick re-emits every 0.5 s
  const want = peerBank(mark, sec);
  if (!want) {
    // already deeper than the mark they are filling to: nothing to do
    if (Number(mark) >= 5 && player.bufferedAhead() >= Number(mark) - 2) {
      S.bankBy = null;
      log(`🤝 ${who} hleður buffer – við höfum þegar ${Math.round(player.bufferedAhead())} sek`);
      return;
    }
    // not playing (or sync is pausing us right now): pause as soon as we can instead of
    // letting the two of us end up half a minute apart with no way back
    S.bankBy = null;
    pendingBank = { sec, mark, who, key: S.current, until: Date.now() + 45000 };
    clearInterval(pendingTimer);
    pendingTimer = setInterval(tryPendingBank, 500);
    log(`🤝 ${who} hleður buffer – við pásum um leið og spilun hefst`);
    toast(`🤝 ${who} hleður buffer – við pásum um leið og spilun hefst`);
    return;
  }
  log(`🤝 ${who} hleður buffer – pása ${want} sek (allir)`);
  toast(`🤝 ${who} hleður buffer – pásum í ${Math.round(want)} sek`);
  showOsd();
}

function tryPendingBank() {
  const p = pendingBank;
  if (!p) { clearInterval(pendingTimer); pendingTimer = null; return; }
  if (Date.now() > p.until || p.key !== S.current || !sync.room) {
    pendingBank = null; clearInterval(pendingTimer); pendingTimer = null;
    log('🤝 Pásan féll niður (of seint eða rásin breyttist)');
    return;
  }
  if (player.bank || player.hold || player.state !== 'playing') return;
  S.bankBy = p.who;
  const want = peerBank(p.mark, p.sec);
  if (!want) { S.bankBy = null; return; }   // bankFor() emits onBank, so set it again next try
  pendingBank = null; clearInterval(pendingTimer); pendingTimer = null;
  S.bankBy = p.who;
  log(`🤝 ${p.who} hleður buffer – pása ${want} sek (allir)`);
  toast(`🤝 ${p.who} hleður buffer – pásum í ${Math.round(want)} sek`);
  showOsd();
}

$('#btnSync').onclick = () => { $('#syncDrawer').classList.toggle('hidden'); renderSync(sync.lastState || { room: null }); };

// The 🤝 button always says where you stand: the room you are in, the code you have
// remembered (a code only – nothing is connected until you press „Taka þátt"), or the plain
// invitation. See boot: a restart never puts you in a room behind your back.
function paintSyncBtn() {
  const btn = $('#btnSync');
  if (!btn) return;
  const room = (sync.lastState && sync.lastState.room) || sync.room || '';
  const saved = String(S.settings.syncRoom || '').toUpperCase();
  btn.classList.toggle('on', !!room);
  btn.classList.toggle('saved', !room && !!saved);
  btn.textContent = room ? `🤝 ${room}` : (saved ? `🤝 ${saved}` : '🤝 Horfa saman');
  btn.title = room ? `Í herbergi ${room}`
    : (saved ? `Kóðinn ${saved} er geymdur – ýttu til að taka þátt (appið tengist honum aldrei sjálft)` : 'Horfa saman');
}

function diffText(d) {
  if (Math.abs(d) < 0.25) return '✅ Í takt';
  return d > 0 ? `Þú ert ${d.toFixed(1)} sek á undan` : `Þú ert ${(-d).toFixed(1)} sek á eftir`;
}

function renderSync(st) {
  sync.lastState = st;
  paintSyncBtn();
  // badge on video
  const badge = $('#syncBadge');
  const same = (st.peers || []).filter(p => p.sameCh && p.diff != null);
  if (st.room && same.length) {
    const worst = same.reduce((a, p) => Math.abs(p.diff) > Math.abs(a) ? p.diff : a, 0);
    badge.textContent = `🤝 ${Math.abs(worst) < 0.25 ? 'Í takt' : 'Samstilli…'} (${same.map(p => esc(p.name)).join(', ')})`;
    badge.classList.remove('hidden');
  } else badge.classList.add('hidden');
  if ($('#syncDrawer').classList.contains('hidden')) return;
  const body = $('#syncBody');
  if (!st.room) {
    delete body.dataset.room;
    body.innerHTML = `<div class="stack">
      <p>Horfðu á sama leik og vinir þínir – appið heldur ykkur í takt sjálfkrafa.</p>
      <small style="margin:-6px 0 8px;display:block">Hver og einn sækir sinn straum í sína áskrift – herbergið stillir bara tímann. Ef áskriftin leyfir aðeins eitt streymi í einu getur bara annar horft í einu.</small>
      <label>Nafnið þitt<br><input id="syNick" type="text" value="${esc(S.settings.nickname || '')}" placeholder="t.d. Júlli" style="width:100%;margin-top:4px"></label>
      <button class="primary" id="syCreate" style="width:100%">➕ Búa til herbergi</button>
      <div class="muted" style="text-align:center">eða</div>
      <div class="row"><input id="syCode" type="text" placeholder="Kóði frá vini" style="flex:1;text-transform:uppercase"><button id="syJoin">Taka þátt</button></div>
      <small id="sySaved" class="muted"></small>
      </div>`;
    const nick = () => { const v = $('#syNick').value.trim(); if (v !== (S.settings.nickname || '')) saveSetting({ nickname: v }); S.settings.nickname = v; };
    // the code is kept, so nobody types it again – not even after a crash or a restart.
    // Changing/clearing it happens in stillingar (🤝 Herbergiskóði).
    const keep = (code) => {
      const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (c !== (S.settings.syncRoom || '')) saveSetting({ syncRoom: c });
      S.settings.syncRoom = c;
      paintSyncBtn();
      return c;
    };
    $('#syCreate').onclick = () => { nick(); sync.join(keep(SyncRoom.newCode())); };
    $('#syJoin').onclick = () => { nick(); const c = $('#syCode').value.trim(); if (c) sync.join(keep(c)); };
    $('#syCode').onkeydown = (e) => { if (e.key === 'Enter') $('#syJoin').click(); };
    if (S.settings.syncRoom) {
      // the code is kept, so nobody has to type it again – joining is always your own click
      $('#syCode').value = S.settings.syncRoom;
      $('#syJoin').classList.add('primary');
      $('#sySaved').textContent = `Kóðinn ${S.settings.syncRoom} er geymdur hér – ýttu á „Taka þátt“ til að tengjast. Appið tengist honum aldrei sjálft.`;
    }
    return;
  }
  const me = S.channels[S.current];
  let peersHtml = (st.peers || []).map(p => {
    let s;
    if (!p.sameCh) {
      const idx = S.channels.findIndex(c => c.name === p.ch);
      s = `📺 Er á annarri rás: <b>${esc(p.ch || '–')}</b>${idx >= 0 && p.ch ? ` <button data-goto="${idx}">Skipta yfir</button>` : ''}`;
    } else if (p.mismatch) s = '⚠️ Tímastimplar passa ekki saman hjá ykkur. Notaðu handvirku takkana hér fyrir neðan.';
    else if (p.diff == null) s = p.playing ? '⏳ Mæli mun…' : '⏸ Er ekki að spila';
    else s = diffText(p.diff);
    return `<div class="peer"><div class="n">👤 ${esc(p.name)}</div><div class="s">${s}</div></div>`;
  }).join('');
  if (!peersHtml) peersHtml = '<p class="muted">Bíð eftir að einhver komi inn… Gefðu frænda þínum kóðann hér fyrir ofan.</p>';
  if (body.dataset.room !== st.room) {
    body.dataset.room = st.room;
    body.innerHTML = `
    <div class="muted" id="syConn"></div>
    <div class="code">${esc(st.room)}</div>
    <small style="text-align:center">Báðir þurfa að vera á sömu rás.</small>
    <small style="text-align:center;display:block;margin-top:6px">Hver sækir sinn straum: sama rás hjá báðum, en hvor í sínu appi. Eitt streymi í einu á hverri áskrift.</small>
    <p class="muted" id="syNoCh"></p>
    <div id="syPeers"></div>
    <label class="row"><input type="checkbox" id="syAuto"> Samstilla sjálfkrafa</label>
    <h4 style="margin:14px 0 6px;color:var(--accent2)">Handvirkt</h4>
    <div class="row"><button data-delay="0.5">⏸ Seinka um 0,5 s</button><button data-delay="1">⏸ 1 s</button><button data-delay="3">⏸ 3 s</button></div>
    <div class="row"><button data-skip="0.5">⏩ Fram um 0,5 s</button><button data-skip="1">⏩ 1 s</button></div>
    <small id="syLast"></small>
    <div class="row" style="margin-top:18px"><button class="danger" id="syLeave">Hætta í herbergi</button></div>`;
    $('#syAuto').onchange = (e) => { sync.auto = e.target.checked; if (!sync.auto) player.setRate(1); sync.emit(); };
    $('#syLeave').onclick = () => { delete body.dataset.room; sync.leave(); };
    body.querySelectorAll('[data-delay]').forEach(b => b.onclick = () => sync.delay(+b.dataset.delay));
    body.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => sync.skip(+b.dataset.skip));
    $('#syPeers').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) playIdx(+b.dataset.goto); });
  }
  $('#syConn').textContent = 'Herbergiskóði ' + (st.connected ? '🟢' : '🟠 tengist…');
  $('#syNoCh').textContent = me ? '' : 'Veldu rás til að byrja.';
  if ($('#syPeers').innerHTML !== peersHtml) $('#syPeers').innerHTML = peersHtml;
  $('#syAuto').checked = !!st.auto;
  $('#syLast').textContent = st.lastAction || '';
}

// ---------- boot ----------
(async () => {
  applySnap(await window.api.getState());
  S.epg = await window.api.getEpg();
  S.sports = await window.api.sports();
  S.ffmpegBase = await window.api.ffmpegBase();
  renderGroups(); if (S.group === '__today') buildList(); else renderRows(true);
  // A remembered room code is *shown*, never joined on launch. A restart, a crash or a plain
  // start must not put you in a room (or on a channel) behind your back: the code is filled
  // into the drawer and carried by the 🤝 button, and one click on „Taka þátt“ is all it takes.
  paintSyncBtn();
})();

// ---------- "Hlaða buffer" (banking a cushion, by hand) ----------
// A pause is local: the relay keeps downloading, the browser keeps appending, so the
// cushion grows in real time and we end up that much behind the live edge. Nothing here
// is automatic – the viewer presses the button and watches the seconds arrive.
S.bank = S.bank || null;
let bankTimer = null;
const bankMark = () => Math.max(20, Math.min(Player.BANK_MAX_SEC, Number(S.settings.bufferSec) || 60));

function doBank() {
  if (player.vod || S.current < 0) return;
  if (player.bank) { player.endBank('notandi'); return; }      // a second press = play now
  S.bankBy = null;                                            // this one is mine
  const mark = bankMark();
  const want = player.bankTo(mark);
  if (!want) {
    // say WHY nothing happened; "buffer is big enough" was a lie when sync had us paused
    if (player.hold) { log('Samstilling pásar núna – reyndu aftur eftir sekúndu'); toast('Andartak – samstilling er að pása'); }
    else if (player.state !== 'playing') { log('Rásin er ekki í spilun – get ekki hlaðið buffer'); toast('Rásin er ekki í spilun'); }
    else { log('Buffer er þegar nógu stór'); toast('Buffer er þegar nógu stór'); }
    return;
  }
  showOsd();
  // in a room everybody fills to the same cushion, so nobody has to wait for anybody
  if (sync.room) sync.announceBank(want, mark);
}

function onBank(st) {
  S.bank = st && st.on ? st : null;
  const badge = $('#bankBadge');
  if (!S.bank) { S.bankBy = null; clearInterval(bankTimer); badge.classList.add('hidden'); return; }
  // build the badge once so the button keeps its element (a click must not fall between rebuilds)
  if (!badge.querySelector('#bankNow')) {
    badge.innerHTML = `⏸️ <span id="bankWho"></span>Hleð buffer <b id="bankNum">0</b>/<span id="bankMark"></span> sek <button id="bankNow">Spila núna</button>`;
    badge.querySelector('#bankNow').onclick = () => player.endBank('notandi');
    badge.querySelector('#bankMark').textContent = String(S.bank.mark);
  }
  // a pause the room asked for names the person who asked, otherwise it looks like a glitch
  const who = badge.querySelector('#bankWho');
  if (who) who.textContent = S.bankBy ? `🤝 ${S.bankBy}: ` : '';
  const num = badge.querySelector('#bankNum');
  const upd = () => {
    if (!player.bank) { clearInterval(bankTimer); badge.classList.add('hidden'); return; }
    if (num) num.textContent = player.bufferedAhead().toFixed(0);
  };
  badge.classList.remove('hidden'); upd();
  clearInterval(bankTimer); bankTimer = setInterval(upd, 500);
}


// ---------- movies & series (VOD) ----------
S.mode = 'live';
S.vod = {};
S.vodGroup = '__all';
S.seriesOpen = null;
const RES_KEY = 'mh.resume';
const loadResume = () => { try { return JSON.parse(localStorage.getItem(RES_KEY) || '{}'); } catch { return {}; } };
function saveResume(url, data) {
  try {
    const r = loadResume();
    if (data) r[url] = { ...data, at: Date.now() }; else delete r[url];
    const keys = Object.keys(r).sort((a, b) => r[b].at - r[a].at).slice(0, 200);
    const out = {}; keys.forEach(k => { out[k] = r[k]; });
    localStorage.setItem(RES_KEY, JSON.stringify(out));
  } catch { }
}
const fmtDur = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

document.querySelector('.modes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  S.mode = b.dataset.mode;
  document.querySelectorAll('.modes button').forEach(x => x.classList.toggle('on', x === b));
  S.search = ''; $('#search').value = ''; S.seriesOpen = null; S.vodGroup = '__all';
  $('#search').placeholder = S.mode === 'live' ? 'Leita að rás…  (⌘F)' : S.mode === 'movies' ? 'Leita að mynd…  (⌘F)' : 'Leita að þáttaröð…  (⌘F)';
  $('#btnGroups').textContent = S.mode === 'live' ? '✏️ Raða og fela flokka' : '✏️ Raða og fela möppur';
  if (S.mode !== 'live' && !S.vod[S.mode]) await loadVodData(S.mode);
  renderGroups(); buildList(); $('#chlist').scrollTop = 0;
});

async function loadVodData(kind, force) {
  S.vod[kind] = { loading: true, categories: [], items: [] };
  renderGroups(); buildList();
  const r = await window.api.vod(kind, force);
  S.vod[kind] = { ...r, loading: false, byId: new Map(r.categories.map(c => [c.id, c])) };
  if (S.mode === kind) { renderGroups(); buildList(); }
}

function resumeList(kind) {
  const r = loadResume();
  return Object.entries(r).filter(([, v]) => v.kind === kind && v.t > 60 && (!v.d || v.t < v.d * 0.95))
    .sort((a, b) => b[1].at - a[1].at).slice(0, 30).map(([url, v]) => ({ url, ...v }));
}

// categories for the current VOD mode, in the user's order; hidden ones left out unless includeHidden
function vodCategories(includeHidden) {
  const kind = S.mode;
  const cats = ((S.vod[kind] || {}).categories) || [];
  const order = ((S.per.vodOrder || {})[kind]) || [];
  const hidden = new Set(((S.per.vodHidden || {})[kind]) || []);
  const pos = new Map(order.map((n, i) => [n, i]));
  return cats.map((c, i) => [c, pos.has(c.name) ? pos.get(c.name) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0])
    .filter(c => includeHidden || !hidden.has(c.name));
}
function visibleVodItems(d) {
  const shown = new Set(vodCategories(false).map(c => c.id));
  return (d.items || []).filter(i => shown.has(i.cat));
}

function renderVodGroups() {
  const d = S.vod[S.mode] || { categories: [] };
  const items = [
    { key: '__resume', label: '⏯️ Haldið áfram', c: resumeList(S.mode === 'movies' ? 'movie' : 'episode').length },
    { key: '__all', label: S.mode === 'movies' ? '🎬 Allar myndir' : '📼 Allar þáttaraðir', c: visibleVodItems(d).length },
    { key: '__new', label: '🆕 Nýtt', c: Math.min(100, visibleVodItems(d).length) },
    'sep',
    ...vodCategories(false).map(c => ({ key: c.id, label: c.name, c: c.count }))
  ];
  $('#groups').innerHTML = items.map(it => it === 'sep' ? '<div class="gsep"></div>' :
    `<div class="grp ${S.vodGroup === it.key && !S.search ? 'sel' : ''}" data-vg="${esc(it.key)}"><span class="nm">${esc(it.label)}</span><span class="c">${it.c}</span></div>`).join('');
}
$('#groups').addEventListener('click', (e) => {
  const el = e.target.closest('[data-vg]'); if (!el) return;
  e.stopImmediatePropagation();
  S.vodGroup = el.dataset.vg; S.seriesOpen = null; S.search = ''; $('#search').value = '';
  renderGroups(); buildList(); $('#chlist').scrollTop = 0;
}, true);

function vodSortMode() { return ((S.per.vodSort || {})[S.mode]) || 'new'; }

function buildVodList() {
  const kind = S.mode;
  const d = S.vod[kind] || { items: [] };
  const q = S.search.trim().toLowerCase();
  let rows = [], title = '';
  if (S.seriesOpen) {
    const so = S.seriesOpen;
    rows.push({ type: 'back' });
    if (so.loading) rows.push({ type: 'head', text: 'Sæki þætti…' });
    else if (so.data && so.data.error) rows.push({ type: 'head', text: '⚠️ ' + so.data.error });
    else for (const season of (so.data.seasons || [])) {
      rows.push({ type: 'head', text: `Sería ${season.season}` });
      season.episodes.forEach(ep => rows.push({ type: 'ep', ep, series: so.item, season: season.season }));
    }
    title = so.item.name;
  } else if (S.vodGroup === '__resume' && !q) {
    rows = resumeList(kind === 'movies' ? 'movie' : 'episode').map(r => ({ type: 'vod', item: { name: r.name, poster: r.poster, url: r.url, resume: true, kind: r.kind } }));
    title = '⏯️ Haldið áfram';
  } else {
    let items = visibleVodItems(d);
    if (q) { const w = q.split(/\s+/); items = items.filter(i => { const n = i.name.toLowerCase(); return w.every(x => n.includes(x)); }); title = `Leit: „${S.search.trim()}“`; }
    else if (S.vodGroup === '__new') { items = [...items].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 100); title = '🆕 Nýtt'; }
    else if (S.vodGroup !== '__all') { items = items.filter(i => i.cat === S.vodGroup); title = (d.byId && d.byId.get(S.vodGroup) || {}).name || ''; }
    else title = kind === 'movies' ? '🎬 Allar myndir' : '📼 Allar þáttaraðir';
    if (S.vodGroup !== '__new') {
      const mode = vodSortMode();
      const yr = (i) => parseInt(i.year, 10) || 0;
      if (mode === 'az') items = [...items].sort((a, b) => coll.compare(a.name, b.name));
      else if (mode === 'year') items = [...items].sort((a, b) => yr(b) - yr(a) || coll.compare(a.name, b.name));
      else if (mode === 'yearOld') items = [...items].sort((a, b) => (yr(a) || 9999) - (yr(b) || 9999) || coll.compare(a.name, b.name));
      else items = [...items].sort((a, b) => (b.added || 0) - (a.added || 0));
    }
    rows = items.map(item => ({ type: 'vod', item }));
  }
  S.list = rows;
  $('#listTitle').textContent = title;
  const n = rows.filter(r => r.type === 'vod' || r.type === 'ep').length;
  const showSort = !S.seriesOpen && S.vodGroup !== '__resume' && S.vodGroup !== '__new';
  const sm = vodSortMode();
  $('#listCount').innerHTML = (n ? `${n} ` : '') + (showSort ? `<select class="mini" id="vodSort" title="Röðun"><option value="new" ${sm === 'new' ? 'selected' : ''}>Nýjast</option><option value="az" ${sm === 'az' ? 'selected' : ''}>A–Ö</option><option value="year" ${sm === 'year' ? 'selected' : ''}>Útgáfuár (nýjast)</option><option value="yearOld" ${sm === 'yearOld' ? 'selected' : ''}>Útgáfuár (elst)</option></select>` : '') + (!S.seriesOpen ? `<button class="mini" id="vodRefresh" title="Sækja aftur">🔄</button>` : '');
  const vs = $('#vodSort'); if (vs) vs.onchange = (e) => { S.per.vodSort = { ...(S.per.vodSort || {}), [kind]: e.target.value }; window.api.updatePer({ vodSort: S.per.vodSort }); buildList(); };
  const vr = $('#vodRefresh'); if (vr) vr.onclick = () => loadVodData(kind, true);
  S.hs = []; layoutRows();
  S.sel = Math.min(S.sel, Math.max(0, rows.length - 1));
  const el = $('#emptyList');
  let msg = '';
  if (d.loading) msg = '<div class="spinner" style="margin:0 auto 12px"></div>Sæki lista…';
  else if (!rows.length) msg = d.error ? '⚠️ ' + esc(d.error) : (S.vodGroup === '__resume' ? 'Ekkert í gangi ennþá.' : (q ? 'Ekkert fannst.' : 'Áskriftin er ekki með neitt hér.'));
  el.innerHTML = msg; el.classList.toggle('hidden', !msg);
  renderRows(true);
}

function vodRowHtml(row, r) {
  const top = `style="top:${S.tops[r] || 0}px"`;
  if (row.type === 'head') return `<div class="ch head" ${top}>${esc(row.text)}</div>`;
  if (row.type === 'back') return `<div class="ch back" ${top} data-vr="${r}">‹ Til baka</div>`;
  const it = row.type === 'ep' ? row.ep : row.item;
  const res = it.url ? loadResume()[it.url] : null;
  const pct = res && res.d ? Math.min(100, res.t / res.d * 100) : 0;
  const name = row.type === 'ep' ? `${it.num != null ? it.num + '. ' : ''}${it.title}` : it.name;
  const sub = row.type === 'ep' ? (it.duration || '') : [it.year, it.rating ? '★ ' + it.rating : ''].filter(Boolean).join(' · ');
  const playing = it.url && S.vodPlaying && S.vodPlaying.url === it.url;
  return `<div class="ch vod ${r === S.sel ? 'sel' : ''} ${playing ? 'playing' : ''}" ${top} data-vr="${r}">
    <div class="logo">${it.poster ? `<img src="${esc(it.poster)}" loading="lazy" onerror="this.remove()">` : `<span>${esc(initials(name))}</span>`}</div>
    <div class="meta"><div class="name">${esc(name)}</div>${sub ? `<div class="prog">${esc(sub)}</div>` : ''}${pct ? `<div class="resume"><i style="width:${pct}%"></i></div>` : ''}</div>
    ${S.mode === 'series' && row.type === 'vod' && !it.url ? '<div class="star">›</div>' : ''}</div>`;
}

async function onVodRowClick(row) {
  if (!row) return;
  if (row.type === 'back') { S.seriesOpen = null; buildList(); return; }
  if (row.type === 'ep') { playVod({ name: `${row.series.name} – S${row.season} ${row.ep.title}`, url: row.ep.url, poster: row.ep.poster || row.series.poster, kind: 'episode', plot: row.ep.plot }); return; }
  if (row.type === 'vod') {
    const it = row.item;
    if (it.url) { playVod({ ...it, kind: it.kind || (S.mode === 'movies' ? 'movie' : 'episode') }); return; }
    // series without a url: open its episode list
    S.seriesOpen = { item: it, loading: true }; S.sel = 0; buildList(); $('#chlist').scrollTop = 0;
    const data = await window.api.series(it.id);
    if (S.seriesOpen && S.seriesOpen.item === it) { S.seriesOpen = { item: it, data }; buildList(); }
  }
}

S.vodOffset = 0; S.vodDur = 0; S.vodFails = 0;
const vodPos = () => S.vodOffset + (video.currentTime || 0);

async function playVod(it, at) {
  S.current = -1;
  S.vodPlaying = it;
  const res = loadResume()[it.url];
  let startAt = at != null ? at : (res && res.t > 30 && (!res.d || res.t < res.d * 0.95) ? res.t : 0);
  if (at == null) S.vodFails = 0;
  wrap.classList.add('vod');
  const wasLive = !player.vod && !!player.url;                // a channel was playing before this movie
  player.session++; player.teardown(); player.url = null;     // close the old stream first
  onPlayerStatus('connecting', wasLive ? 'Bíð eftir að rásin lokist…' : 'Opna…');
  if (wasLive) {
    // same rule as channel switching: the subscription may allow only ONE stream, and the
    // movie's ffmpeg would otherwise open its connection while the channel is still counted
    await player.waitRelease(Player.SWITCH_GAP_MS);
    if (S.vodPlaying !== it) return;
  }
  const info = await window.api.vodProbe(it.url);
  if (S.vodPlaying !== it) return;
  if (info && info.error) {
    log(`Mynd opnaðist ekki: ${info.error}`);
    vodFailUi(it, startAt, `⚠️ Náði ekki að opna myndina (${esc(info.error)}).`);
    return;
  }
  const proxied = !(info && info.noFfmpeg);
  S.vodDur = (info && info.duration) || (res && res.d) || 0;
  // Without HTTP Range support ffmpeg must read the file from the beginning, so "halda
  // áfram" at 2–3 minútur can take minutes. Ask instead of leaving a black screen.
  if (proxied && startAt > 90) {
    const rangeOk = await window.api.vodRange(it.url);
    if (S.vodPlaying !== it) return;
    log(`Stökk í skrá (HTTP Range): ${rangeOk ? 'í lagi' : 'ekki studd'}`);
    if (!rangeOk) {
      const chose = await askVodStart(startAt);
      if (S.vodPlaying !== it) return;
      startAt = chose;
      if (chose !== at && at == null) log(`Valið: ${chose ? 'halda áfram frá ' + fmtDur(chose) : 'byrja frá upphafi'}`);
    }
  }
  S.vodOffset = proxied ? startAt : 0;
  wrap.classList.toggle('vodx', proxied);
  $('#overlay .spinner').style.display = '';
  const url = proxied ? await window.api.vodUrl(it.url, startAt) : it.url;
  if (S.vodPlaying !== it) return;
  if (at == null) log(`=== Spila ${it.kind === 'movie' ? 'mynd' : 'þátt'}: ${it.name}${startAt ? ' (frá ' + fmtDur(startAt) + ')' : ''}${info && info.video ? ` [${info.video}/${info.audio}]` : ''} ===`);
  player.play(url, { vod: true, proxied, startAt: proxied ? 0 : startAt, onVodFail: () => vodRetry(it) });
  if (at == null) {
    $('#nowInfo').innerHTML = `<div class="t">${esc(it.name)}</div>${startAt ? `<div class="p">⏯️ Heldur áfram frá ${fmtDur(startAt)} <button class="mini" id="fromStart">Byrja frá upphafi</button></div>` : ''}${it.plot ? `<div class="d">${esc(it.plot)}</div>` : ''}`;
    $('#epgList').innerHTML = '';
    const fs = $('#fromStart'); if (fs) fs.onclick = () => { fs.parentElement.remove(); seekVod(0); };
    document.title = `${it.name} – Mulehead`;
  }
  renderRows(true); updVodBar();
}
function vodRetry(it) {
  if (S.vodPlaying !== it) return;
  const pos = vodPos();
  if (++S.vodFails > 3) {
    log('Myndin spilast ekki (3 tilraunir) – býð val');
    vodFailUi(it, pos, '⚠️ Myndin spilast ekki.');
    return;
  }
  setTimeout(() => { if (S.vodPlaying === it) playVod(it, pos); }, 2000);
}

// The movie will not play: offer a way out instead of a dead black screen
function vodFailUi(it, startAt, msg) {
  onPlayerStatus('error', '');
  const ov = $('#overlay');
  ov.classList.remove('hidden');
  const sp = ov.querySelector('.spinner'); if (sp) sp.style.display = 'none';
  const t = $('#overlayText');
  t.innerHTML = `${msg}<div style="margin-top:6px;font-size:13px;opacity:.75">Áskriftin leyfir aðeins eitt streymi í einu – ef annað tæki streymir, lokaðu því.</div>`;
  const bar = document.createElement('div');
  bar.style.marginTop = '12px';
  const b1 = document.createElement('button');
  b1.className = 'mini'; b1.textContent = '🔄 Reyna aftur';
  b1.onclick = () => { S.vodFails = 0; playVod(it, startAt > 5 ? startAt : 0); };
  bar.appendChild(b1);
  if (startAt > 5) {
    const b2 = document.createElement('button');
    b2.className = 'mini'; b2.textContent = '⏮ Byrja frá upphafi';
    b2.style.marginLeft = '8px';
    b2.onclick = () => { S.vodFails = 0; playVod(it, 0); };
    bar.appendChild(b2);
  }
  t.appendChild(bar);
}

// "Halda áfram" can take minutes when the provider ignores HTTP Range – let the user choose
function askVodStart(startAt) {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    ov.classList.remove('hidden');
    const sp = ov.querySelector('.spinner'); if (sp) sp.style.display = 'none';
    const t = $('#overlayText');
    t.innerHTML = `⏱️ Þessi þjónn styður ekki stökk í skránni.<div style="margin-top:6px;font-size:13px;opacity:.75">Að halda áfram frá ${fmtDur(startAt)} getur tekið mínútur.</div>`;
    const bar = document.createElement('div');
    bar.style.marginTop = '12px';
    const b1 = document.createElement('button');
    b1.className = 'mini'; b1.textContent = `▶️ Halda áfram (${fmtDur(startAt)})`;
    const b2 = document.createElement('button');
    b2.className = 'mini'; b2.textContent = '⏮ Byrja frá upphafi';
    b2.style.marginLeft = '8px';
    const done = (v) => { if (sp) sp.style.display = ''; resolve(v); };
    b1.onclick = () => done(startAt);
    b2.onclick = () => done(0);
    bar.appendChild(b1); bar.appendChild(b2); t.appendChild(bar);
  });
}
function seekVod(t) {
  const it = S.vodPlaying; if (!it) return;
  t = Math.max(0, S.vodDur ? Math.min(t, S.vodDur - 5) : t);
  if (wrap.classList.contains('vodx')) playVod(it, t);
  else video.currentTime = t;
}
function updVodBar() {
  if (!wrap.classList.contains('vodx')) return;
  const p = vodPos();
  $('#vTime').textContent = fmtDur(p);
  $('#vDur').textContent = S.vodDur ? fmtDur(S.vodDur) : '–';
  if (!S.seeking && S.vodDur) $('#vSeek').value = Math.round(p / S.vodDur * 1000);
  $('#vMute').textContent = video.muted ? '🔇' : '🔊';
}
setInterval(updVodBar, 500);
$('#vPlay').onclick = () => { if (video.paused) video.play().catch(() => { }); else video.pause(); };
$('#vBack').onclick = () => seekVod(vodPos() - 30);
$('#vFwd').onclick = () => seekVod(vodPos() + 30);
$('#vSeek').oninput = (e) => { S.seeking = true; if (S.vodDur) $('#vTime').textContent = fmtDur(e.target.value / 1000 * S.vodDur); };
$('#vSeek').onchange = (e) => { S.seeking = false; if (S.vodDur) seekVod(e.target.value / 1000 * S.vodDur); };
$('#vMute').onclick = () => { video.muted = !video.muted; updVodBar(); };
$('#vFull').onclick = () => toggleFull();
video.addEventListener('click', () => { if (wrap.classList.contains('vodx')) { if (video.paused) video.play().catch(() => { }); else video.pause(); } });

// remember where we are in movies/episodes
setInterval(() => {
  const it = S.vodPlaying;
  if (!it || !player.vod || !(video.currentTime > 2) || player.state !== 'playing') return;
  const d = S.vodDur || (isFinite(video.duration) ? video.duration : 0);
  saveResume(it.url, { t: vodPos(), d, name: it.name, poster: it.poster || '', kind: it.kind });
}, 5000);
video.addEventListener('ended', () => { if (S.vodPlaying && player.vod) saveResume(S.vodPlaying.url, null); });
