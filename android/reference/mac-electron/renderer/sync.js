'use strict';
/* global mqtt, PTS_WRAP */
// "Horfa saman" – keeps two or more Mulehead apps in step on the same channel.
// Each app publishes its absolute stream time once a second through a free public
// MQTT broker; whoever is ahead of the slowest viewer slows down / pauses briefly.

const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
try { const o = localStorage.getItem('mulehead.broker'); if (o) BROKERS.unshift(o); } catch { }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function wrapDiff(d, kind) {
  if (kind !== 'pts') return d;
  if (d > PTS_WRAP / 2) d -= PTS_WRAP;
  if (d < -PTS_WRAP / 2) d += PTS_WRAP;
  return d;
}

class SyncRoom {
  constructor({ player, getChannel, getChannelKey, getNickname, onUpdate, onPeerChannel, onPeerBank }) {
    this.player = player;
    this.getChannel = getChannel;
    this.getChannelKey = getChannelKey || (() => '');
    this.getNickname = getNickname;
    this.onUpdate = onUpdate || (() => { });
    this.onPeerChannel = onPeerChannel || (() => { });
    this.onPeerBank = onPeerBank || (() => { });
    this.client = null; this.room = null; this.peers = new Map();
    this.id = Math.random().toString(36).slice(2, 10);
    this.auto = true;
    this.cooldownUntil = 0;
    this.brokerIdx = 0;
    this.connected = false;
    this.lastAction = '';
    this.timer = null;
    this.chAt = 0;        // when *I* last changed channel (only my own changes are announced)
    this.followAt = 0;    // the last change by a peer that I followed (don't echo it back)
    this.bankUntil = 0;   // wall clock: the room is banking buffer until then
    this.bankMark = 0;    // the cushion (sec ahead) everybody should end on
  }

  static newCode() {
    let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return s;
  }

  join(code) {
    this.leave();
    this.room = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!this.room) return;
    // The speed is NOT locked here: compute() locks it only while somebody else is really
    // playing the same channel. A viewer who sits alone in a room (or who has the automatic
    // control switched off) must keep the player's own buffer growth (player.js growSlow).
    this.player.rateLocked = false;
    this.connect();
    this.timer = setInterval(() => this.tick(), 1000);
    this.emit();
  }

  connect() {
    const url = BROKERS[this.brokerIdx % BROKERS.length];
    const c = mqtt.connect(url, { clientId: 'mulehead-' + this.id + '-' + Date.now().toString(36), connectTimeout: 8000, reconnectPeriod: 3000, clean: true });
    this.client = c;
    const topic = `mulehead/v1/room/${this.room}`;
    let opened = false;
    // `connected` is only a mirror for the UI: the truth is client.connected, because a
    // reconnect can fire 'close' after the new socket is already up (one window went silent
    // for a whole evening that way: the others pruned it after 6 s and the room went blind).
    c.on('connect', () => { opened = true; this.connected = true; c.subscribe(topic); this.publishNow(); this.emit(); });
    c.on('close', () => { if (this.client === c && !c.connected) this.connected = false; this.emit(); });
    c.on('error', () => { });
    c.on('offline', () => {
      if (!opened && this.client === c) { // try the other broker
        c.end(true); this.brokerIdx++; this.connect();
      }
    });
    c.on('message', (_t, buf) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(buf));
        if (!m || m.id === this.id) return;
        if (m.bye) { this.peers.delete(m.id); this.emit(); return; }
        m.rx = Date.now();
        this.peers.set(m.id, m);
        // the room follows the channel of whoever changed last (the newest `cat` wins)
        if (m.ck && m.cat && m.cat > Math.max(this.chAt, this.followAt) + 300) {
          this.followAt = m.cat;
          this.onPeerChannel({ key: m.ck, name: m.ch || '', by: m.n || 'Gestur', at: m.cat });
          // tell the room straight away that my channel is now the one we agreed on, so the next
          // viewer who joins (or reconnects) has a `cat` to copy instead of waiting for the tick
          this.publishNow();
        }
        // somebody banks buffer: we all pause together, so nobody has to wait for anybody
        if (m.bank && m.bank > Date.now() + 400 && m.bank > this.bankUntil) {
          this.bankUntil = m.bank;
          this.bankMark = Number(m.bm) || 0;
          this.onPeerBank({ sec: Math.round((m.bank - Date.now()) / 1000), until: m.bank, mark: this.bankMark, by: m.n || 'Gestur' });
        }
      } catch { }
    });
  }

  leave() {
    clearInterval(this.timer); this.timer = null;
    if (this.client) {
      try { this.client.publish(`mulehead/v1/room/${this.room}`, JSON.stringify({ id: this.id, bye: true })); } catch { }
      const c = this.client; setTimeout(() => c.end(true), 300);
    }
    this.client = null; this.room = null; this.peers.clear(); this.connected = false;
    this.chAt = 0; this.followAt = 0; this.bankUntil = 0; this.bankMark = 0;
    if (this.player) { this.player.rateLocked = false; this.player.setRate(1); }
    this.emit();
  }

  myStatus() {
    const st = this.player.streamTime();
    const v = this.player.video;
    const playing = this.player.state === 'playing' && !v.paused && !this.player.hold;
    const ch = this.getChannel();
    return {
      id: this.id, n: this.getNickname(), ch: ch ? ch.name : '',
      // `cat` = when my current channel was decided: either I picked it (chAt) or I adopted a
      // peer's pick (followAt). Publishing the max matters: a viewer who has only ever *followed*
      // has chAt = 0, and a newcomer then sees cat = 0 and copies nobody (11. nóv.: the reopened
      // window sat idle in the room while the other one was playing).
      ck: ch ? (this.getChannelKey(ch) || '') : '', cat: Math.max(this.chAt || 0, this.followAt || 0),
      k: st ? st.kind : null, t: st ? st.t : null, w: Date.now(), p: playing,
      bank: this.bankUntil > Date.now() ? this.bankUntil : 0,
      bm: this.bankUntil > Date.now() ? (this.bankMark || 0) : 0
    };
  }

  // is the room link really up? (client.connected, not our cached flag)
  isUp() { return !!(this.client && this.client.connected && this.room); }

  publishNow() {
    if (!this.isUp()) return;
    try { this.client.publish(`mulehead/v1/room/${this.room}`, JSON.stringify(this.myStatus())); } catch { }
  }

  // my channel changed: tell the room so that everyone follows
  setChannel() {
    if (!this.room) return;
    this.chAt = Date.now();
    this.publishNow();
  }

  // "Hlaða buffer" in a room: everyone pauses at the same moment, so the room stays in step
  announceBank(sec, mark) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (!this.room || s < 2) return;
    this.bankUntil = Date.now() + s * 1000;
    // the cushion everybody should end on; the seconds are only a fallback for older apps
    this.bankMark = Math.round(Number(mark) || 0);
    this.publishNow();
    this.emit();
  }

  tick() {
    const now = Date.now();
    for (const [id, p] of this.peers) if (now - p.rx > 6000) this.peers.delete(id);
    this.connected = this.isUp();     // resync the mirror every second, whatever mqtt said
    const me = this.myStatus();
    if (this.client && this.connected) this.client.publish(`mulehead/v1/room/${this.room}`, JSON.stringify(me));
    this.compute(me);
    this.emit();
  }

  compute(me) {
    this.view = [];
    let worst = null; // largest amount I'm ahead of someone
    for (const p of this.peers.values()) {
      // compare channels by the merged name key ("Sky Sport PL" = "Sky Sport Premier League"),
      // and fall back to the plain name for older apps that do not send a key
      const mine = me.ck || me.ch, theirs = p.ck || p.ch;
      const row = { id: p.id, name: p.n || 'Gestur', ch: p.ch, sameCh: !!mine && mine === theirs, diff: null, mismatch: false, playing: p.p };
      if (row.sameCh && me.t != null && p.t != null && p.k === me.k) {
        const peerNow = p.t + (p.p ? (Date.now() - p.w) / 1000 : 0);
        const myNow = me.t;
        const d = wrapDiff(myNow - peerNow, me.k);
        if (Math.abs(d) > 60) row.mismatch = true;
        else {
          row.diff = d;
          if (p.p && (worst === null || d > worst)) worst = d;
        }
      }
      this.view.push(row);
    }
    // Sync steers the speed only while somebody else is playing the same channel and we have
    // a time to compare with. Alone in a room, paused, or with the automatic control off the
    // player gets the speed back: growSlow then fills the buffer as usual. Doing it here (once
    // a second, in the loop that already runs) keeps it in step with the peers – an
    // event-driven version would have to be repeated in six places and would drift.
    const steer = this.auto && me.p && worst !== null;
    const wasLocked = this.player.rateLocked;
    if (wasLocked !== steer) this.player.rateLocked = steer;
    if (!steer) {
      // Nothing to follow: the player owns the speed again (growSlow fills the buffer). Only a
      // 0.92 that sync itself left behind is cleared – calling setRate(1) every second here
      // would undo the growth tick for tick and the buffer would never fill.
      if (wasLocked) this.player.setRate(1);
      return;
    }
    // a deliberate pause is running (holdFor/delay/skip): play on at normal speed afterwards
    if (Date.now() < this.cooldownUntil) { this.player.setRate(1); return; }
    if (worst > 1.0) {
      this.player.setRate(1);
      this.player.holdFor(worst - 0.05);
      this.lastAction = `Seinkaði um ${worst.toFixed(1)} sek`;
      this.cooldownUntil = Date.now() + worst * 1000 + 3000;
    } else if (worst > 0.15) {
      this.player.setRate(0.92);
    } else {
      this.player.setRate(1);
    }
  }

  // manual controls (always available)
  delay(sec) { this.player.holdFor(sec); this.cooldownUntil = Date.now() + sec * 1000 + 3000; this.lastAction = `Seinkaði um ${sec} sek`; this.emit(); }
  skip(sec) { const s = this.player.skipForward(sec); this.cooldownUntil = Date.now() + 3000; this.lastAction = s > 0.05 ? `Hoppaði fram um ${s.toFixed(1)} sek` : 'Ekki nóg í buffer til að hoppa fram'; this.emit(); }

  emit() {
    this.onUpdate({ room: this.room, connected: this.connected, auto: this.auto, peers: this.view || [], lastAction: this.lastAction });
  }
}

window.SyncRoom = SyncRoom;
