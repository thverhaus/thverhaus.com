'use strict';
// M3U / M3U8 playlist parser. Returns { epgUrl, channels: [...] }

// key="value", key='value' or key=value (unquoted)
const ATTR_RE = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,"']+))/g;

function parseAttrs(str) {
  const out = {};
  // only look at the part before the channel name
  const head = str.slice(0, attrEnd(str));
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(head))) {
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    out[m[1].toLowerCase().replace(/_/g, '-')] = v.trim();
  }
  return out;
}

// index of the comma that separates attributes from the channel name
function attrEnd(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") { if (/=\s*$/.test(line.slice(0, i))) q = c; }
    else if (c === ',') return i;
  }
  return line.length;
}

// Name is the text after the comma that follows the attribute list.
function extractName(line) {
  const i = attrEnd(line);
  return i < line.length ? line.slice(i + 1).trim() : '';
}

function guessKind(url) {
  if (/\/movie\//i.test(url)) return 'movie';
  if (/\/series\//i.test(url)) return 'series';
  return 'live';
}

function parseM3U(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let epgUrl = '';
  const channels = [];
  let cur = null;
  let pendingGroup = '';
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const a = parseAttrs(line);
      epgUrl = a['url-tvg'] || a['x-tvg-url'] || a['tvg-url'] || '';
      if (epgUrl.includes(',')) epgUrl = epgUrl.split(',')[0].trim();
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const a = parseAttrs(line);
      cur = {
        name: extractName(line) || a['tvg-name'] || 'Án nafns',
        tvgId: a['tvg-id'] || '',
        tvgName: a['tvg-name'] || '',
        logo: a['tvg-logo'] || a['logo'] || '',
        group: a['group-title'] || a['tvg-group'] || a['group'] || a['category'] || '',
        catchup: a['catchup'] || a['catchup-type'] || '',
        catchupDays: a['catchup-days'] || a['timeshift'] || '',
        ua: a['user-agent'] || ''
      };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice(11);
      if (cur && /^http-user-agent=/i.test(opt)) cur.ua = opt.split('=').slice(1).join('=');
      continue;
    }
    if (line.startsWith('#')) continue;
    // URL line
    if (!cur) cur = { name: line.split('/').pop() || 'Rás', tvgId: '', tvgName: '', logo: '', group: '' };
    if (!cur.group) cur.group = pendingGroup || 'Án flokks';
    cur.url = line;
    cur.kind = guessKind(line);
    channels.push(cur);
    cur = null;
    pendingGroup = '';
  }
  return { epgUrl, channels };
}

module.exports = { parseM3U, parseAttrs, extractName };
