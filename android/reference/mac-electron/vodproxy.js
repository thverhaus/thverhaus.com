'use strict';
// Movies & episodes go through a bundled ffmpeg:
//  - remuxes/transcodes MKV, AVI, AC3, DTS … into fragmented MP4 that the player understands
//  - keeps at most ONE connection to the provider open (old ffmpeg is killed and has
//    exited before a new one starts), also when seeking
//  - seeking = restarting ffmpeg at the new position (-ss), so long jumps are instant
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const OK_VIDEO = /^(h264|hevc|h265|vp9|av1)$/;
const OK_AUDIO = /^(aac|mp3|opus)$/;

function findFfmpeg(resourcesPath) {
  const cands = [
    resourcesPath && path.join(resourcesPath, 'ffmpeg'),
    path.join(__dirname, '..', 'build', 'ffmpeg', `darwin-${process.arch}`, 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'
  ].filter(Boolean);
  for (const c of cands) {
    if (process.platform !== 'darwin' && c.includes('darwin-')) continue;
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { }
  }
  return null;
}

class VodProxy {
  constructor({ resourcesPath, getUserAgent, log }) {
    this.ffmpeg = findFfmpeg(resourcesPath);
    this.getUA = getUserAgent || (() => 'VLC/3.0.20 LibVLC/3.0.20');
    this.log = log || (() => { });
    this.proc = null;        // the one ffmpeg process allowed to talk to the provider
    this.procs = new Set();  // every child that may still hold a provider connection
    this.stopping = null;    // teardown in progress (all callers wait for the same one)
    this.gen = 0;            // newest request wins; older ones must back off
    this.port = null;
    this.probeCache = new Map();
    if (this.ffmpeg && process.platform === 'darwin') {
      // files from a downloaded zip carry a quarantine flag that can stop the helper from starting
      execFile('/usr/bin/xattr', ['-d', 'com.apple.quarantine', this.ffmpeg], () => { });
    }
  }

  available() { return !!this.ffmpeg; }

  // Does the provider honour HTTP Range requests? Without it ffmpeg has to read the
  // file from the very beginning when we seek, so "halda áfram" can take minutes.
  // One tiny 1 KB request per host, cached for the session, and never while a stream runs.
  async rangeSupport(src) {
    let key = src;
    try { key = 'range:' + new URL(src).host; } catch { }
    if (this.probeCache.has(key)) return this.probeCache.get(key);
    const ok = await new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        const lib = /^https:/i.test(src) ? require('https') : http;
        const req = lib.request(src, {
          method: 'GET',
          headers: { Range: 'bytes=0-1023', 'User-Agent': this.getUA() }
        }, (res) => {
          const code = res.statusCode;
          res.destroy();                     // we only wanted the answer, not the data
          done(code === 206);
        });
        req.setTimeout(4000, () => { req.destroy(); done(false); });
        req.on('error', () => done(false));
        req.end();
      } catch { done(false); }
    });
    this.probeCache.set(key, ok);
    return ok;
  }

  // every ffmpeg is tracked so nothing can be left running (and talking to the provider)
  spawnChild(args, stdio) {
    const p = spawn(this.ffmpeg, args, { stdio });
    this.procs.add(p);
    const gone = () => this.procs.delete(p);
    p.once('exit', gone);
    p.once('error', gone);
    return p;
  }

  // Stop the current ffmpeg and wait until it has really exited (= provider connection
  // closed). Calls are serialized: a second caller waits for the teardown that is
  // already running instead of starting a parallel one.
  stop() {
    if (!this.stopping) {
      this.stopping = this.stopAll().finally(() => { this.stopping = null; });
    }
    return this.stopping;
  }

  async stopAll() {
    const list = [...this.procs];
    this.proc = null;
    if (!list.length) return;
    await Promise.all(list.map(p => new Promise((resolve) => {
      if (p.exitCode !== null || p.signalCode) return resolve();
      const t = setTimeout(resolve, 3000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.kill('SIGKILL'); } catch { resolve(); }
    })));
    await new Promise(r => setTimeout(r, 600));   // let the provider notice the closed socket
  }

  inputArgs(url) {
    return ['-hide_banner', '-nostdin', '-user_agent', this.getUA(),
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5',
      '-rw_timeout', '20000000'];
  }

  // Read container info (duration, codecs). Uses the single connection, then frees it.
  async probe(url) {
    if (this.probeCache.has(url)) return this.probeCache.get(url);
    const gen = ++this.gen;          // cancel whatever was being opened before
    await this.stop();
    if (gen !== this.gen) {          // a newer request has taken over: don't open a second connection
      return this.probeCache.get(url) || { duration: 0, video: null, audio: null, error: null };
    }
    const info = await new Promise((resolve) => {
      const p = this.spawnChild([...this.inputArgs(url), '-i', url], ['ignore', 'ignore', 'pipe']);
      this.proc = p;
      let err = '';
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } }, 25000);
      p.stderr.on('data', d => { err += d.toString(); if (err.length > 200000) err = err.slice(-100000); });
      p.on('exit', () => {
        clearTimeout(t);
        if (this.proc === p) this.proc = null;
        const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
        const v = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: (\w+)/.exec(err);
        const a = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: (\w+)/.exec(err);
        resolve({
          duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
          video: v ? v[1] : null, audio: a ? a[1] : null,
          error: !v && !a ? (err.split('\n').filter(l => /error|forbidden|denied|refused|404|403|401|timed out/i.test(l)).pop() || 'Náði ekki að opna skrána') : null
        });
      });
    });
    await new Promise(r => setTimeout(r, 600));
    if (!info.error) this.probeCache.set(url, info);
    return info;
  }

  async start() {
    if (!this.ffmpeg) return null;
    const server = http.createServer((req, res) => this.handle(req, res));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    this.port = server.address().port;
    this.server = server;
    return this.port;
  }

  // Live channel the normal player can't handle: convert to H.264/HEVC + AAC in MPEG-TS
  // (timestamps kept with -copyts, so buffering and watch-together keep working)
  async handleLive(req, res, src) {
    const gen = ++this.gen;          // a newer request (another channel) wins
    await this.stop();
    if (gen !== this.gen || req.destroyed) return;
    const info = await this.probeLive(src);
    if (gen !== this.gen || req.destroyed) { try { res.end(); } catch { } return; }
    const vcopy = info.video && /^(h264|hevc|h265)$/.test(info.video);
    const args = [...this.inputArgs(src), '-copyts', '-fflags', '+genpts+discardcorrupt', '-i', src,
      '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn'];
    if (vcopy) args.push('-c:v', 'copy'); else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '21', '-pix_fmt', 'yuv420p', '-g', '50');
    // copy the audio when the player understands it (saves CPU); only re-encode what MSE can't take
    const acopy = !!info.audio && /^(aac|mp3)$/.test(info.audio);
    if (acopy) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
    args.push('-f', 'mpegts', '-muxdelay', '0', 'pipe:1');
    this.log(`ffmpeg (bein rás): ${vcopy ? 'afrit' : 'umkóðun'} mynd (${info.video || '?'}), ${acopy ? 'afrit' : 'umkóðun'} hljóð (${info.audio || '?'})`);
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    // The relay must never go quiet: a Wi-Fi drop leaves the provider socket hanging with
    // no error at all, and ffmpeg's own -reconnect does not always notice. So we watch the
    // bytes ourselves and start a fresh ffmpeg on the SAME response when the stream goes
    // silent – the player only ever talks to 127.0.0.1 and never sees a broken connection.
    let child = null, closed = false, respawns = 0, lastByte = Date.now();
    const spawnOne = () => {
      const p = this.spawnChild(args, ['ignore', 'pipe', 'pipe']);
      child = p; this.proc = p; lastByte = Date.now();
      let errTail = '';
      p.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-2000); });
      let firstByte = true;
      p.stdout.on('data', () => {
        lastByte = Date.now();
        if (!firstByte) return;
        firstByte = false;
        // the diary then shows both sides of a drop: when the relay went quiet and when
        // the fresh ffmpeg started delivering again (the player may start at a new PTS)
        if (respawns > 0) this.log(`Nýtt ffmpeg komið í gang eftir ${respawns} tilraun${respawns > 1 ? 'ir' : ''}`);
      });
      p.stdout.pipe(res, { end: false });
      p.on('exit', (code) => {
        if (closed || child !== p) return;
        child = null;
        if (code && code !== 255) this.log(`ffmpeg (bein rás) hætti (${code}): ${errTail.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
        // after a drop the watchdog starts a new ffmpeg on the same response; the stream is
        // only closed when the very first attempt fails (never delivered) or we give up
        if (respawns === 0 || respawns >= 12) { try { res.end(); } catch { } }
      });
    };
    spawnOne();
    const kill = () => {
      if (closed) return;
      closed = true; clearInterval(wd);
      const p = child; child = null;
      if (!p) return;
      if (this.proc === p) this.stop(); else { try { p.kill('SIGKILL'); } catch { } }
    };
    const wd = setInterval(async () => {
      if (closed || gen !== this.gen || res.destroyed) return;
      if (Date.now() - lastByte < VodProxy.SILENT_MS) return;
      if (respawns >= 12) { this.log('Relay fékk ekkert streymi – hætti'); kill(); return; }
      respawns++;
      this.log(`Relay þaggaði ${Math.round((Date.now() - lastByte) / 1000)} sek – endurræsi ffmpeg (${respawns})`);
      const old = child; child = null;
      if (old) {
        try { old.stdout.unpipe(res); } catch { }
        try { old.kill('SIGKILL'); } catch { }
      }
      await new Promise(r => setTimeout(r, 600));   // let the provider notice the closed socket
      if (closed || gen !== this.gen || res.destroyed) return;
      spawnOne();
    }, 2000);
    req.on('close', kill); res.on('close', kill);
  }

  // codecs of a live stream (reads a few seconds, then closes the connection)
  async probeLive(src) {
    if (this.probeCache.has('live:' + src)) return this.probeCache.get('live:' + src);
    const info = await new Promise((resolve) => {
      const p = this.spawnChild([...this.inputArgs(src), '-t', '1', '-i', src, '-f', 'null', '-'], ['ignore', 'ignore', 'pipe']);
      this.proc = p;
      let err = '';
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } }, 15000);
      p.stderr.on('data', d => { err += d.toString(); if (err.length > 100000) err = err.slice(-50000); });
      p.on('exit', () => {
        clearTimeout(t);
        if (this.proc === p) this.proc = null;
        const v = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: (\w+)/.exec(err);
        const a = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: (\w+)/.exec(err);
        resolve({ video: v ? v[1] : null, audio: a ? a[1] : null });
      });
    });
    await new Promise(r => setTimeout(r, 600));
    this.probeCache.set('live:' + src, info);
    return info;
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/live') {
      const src = u.searchParams.get('src');
      if (!/^https?:\/\//.test(src || '')) { res.writeHead(400); res.end(); return; }
      return this.handleLive(req, res, src);
    }
    if (u.pathname !== '/vod') { res.writeHead(404); res.end(); return; }
    const src = u.searchParams.get('src');
    const at = Math.max(0, parseFloat(u.searchParams.get('t') || '0') || 0);
    if (!/^https?:\/\//.test(src || '')) { res.writeHead(400); res.end(); return; }
    let info = this.probeCache.get(src) || { video: null, audio: null };
    const gen = ++this.gen;      // a newer request (another movie / seek) wins
    await this.stop();   // one connection at a time
    if (gen !== this.gen || req.destroyed) { try { res.end(); } catch { } return; }
    const vcopy = info.video && OK_VIDEO.test(info.video);
    const acopy = info.audio && OK_AUDIO.test(info.audio);
    const args = [...this.inputArgs(src)];
    if (at > 0) args.push('-ss', String(at));
    args.push('-i', src, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn');
    if (vcopy) { args.push('-c:v', 'copy'); if (/hevc|h265/.test(info.video)) args.push('-tag:v', 'hvc1'); }
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
    if (acopy) args.push('-c:a', 'copy'); else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
    args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1');
    this.log(`ffmpeg: ${vcopy ? 'afrit' : 'umkóðun'} mynd (${info.video || '?'}), ${acopy ? 'afrit' : 'umkóðun'} hljóð (${info.audio || '?'})${at ? ', frá ' + Math.round(at) + ' sek' : ''}`);
    const p = this.spawnChild(args, ['ignore', 'pipe', 'pipe']);
    this.proc = p;
    let errTail = '';
    p.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-2000); });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    p.stdout.pipe(res);
    const kill = () => { if (this.proc === p) this.stop(); else { try { p.kill('SIGKILL'); } catch { } } };
    req.on('close', kill);
    res.on('close', kill);
    p.on('exit', (code) => {
      if (code && code !== 255) this.log(`ffmpeg hætti (${code}): ${errTail.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
      try { res.end(); } catch { }
    });
  }

  base() { return this.port ? `http://127.0.0.1:${this.port}` : null; }

  url(src, at) { return `http://127.0.0.1:${this.port}/vod?src=${encodeURIComponent(src)}&t=${Math.max(0, at || 0).toFixed(1)}`; }
}

// no bytes for this long on a live channel → the relay restarts ffmpeg on the same response
VodProxy.SILENT_MS = 8000;

module.exports = { VodProxy, findFfmpeg };
