/* Netföng staða – fundin einu sinni, svo staðir geti staðfest sig sjálfir.
   1) Úr OpenStreetMap (netfang/heimasíða/Facebook sem skráð er á þann tiltekna stað).
   2) Heimasíða sem vantar: Google Places, leitað við staðsetningu staðarins (aldrei bara eftir nafni,
      svo Pakkhúsið á Höfn ruglist ekki við annað Pakkhús). Bara samþykkt ef staðurinn er innan ~300 m.
   3) Netfang sótt af heimasíðunni (forsíða og „hafa samband“-síða).
   Google: Text Search með websiteUri = 1.000 ókeypis á mánuði; stoppum við 900. */
import OSM_CONTACTS from "./osm-contacts.json";

const GOOGLE_MONTH_CAP = 900;
const BAD_MAIL = /(example\.|sentry|wixpress|@2x|\.png|\.jpg|\.gif|\.webp|\.svg|domain\.|yourdomain|email\.com$|u00|noreply|no-reply)/i;

export async function contactsSchema(env) {
  for (const sql of [
    `ALTER TABLE places ADD COLUMN email TEXT DEFAULT ''`, `ALTER TABLE places ADD COLUMN web TEXT DEFAULT ''`,
    `ALTER TABLE places ADD COLUMN fb TEXT DEFAULT ''`, `ALTER TABLE places ADD COLUMN phone TEXT DEFAULT ''`,
    `ALTER TABLE places ADD COLUMN email_src TEXT DEFAULT ''`, `ALTER TABLE places ADD COLUMN web_src TEXT DEFAULT ''`,
    `ALTER TABLE places ADD COLUMN contact_checked INTEGER DEFAULT 0`,
  ]) { try { await env.DB.prepare(sql).run(); } catch (_e) {} }
  // Ný regla (samhengi netfangs): netföng sem sótt voru af heimasíðum eru sótt aftur. Google er EKKI spurt aftur
  // (heimasíðurnar eru vistaðar), svo bara staðir með heimasíðu fara aftur í gegn.
  const rule = await env.DB.prepare(`SELECT v FROM meta WHERE k='contacts_rule'`).first();
  if (!rule || rule.v !== "2") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE places SET email='', email_src='' WHERE email_src='web'`),
      env.DB.prepare(`UPDATE places SET contact_checked=0 WHERE web<>'' AND email=''`),
      env.DB.prepare(`INSERT OR REPLACE INTO meta (k,v) VALUES ('contacts_rule','2')`),
    ]);
  }
  // Regla 3: staðir sem Google fann ekki heimasíðu fyrir eru spurðir aftur (einu sinni) með rýmri reglu.
  const r3 = await env.DB.prepare(`SELECT v FROM meta WHERE k='contacts_google2'`).first();
  if (!r3) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE places SET contact_checked=0 WHERE web='' AND email=''`),
      env.DB.prepare(`INSERT OR REPLACE INTO meta (k,v) VALUES ('contacts_google2','1')`),
    ]);
  }
  const row = await env.DB.prepare(`SELECT v FROM meta WHERE k='contacts_osm'`).first();
  if (row && row.v === "1") return;
  const stmts = Object.entries(OSM_CONTACTS).map(([id, [email, web, fb, phone]]) =>
    env.DB.prepare(`UPDATE places SET email=CASE WHEN email='' THEN ? ELSE email END, email_src=CASE WHEN email='' AND ?<>'' THEN 'osm' ELSE email_src END,
      web=CASE WHEN web='' THEN ? ELSE web END, web_src=CASE WHEN web='' AND ?<>'' THEN 'osm' ELSE web_src END, fb=?, phone=? WHERE id=?`)
      .bind(email, email, web, web, fb, phone, id));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (k,v) VALUES ('contacts_osm','1')`).run();
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae").replace(/ö/g, "o").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
function nameSim(a, b) { const A = new Set(norm(a)), B = norm(b); if (!A.size || !B.length) return 0; return B.filter((w) => A.has(w)).length / Math.min(A.size, B.length); }
function distM(a, b, c, d) { const R = 6371e3, r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; }
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_e) { return ""; } };

async function googleWebsite(env, p) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_PLACES_KEY, "X-Goog-FieldMask": "places.displayName,places.location,places.websiteUri" },
    body: JSON.stringify({ textQuery: `${p.name} ${p.town || ""}`.trim(), pageSize: 3, languageCode: "is",
      locationBias: { circle: { center: { latitude: p.lat, longitude: p.lon }, radius: 500 } } }),
  });
  if (!r.ok) throw new Error("Google: " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  for (const g of j.places || []) {
    if (!g.websiteUri || !g.location) continue;
    const d = distM(p.lat, p.lon, g.location.latitude, g.location.longitude);
    const sim = nameSim(p.name, g.displayName && g.displayName.text);
    // Rýmra (17. nóv): nafnið passar og innan 800 m, eða alveg við punktinn (100 m).
    if ((d <= 800 && sim >= 0.5) || d <= 100) return g.websiteUri;
  }
  return "";
}

// Netföng með samhengi: hvað stendur í kringum netfangið á síðunni.
// Við „Hafa samband / Netfang / Bókanir / Contact“ = gott. Við „Hönnun / Design by / Powered by“ = hunsað (vefhönnuður).
const GOOD_CTX = /(hafa samband|samband|netfang|t[öo]lvup[óo]st|b[óo]kan|b[óo]ka |pantan|fyrirspurn|contact|e-?mail|booking|reservation|info)/i;
const BAD_CTX = /(h[öo]nnun|hanna[ðd]|vefh[öo]nnun|vefs[íi][ðd]a ger[ðd]|vefur ger|sm[íi][ðd]a[ðd]|design(ed)? by|developed by|powered by|made by|website by|web by|created by|built by|webdesign|web design)/i;
function emailsIn(html) {
  const txt = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@").replace(/%40/g, "@");
  const plain = txt.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<a [^>]*href=["']mailto:([^"'?>\s]+)[^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ");
  const found = new Map();
  for (const m of plain.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const e = m[0].toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) || BAD_MAIL.test(e) || e.length >= 80) continue;
    // Orðið sem stendur NÆST á undan netfanginu ræður (önnur netföng í textanum eru tekin út fyrst).
    const before = plain.slice(Math.max(0, m.index - 100), m.index).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ".repeat(5));
    const lastPos = (re) => { let p = -1; for (const x of before.matchAll(new RegExp(re.source, "gi"))) p = x.index; return p; };
    const gp = lastPos(GOOD_CTX), bp = lastPos(BAD_CTX);
    const bad = bp > gp, good = gp > bp;
    const prev = found.get(e) || { e, score: 0, bad: false };
    prev.score += good ? 3 : 1;
    prev.bad = prev.bad || (bad && !good);
    found.set(e, prev);
  }
  return [...found.values()].filter((x) => !x.bad).sort((a, b) => b.score - a.score);
}
async function getHtml(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Vidburdir; netfang stadar)" } });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") || "")) return "";
    return (await r.text()).slice(0, 600000);
  } catch (_e) { return ""; } finally { clearTimeout(t); }
}
function pickEmail(list, web) {
  if (!list.length) return "";
  const h = host(web), best = list[0].score;
  const top = list.filter((x) => x.score === best).map((x) => x.e);
  return top.find((e) => h && e.endsWith("@" + h)) || top[0];
}
async function emailFromSite(web) {
  if (!web || /facebook\.com|instagram\.com/i.test(web)) return "";
  const url = /^https?:/i.test(web) ? web : "https://" + web;
  const html = await getHtml(url);
  if (!html) return "";
  let found = emailsIn(html);
  if (!found.length) {
    // „Hafa samband“-síðan
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1])
      .filter((h) => /(hafa-?samband|samband|contact|kontakt|um-okkur|about)/i.test(h)).slice(0, 2);
    for (const l of links) {
      let u; try { u = new URL(l, url).href; } catch (_e) { continue; }
      if (host(u) !== host(url)) continue;
      found = emailsIn(await getHtml(u));
      if (found.length) break;
    }
  }
  return pickEmail(found, url);
}

// Eitt skref (fáir staðir í einu svo Cloudflare-mörk haldist). Kallað aftur og aftur úr stjórnborðinu.
export async function contactsStep(env) {
  await contactsSchema(env);
  const month = new Date().toISOString().slice(0, 7);
  const cnt = await env.DB.prepare(`SELECT v FROM meta WHERE k=?`).bind("google_" + month).first();
  let used = cnt ? +cnt.v : 0;
  const batch = (await env.DB.prepare(`SELECT id,name,town,lat,lon,web,email FROM places WHERE contact_checked=0 AND lat IS NOT NULL ORDER BY id LIMIT 3`).all()).results;
  const log = [];
  for (const p of batch) {
    let web = p.web, webSrc = "", email = p.email, emailSrc = "";
    if (!web && env.GOOGLE_PLACES_KEY && used < GOOGLE_MONTH_CAP) {
      try { used++; web = await googleWebsite(env, p); if (web) webSrc = "google"; }
      catch (e) { log.push(`${p.name}: ${String(e.message || e)}`); used--; continue; } // ekki merkja yfirfarinn – reynt aftur
    }
    // Ein slæm heimasíða má aldrei stöðva alla leitina.
    if (!email && web) { try { email = await emailFromSite(web); if (email) emailSrc = "web"; } catch (_e) { email = ""; } }
    await env.DB.prepare(`UPDATE places SET contact_checked=?, web=CASE WHEN web='' THEN ? ELSE web END, web_src=CASE WHEN web_src='' THEN ? ELSE web_src END,
      email=CASE WHEN email='' THEN ? ELSE email END, email_src=CASE WHEN email_src='' THEN ? ELSE email_src END WHERE id=?`)
      .bind(Date.now(), web || "", webSrc, email || "", emailSrc, p.id).run();
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)`).bind("google_" + month, String(used)).run();
  return { ...(await contactsStats(env)), done: batch.length === 0, googleUsed: used, errors: log };
}
export async function contactsStats(env) {
  await contactsSchema(env);
  const r = await env.DB.prepare(`SELECT COUNT(*) n, SUM(contact_checked>0) checked, SUM(email<>'') email, SUM(web<>'') web, SUM(fb<>'') fb FROM places`).first();
  return { total: r.n, checked: r.checked || 0, email: r.email || 0, web: r.web || 0, fb: r.fb || 0, hasKey: !!env.GOOGLE_PLACES_KEY };
}
