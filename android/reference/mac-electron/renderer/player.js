'use strict';
/* global mpegts, Hls */
// Mulehead player: wraps mpegts.js (MPEG-TS live), hls.js (HLS) and native <video>
// with pre-buffering, stall detection and automatic reconnect.

const PTS_WRAP = 8589934592 / 90000; // 33-bit PTS wraps every ~26.5 h

// ---- MPEG-TS timestamp sniffer (used for "watch together" sync) ----
// mpegts.js rebases timestamps to 0, so we read the first DTS/PTS from the raw stream
// ourselves: absolute stream time = base + video.currentTime
class TsSniffer {
  constructor() { this.left = null; this.video = null; this.audio = null; this.bytes = 0; this.done = false; }
  readTs(b, i) {
    return ((b[i] & 0x0e) * 536870912) + ((b[i + 1] << 22) | ((b[i + 2] & 0xfe) << 14) | (b[i + 3] << 7) | ((b[i + 4] & 0xfe) >>> 1));
  }
  push(chunk) {
    if (this.done) return;
    let b = chunk;
    if (this.left) { const m = new Uint8Array(this.left.length + chunk.length); m.set(this.left); m.set(chunk, this.left.length); b = m; }
    let i = 0;
    while (i < b.length && b[i] !== 0x47) i++;
    for (; i + 188 <= b.length; i += 188) {
      if (b[i] !== 0x47) { while (i < b.length && b[i] !== 0x47) i++; i -= 188; continue; }
      const pusi = b[i + 1] & 0x40;
      if (!pusi) continue;
      const afc = (b[i + 3] >> 4) & 3;
      let p = i + 4;
      if (afc === 2) continue;
      if (afc === 3) p += 1 + b[i + 4];
      if (p + 19 > i + 188) continue;
      if (b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1) continue;
      const sid = b[p + 3];
      const isVideo = sid >= 0xe0 && sid <= 0xef;
      const isAudio = (sid >= 0xc0 && sid <= 0xdf) || sid === 0xbd;
      if (!isVideo && !isAudio) continue;
      const flags = (b[p + 7] >> 6) & 3;
      if (!(flags & 2)) continue;
      const pts = this.readTs(b, p + 9);
      const dts = flags === 3 ? this.readTs(b, p + 14) : pts;
      if (isVideo && this.video === null) this.video = dts;
      if (isAudio && this.audio === null) this.audio = pts;
    }
    this.left = b.slice(i);
    this.bytes += chunk.length;
    if ((this.video !== null && this.audio !== null) || this.bytes > 4e6) this.done = true;
  }
  base() {
    const v = [this.video, this.audio].filter(x => x !== null);
    return v.length ? Math.min(...v) / 90000 : null;
  }
}

// patch fetch so the sniffer sees bytes that mpegts.js downloads
let activeSniff = null; // { url, sniffer }
const origFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const res = await origFetch(input, init);
  const url = typeof input === 'string' ? input : (input && input.url);
  if (activeSniff && url === activeSniff.url && res.body) {
    const sniffer = new TsSniffer();
    activeSniff.sniffer = sniffer;
    const ts = new TransformStream({ transform(chunk, ctl) { try { sniffer.push(chunk); } catch { } ctl.enqueue(chunk); } });
    const wrapped = new Response(res.body.pipeThrough(ts), { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(wrapped, 'url', { value: res.url });
    return wrapped;
  }
  return res;
};

function streamType(url) {
  const u = url.split('?')[0].toLowerCase();
  if (u.endsWith('.m3u8') || u.includes('/hls/') || u.includes('.m3u8')) return 'hls';
  if (/\.(mp4|mkv|mov|avi|webm|m4v)$/.test(u)) return 'native';
  return 'ts';
}

class Player {
  constructor(video, { onStatus, log, onBank, onDead } = {}) {
    this.video = video;
    this.log = log || (() => { });
    this.onStatus = onStatus || (() => { });
    this.onBank = onBank || (() => { });   // "Hlaða buffer" (see bankTo)
    this.onDead = onDead || null;          // the channel is dead (see dead())
    this.engine = null; this.kind = null; this.url = null;
    this.opts = { bufferSec: 5 };
    this.attempt = 0; this.session = 0;
    this.state = 'idle';
    this.lastTime = 0; this.lastProgress = 0; this.goodSince = 0;
    this.hold = null; this.reconnectTimer = null; this.bufferTimer = null;
    this.bank = null; this.bankTimer = null;   // "Hlaða buffer" (see bankTo)
    this.fails = [];                           // when the last attempts failed (see dead)
    this.hlsInitPts = null;
    this.triedHlsFallback = false;
    // data watchdog: when did bytes last arrive? (a Wi-Fi drop raises NO error at all:
    // the connection just goes silent while the picture keeps playing from the buffer)
    this.lastDataAt = performance.now(); this.bufEnd = 0;
    this.useRelay = false; this.relayOk = false; this.relayFallback = false;
    // frame watchdog: the buffer can be full while no frame is drawn at all (a fresh ffmpeg
    // in the relay comes back at the live edge, the timeline jumps and the picture stands
    // still for ever – the buffer grew 10 -> 30+ sek on 9. nóv. with a frozen picture)
    this.lastFrameAt = 0;
    this.lastFreezeAt = 0;
    this.freezeCount = 0; this.frameWatchHold = 0;
    this.jumpedAt = 0;                       // last deliberate jump (live edge / over a hole)
    this.lastDryAt = 0;                      // last time the buffer ran dry (see onWaiting)
    this.watchFrames();
    // the OS says the network is back: no point in waiting out the reconnect backoff
    const onOnline = () => {
      if (!this.url || this.vod) return;
      if (!/^(reconnecting|buffering|error|dead)$/.test(this.state) || this.silentFor() < 3) return;
      this.log(`Net kom aftur – endurtengi strax (${this.state})`);
      this.fails = [];                       // a new network: the old failures say nothing now
      clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
      this.session++; this.teardown();
      this.setState('connecting', 'Tengist…');
      this.scheduleOpen(Player.CLOSE_GAP_MS);
    };
    if (typeof window.addEventListener === 'function') window.addEventListener('online', onOnline);
    video.addEventListener('error', () => { if (video.error && video.error.code === 4 && !this.vod && this.useFfmpeg()) return; this.fail('Villa í spilara'); });
    video.addEventListener('ended', () => { if (!this.vod && this.kind !== 'native') this.fail('Streymi endaði'); else this.setState('ended', 'Búið'); });
    video.addEventListener('waiting', () => this.onWaiting());
    video.addEventListener('playing', () => this.setState('playing'));
    this.watchdog = setInterval(() => this.tick(), 1000);
  }

  setState(s, msg) {
    this.state = s; this.onStatus(s, msg || '');
    // a fresh playback start must not look like a frozen picture
    if (s === 'playing') this.lastFrameAt = performance.now();
  }

  bufferedAhead() {
    const v = this.video, t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.3 && v.buffered.end(i) >= t) {
        // A provider whose timestamps are far in the future makes the element report a
        // buffer of millions of seconds (9. nóv.: 4.294.952 sek after fast zapping). A
        // number like that turns off every watchdog and sends seekToEdge() into nowhere,
        // so anything beyond the biggest possible target (120 sek) is treated as absurd.
        return Math.min(v.buffered.end(i) - t, Player.MAX_AHEAD_SEC);
      }
    }
    return 0;
  }

  // seconds since data last arrived (buffer growth) – NOT since the picture last moved
  silentFor() { return (performance.now() - this.lastDataAt) / 1000; }

  // seconds since the browser last presented a video frame. 0 = the browser can't tell us.
  frozenFor() { return this.lastFrameAt ? (performance.now() - this.lastFrameAt) / 1000 : 0; }

  // A hidden window draws no frames at all (Chromium stops presenting them): the frame
  // watchdog must not mistake that for a frozen picture.
  pageVisible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }

  // ask the browser to tell us whenever a frame is really drawn (Chromium: cheap and exact)
  watchFrames() {
    const v = this.video;
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return;
    const onFrame = () => { this.lastFrameAt = performance.now(); v.requestVideoFrameCallback(onFrame); };
    v.requestVideoFrameCallback(onFrame);
  }

  // Jump close to the live edge of the buffer. A video track whose timestamps ran ahead
  // of the audio while the audio kept playing leaves the picture frozen until the
  // timestamps catch up – a seek snaps both tracks at once, without a new connection.
  // A 15 sek cushion is left in front of the play head so playback resumes at once
  // (landing on the very last second starts a "Safnar í buffer" stop of its own).
  seekToEdge() {
    const v = this.video;
    if (!v.buffered.length) return false;
    const end = v.buffered.end(v.buffered.length - 1);
    const ahead = end - v.currentTime;
    // an end thousands of seconds ahead is not a real buffer (broken stream timestamps):
    // seeking there would leave the picture with nothing at all in front of it
    if (ahead < 17 || ahead > Player.MAX_AHEAD_SEC) {
      if (ahead > Player.MAX_AHEAD_SEC) this.log(`Buffergildið segir ${ahead.toFixed(0)} sek fram – ekki stökkt (gallaðir tímar)`);
      return false;
    }
    const to = end - 15;
    this.log(`Myndin fraus – stökk á lífbeinta brún (${(to - v.currentTime).toFixed(0)} sek fram)`);
    v.currentTime = Math.max(0, to);
    this.jumpedAt = performance.now();
    this.lastProgress = this.jumpedAt;
    this.lastFrameAt = this.jumpedAt;
    return true;
  }

  // The stream has a hole in front of currentTime (the relay's fresh ffmpeg begins at the
  // live edge, so the timeline jumps 20–40 sek forward). Jump over it – returns true when
  // the picture was moved. Without this the element waits in front of the hole for ever.
  jumpGap(maxSec) {
    const v = this.video;
    for (let i = 0; i < v.buffered.length; i++) {
      const s = v.buffered.start(i);
      if (s > v.currentTime + 0.05 && s - v.currentTime < maxSec) {
        const gap = s - v.currentTime;
        this.log(`${gap > 15 ? 'Lífbeint fram' : 'Gat í streymi'} – hoppaði yfir ${gap.toFixed(1)} sek`);
        v.currentTime = s + 0.05;
        this.jumpedAt = performance.now();
        this.lastProgress = this.jumpedAt;
        this.lastFrameAt = this.jumpedAt;
        return true;
      }
    }
    return false;
  }

  // after the provider has had time to release the old connection (SWITCH_GAP_MS).
  // Rapid zapping then opens just the last channel, and the provider always sees the
  // old connection closed before a new one appears (many subscriptions allow only ONE
  // stream at a time).
  play(url, opts = {}) {
    this.session++;
    this.teardown();
    this.url = url;
    this.opts = { ...this.opts, ...opts };
    this.attempt = 0;
    this.fails = [];                      // another channel: the old failures are not its own
    this.triedHlsFallback = false;
    this.kind = opts.forceKind || streamType(url);
    this.srcUrl = url;
    this.viaFfmpeg = false;
    this.relayOk = false; this.relayFallback = false; this.codecHop = false;
    // Live channels go through the bundled ffmpeg on 127.0.0.1 when it is available:
    // its own connection to the provider survives a Wi-Fi drop (-reconnect) while the
    // player keeps talking to localhost, so nothing dies on this side at all.
    // player keeps talking to localhost, so nothing dies on this side at all.
    this.useRelay = !opts.vod && !(opts.forceKind) && opts.liveRelay !== false &&
      !!opts.ffmpegBase && /^(ts|hls)$/.test(streamType(url));
    if (this.useRelay) this.url = `${opts.ffmpegBase}/live?src=${encodeURIComponent(url)}`;
    this.vod = !!opts.vod;
    this.lastDataAt = performance.now(); this.bufEnd = 0;
    this.resumeAt = opts.startAt || 0;
    this.lastProgress = performance.now();   // no "frozen stream" while the gap runs
    this.lastFrameAt = this.lastProgress;    // same for the frame watchdog
    this.freezeCount = 0; this.frameWatchHold = 0; this.jumpedAt = 0; this.lastDryAt = 0;
    this.setState('connecting', 'Tengist…');
    // channel switch: 3 sek so the old stream is gone before the new one starts
    this.scheduleOpen(this.vod ? 50 : Player.SWITCH_GAP_MS);
  }

  // `gap` = at least this many milliseconds must have passed since the last teardown
  // before a connection may be opened.
  scheduleOpen(gap) {
    clearTimeout(this.startTimer);
    const sinceClose = this.lastCloseAt ? performance.now() - this.lastCloseAt : Infinity;
    const delay = Math.max(0, gap - sinceClose);
    const sess = this.session;
    this.startTimer = setTimeout(() => {
      if (sess !== this.session || !this.url) return;
      this.releaseThen(() => { if (sess === this.session && this.url) this.start(); });
    }, delay);
  }

  // Wait until the provider has had time to release the stream we just closed.
  // Used when a channel is left for a movie: the movie goes through the bundled ffmpeg
  // and its first connection may not be opened while the channel is still counted.
  waitRelease(gap) {
    const sinceClose = this.lastCloseAt ? performance.now() - this.lastCloseAt : Infinity;
    const delay = Math.max(0, gap - sinceClose);
    return delay > 0 ? new Promise(r => setTimeout(r, delay)) : Promise.resolve();
  }

  // The provider connection may still be held by the bundled ffmpeg (movies, or a
  // channel the player can't decode). Nothing new may be opened until it has let go,
  // otherwise the provider counts two streams.
  releaseThen(fn) {
    const rel = this.vod ? null : this.opts.release;
    if (!rel) { fn(); return; }
    let done = false;
    const go = () => { if (done) return; done = true; fn(); };
    try { Promise.resolve(rel()).then(go, go); } catch { go(); }
  }

  targetSec() { return Math.max(1, Math.min(120, Number(this.opts.bufferSec) || 60)); }

  start() {
    this.session++;
    this.teardown();
    const sess = this.session;
    const v = this.video;
    this.setState('connecting', this.attempt ? `Tengist aftur… (${this.attempt})` : 'Tengist…');
    this.lastProgress = performance.now();
    // A new connection starts from scratch: the old buffer is gone, so the data watchdog must
    // not compare against the buffer end of the stream we just closed (it did, and the player
    // then believed the fresh feed was silent and reconnected in a loop every ~15 sek).
    this.bufEnd = 0; this.lastDataAt = this.lastProgress;
    this.hlsInitPts = null;
    this.log(`Opna tengingu${this.attempt ? ' (tilraun ' + (this.attempt + 1) + ')' : ''}`);
    if (this.kind === 'hls' && window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1,
        maxBufferLength: Math.max(60, this.targetSec() + 30),
        maxMaxBufferLength: 180,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 2000, levelLoadingRetryDelay: 2000, fragLoadingRetryDelay: 2000,
        startFragPrefetch: false
      });
      this.engine = hls;
      hls.on(Hls.Events.INIT_PTS_FOUND, (_e, d) => { if (d && d.initPTS != null) this.hlsInitPts = d.initPTS / (d.timescale || 90000); });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        const code = d.response && d.response.code;
        if (sess === this.session) this.log(`HLS ${d.fatal ? 'alvarleg ' : ''}villa: ${d.type}/${d.details}${code ? ' HTTP ' + code : ''}`);
        if (!d.fatal || sess !== this.session) return;
        if (this.triedHlsFallback && /PARSING/.test(d.details || '') && this.useFfmpeg()) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if ((this.hlsMediaErrors = (this.hlsMediaErrors || 0) + 1) > 2 && this.useFfmpeg()) return;
          hls.recoverMediaError(); return;
        }
        this.fail('Netvilla', code);
      });
      hls.loadSource(this.url);
      hls.attachMedia(v);
    } else if (this.kind === 'native' || (this.vod && this.kind !== 'hls')) {
      // movies / episodes: let the browser handle buffering and seeking
      v.src = this.url;
      v.controls = !this.opts.proxied;
      const at = this.opts.proxied ? 0 : this.resumeAt;
      v.addEventListener('loadedmetadata', () => { if (sess === this.session && at > 5 && at < (v.duration || 1e9) - 10) v.currentTime = at; }, { once: true });
      const pr = v.play(); if (pr && pr.catch) pr.catch(() => { });
      this.setState('buffering', 'Hleður…');
      return;
    } else {
      activeSniff = { url: this.url, sniffer: null };
      const p = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: this.url }, {
        enableWorker: false,
        enableStashBuffer: true,
        stashInitialSize: 512 * 1024,
        lazyLoad: false,
        liveBufferLatencyChasing: false,
        liveSync: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 40,
        autoCleanupMinBackwardDuration: 20,
        fixAudioTimestampGap: true
      });
      this.engine = p;
      p.on(mpegts.Events.ERROR, (type, detail, info) => {
        if (sess !== this.session) return;
        const code = info && info.code;
        this.log(`TS villa: ${type}/${detail}${code ? ' HTTP ' + code : ''}${info && info.msg ? ' ' + info.msg : ''}`);
        // ffmpeg understands nearly everything (also HLS behind an extensionless URL)
        if (type === mpegts.ErrorTypes.MEDIA_ERROR && !this.viaFfmpeg && this.useFfmpeg()) return;
        if (type === mpegts.ErrorTypes.MEDIA_ERROR && !this.triedHlsFallback && window.Hls && !this.viaFfmpeg) {
          // maybe it's actually HLS behind an extensionless URL
          this.triedHlsFallback = true; this.kind = 'hls';
          this.session++; this.teardown(); this.scheduleOpen(Player.CLOSE_GAP_MS); return;
        }
        this.fail(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'Netvilla' : 'Villa í streymi', code);
      });
      // server closed the connection: treat as a drop (we keep playing the buffer meanwhile)
      p.on(mpegts.Events.LOADING_COMPLETE, () => { if (sess === this.session) this.fail('Streymi slitnaði'); });
      p.attachMediaElement(v);
      p.load();
    }
    // fast start: begin playing after a few seconds, then grow the buffer gradually.
    // After a drop we fill a bit more first, so the picture does not stop again at once.
    const first = this.attempt > 0 ? Player.RESUME_START_SEC : Player.FAST_START_SEC;
    this.waitForBuffer(Math.min(this.targetSec(), first), sess, true);
  }

  // The normal player can't decode this channel: play it through the bundled ffmpeg instead
  useFfmpeg() {
    // one hop only: the relay already converts everything, so a stream that still won't play
    // goes direct once and then gives up instead of ping-ponging between the two
    if (this.vod || this.viaFfmpeg || this.codecHop) return false;
    if (this.useRelay) {
      if (!this.relayOk) return false;   // nothing ever arrived – reconnect() handles that
      this.relayFallback = true; this.useRelay = false;
      this.url = this.srcUrl; this.kind = streamType(this.srcUrl);
      this.log('Relay streymið virkaði ekki í spilaranum – fer beint á þráðinn');
    } else {
      if (!this.opts.ffmpegBase) return false;
      this.viaFfmpeg = true;
      this.log('Spilarinn ræður ekki við rásina – skipti yfir í ffmpeg');
      this.url = `${this.opts.ffmpegBase}/live?src=${encodeURIComponent(this.srcUrl)}`;
      this.kind = 'ts';
    }
    this.codecHop = true;
    this.session++; this.teardown();
    this.setState('connecting', 'Opna með ffmpeg…');
    this.scheduleOpen(Player.CLOSE_GAP_MS);
    return true;
  }

  // hold playback until enough is buffered (smooths out Wi-Fi hiccups)
  waitForBuffer(sec, sess, initial) {
    clearInterval(this.bufferTimer);
    const v = this.video;
    const t0 = performance.now();
    let best = 0, bestAt = t0;
    v.pause();
    this.setState('buffering', initial ? 'Hleður…' : 'Safnar í buffer…');
    this.bufferTimer = setInterval(() => {
      if (sess !== this.session) { clearInterval(this.bufferTimer); return; }
      const ahead = this.bufferedAhead();
      const now = performance.now();
      const waited = (now - t0) / 1000;
      if (ahead > best + 0.2) { best = ahead; bestAt = now; }
      // data is arriving but nothing becomes playable: codecs the player doesn't know
      if (!this.viaFfmpeg && waited > 5 && ahead === 0 && v.readyState < 2 && activeSniff && activeSniff.sniffer &&
          activeSniff.sniffer.bytes > 300000) { clearInterval(this.bufferTimer); this.bufferTimer = null; if (this.useFfmpeg()) return; }
      if (v.readyState >= 2 && (ahead >= sec || waited > sec + 20)) {
        clearInterval(this.bufferTimer); this.bufferTimer = null;
        if (this.hold) return;
        const pr = v.play();
        if (pr && pr.catch) pr.catch(() => { });
        this.lastProgress = performance.now();
      } else if ((now - bestAt) / 1000 > (initial ? (best > 0 ? 25 : Player.OPEN_SILENT_SEC) : Player.REFILL_SILENT_SEC)) {
        // no new data at all: a stream that has not sent a single byte in 7 sek is not "slow",
        // it is not answering (25 sek is only for a provider that delivers, but slowly). The
        // provider is not asked for ever either – three of these and the channel is called dead
        clearInterval(this.bufferTimer); this.bufferTimer = null;
        this.fail(best > 0 ? 'Ekkert merki' : 'Rásin svarar ekki');
      } else {
        this.onStatus('buffering', `${initial ? 'Hleður' : 'Safnar í buffer'}… ${Math.min(100, Math.round(ahead / sec * 100))}%`);
      }
    }, 200);
  }

  onWaiting() {
    if (this.vod) { if (this.state === 'playing') this.setState('buffering', 'Hleður…'); return; }
    if (this.state !== 'playing' || this.hold || this.bufferTimer) return;
    // A hole right in front of us (the relay's fresh ffmpeg comes back at the live edge):
    // waiting for a full buffer here would keep the picture frozen for a whole minute.
    if (this.jumpGap(this.vod ? 10 : Player.LIVE_EDGE_SEC)) return;
    // Just after a deliberate jump (live edge / over a hole) the buffer is spent by
    // definition – the old one is behind us. Refill a handful of seconds, not the whole
    // minute (12. nóv.: a jump to the live edge started a 60 sek "Safnar í buffer" stop).
    if (this.jumpedAt && performance.now() - this.jumpedAt < 20000) {
      const few = Math.min(8, this.targetSec());
      this.log(`Eftir stökk – safnar ${few} sek áður en haldið er áfram`);
      this.waitForBuffer(few, this.session, false);
      return;
    }
    // Buffer ran dry. If bytes are still arriving this is just a slow moment – keep
    // filling. But if the feed has gone silent the connection is dead (the Wi-Fi drop
    // raises no error at all), and waiting is pointless: reconnect NOW instead of
    // sitting out the 25 s "no data" watchdog (11. nóv.: 25 sek of pure dead time).
    const silent = this.silentFor();
    if (silent > 3) {
      this.log(`Buffer tæmdist og streymið þaggaði ${silent.toFixed(0)} sek – endurtengi strax`);
      this.reconnect('Streymi þagnaði', null);
      return;
    }
    // Refill a SHORT cushion first (15 sek). Waiting for the full minute keeps the picture
    // frozen three to four times longer than the stop it is meant to prevent, and on a feed
    // that only stutters a little the viewer loses more than the deep cushion gains.
    const now = performance.now();
    const again = !!this.lastDryAt && now - this.lastDryAt < Player.DRY_ESCALATE_MS;
    this.lastDryAt = now;
    // …unless the short cushion ran dry again soon after: then 15 sek was not enough and this
    // stop fills the whole target (one long stop instead of two or three short ones –
    // 8. nóv.: resumed after 15 sek, ran dry again 3 sek later, stopped twice).
    const sec = again ? this.targetSec() : Math.min(Player.REBUFFER_SEC, this.targetSec());
    this.log(`Buffer tæmdist – safnar ${sec} sek áður en haldið er áfram (myndin stoppar)${again ? ' – ítrekað, fer í fullan buffer' : ''}`);
    this.waitForBuffer(sec, this.session, false);
  }

  // A frozen picture is worth a fast retry, but a stream that freezes again and again must
  // back off like any other failure (the subscription may allow only one connection).
  freezeReset(now) {
    if (!this.lastFreezeAt || now - this.lastFreezeAt > 120000) this.attempt = 0;
    this.lastFreezeAt = now;
  }

  // ↻ button / R key: reconnect right away, no backoff
  retry() {
    if (!this.url) return;
    this.log('↻ Endurtengi af notanda');
    this.attempt = 0;
    this.fails = [];        // the user asked once more: the channel gets a clean slate
    this.reconnect('Endurtengt', null);
  }

  tick() {
    if (!this.url || this.state === 'idle' || this.state === 'error' || this.state === 'dead') return;
    if (this.vod) { if (this.video.currentTime > 1) this.resumeAt = this.video.currentTime; return; }
    const v = this.video, now = performance.now();
    // feed watchdog: has the buffer grown? (bytes arriving) – a silent connection is not
    // an error in mpegts.js/hls.js, so we have to look for ourselves
    const be = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    if (be > v.currentTime + Player.MAX_AHEAD_SEC) {
      // the element reports an end thousands of seconds ahead: the timeline is garbage, but
      // something is clearly being fed – don't use it to measure growth, don't call it silence
      this.lastDataAt = now;
    } else if (be > this.bufEnd + 0.2) { this.bufEnd = be; this.lastDataAt = now; if (this.useRelay) this.relayOk = true; }
    if (v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime; this.lastProgress = now;
      if (!this.goodSince) this.goodSince = now;
      if (now - this.goodSince > 60000) this.attempt = 0;
    }
    // hold / buffer fill is deliberate: nothing to watch while they run
    if (this.hold || this.bufferTimer) { this.lastProgress = now; return; }
    // A "Safnar í buffer" wait can be left without an owner: the relay reconnects (a new
    // session) and the interval that would call play() sees a stale session and stops. The
    // state then stays 'buffering' with the element paused, and the picture watchdog below
    // only runs while 'playing' – so nothing rescued it and the picture stayed frozen while
    // the buffer grew past 85 sek (11. nóv.). If the data is there and nobody owns the pause,
    // start again.
    if (this.state === 'buffering' && !this.vod && !this.bank && v.paused &&
        v.readyState >= 2 && this.bufferedAhead() > 2) {
      this.log('Buffer var í bið án eiganda – held áfram');
      const pr = v.play(); if (pr && pr.catch) pr.catch(() => { });
      this.lastProgress = now; this.lastFrameAt = now;
      return;
    }
    // Chromium stops drawing frames while the window is hidden: let the frame watchdog rest
    if (!this.pageVisible()) this.lastFrameAt = now;
    // ---- picture watchdog --------------------------------------------------------------
    // The element can stand still with a FULL buffer: a fresh ffmpeg in the relay comes back
    // at the live edge, the timeline jumps 20–40 sek forward and the element waits in front
    // of that hole for ever. This check must run BEFORE the paused return below – skipping
    // everything while the element sits paused is exactly why the freeze of 9. nóv. was
    // invisible for 30 sek while the buffer grew from 10 to 30+ sek.
    if (this.state === 'playing' && (now - this.lastProgress) / 1000 > Player.STALL_SEC) {
      const stalled = (now - this.lastProgress) / 1000;
      // the connection is already known to be dead: take the reconnect that is pending
      if (this.pendingReconnect && this.bufferedAhead() < 4) {
        const r = this.pendingReconnect; this.pendingReconnect = null;
        this.log('Buffer að klárast – tengist aftur');
        this.reconnect(r.reason, r.code);
        return;
      }
      // a) the element paused itself: start it again, no reconnect needed
      if (v.paused) {
        this.log('Myndin stöðvaðist – ýti á play');
        const pr = v.play();
        if (pr && pr.catch) pr.catch(() => { });
        this.lastProgress = now; this.lastFrameAt = now;
        return;
      }
      // b) follow the timeline if it jumped forward (hole = the relay's fresh ffmpeg)
      if (this.jumpGap(this.vod ? 10 : Player.LIVE_EDGE_SEC)) return;
      // c) nothing in front and nothing drawn: the decoder is stuck → clean reconnect
      const frozen = Math.max(v.videoWidth ? this.frozenFor() : 0, stalled);
      if (frozen > Player.FREEZE_SEC) {
        this.log(`Myndin fraus (engin rammi í ${frozen.toFixed(0)} sek) – endurtengi`);
        this.freezeReset(now);
        this.reconnect('Myndin fraus', null);
      }
      return;
    }
    // The clock runs (audio is fine) but no frame has been drawn for several seconds: the
    // video decoder is stuck. The buffer and the timeline both look healthy – only the frame
    // counter can see it, so it needs its own check. A screen that is off or covered draws no
    // frames at all, so after three such freezes in a row the check rests for five minutes
    // (otherwise a sleeping screen would reconnect to the provider all night long).
    if (this.state === 'playing' && v.videoWidth && !v.paused && now > this.frameWatchHold &&
        this.frozenFor() > Player.FREEZE_SEC) {
      const f = this.frozenFor();
      const n = ++this.freezeCount;
      // first time: a seek to the live edge is cheap and keeps the connection (and the buffer
      // behind us is lost either way – a frozen picture is worth more)
      if (n === 1 && this.seekToEdge()) return;
      if (n > 3) {
        this.frameWatchHold = now + 300000;
        this.freezeCount = 0;
        this.lastFrameAt = now;
        this.log('Enginn rammi birtist en tíminn gengur – sleppi rammavakt í 5 mínútur');
        return;
      }
      this.log(`Enginn rammi birtist í ${f.toFixed(0)} sek (hljóðið gengur) – endurtengi`);
      this.freezeReset(now);
      this.reconnect('Myndin fraus', null);
      return;
    }
    if (this.freezeCount && this.frozenFor() < 2) this.freezeCount = 0;   // healthy again
    if (v.paused) return;   // only holdFor/waitForBuffer pause, and they returned above
    // sound but no picture: the stream has a video track the player can't decode (e.g. MPEG-2)
    if (!this.viaFfmpeg && this.goodSince && now - this.goodSince > 6000 && !v.videoWidth &&
        activeSniff && activeSniff.sniffer && activeSniff.sniffer.video !== null && this.useFfmpeg()) return;
    // grow the buffer towards the target by playing slightly slower (pitch is preserved)
    if (!this.rateLocked) {
      const ahead = this.bufferedAhead();
      const target = this.targetSec();
      // after a drop, refill faster (10% slower playback) so the buffer is protective again
      const grow = this.attempt > 0 ? Player.GROW_RATE_RECOVER : Player.GROW_RATE;
      const want = this.opts.growSlow !== false && ahead < target - 1 ? grow : 1;
      if (v.playbackRate !== want) v.playbackRate = want;
    }
    // stream connection died but we still have buffer: keep watching it, reconnect when it runs low
    if (this.pendingReconnect && this.bufferedAhead() < 2) {
      const r = this.pendingReconnect; this.pendingReconnect = null;
      this.log('Buffer að klárast – tengist aftur');
      this.reconnect(r.reason, r.code);
      return;
    }
    const stuck = (now - this.lastProgress) / 1000;
    if (stuck > 3) this.jumpGap(this.vod ? 10 : Player.LIVE_EDGE_SEC);
  }

  fail(reason, code) {
    if (!this.url) return;
    if (this.vod && this.video.currentTime > 1) this.resumeAt = this.video.currentTime;
    if (this.vod && this.opts.onVodFail) { this.log(`VILLA í mynd: ${reason}`); this.opts.onVodFail(reason); return; }
    const ahead = this.bufferedAhead();
    this.log(`VILLA: ${reason}${code ? ' (HTTP ' + code + ')' : ''} – buffer ${ahead.toFixed(1)} sek`);
    // still have a good buffer and we are playing: close the dead connection, keep watching
    if (!this.vod && ahead > 4 && !this.video.paused && this.state === 'playing' && !this.pendingReconnect) {
      this.closeEngine();
      this.pendingReconnect = { reason, code };
      this.log(`Spila áfram úr buffer (${ahead.toFixed(0)} sek) og tengist aftur þegar hann klárast`);
      return;
    }
    this.reconnect(reason, code);
  }

  reconnect(reason, code) {
    clearTimeout(this.reconnectTimer);
    // the relay never delivered a single byte: go straight to the provider instead
    if (this.useRelay && !this.relayOk && !this.relayFallback) {
      this.relayFallback = true; this.useRelay = false;
      this.url = this.srcUrl; this.kind = streamType(this.srcUrl);
      this.log('Relay svaraði ekki – fer beint á þráðinn');
    }
    this.session++;
    this.teardown();
    this.goodSince = 0;
    this.attempt++;
    const refused = code && (code === 401 || code === 403 || code === 429 || code === 456 || code === 458 || code === 509 || code >= 500);
    let delay;
    if (refused) delay = Math.min(120, 30 * this.attempt) * 1000;          // provider said no: back off hard
    else delay = [2, 4, 8, 15, 30][Math.min(this.attempt - 1, 4)] * 1000;  // ordinary drop
    const msg = refused
      ? (this.attempt >= 2
        ? `Áskriftin leyfir aðeins eitt streymi (HTTP ${code}) – lokaðu Mulehead á öðru tæki og ýttu á ↻`
        : `Áskriftin neitaði tengingu (HTTP ${code}) – reyni aftur eftir ${Math.round(delay / 1000)} sek`)
      // the attempt number is there so the viewer sees that something is being done, and how
      // many tries are left before the channel is called dead (see dead())
      : `${reason} – reyni aftur eftir ${Math.round(delay / 1000)} sek (${this.attempt}. tilraun af ${Player.DEAD_AFTER_FAILS})`;
    this.log(msg);
    // the channel list remembers which streams keep causing trouble (yellow after the first
    // time, red when it happens again). A refusal from the provider is about the subscription
    // (one stream at a time, too many devices) and says nothing about this channel, and a
    // ↻ from the user is not trouble at all – neither is counted.
    if (!this.vod && !refused && reason !== 'Endurtengt' && this.opts.onTrouble) {
      try { this.opts.onTrouble({ reason, code: code || 0 }); } catch { }
    }
    // Three attempts in a row and the channel gets no more: a 404, a host that does not
    // resolve or a subscription that says no will not change its mind because we ask once
    // more, and asking for ever leaves the viewer in front of a dead picture (see dead()).
    // A refusal is asked again more slowly (30/60/90 sek), so it gets a longer window.
    // A movie is not a dead channel (it has its own retry, see vodRetry in the app).
    if (!this.vod && reason !== 'Endurtengt') {
      const t = performance.now();
      const win = refused ? Player.REFUSED_WINDOW_MS : Player.DEAD_WINDOW_MS;
      this.fails = (this.fails || []).filter(x => t - x < win);
      this.fails.push(t);
      if (this.fails.length >= Player.DEAD_AFTER_FAILS) {
        // plain words on the screen: what went wrong, and that we stopped trying
        const why = refused ? `Áskriftin neitar tengingu (HTTP ${code})`
          : code === 404 ? 'Rásin fannst ekki (HTTP 404)'
            : code ? `${reason} (HTTP ${code})` : reason;
        return this.dead(why);
      }
    }
    this.setState('reconnecting', msg);
    const sess = this.session;
    this.reconnectTimer = setTimeout(() => { if (sess === this.session && this.url) this.scheduleOpen(Player.CLOSE_GAP_MS); }, delay);
  }

  // The channel is not coming back. Three failed attempts in a row (see reconnect) are enough:
  // no timers, no spinner that never ends – one plain message on the screen and a ↻ button.
  // The channel is marked red in the list (onDead), and ↻ or another channel starts over with
  // a clean slate. This is the difference between "the net hiccuped" (we retry quietly) and
  // "this channel is dead" (we say so and stop wasting the viewer's time).
  dead(text) {
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    clearInterval(this.bufferTimer); this.bufferTimer = null;
    this.session++;
    this.teardown();
    const m = `${text} – hætti að reyna`;
    this.log(`⛔ RÁSIN ER DAUÐ: ${m}`);
    this.setState('dead', m);
    const cb = this.onDead || (this.opts && this.opts.onDead);
    if (cb) { try { cb({ reason: text }); } catch { } }
    return 0;
  }

  // close the network side only (keeps what is already in the video buffer)
  closeEngine() {
    const e = this.engine;
    if (!e) return;
    // hls.js can stop loading while keeping its buffer. For MPEG-TS the connection has
    // already died when we get here (network error / end of stream), and mpegts.js's
    // unload() would also wipe the buffer, so we leave it alone.
    try { if (e.stopLoad) e.stopLoad(); } catch { }
    this.lastCloseAt = performance.now();
  }

  teardown() {
    clearInterval(this.bufferTimer); this.bufferTimer = null;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.startTimer);
    this.pendingReconnect = null;
    if (this.bank) { this.bank = null; this.emitBank(true, 'endurtengt'); }
    clearInterval(this.bankTimer); this.bankTimer = null;
    if (this.hold) { clearTimeout(this.hold); this.hold = null; }
    const e = this.engine; this.engine = null;
    // remember when the old stream was really let go of: the next one may not be opened
    // until the provider has had time to notice. Nothing was open = nothing to wait for.
    if (e || this.startTimer) this.lastCloseAt = performance.now();
    activeSniff = null;
    try {
      if (e && e.destroy) {
        if (e.unload) { e.pause && e.pause(); e.unload(); e.detachMediaElement && e.detachMediaElement(); }
        e.destroy();
      }
    } catch { }
    const v = this.video;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch { }
    v.controls = false;
    v.playbackRate = 1;
    this.lastTime = 0;
  }

  stop() { this.session++; this.fails = []; this.teardown(); this.url = null; this.setState('idle'); }

  // ---- sync helpers ----
  // absolute stream time in seconds ({kind:'pts'|'pdt', t}) or null
  streamTime() {
    const v = this.video;
    if (!this.engine || v.readyState < 2) return null;
    if (this.kind === 'hls') {
      const d = this.engine.playingDate;
      if (d && d.getTime) return { kind: 'pdt', t: d.getTime() / 1000 };
      if (this.hlsInitPts != null) return { kind: 'pts', t: (this.hlsInitPts + v.currentTime) % PTS_WRAP };
      return null;
    }
    if (this.kind === 'ts' && activeSniff && activeSniff.sniffer) {
      const base = activeSniff.sniffer.base();
      if (base == null) return null;
      return { kind: 'pts', t: (base + v.currentTime) % PTS_WRAP };
    }
    return null;
  }

  // ---- "Hlaða buffer" (banking) ------------------------------------------------------
  // A pause is local: the relay keeps downloading, the browser keeps appending, only the
  // play head stands still. So the cushion grows in real time and we end up that many
  // seconds behind the live edge – the same as a manual pause, except that we stop by
  // ourselves once the target is reached (or the feed turns out to be dead).
  bankTo(mark) {                       // fill up to `mark` seconds in front of the play head
    const want = Math.min(Number(mark) || 60, Player.BANK_MAX_SEC) - this.bufferedAhead();
    if (want < 3) return 0;
    return this.startBank(want, 'grow');
  }
  bankFor(sec) {                       // a peer in a room asked us all to pause this long
    const want = Math.min(Number(sec) || 0, Player.BANK_MAX_SEC - this.bufferedAhead());
    if (want < 2) return 0;
    // Grow to the cushion the asker is aiming for, not for a fixed number of seconds: the
    // relay delivers faster than realtime (1.1–1.5×), so a fixed pause always overshoots and
    // the two of us would end the pause with different buffers – seconds out of step.
    return this.startBank(want, 'grow');
  }
  startBank(want, mode) {
    if (this.vod || !this.url || this.state !== 'playing') return 0;
    if (this.hold || this.bufferTimer || this.bank) return 0;
    const v = this.video, now = performance.now(), ahead = this.bufferedAhead();
    want = Math.round(want);
    v.pause();
    this.bank = { mode, want, from: ahead, ahead, t0: now, best: ahead, bestAt: now, sess: this.session };
    // the ordinary watchdogs step aside while we hold (the same flag holdFor() uses);
    // the timer is only a backstop – bankTick() ends the bank normally
    this.hold = setTimeout(() => this.endBank('tímamörk'), want * 1000 + Player.BANK_GUARD_SEC * 1000);
    this.log(`Hleð buffer: pása ${want} sek (buffer ${ahead.toFixed(0)} sek)`);
    this.emitBank();
    clearInterval(this.bankTimer);
    this.bankTimer = setInterval(() => this.bankTick(), 500);
    return want;
  }
  bankTick() {
    const b = this.bank;
    if (!b) return;
    if (b.sess !== this.session) return this.endBank('endurtengt');
    const ahead = this.bufferedAhead(), now = performance.now();
    if (ahead > b.best + 0.2) { b.best = ahead; b.bestAt = now; }
    b.ahead = ahead;
    if (ahead >= Player.BANK_MAX_SEC) return this.endBank('þak');
    const done = b.mode === 'grow' ? ahead >= b.from + b.want - 0.3 : (now - b.t0) / 1000 >= b.want;
    if (done) return this.endBank('lokið');
    // nothing is arriving: a dead relay will never fill anything, so don't sit and wait
    if ((now - b.bestAt) / 1000 > Player.BANK_STALL_SEC && this.silentFor() > Player.BANK_STALL_SEC) {
      this.log(`Hleð buffer: ekkert kemur inn (${b.ahead.toFixed(0)} sek) – hætti`);
      return this.endBank('ekkert merki');
    }
    this.emitBank();
  }
  // stop banking and play on from where we stand (the cushion is what it is)
  endBank(reason) {
    const b = this.bank;
    if (!b) return 0;
    this.bank = null;
    clearInterval(this.bankTimer); this.bankTimer = null;
    if (this.hold) { clearTimeout(this.hold); this.hold = null; }
    const v = this.video, ahead = this.bufferedAhead();
    const pr = v.play(); if (pr && pr.catch) pr.catch(() => { });
    this.lastProgress = performance.now(); this.lastFrameAt = this.lastProgress;
    this.log(`Hleð buffer búið (${reason}): buffer ${ahead.toFixed(0)} sek`);
    this.emitBank(true, reason);
    return ahead;
  }
  emitBank(done, reason) {
    if (!this.onBank) return;
    const b = this.bank;
    try {
      this.onBank(b
        ? { on: true, mode: b.mode, want: b.want, from: b.from, mark: Math.round(b.from + b.want), ahead: b.ahead }
        : { on: false, done: !!done, reason: reason || '', ahead: this.bufferedAhead() });
    } catch { }
  }

  // pause for `sec` seconds (delays us relative to others)
  holdFor(sec) {
    const v = this.video;
    if (this.bank) this.endBank('hlé frá sync');
    if (this.hold) clearTimeout(this.hold);
    v.pause();
    this.hold = setTimeout(() => {
      this.hold = null;
      const pr = v.play(); if (pr && pr.catch) pr.catch(() => { });
      this.lastProgress = performance.now();
    }, Math.max(0, sec * 1000));
  }

  // jump forward within the buffer (catch up). returns seconds actually skipped
  skipForward(sec) {
    const ahead = this.bufferedAhead() - 0.5;
    const s = Math.max(0, Math.min(sec, ahead));
    if (s > 0.05) this.video.currentTime += s;
    return s;
  }

  setRate(r) { this.video.playbackRate = r; }
}

Player.CLOSE_GAP_MS = 1200;   // minimum time between closing a stream and opening the next
Player.SWITCH_GAP_MS = 3000;  // wait between channel switches (the subscription may allow only ONE stream)
Player.FAST_START_SEC = 6;
Player.RESUME_START_SEC = 10;  // after a drop: fill this much before playing again
Player.GROW_RATE_RECOVER = 0.90; // after a drop: refill twice as fast as the normal 0.95
Player.REBUFFER_SEC = 15;      // stutt bið eftir að buffer tæmist (sjá onWaiting) – ekki fullur buffer
Player.DRY_ESCALATE_MS = 120000; // tæmist aftur innan 2 mín: 15 sek dugðu ekki, fyllt í fullan buffer
Player.GROW_RATE = 0.95;
// picture watchdog (see tick): a full buffer does not mean a moving picture
Player.STALL_SEC = 2.5;        // the picture stood still this long → something is wrong
Player.FREEZE_SEC = 4;         // no frame drawn at all → jump/reconnect (audio may still be running)
Player.LIVE_EDGE_SEC = 40;     // a hole this big is the relay's fresh ffmpeg at the live edge
Player.MAX_AHEAD_SEC = 600;    // more than this in front of the play head is a broken timestamp, not a buffer
// "Hlaða buffer": how far the bank may fill, how long without any data before giving up,
// and how long after the target we stop regardless (a backstop for a suspended tab)
Player.BANK_MAX_SEC = 560;     // leaves room under MAX_AHEAD_SEC (the guard is 600)
Player.BANK_STALL_SEC = 12;
Player.BANK_GUARD_SEC = 20;
// A dead channel is not a slow one: three failed attempts in a row and the app stops asking
// (see dead()). A stream that has not sent a single byte is given 7 sek, not 25.
Player.DEAD_AFTER_FAILS = 3;
Player.DEAD_WINDOW_MS = 90000;
// A refusal from the provider (one stream at a time) is asked again after 30/60/90 sek, so
// its window is longer – otherwise the third attempt would always fall outside it.
Player.REFUSED_WINDOW_MS = 300000;
Player.OPEN_SILENT_SEC = 7;
Player.REFILL_SILENT_SEC = 6;

window.Player = Player;
window.PTS_WRAP = PTS_WRAP;
