// Prufuviðburðir á alvöru stöðum (úr OpenStreetMap) til að sjá síðuna „í notkun“.
// Viðburðirnir og böndin eru tilbúningur. Allt prufudót hefur id sem byrjar á "demo-"
// og hægt er að eyða öllu í einu – staðirnir sjálfir haldast.

const BANDS = [
  ["Brimsalt", "band"], ["Kvöldroði", "band"], ["Hrafnaspark", "band"], ["Þokan", "band"], ["Sjávarsól", "band"], ["DJ Norðurljós", "band"],
  ["Gunna og Gítarinn", "band"], ["Malbik", "band"], ["Tunglskin", "band"], ["Kór Suðurbæjar", "group"], ["Leikfélagið Grímur", "group"],
  ["Spurningalið Siggu", "group"], ["Uppistandshópurinn Hlátur", "group"], ["Lúðrasveitin Lúðurinn", "group"], ["Kvenfélagið Fjóla", "group"],
];

const TITLES = {
  tonleikar: (b) => [`${b}`, `${b} – útgáfutónleikar`, `${b} á heimavelli`, `Tónleikar: ${b}`, `${b} + gestir`, `Jólatónleikar ${b}`],
  dj: () => ["DJ kvöld", "Föstudagsdiskó", "Dansað fram á nótt", "Vínylkvöld", "90's kvöld", "Laugardagsklúbbur"],
  pubquiz: () => ["Pub quiz", "Barsvar", "Pub quiz – jólaþema", "Spurningakeppni"],
  uppistand: () => ["Uppistand", "Uppistandskvöld", "Opið míkrófónkvöld"],
  leikhus: () => ["Leiksýning: Síðasti strætóinn", "Spunaleikhús", "Leiklestur", "Jólaleikrit fyrir börn"],
  list: () => ["Myndlistaropnun: Ljós og skuggi", "Ljósmyndasýning", "Listamarkaður", "Opin vinnustofa"],
  annad: () => ["Bingó", "Íbúafundur", "Jólamarkaður", "Prjónakvöld", "Spilakvöld", "Jólaball"],
};
const OTHER_LABEL = { "Bingó": "Bingó", "Íbúafundur": "Fundur", "Jólamarkaður": "Markaður", "Prjónakvöld": "Prjónakvöld", "Spilakvöld": "Spilakvöld", "Jólaball": "Ball" };
const BY_CAT = {
  bar: ["tonleikar", "tonleikar", "dj", "pubquiz", "uppistand"],
  pub: ["tonleikar", "tonleikar", "pubquiz", "pubquiz", "dj"],
  nightclub: ["dj", "dj", "tonleikar"],
  biergarten: ["tonleikar", "pubquiz"],
  theatre: ["leikhus", "leikhus", "uppistand", "tonleikar"],
  cinema: ["annad", "list"],
  arts_centre: ["list", "tonleikar", "leikhus"],
  music_venue: ["tonleikar"], concert_hall: ["tonleikar"], events_venue: ["tonleikar", "dj"],
  community_centre: ["annad", "tonleikar", "leikhus", "annad"],
  social_centre: ["annad", "tonleikar"],
  sports_hall: ["annad", "tonleikar"],
  cafe: ["tonleikar", "list", "pubquiz"],
  restaurant: ["tonleikar", "pubquiz"],
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function createDemo(env, todayISO) {
  await deleteDemo(env);
  const r = rng(Date.now() % 100000);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const now = Date.now();
  const stmts = [];

  const all = (await env.DB.prepare(`SELECT id,name,cat,town FROM places`).all()).results;
  const chosen = new Map();
  for (const p of all) {
    if (!p.cat) chosen.set(p.id, { ...p, cat: "bar" }); // staðir skráðir handvirkt (t.d. Hafið)
    else if (p.cat !== "cafe" && p.cat !== "restaurant") chosen.set(p.id, p);
    else if (r() < 0.09 || p.town === "Höfn") chosen.set(p.id, p);
  }

  const bands = BANDS.map(([name, kind], i) => {
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO pages (id,kind,name,code,created) VALUES (?,?,?,?,?)`).bind(`demo-pb-${i}`, kind, name, `DEMOB${i}`, now));
    return { id: `demo-pb-${i}`, name, kind };
  });
  const bandsOnly = bands.filter((b) => b.kind === "band");
  const groups = bands.filter((b) => b.kind === "group");
  const addDays = (n) => { const d = new Date(todayISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  let n = 0;
  for (const pl of chosen.values()) {
    const big = ["bar", "pub", "nightclub", "music_venue", "concert_hall", "theatre"].includes(pl.cat);
    const count = big ? 2 + Math.floor(r() * 5) : 1 + Math.floor(r() * 2);
    for (let k = 0; k < count; k++) {
      const tag = pick(BY_CAT[pl.cat] || ["tonleikar"]);
      const by = tag === "tonleikar" || tag === "dj" ? pick(bandsOnly) : pick(groups);
      const title = pick(TITLES[tag](by.name));
      const day = Math.floor(r() * 42);
      const fam = tag === "list" || tag === "leikhus" ? r() < 0.5 : tag === "annad" ? r() < 0.4 : r() < 0.06;
      const time = tag === "dj" ? pick(["22:00", "23:00", "23:30"]) : tag === "list" ? pick(["16:00", "17:00", "18:00"]) : fam ? pick(["14:00", "15:00", "17:00"]) : pick(["20:00", "20:30", "21:00", "21:00", "22:00"]);
      const end = tag === "dj" ? pick(["03:00", "04:00", ""]) : r() < 0.3 ? pick(["23:00", "00:00", "01:00"]) : "";
      const price = tag === "list" || tag === "annad" ? (r() < 0.7 ? 0 : 1000) : tag === "pubquiz" ? 0 : r() < 0.15 ? 0 : r() < 0.15 ? null : Math.round((1500 + r() * 5000) / 500) * 500;
      const age = fam ? "" : tag === "dj" ? pick(["20", "18", "20"]) : r() < 0.4 ? pick(["18", "20"]) : "";
      const cancelled = r() < 0.03 ? 1 : 0;
      const changed = !cancelled && r() < 0.04 ? 1 : 0;
      const date = addDays(day);
      stmts.push(env.DB.prepare(
        `INSERT OR REPLACE INTO events (id,place_id,page_id,title,date,time,end_time,price,ticket,door,age,age_text,tags,other_label,fam,descr,poster,status,cancelled,cancel_note,time_changed,old_time,created,updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(`demo-e-${n++}`, pl.id, by.id, title, date, time, end, price,
        price && price >= 3000 && r() < 0.5 ? "https://tix.is/" : "", price && r() < 0.5 ? 1 : 0, age, "",
        JSON.stringify([tag]), tag === "annad" ? OTHER_LABEL[title] || "" : "", fam ? 1 : 0,
        "🧪 Prufuviðburður – ekki raunverulegur. Hér kæmi lýsing frá staðnum eða bandinu.", "", "approved", cancelled,
        cancelled ? "Veikindi í hljómsveitinni" : "", changed, changed ? `${date} 20:00` : "", now, now));
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { places: chosen.size, pages: bands.length, events: n };
}

export async function deleteDemo(env) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM events WHERE id LIKE 'demo-%' OR place_id LIKE 'demo-%' OR page_id LIKE 'demo-%'`),
    env.DB.prepare(`DELETE FROM trusts WHERE venue_page_id LIKE 'demo-%' OR page_id LIKE 'demo-%'`),
    env.DB.prepare(`DELETE FROM members WHERE page_id LIKE 'demo-%'`),
    env.DB.prepare(`DELETE FROM pages WHERE id LIKE 'demo-%'`),
    env.DB.prepare(`DELETE FROM places WHERE id LIKE 'demo-%'`),
  ]);
  return { ok: true };
}
