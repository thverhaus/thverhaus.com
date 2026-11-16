import { createDemo, deleteDemo } from "./demo.js";
import OSM_PLACES from "./osm-places.json";
const OSM_VERSION = "261114d";

// Viðburðasíðan – netþjónn (Cloudflare Worker + D1 + R2).
// Aðskilið frá Mulehead. Öll slóð byrjar á BASE_PATH (nú /event).

const SESSION_DAYS = 365;
const LOGIN_TTL_MIN = 30;
const MAX_POSTER_BYTES = 3 * 1024 * 1024;
const TAGS = ["tonleikar", "leikhus", "list", "dj", "uppistand", "pubquiz", "annad"];

/* ---------------- Gagnagrunnur ---------------- */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '', is_owner INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT DEFAULT '', town TEXT DEFAULT '', muni TEXT DEFAULT '', region TEXT DEFAULT '', lat REAL, lon REAL, created_by TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, place_id TEXT, status TEXT DEFAULT 'approved', created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS members (page_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (page_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS trusts (venue_page_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY (venue_page_id, page_id))`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, place_id TEXT NOT NULL, page_id TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT, end_time TEXT, price INTEGER, ticket TEXT, door INTEGER DEFAULT 0, age TEXT, age_text TEXT, tags TEXT, other_label TEXT, fam INTEGER DEFAULT 0, descr TEXT, poster TEXT, status TEXT NOT NULL, cancelled INTEGER DEFAULT 0, cancel_note TEXT, time_changed INTEGER DEFAULT 0, old_time TEXT, created_by TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE INDEX IF NOT EXISTS ev_date ON events(date)`,
  `CREATE INDEX IF NOT EXISTS ev_place ON events(place_id)`,
  `CREATE INDEX IF NOT EXISTS ev_page ON events(page_id)`,
  // Upphafsgögn: Hafið á Höfn og bönd Júlíusar. Eigandi verður stjórnandi við fyrstu innskráningu.
  `INSERT OR IGNORE INTO places (id,name,town,muni,region,lat,lon,created) VALUES ('hafid','Hafið','Höfn','hornafjordur','austurland',64.25088,-15.20205,0)`,
  `INSERT OR IGNORE INTO pages (id,kind,name,code,place_id,created) VALUES ('p-hafid','venue','Hafið','HAFID7','hafid',0)`,
  `INSERT OR IGNORE INTO pages (id,kind,name,code,created) VALUES ('p-kusk','band','Kusk','KUSK88',0)`,
  `INSERT OR IGNORE INTO pages (id,kind,name,code,created) VALUES ('p-hrud','band','Hrúðurkarlarnir','HRUD31',0)`,
];

// Staðir úr OpenStreetMap (barir, pöbbar, félagsheimili o.fl.) – fluttir inn einu sinni per útgáfu.
async function importOsm(env) {
  const row = await env.DB.prepare(`SELECT v FROM meta WHERE k='osm'`).first();
  if (row && row.v === OSM_VERSION) return;
  try { await env.DB.prepare(`ALTER TABLE places ADD COLUMN cat TEXT DEFAULT ''`).run(); } catch {}
  const now = Date.now();
  for (let i = 0; i < OSM_PLACES.length; i += 90) {
    await env.DB.batch(OSM_PLACES.slice(i, i + 90).map(([id, name, cat, lon, lat, town, muni, region]) =>
      env.DB.prepare(`INSERT INTO places (id,name,cat,town,muni,region,lat,lon,created) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET lat=excluded.lat,lon=excluded.lon,town=excluded.town,muni=excluded.muni,region=excluded.region WHERE places.created_by IS NULL`)
        .bind(id, name, cat, town, muni, region, lat, lon, now)));
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (k,v) VALUES ('osm',?)`).bind(OSM_VERSION).run();
}

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).then(() => importOsm(env)).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/* ---------------- Hjálparföll ---------------- */

const now = () => Date.now();
const enc = new TextEncoder();

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const newId = (p) => p + "-" + randomToken(8);
const CODE_ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newCode() {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(6))) s += CODE_ALPHA[b % CODE_ALPHA.length];
  return s;
}

function headersBase(extra = {}) {
  return {
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersBase({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
  });
}
const err = (msg, status = 400) => json({ error: msg }, status);

function getCookie(req, name) {
  const c = req.headers.get("Cookie") || "";
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
function cookie(env, name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=${env.BASE_PATH}; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
}

function str(v, max = 300) {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function httpUrl(s) {
  s = str(s, 500);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
const todayISO = () => new Date().toISOString().slice(0, 10); // Ísland = UTC
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > 20000) return null;
    return JSON.parse(t || "{}");
  } catch {
    return null;
  }
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- Lykilorð (falin síða á meðan prófað er) ---------------- */

async function gateOk(req, env) {
  if (!env.SITE_PASSWORD) return true;
  const c = getCookie(req, "gate");
  return !!c && c === (await sha256("gate:" + env.SITE_PASSWORD));
}
function gatePage(env, wrong) {
  const html = `<!doctype html><html lang="is"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Viðburðir</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1d1214;color:#f2e2dc;font:18px/1.5 system-ui,sans-serif}
form{background:#2c1a1d;border:1px solid #4d2f33;border-radius:18px;padding:28px;width:min(92vw,360px)}
h1{font:800 26px Georgia,serif;margin:0 0 6px}p{color:#b9958d;margin:0 0 16px}
input,button{font:inherit;width:100%;box-sizing:border-box;border-radius:12px;padding:12px 14px}
input{background:#1d1214;color:inherit;border:1px solid #4d2f33;margin-bottom:12px}
button{background:#de8a5a;color:#2a1208;border:0;font-weight:700;cursor:pointer}.w{color:#e98a8a}</style></head>
<body><form method="post" action="${env.BASE_PATH}/api/gate"><h1>Viðburðir</h1><p>Síðan er í prófun. Sláðu inn lykilorðið.</p>
${wrong ? '<p class="w">Rangt lykilorð.</p>' : ""}<input type="password" name="password" autofocus autocomplete="current-password" placeholder="Lykilorð"><button>Opna síðuna</button></form></body></html>`;
  return new Response(html, { status: 401, headers: headersBase({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }) });
}

/* ---------------- Innskráning ---------------- */

async function currentUser(req, env) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.is_owner FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?`
  ).bind(await sha256(sid), now()).first();
  return row || null;
}

async function sendMail(env, to, subject, text, html) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY vantar");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 200));
}

async function apiLogin(req, env) {
  const b = await readJson(req);
  const email = str(b && b.email, 200).toLowerCase();
  if (!isEmail(email)) return err("Netfangið lítur ekki rétt út.");
  const recent = await env.DB.prepare(`SELECT COUNT(*) n FROM login_tokens WHERE email=? AND created>?`)
    .bind(email, now() - 3600_000).first();
  if (recent && recent.n >= 5) return err("Of margar tilraunir. Prófaðu aftur eftir klukkutíma.", 429);
  const token = randomToken();
  await env.DB.prepare(`INSERT INTO login_tokens (id,email,expires,created) VALUES (?,?,?,?)`)
    .bind(await sha256(token), email, now() + LOGIN_TTL_MIN * 60_000, now()).run();
  const link = `${env.BASE_URL}${env.BASE_PATH}/api/verify?t=${token}`;
  const text = `Smelltu á hlekkinn til að skrá þig inn á Viðburði:\n\n${link}\n\nHlekkurinn virkar í ${LOGIN_TTL_MIN} mínútur og bara einu sinni.\nEf þú baðst ekki um þetta máttu hunsa þennan póst.`;
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;color:#222"><p>Smelltu á takkann til að skrá þig inn á <b>Viðburði</b>:</p>
<p><a href="${link}" style="display:inline-block;background:#de8a5a;color:#2a1208;padding:12px 22px;border-radius:999px;font-weight:700;text-decoration:none">Skrá mig inn</a></p>
<p style="color:#777;font-size:14px">Hlekkurinn virkar í ${LOGIN_TTL_MIN} mínútur og bara einu sinni. Ef þú baðst ekki um þetta máttu hunsa þennan póst.</p></div>`;
  // Aðeins við prófanir á eigin vél (aldrei sett á Cloudflare).
  if (env.DEV_LOGIN_LINK === "1") return json({ ok: true, link });
  try {
    await sendMail(env, email, "Innskráning á Viðburði", text, html);
  } catch (e) {
    console.error(e);
    return err("Ekki tókst að senda póstinn. Reyndu aftur síðar.", 502);
  }
  return json({ ok: true });
}

async function apiVerify(req, env, url) {
  const token = url.searchParams.get("t") || "";
  const back = (msg) =>
    new Response(null, { status: 302, headers: headersBase({ Location: `${env.BASE_PATH}/${msg ? "?login=" + msg : ""}` }) });
  if (!/^[0-9a-f]{64}$/.test(token)) return back("villa");
  const id = await sha256(token);
  const row = await env.DB.prepare(`SELECT email,expires,used FROM login_tokens WHERE id=?`).bind(id).first();
  if (!row || row.used || row.expires < now()) return back("utrunnid");
  await env.DB.prepare(`UPDATE login_tokens SET used=1 WHERE id=?`).bind(id).run();
  const email = row.email;
  let user = await env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(email).first();
  const owner = env.OWNER_EMAIL && email === String(env.OWNER_EMAIL).trim().toLowerCase() ? 1 : 0;
  if (!user) {
    user = { id: newId("u") };
    await env.DB.prepare(`INSERT INTO users (id,email,is_owner,created) VALUES (?,?,?,?)`).bind(user.id, email, owner, now()).run();
  } else if (owner) {
    await env.DB.prepare(`UPDATE users SET is_owner=1 WHERE id=?`).bind(user.id).run();
  }
  if (owner) {
    // Eigandinn er stjórnandi upphafssíðnanna (Hafið, Kusk, Hrúðurkarlarnir).
    await env.DB.batch(
      ["p-hafid", "p-kusk", "p-hrud"].map((p) =>
        env.DB.prepare(`INSERT OR IGNORE INTO members (page_id,user_id,role) VALUES (?,?, 'admin')`).bind(p, user.id)
      )
    );
  }
  const sid = randomToken();
  await env.DB.prepare(`INSERT INTO sessions (id,user_id,expires) VALUES (?,?,?)`)
    .bind(await sha256(sid), user.id, now() + SESSION_DAYS * 86400_000).run();
  return new Response(null, {
    status: 302,
    headers: headersBase({ Location: `${env.BASE_PATH}/?login=ok`, "Set-Cookie": cookie(env, "sid", sid, SESSION_DAYS * 86400) }),
  });
}

async function apiLogout(req, env) {
  const sid = getCookie(req, "sid");
  if (sid) await env.DB.prepare(`DELETE FROM sessions WHERE id=?`).bind(await sha256(sid)).run();
  return json({ ok: true }, 200, { "Set-Cookie": cookie(env, "sid", "", 0) });
}

/* ---------------- Notandi og síður ---------------- */

async function myPages(env, userId) {
  const r = await env.DB.prepare(
    `SELECT p.id,p.kind,p.name,p.code,p.place_id,p.status,m.role FROM members m JOIN pages p ON p.id=m.page_id WHERE m.user_id=? ORDER BY p.name`
  ).bind(userId).all();
  return r.results;
}
async function roleIn(env, user, pageId) {
  if (!user) return null;
  const r = await env.DB.prepare(`SELECT role FROM members WHERE page_id=? AND user_id=?`).bind(pageId, user.id).first();
  return r ? r.role : null;
}
async function pendingCount(env, userId) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) n FROM events e JOIN pages vp ON vp.place_id=e.place_id AND vp.kind='venue'
     JOIN members m ON m.page_id=vp.id AND m.user_id=? WHERE e.status='pending' AND e.date>=?`
  ).bind(userId, todayISO()).first();
  return r ? r.n : 0;
}

async function apiMe(req, env, user) {
  if (!user) return json({ user: null });
  const pages = await myPages(env, user.id);
  return json({
    user: { id: user.id, email: user.email, name: user.name, owner: !!user.is_owner },
    pages: pages.map((p) => ({ ...p, code: p.role === "admin" || user.is_owner ? p.code : undefined })),
    pending: await pendingCount(env, user.id),
  });
}

async function apiSetName(req, env, user) {
  const b = await readJson(req);
  const name = str(b && b.name, 80);
  await env.DB.prepare(`UPDATE users SET name=? WHERE id=?`).bind(name, user.id).run();
  return json({ ok: true });
}

async function apiJoin(req, env, user) {
  const b = await readJson(req);
  const code = str(b && b.code, 20).toUpperCase().replace(/[\s-]/g, "");
  if (!code) return err("Sláðu inn kóða.");
  const page = await env.DB.prepare(`SELECT id,name FROM pages WHERE code=?`).bind(code).first();
  if (!page) return err("Enginn síða með þennan kóða.");
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO members (page_id,user_id,role) VALUES (?,?,'member')`).bind(page.id, user.id).run();
  // Staðfesta að það hafi raunverulega vistast (svo síðan segi aldrei „tókst“ að ósekju).
  const check = await roleIn(env, user, page.id);
  if (!check) return err("Ekki tókst að vista. Reyndu aftur.", 500);
  return json({ ok: true, page: page.name, already: res.meta.changes === 0 });
}

async function apiLeave(req, env, user, pageId) {
  await env.DB.prepare(`DELETE FROM members WHERE page_id=? AND user_id=?`).bind(pageId, user.id).run();
  return json({ ok: true });
}

async function apiPageMembers(req, env, user, pageId) {
  const role = await roleIn(env, user, pageId);
  if (role !== "admin" && !user.is_owner) return err("Aðeins stjórnendur.", 403);
  const r = await env.DB.prepare(
    `SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.page_id=? ORDER BY m.role,u.name`
  ).bind(pageId).all();
  const t = await env.DB.prepare(`SELECT p.id,p.name FROM trusts t JOIN pages p ON p.id=t.page_id WHERE t.venue_page_id=?`).bind(pageId).all();
  return json({ members: r.results, trusts: t.results });
}

async function apiSetRole(req, env, user, pageId) {
  const role = await roleIn(env, user, pageId);
  if (role !== "admin" && !user.is_owner) return err("Aðeins stjórnendur.", 403);
  const b = await readJson(req);
  const target = str(b && b.user, 60);
  const newRole = b && b.role;
  if (newRole === "remove") {
    await env.DB.prepare(`DELETE FROM members WHERE page_id=? AND user_id=?`).bind(pageId, target).run();
  } else if (newRole === "admin" || newRole === "member") {
    await env.DB.prepare(`UPDATE members SET role=? WHERE page_id=? AND user_id=?`).bind(newRole, pageId, target).run();
  } else return err("Ógilt hlutverk.");
  return json({ ok: true });
}

async function apiUntrust(req, env, user, pageId) {
  const role = await roleIn(env, user, pageId);
  if (role !== "admin" && !user.is_owner) return err("Aðeins stjórnendur.", 403);
  const b = await readJson(req);
  await env.DB.prepare(`DELETE FROM trusts WHERE venue_page_id=? AND page_id=?`).bind(pageId, str(b && b.page, 60)).run();
  return json({ ok: true });
}

/* ---- Eigandi: búa til síður ---- */
async function apiAdminPages(req, env, user) {
  if (!user.is_owner) return err("Aðeins eigandi.", 403);
  const r = await env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM members m WHERE m.page_id=p.id) n, pl.name place_name, pl.town place_town
     FROM pages p LEFT JOIN places pl ON pl.id=p.place_id ORDER BY p.name`
  ).all();
  return json({ pages: r.results });
}
async function apiCreatePage(req, env, user) {
  if (!user.is_owner) return err("Aðeins eigandi.", 403);
  const b = await readJson(req);
  const name = str(b && b.name, 100);
  const kind = b && b.kind;
  if (!name) return err("Nafn vantar.");
  if (!["band", "group", "venue"].includes(kind)) return err("Veldu tegund.");
  let placeId = null;
  if (kind === "venue") {
    placeId = str(b.place_id, 60);
    const pl = placeId && (await env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(placeId).first());
    if (!pl) return err("Veldu stað fyrir síðuna.");
  }
  const id = newId("p");
  for (let i = 0; i < 5; i++) {
    try {
      const code = newCode();
      await env.DB.prepare(`INSERT INTO pages (id,kind,name,code,place_id,created) VALUES (?,?,?,?,?,?)`)
        .bind(id, kind, name, code, placeId, now()).run();
      if (b.join) await env.DB.prepare(`INSERT OR IGNORE INTO members (page_id,user_id,role) VALUES (?,?,'admin')`).bind(id, user.id).run();
      return json({ ok: true, id, code });
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
  return err("Reyndu aftur.", 500);
}

/* ---------------- Staðir ---------------- */

async function apiPlaces(req, env) {
  const r = await env.DB.prepare(
    `SELECT pl.id,pl.name,pl.area,pl.town,pl.muni,pl.region,pl.lat,pl.lon,pl.cat,
       (SELECT p.id FROM pages p WHERE p.place_id=pl.id AND p.kind='venue' LIMIT 1) page_id
     FROM places pl ORDER BY pl.name`
  ).all();
  return json({ places: r.results }, 200, { "Cache-Control": "no-store" });
}

async function canAddPlace(env, user) {
  if (user.is_owner) return true;
  const r = await env.DB.prepare(`SELECT 1 FROM members WHERE user_id=? AND role='admin' LIMIT 1`).bind(user.id).first();
  return !!r;
}
async function apiCreatePlace(req, env, user) {
  if (!(await canAddPlace(env, user))) return err("Aðeins stjórnendur síðna geta skráð stað.", 403);
  const b = await readJson(req);
  const name = str(b && b.name, 100);
  const lat = Number(b && b.lat), lon = Number(b && b.lon);
  if (!name) return err("Heiti staðarins vantar.");
  if (!(lat > 62.5 && lat < 67.5 && lon > -25.5 && lon < -12.5)) return err("Punkturinn þarf að vera á Íslandi.");
  const id = newId("pl");
  await env.DB.prepare(`INSERT INTO places (id,name,area,town,muni,region,lat,lon,created_by,created) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, name, str(b.area, 80), str(b.town, 80), str(b.muni, 80), str(b.region, 40), lat, lon, user.id, now()).run();
  return json({ ok: true, id });
}

async function apiUpdatePlace(req, env, user, placeId) {
  // Eigandi, eða stjórnandi staðarsíðunnar, má færa/endurnefna stað.
  let ok = !!user.is_owner;
  if (!ok) {
    const r = await env.DB.prepare(
      `SELECT 1 FROM pages p JOIN members m ON m.page_id=p.id WHERE p.place_id=? AND m.user_id=? AND m.role='admin' LIMIT 1`
    ).bind(placeId, user.id).first();
    ok = !!r;
  }
  if (!ok) return err("Aðeins stjórnandi staðarins.", 403);
  const b = await readJson(req);
  const name = str(b && b.name, 100);
  const lat = Number(b && b.lat), lon = Number(b && b.lon);
  if (!name) return err("Heiti staðarins vantar.");
  if (!(lat > 62.5 && lat < 67.5 && lon > -25.5 && lon < -12.5)) return err("Punkturinn þarf að vera á Íslandi.");
  await env.DB.prepare(`UPDATE places SET name=?,area=?,town=?,muni=?,region=?,lat=?,lon=? WHERE id=?`)
    .bind(name, str(b.area, 80), str(b.town, 80), str(b.muni, 80), str(b.region, 40), lat, lon, placeId).run();
  return json({ ok: true });
}

/* ---------------- Viðburðir ---------------- */

const EV_COLS = `e.id,e.place_id,e.page_id,e.title,e.date,e.time,e.end_time,e.price,e.ticket,e.door,e.age,e.age_text,e.tags,e.other_label,e.fam,e.descr,e.poster,e.status,e.cancelled,e.cancel_note,e.time_changed,e.old_time,
  p.name page_name,p.kind page_kind`;
function outEvent(r) {
  let tags = [];
  try { tags = JSON.parse(r.tags || "[]"); } catch {}
  return { ...r, tags, door: !!r.door, fam: !!r.fam, cancelled: !!r.cancelled, time_changed: !!r.time_changed };
}

async function apiEvents(req, env, url) {
  let from = url.searchParams.get("from") || todayISO();
  let to = url.searchParams.get("to") || addDaysISO(from, 180);
  if (!isDate(from) || !isDate(to)) return err("Ógild dagsetning.");
  const r = await env.DB.prepare(
    `SELECT ${EV_COLS} FROM events e JOIN pages p ON p.id=e.page_id WHERE e.status='approved' AND e.date>=? AND e.date<=? ORDER BY e.date,e.time LIMIT 3000`
  ).bind(from, to).all();
  return json({ events: r.results.map(outEvent) });
}

async function apiEvent(req, env, id) {
  const r = await env.DB.prepare(`SELECT ${EV_COLS} FROM events e JOIN pages p ON p.id=e.page_id WHERE e.id=? AND e.status='approved'`).bind(id).first();
  if (!r) return err("Viðburður fannst ekki.", 404);
  return json({ event: outEvent(r) });
}

async function apiMyEvents(req, env, user) {
  const r = await env.DB.prepare(
    `SELECT ${EV_COLS} FROM events e JOIN pages p ON p.id=e.page_id JOIN members m ON m.page_id=e.page_id AND m.user_id=?
     WHERE e.date>=? ORDER BY e.date DESC,e.time LIMIT 500`
  ).bind(user.id, addDaysISO(todayISO(), -120)).all();
  return json({ events: r.results.map(outEvent) });
}

function cleanEvent(b) {
  const title = str(b.title, 140);
  if (!title) return { error: "Heiti viðburðar vantar." };
  const date = str(b.date, 10);
  if (!isDate(date)) return { error: "Veldu dagsetningu." };
  const time = str(b.time, 5);
  if (!isTime(time)) return { error: "Veldu tíma." };
  const end_time = str(b.end_time, 5);
  if (end_time && !isTime(end_time)) return { error: "Lokatíminn er ekki réttur." };
  let price = b.price === "" || b.price === null || b.price === undefined ? null : Math.round(Number(b.price));
  if (price !== null && !(price >= 0 && price < 1_000_000)) return { error: "Verðið er ekki rétt." };
  const tags = Array.isArray(b.tags) ? b.tags.filter((t) => TAGS.includes(t)) : [];
  if (!tags.length) return { error: "Veldu tegund viðburðar." };
  const age = ["", "12", "16", "18", "20", "fylgd"].includes(String(b.age || "")) ? String(b.age || "") : "";
  return {
    title, date, time, end_time, price,
    ticket: httpUrl(b.ticket),
    door: b.door ? 1 : 0,
    age,
    age_text: age ? "" : str(b.age_text, 80),
    tags: JSON.stringify(tags),
    other_label: tags.includes("annad") ? str(b.other_label, 40) : "",
    fam: b.fam ? 1 : 0,
    descr: str(b.descr, 3000),
    poster: /^[a-z0-9-]{10,80}\.(jpg|png|webp)$/.test(str(b.poster, 100)) ? str(b.poster, 100) : "",
  };
}

async function venuePageOf(env, placeId) {
  return env.DB.prepare(`SELECT id,name FROM pages WHERE place_id=? AND kind='venue' LIMIT 1`).bind(placeId).first();
}

async function apiCreateEvent(req, env, user) {
  const b = await readJson(req);
  if (!b) return err("Ógild gögn.");
  const pageId = str(b.page_id, 60);
  if (!(await roleIn(env, user, pageId))) return err("Þú ert ekki í þessari síðu.", 403);
  const page = await env.DB.prepare(`SELECT id,status FROM pages WHERE id=?`).bind(pageId).first();
  if (!page || page.status !== "approved") return err("Síðan hefur ekki verið samþykkt.", 403);
  const placeId = str(b.place_id, 60);
  const place = await env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(placeId).first();
  if (!place) return err("Veldu stað.");
  const c = cleanEvent(b);
  if (c.error) return err(c.error);

  // Staðurinn er hliðvörðurinn.
  const vp = await venuePageOf(env, placeId);
  let status = "approved";
  if (vp && vp.id !== pageId) {
    const t = await env.DB.prepare(`SELECT 1 FROM trusts WHERE venue_page_id=? AND page_id=?`).bind(vp.id, pageId).first();
    if (!t) status = "pending";
  }

  const repeat = Math.max(1, Math.min(52, Number(b.repeat_weeks) || 1));
  const ids = [];
  const stmts = [];
  for (let i = 0; i < repeat; i++) {
    const id = newId("e");
    ids.push(id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO events (id,place_id,page_id,title,date,time,end_time,price,ticket,door,age,age_text,tags,other_label,fam,descr,poster,status,created_by,created,updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, placeId, pageId, c.title, addDaysISO(c.date, i * 7), c.time, c.end_time, c.price, c.ticket, c.door, c.age, c.age_text,
        c.tags, c.other_label, c.fam, c.descr, c.poster, status, user.id, now(), now())
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true, ids, status, venue: vp ? vp.name : null });
}

async function eventForEdit(env, user, id) {
  const ev = await env.DB.prepare(`SELECT * FROM events WHERE id=?`).bind(id).first();
  if (!ev) return { error: err("Viðburður fannst ekki.", 404) };
  if (!user.is_owner && !(await roleIn(env, user, ev.page_id))) return { error: err("Þú mátt ekki breyta þessum viðburði.", 403) };
  return { ev };
}

async function apiUpdateEvent(req, env, user, id) {
  const { ev, error } = await eventForEdit(env, user, id);
  if (error) return error;
  const b = await readJson(req);
  if (!b) return err("Ógild gögn.");
  const c = cleanEvent(b);
  if (c.error) return err(c.error);
  let placeId = ev.place_id, status = ev.status;
  if (b.place_id && b.place_id !== ev.place_id) {
    const place = await env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(str(b.place_id, 60)).first();
    if (!place) return err("Veldu stað.");
    placeId = place.id;
    const vp = await venuePageOf(env, placeId);
    status = "approved";
    if (vp && vp.id !== ev.page_id) {
      const t = await env.DB.prepare(`SELECT 1 FROM trusts WHERE venue_page_id=? AND page_id=?`).bind(vp.id, ev.page_id).first();
      if (!t) status = "pending";
    }
  }
  const changed = ev.date !== c.date || ev.time !== c.time;
  const highlight = changed && b.highlight_change && ev.status === "approved";
  await env.DB.prepare(
    `UPDATE events SET place_id=?,title=?,date=?,time=?,end_time=?,price=?,ticket=?,door=?,age=?,age_text=?,tags=?,other_label=?,fam=?,descr=?,poster=?,status=?,
       time_changed=?,old_time=?,updated=? WHERE id=?`
  ).bind(placeId, c.title, c.date, c.time, c.end_time, c.price, c.ticket, c.door, c.age, c.age_text, c.tags, c.other_label, c.fam, c.descr,
    c.poster, status, highlight ? 1 : ev.time_changed, highlight ? `${ev.date} ${ev.time}` : ev.old_time, now(), id).run();
  return json({ ok: true, status });
}

async function apiCancelEvent(req, env, user, id, cancel) {
  const { error } = await eventForEdit(env, user, id);
  if (error) return error;
  const b = (await readJson(req)) || {};
  await env.DB.prepare(`UPDATE events SET cancelled=?,cancel_note=?,updated=? WHERE id=?`)
    .bind(cancel ? 1 : 0, cancel ? str(b.note, 300) : "", now(), id).run();
  return json({ ok: true });
}

async function apiDeleteEvent(req, env, user, id) {
  const { ev, error } = await eventForEdit(env, user, id);
  if (error) return error;
  await env.DB.prepare(`DELETE FROM events WHERE id=?`).bind(id).run();
  if (ev.poster) {
    const others = await env.DB.prepare(`SELECT 1 FROM events WHERE poster=? LIMIT 1`).bind(ev.poster).first();
    if (!others) await env.POSTERS.delete(ev.poster).catch(() => {});
  }
  return json({ ok: true });
}

/* ---- Beiðnir (staður samþykkir) ---- */
async function apiRequests(req, env, user) {
  const r = await env.DB.prepare(
    `SELECT ${EV_COLS}, vp.id venue_page_id, vp.name venue_page_name FROM events e JOIN pages p ON p.id=e.page_id
     JOIN pages vp ON vp.place_id=e.place_id AND vp.kind='venue' JOIN members m ON m.page_id=vp.id AND m.user_id=?
     WHERE e.status='pending' AND e.date>=? ORDER BY e.date,e.time`
  ).bind(user.id, todayISO()).all();
  return json({ requests: r.results.map(outEvent) });
}

async function apiAnswerRequest(req, env, user, id) {
  const b = (await readJson(req)) || {};
  const action = b.action;
  const ev = await env.DB.prepare(`SELECT id,place_id,page_id,status FROM events WHERE id=?`).bind(id).first();
  if (!ev) return err("Beiðnin fannst ekki.", 404);
  const vp = await venuePageOf(env, ev.place_id);
  if (!vp || !(await roleIn(env, user, vp.id))) return err("Þú mátt ekki svara þessari beiðni.", 403);
  if (action === "approve" || action === "always") {
    const stmts = [env.DB.prepare(`UPDATE events SET status='approved',updated=? WHERE id=?`).bind(now(), id)];
    if (action === "always") {
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO trusts (venue_page_id,page_id) VALUES (?,?)`).bind(vp.id, ev.page_id));
      // Aðrar bíðandi beiðnir frá sömu síðu á þennan stað samþykkjast líka.
      stmts.push(env.DB.prepare(`UPDATE events SET status='approved',updated=? WHERE status='pending' AND page_id=? AND place_id IN (SELECT place_id FROM pages WHERE id=?)`).bind(now(), ev.page_id, vp.id));
    }
    await env.DB.batch(stmts);
  } else if (action === "trust") {
    await env.DB.prepare(`INSERT OR IGNORE INTO trusts (venue_page_id,page_id) VALUES (?,?)`).bind(vp.id, ev.page_id).run();
  } else if (action === "reject") {
    await env.DB.prepare(`UPDATE events SET status='rejected',updated=? WHERE id=?`).bind(now(), id).run();
  } else return err("Ógild aðgerð.");
  return json({ ok: true });
}

/* ---------------- Plaköt (R2) ---------------- */
async function apiUploadPoster(req, env, user) {
  if (!env.POSTERS) return err("Plakatageymslan er ekki tilbúin enn.", 503);
  const type = (req.headers.get("Content-Type") || "").split(";")[0];
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
  if (!ext) return err("Plakatið þarf að vera mynd (jpg, png eða webp).");
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_POSTER_BYTES) return err("Myndin er of stór.");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_POSTER_BYTES || buf.byteLength < 100) return err("Myndin er of stór eða skemmd.");
  const key = `${randomToken(12)}.${ext}`;
  await env.POSTERS.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { by: user.id } });
  return json({ ok: true, key });
}
async function apiGetPoster(req, env, key) {
  if (!env.POSTERS) return err("Fannst ekki.", 404);
  if (!/^[a-z0-9-]{10,80}\.(jpg|png|webp)$/.test(key)) return err("Fannst ekki.", 404);
  const obj = await env.POSTERS.get(key);
  if (!obj) return err("Fannst ekki.", 404);
  return new Response(obj.body, {
    headers: headersBase({ "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" }),
  });
}

/* ---------------- Beiningar ---------------- */

async function route(req, env, url, path) {
  const m = req.method;
  if (path === "/api/gate" && m === "POST") {
    const form = await req.formData().catch(() => null);
    const pw = form ? String(form.get("password") || "") : "";
    if (!env.SITE_PASSWORD || pw !== env.SITE_PASSWORD) return gatePage(env, true);
    return new Response(null, {
      status: 302,
      headers: headersBase({ Location: env.BASE_PATH + "/", "Set-Cookie": cookie(env, "gate", await sha256("gate:" + env.SITE_PASSWORD), 365 * 86400) }),
    });
  }

  if (!(await gateOk(req, env))) return path.startsWith("/api/") ? err("Lykilorð vantar.", 401) : gatePage(env, false);

  if (!path.startsWith("/api/")) {
    // Skrár síðunnar (public/event/...).
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(headersBase())) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }

  await ensureSchema(env);

  // CSRF-vörn: breytingar aðeins frá okkar eigin síðu.
  if (m !== "GET" && m !== "HEAD" && path !== "/api/gate") {
    const origin = req.headers.get("Origin");
    if (origin && origin !== url.origin) return err("Bannað.", 403);
  }

  if (path === "/api/login" && m === "POST") return apiLogin(req, env);
  if (path === "/api/verify" && m === "GET") return apiVerify(req, env, url);
  if (path === "/api/logout" && m === "POST") return apiLogout(req, env);
  if (path === "/api/places" && m === "GET") return apiPlaces(req, env);
  if (path === "/api/events" && m === "GET") return apiEvents(req, env, url);
  let mm;
  if ((mm = path.match(/^\/api\/events\/([\w-]+)$/)) && m === "GET") return apiEvent(req, env, mm[1]);
  if ((mm = path.match(/^\/api\/poster\/([\w.-]+)$/)) && m === "GET") return apiGetPoster(req, env, mm[1]);

  const user = await currentUser(req, env);
  if (path === "/api/me" && m === "GET") return apiMe(req, env, user);
  if (!user) return err("Þú þarft að skrá þig inn.", 401);

  if (path === "/api/me" && m === "POST") return apiSetName(req, env, user);
  if (path === "/api/join" && m === "POST") return apiJoin(req, env, user);
  if ((mm = path.match(/^\/api\/pages\/([\w-]+)\/leave$/)) && m === "POST") return apiLeave(req, env, user, mm[1]);
  if ((mm = path.match(/^\/api\/pages\/([\w-]+)\/members$/)) && m === "GET") return apiPageMembers(req, env, user, mm[1]);
  if ((mm = path.match(/^\/api\/pages\/([\w-]+)\/role$/)) && m === "POST") return apiSetRole(req, env, user, mm[1]);
  if ((mm = path.match(/^\/api\/pages\/([\w-]+)\/untrust$/)) && m === "POST") return apiUntrust(req, env, user, mm[1]);
  if (path === "/api/admin/pages" && m === "GET") return apiAdminPages(req, env, user);
  if (path === "/api/admin/pages" && m === "POST") return apiCreatePage(req, env, user);
  if (path === "/api/admin/demo" && (m === "POST" || m === "DELETE")) {
    if (!user.is_owner) return err("Aðeins eigandi.", 403);
    return json(m === "POST" ? await createDemo(env, todayISO()) : await deleteDemo(env));
  }
  if (path === "/api/places" && m === "POST") return apiCreatePlace(req, env, user);
  if ((mm = path.match(/^\/api\/places\/([\w-]+)$/)) && m === "PUT") return apiUpdatePlace(req, env, user, mm[1]);
  if (path === "/api/my-events" && m === "GET") return apiMyEvents(req, env, user);
  if (path === "/api/events" && m === "POST") return apiCreateEvent(req, env, user);
  if ((mm = path.match(/^\/api\/events\/([\w-]+)$/)) && m === "PUT") return apiUpdateEvent(req, env, user, mm[1]);
  if ((mm = path.match(/^\/api\/events\/([\w-]+)$/)) && m === "DELETE") return apiDeleteEvent(req, env, user, mm[1]);
  if ((mm = path.match(/^\/api\/events\/([\w-]+)\/(cancel|uncancel)$/)) && m === "POST") return apiCancelEvent(req, env, user, mm[1], mm[2] === "cancel");
  if (path === "/api/requests" && m === "GET") return apiRequests(req, env, user);
  if ((mm = path.match(/^\/api\/requests\/([\w-]+)$/)) && m === "POST") return apiAnswerRequest(req, env, user, mm[1]);
  if (path === "/api/poster" && m === "POST") return apiUploadPoster(req, env, user);
  return err("Fannst ekki.", 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const base = env.BASE_PATH || "";
    if (!url.pathname.startsWith(base)) return new Response("Not found", { status: 404 });
    let path = url.pathname.slice(base.length);
    if (path === "") return Response.redirect(url.origin + base + "/" + url.search, 301);
    try {
      return await route(req, env, url, path);
    } catch (e) {
      console.error(e);
      return err("Villa kom upp. Reyndu aftur.", 500);
    }
  },
};
