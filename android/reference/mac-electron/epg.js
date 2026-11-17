'use strict';
// Streaming XMLTV parser – keeps only programmes for channels we know about,
// within a time window around now.
const sax = require('sax');
const zlib = require('zlib');
const { Readable } = require('stream');

function parseXmltvTime(s) {
  if (!s) return 0;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(s.trim());
  if (!m) return 0;
  const [, Y, M, D, h, mi, se = '00', tz] = m;
  let t = Date.UTC(+Y, +M - 1, +D, +h, +mi, +se);
  if (tz) {
    const sign = tz[0] === '-' ? -1 : 1;
    const off = (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10)) * 60000;
    t -= sign * off;
  }
  return t;
}

const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|\+1)\b/g, '').replace(/[^a-z0-9]/g, '');

// Loose key for channel names: the playlist often says "UK: Sky Sports Main Event FHD B"
// while the EPG says "Sky Sports Main Event" (or vice versa). Strip the country prefix and
// the quality/backup tokens, then normalize – "skysportsmainevent" on both sides.
const looseNorm = s => norm(String(s || '')
  .replace(/^[A-Z]{2,4}\s*[:|]\s*/, ' ')
  .replace(/\b(backup|alt|raw|b|8k|hdr|4k|uhd|fhd|hd|sd|hevc|h265|\d{3,4}p)\b/gi, ' '));

// Providers often list the same programme twice (identical start, stop and title).
// Sort by start and drop the repeats so the guide shows each programme once.
function sortUniq(list) {
  const out = [];
  const seen = new Set();
  for (const p of list.slice().sort((a, b) => a[0] - b[0])) {
    const key = `${p[0]}|${p[1]}|${p[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * @param {ReadableStream|Buffer|string} source  web stream (fetch body), buffer or xml string
 * @param {Set<string>} wantIds   tvg-ids used by the playlist
 * @param {Set<string>} wantNames normalized names used by the playlist
 */
function parseXmltv(source, wantIds, wantNames, { pastMs = 6 * 3600e3, futureMs = 48 * 3600e3, wantLoose = null } = {}) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const from = now - pastMs, to = now + futureMs;
    const parser = sax.createStream(false, { lowercase: true, trim: false });
    const programmes = {}; // xmltvId -> [[start, stop, title, desc]]
    const nameToId = {};   // normalized display-name -> xmltv id
    const nameToIdLoose = {}; // loosely normalized display-name -> xmltv id
    const matched = new Set();
    let chan = null, prog = null, field = null, text = '';

    parser.on('opentag', node => {
      const a = node.attributes;
      if (node.name === 'channel') { chan = { id: a.id || '' }; }
      else if (node.name === 'programme') {
        const start = parseXmltvTime(a.start), stop = parseXmltvTime(a.stop) || start + 3600e3;
        const id = a.channel || '';
        // XMLTV lists <channel> tags before programmes, so name matches are known here
        if (stop >= from && start <= to && (wantIds.has(id) || wantIds.has(id.toLowerCase()) || matched.has(id))) {
          prog = { id, start, stop, title: '', desc: '' };
        } else prog = null;
      }
      else if ((node.name === 'display-name' && chan) || ((node.name === 'title' || node.name === 'desc') && prog)) {
        field = node.name; text = '';
      }
    });
    parser.on('text', t => { if (field) text += t; });
    parser.on('cdata', t => { if (field) text += t; });
    parser.on('closetag', name => {
      if (field && name === field) {
        if (field === 'display-name' && chan) {
          const k = norm(text);
          if (k && wantNames.has(k) && !nameToId[k]) { nameToId[k] = chan.id; matched.add(chan.id); }
          if (wantLoose) {
            const lk = looseNorm(text);
            if (lk && wantLoose.has(lk)) {
              if (!nameToIdLoose[lk]) nameToIdLoose[lk] = chan.id;
              matched.add(chan.id);
            }
          }
        } else if (prog) {
          if (field === 'title' && !prog.title) prog.title = text.trim();
          if (field === 'desc' && !prog.desc) prog.desc = text.trim().slice(0, 400);
        }
        field = null;
      } else if (name === 'channel') chan = null;
      else if (name === 'programme' && prog) {
        (programmes[prog.id] || (programmes[prog.id] = [])).push([prog.start, prog.stop, prog.title, prog.desc]);
        prog = null;
      }
    });
    parser.on('error', function (e) {
      // be tolerant of junk in provider XML
      this._parser.error = null;
      this._parser.resume();
    });
    parser.on('end', () => {
      // keep only channels the playlist references (by id or by name)
      const keep = new Set([...wantIds, ...Object.values(nameToId), ...Object.values(nameToIdLoose)]);
      const out = {};
      for (const id of Object.keys(programmes)) {
        if (keep.has(id) || wantIds.has(id.toLowerCase())) {
          out[id] = sortUniq(programmes[id]);
        }
      }
      resolve({ programmes: out, nameToId, nameToIdLoose });
    });

    let first = true;
    let sink = parser;
    const feed = (input) => {
      input.on('data', chunk => {
        if (first) {
          first = false;
          if (chunk[0] === 0x1f && chunk[1] === 0x8b) {
            const gz = zlib.createGunzip();
            gz.on('error', reject);
            gz.pipe(parser);
            sink = gz;
          }
        }
        sink.write(chunk);
      });
      input.on('end', () => sink.end());
      input.on('error', reject);
    };
    if (Buffer.isBuffer(source) || typeof source === 'string') {
      feed(Readable.from([Buffer.from(source)]));
    } else {
      feed(Readable.fromWeb(source));
    }
  });
}

async function fetchEpg(url, ua, wantIds, wantNames, wantLoose) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 300000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua || 'VLC/3.0.20 LibVLC/3.0.20' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`Dagskrá: HTTP ${res.status}`);
    return await parseXmltv(res.body, wantIds, wantNames, { wantLoose });
  } finally { clearTimeout(t); }
}

module.exports = { parseXmltv, parseXmltvTime, fetchEpg, norm, looseNorm };
