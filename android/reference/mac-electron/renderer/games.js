'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => new Date(t).toLocaleTimeString('is-IS', { hour: '2-digit', minute: '2-digit', hour12: false });

let D = null;           // sports snapshot
let open = new Set();   // expanded match ids
let dayOffset = 0;
let sport = 'football';

const dateStr = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
const dayLabel = (off) => off === 0 ? 'Í dag' : off === -1 ? 'Í gær' : off === 1 ? 'Á morgun'
  : new Date(Date.now() + off * 86400000).toLocaleDateString('is-IS', { weekday: 'short', day: 'numeric', month: 'short' });

function timeCell(f) {
  if (f.halftime) return '<div class="tm ht">Hálfl.</div>';
  if (f.state === 'in') return `<div class="tm live">${esc(f.clock || f.detail || 'Í gangi')}</div>`;
  if (f.state === 'post') return '<div class="tm">Lokið</div>';
  return `<div class="tm">${fmtTime(f.start)}</div>`;
}

function teamRow(t, f) {
  const fav = D.cfg.teams.includes(t.name);
  const score = f.state !== 'pre' ? `<span class="sc">${esc(t.score)}</span>` : '';
  return `<div class="team">${t.logo ? `<img src="${esc(t.logo)}" onerror="this.remove()">` : ''}<span class="nm">${esc(t.name)}</span>
    <span class="tstar ${fav ? 'on' : ''}" data-team="${esc(t.name)}" title="Uppáhaldslið">${fav ? '⭐' : '☆'}</span>${score}</div>`;
}

function matchHtml(f) {
  const isOpen = open.has(f.id);
  const n = (f.channels || []).length;
  let chs = '';
  if (isOpen) {
    if (n) {
      chs = f.channels.map(c => `<div class="chrow" data-play="${c.idx}"><div class="n">${esc(c.name)}<small>${esc(c.group)} · ${esc(c.why)}</small></div><span>▶</span></div>`).join('');
    }
    for (const fo of (f.folders || [])) {
      chs += `<div class="chrow" data-group="${esc(fo.group)}"><div class="n">📁 ${esc(fo.group)}<small>Sýndur á ${esc(fo.service)} – opna möppuna</small></div><span>›</span></div>`;
    }
    if (!n && !(f.folders || []).length) chs = '<div class="note">Engin rás fannst í áskriftinni þinni fyrir þennan leik.</div>';
    const byC = new Map();
    for (const b of (f.broadcasts || [])) { if (!byC.has(b.country)) byC.set(b.country, []); byC.get(b.country).push(b.channel); }
    if (byC.size) {
      chs += '<div class="note">' + [...byC.entries()].map(([c, list]) =>
        `<b>${esc((D.countriesAll.find(x => x.id === c) || {}).name || c)}:</b> ${list.map(esc).join(', ')}`).join('<br>') + '</div>';
    } else {
      chs += '<div class="note">Engar upplýsingar um sjónvarpsstöðvar fyrir þennan leik ennþá.</div>';
    }
    chs = `<div class="chs">${chs}</div>`;
  }
  return `<div class="m ${isOpen ? 'open' : ''}" data-id="${esc(f.id)}"><div class="mrow">${timeCell(f)}
    <div class="teams">${teamRow(f.home, f)}${teamRow(f.away, f)}</div>
    <div class="nch ${n ? 'has' : ''}">${n ? '📺 ' + n : ''}</div></div>${chs}</div>`;
}

function ufcHtml(ev) {
  const isOpen = open.has(ev.id);
  const n = (ev.channels || []).length;
  const day = new Date(ev.start).toLocaleDateString('is-IS', { weekday: 'short', day: 'numeric', month: 'short' });
  const when = ev.state === 'in' ? '<div class="tm live">Í gangi</div>' : ev.state === 'post' ? '<div class="tm">Lokið</div>' : `<div class="tm">${esc(day)}</div>`;
  let chs = '';
  if (isOpen) {
    chs = (ev.channels || []).map(c => `<div class="chrow" data-play="${c.idx}"><div class="n">${esc(c.name)}<small>${esc(c.group)} · ${esc(c.why)}</small></div><span>▶</span></div>`).join('');
    for (const fo of (ev.folders || [])) chs += `<div class="chrow" data-group="${esc(fo.group)}"><div class="n">📁 ${esc(fo.group)}<small>Sýnt á ${esc(fo.service)} – opna möppuna</small></div><span>›</span></div>`;
    if (!n && !(ev.folders || []).length) chs = '<div class="note">Engin rás fannst í áskriftinni þinni fyrir þetta kvöld ennþá.</div>';
    const rows = (ev.broadcasts || []).map(b => `<b>${esc((D.countriesAll.find(x => x.id === b.country) || {}).name || b.country)}:</b> ${esc(b.channel)}${b.rights ? ' <span style="opacity:.6">(rétthafi)</span>' : ''}`);
    if (rows.length) chs += `<div class="note">${rows.join('<br>')}</div>`;
    chs = `<div class="chs">${chs}</div>`;
  }
  return `<div class="m ev ${isOpen ? 'open' : ''}" data-id="${esc(ev.id)}"><div class="mrow">${when}
    <div class="teams"><div class="evname">${esc(ev.fighters.join(' vs '))}</div>
    <div class="evsub">${esc(ev.name)} · forkeppni ${fmtTime(ev.start)} · aðalbardagi ~${fmtTime(ev.mainAt)}</div></div>
    <div class="nch ${n ? 'has' : ''}">${n ? '📺 ' + n : ''}</div></div>${chs}</div>`;
}

function render() {
  if (!D) return;
  document.body.classList.toggle('ufc', sport === 'ufc');
  if (sport === 'ufc') {
    const list = D.ufc || [];
    $('#list').innerHTML = list.length ? '<div class="sec">🥊 Næstu UFC kvöld</div>' + list.map(ufcHtml).join('')
      : `<div class="empty">${D.loading ? 'Sæki…' : 'Engin UFC kvöld fundust næstu 30 daga.'}</div>`;
    return;
  }
  $('#dayLabel').textContent = dayLabel(dayOffset);
  const fx = D.fixtures || [];
  let html = '';
  const favs = fx.filter(f => f.fav);
  if (favs.length) html += '<div class="sec">⭐ Liðin mín</div>' + favs.map(matchHtml).join('');
  const byLeague = new Map();
  for (const f of fx) { if (!byLeague.has(f.leagueName)) byLeague.set(f.leagueName, []); byLeague.get(f.leagueName).push(f); }
  for (const [name, list] of byLeague) html += `<div class="sec">${esc(name)}</div>` + list.map(matchHtml).join('');
  if (!fx.length) {
    html = D.loading ? '<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Sæki leiki…</div>'
      : D.error ? `<div class="empty">⚠️ Náði ekki í leiki: ${esc(D.error)}</div>`
        : '<div class="empty">Engir leikir í völdum keppnum þennan dag.</div>';
  }
  $('#list').innerHTML = html;
}

function renderSettings() {
  const c = D.cfg;
  $('#leagues').innerHTML = D.leaguesAll.map(l => `<label><input type="checkbox" data-league="${l.id}" ${c.leagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('');
  $('#countries').innerHTML = D.countriesAll.map(l => `<label><input type="checkbox" data-country="${l.id}" ${c.countries.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('');
}

$('#list').addEventListener('click', async (e) => {
  const star = e.target.closest('[data-team]');
  if (star) {
    e.stopPropagation();
    const t = star.dataset.team;
    const teams = D.cfg.teams.includes(t) ? D.cfg.teams.filter(x => x !== t) : [...D.cfg.teams, t];
    D = await window.api.sportsConfig({ teams }); render(); return;
  }
  const pl = e.target.closest('[data-play]');
  if (pl) { e.stopPropagation(); window.api.playChannel(+pl.dataset.play); return; }
  const gr = e.target.closest('[data-group]');
  if (gr) { e.stopPropagation(); window.api.openGroup(gr.dataset.group); return; }
  const m = e.target.closest('.m'); if (!m) return;
  const id = m.dataset.id;
  if (open.has(id)) open.delete(id); else open.add(id);
  render();
});

$('#settings').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.league) {
    const leagues = [...document.querySelectorAll('[data-league]:checked')].map(x => x.dataset.league);
    D = await window.api.sportsConfig({ leagues });
  } else if (t.dataset.country) {
    const countries = [...document.querySelectorAll('[data-country]:checked')].map(x => x.dataset.country);
    D = await window.api.sportsConfig({ countries });
  }
  render();
});
document.querySelectorAll('[data-sport]').forEach(b => b.onclick = () => { sport = b.dataset.sport; document.querySelectorAll('[data-sport]').forEach(x => x.classList.toggle('on', x === b)); render(); });
$('#toggleSettings').onclick = () => { $('#settings').classList.toggle('hidden'); renderSettings(); };
$('#refresh').onclick = () => window.api.sportsRefresh(dateStr(dayOffset));
$('#prev').onclick = () => { dayOffset = Math.max(-1, dayOffset - 1); window.api.sportsRefresh(dateStr(dayOffset)); };
$('#next').onclick = () => { dayOffset = Math.min(6, dayOffset + 1); window.api.sportsRefresh(dateStr(dayOffset)); };

window.api.on('sports:changed', (snap) => { D = snap; render(); });
(async () => { D = await window.api.sports(); render(); })();
setInterval(render, 30000);
