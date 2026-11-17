'use strict';
// Small local web server so playlists can be added from any browser on the network.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

function readBody(req, limit = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Of stór skrá')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * api: { list(), add(obj), addFile(name, text, epgUrl), remove(id), activate(id), refresh(id), update(id, obj) }
 */
function startWebServer(port, api) {
  const page = path.join(__dirname, '..', 'web', 'admin.html');
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      const u = new URL(req.url, 'http://x');
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(page));
        return;
      }
      if (u.pathname === '/api/playlists' && req.method === 'GET') return send(200, api.list());
      if (u.pathname === '/api/playlists' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
        return send(200, await api.add(body));
      }
      if (u.pathname === '/api/upload' && req.method === 'POST') {
        const text = (await readBody(req)).toString('utf8');
        return send(200, await api.addFile(u.searchParams.get('name') || 'Playlist', text, u.searchParams.get('epg') || ''));
      }
      let m = /^\/api\/playlists\/([\w-]+)(?:\/(activate|refresh))?$/.exec(u.pathname);
      if (m) {
        const [, id, action] = m;
        if (req.method === 'DELETE' && !action) return send(200, await api.remove(id));
        if (req.method === 'PUT' && !action) {
          const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
          return send(200, await api.update(id, body));
        }
        if (req.method === 'POST' && action === 'activate') return send(200, await api.activate(id));
        if (req.method === 'POST' && action === 'refresh') return send(200, await api.refresh(id));
      }
      send(404, { error: 'Fannst ekki' });
    } catch (e) {
      send(400, { error: e.message || String(e) });
    }
  });
  return new Promise((resolve) => {
    let tries = 0;
    const tryListen = (p) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && tries++ < 10) tryListen(p + 1);
        else resolve({ server, port: null, error: e.message });
      });
      server.listen(p, '0.0.0.0', () => resolve({ server, port: server.address().port }));
    };
    tryListen(port);
  });
}

module.exports = { startWebServer, lanAddresses };
