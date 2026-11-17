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
  ball: () => ["Dansleikur", "Stórdansleikur", "Jólaball", "Sveitaball", "Þorrablót og ball"],
  trubador: () => ["Trúbador", "Trúbadorkvöld", "Trúbador fram á nótt", "Singalong með trúbador"],
  dj: () => ["DJ kvöld", "Föstudagsdiskó", "Dansað fram á nótt", "Vínylkvöld", "90's kvöld", "Laugardagsklúbbur"],
  pubquiz: () => ["Pub quiz", "Barsvar", "Pub quiz – jólaþema", "Spurningakeppni"],
  uppistand: () => ["Uppistand", "Uppistandskvöld", "Opið míkrófónkvöld"],
  leikhus: () => ["Leiksýning: Síðasti strætóinn", "Spunaleikhús", "Leiklestur", "Jólaleikrit fyrir börn"],
  list: () => ["Myndlistaropnun: Ljós og skuggi", "Ljósmyndasýning", "Listamarkaður", "Opin vinnustofa"],
  annad: () => ["Bingó", "Íbúafundur", "Jólamarkaður", "Prjónakvöld", "Spilakvöld", "Jólaball"],
};
const OTHER_LABEL = { "Bingó": "Bingó", "Íbúafundur": "Fundur", "Jólamarkaður": "Markaður", "Prjónakvöld": "Prjónakvöld", "Spilakvöld": "Spilakvöld", "Jólaball": "Ball" };
const BY_CAT = {
  bar: ["tonleikar", "tonleikar", "dj", "trubador", "trubador", "pubquiz", "uppistand"],
  pub: ["tonleikar", "trubador", "trubador", "pubquiz", "pubquiz", "dj"],
  nightclub: ["dj", "dj", "tonleikar"],
  biergarten: ["tonleikar", "pubquiz"],
  theatre: ["leikhus", "leikhus", "uppistand", "tonleikar"],
  cinema: ["annad", "list"],
  arts_centre: ["list", "tonleikar", "leikhus"],
  music_venue: ["tonleikar"], concert_hall: ["tonleikar"], events_venue: ["tonleikar", "dj"],
  community_centre: ["annad", "ball", "ball", "tonleikar", "leikhus", "annad"],
  social_centre: ["annad", "tonleikar"],
  sports_hall: ["annad", "ball", "tonleikar"],
  cafe: ["tonleikar", "list", "pubquiz"],
  restaurant: ["tonleikar", "pubquiz"],
};

const GENRES = ["rokk", "rokk", "metall", "ponk", "popp", "popp", "hiphop", "raf", "djass", "blus", "kantri", "thjodlaga", "klassik", "kor", "abreidur"];
const THEATRE = ["leiksyning", "leiksyning", "songleikur", "barnaleikrit", "dans", "leikhus_annad"];

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

  const all = (await env.DB.prepare(`SELECT id,name,cat,town,lat,lon,muni,region FROM places WHERE COALESCE(cat,'')<>'town'`).all()).results;
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
      const music = ["tonleikar", "dj", "ball", "trubador"].includes(tag);
      const by = music ? pick(bandsOnly) : pick(groups);
      const title = pick(TITLES[tag](by.name));
      const day = Math.floor(r() * 42);
      const fam = tag === "list" || tag === "leikhus" ? r() < 0.5 : tag === "annad" ? r() < 0.4 : r() < 0.06;
      const time = tag === "ball" ? pick(["23:00", "23:30"]) : tag === "dj" ? pick(["22:00", "23:00", "23:30"]) : tag === "list" ? pick(["16:00", "17:00", "18:00"]) : fam ? pick(["14:00", "15:00", "17:00"]) : pick(["20:00", "20:30", "21:00", "21:00", "22:00"]);
      const end = tag === "dj" ? pick(["03:00", "04:00", ""]) : r() < 0.3 ? pick(["23:00", "00:00", "01:00"]) : "";
      const price = tag === "list" || tag === "annad" ? (r() < 0.7 ? 0 : 1000) : tag === "pubquiz" ? 0 : r() < 0.15 ? 0 : r() < 0.15 ? null : Math.round((1500 + r() * 5000) / 500) * 500;
      const age = fam ? "" : tag === "dj" ? pick(["20", "18", "20"]) : r() < 0.4 ? pick(["18", "20"]) : "";
      const cancelled = r() < 0.03 ? 1 : 0;
      const changed = !cancelled && r() < 0.04 ? 1 : 0;
      const date = addDays(day);
      stmts.push(env.DB.prepare(
        `INSERT OR REPLACE INTO events (id,place_id,page_id,title,date,time,end_time,price,ticket,door,age,age_text,tags,genres,other_label,fam,descr,poster,status,cancelled,cancel_note,time_changed,old_time,created,updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(`demo-e-${n++}`, pl.id, by.id, title, date, time, end, price,
        price && price >= 3000 && r() < 0.5 ? "https://tix.is/" : "", price && r() < 0.5 ? 1 : 0, age, "",
        JSON.stringify(music ? ["tonlist", tag] : tag === "leikhus" ? ["leikhus", pick(THEATRE)] : [tag]),
        JSON.stringify(music && tag !== "dj" && r() < 0.8 ? [...new Set([pick(GENRES), ...(r() < 0.3 ? [pick(GENRES)] : [])])] : []), tag === "annad" ? OTHER_LABEL[title] || "" : "", fam ? 1 : 0,
        "🧪 Prufuviðburður – ekki raunverulegur. Hér kæmi lýsing frá staðnum eða bandinu.", "", "approved", cancelled,
        cancelled ? "Veikindi í hljómsveitinni" : "", changed, changed ? `${date} 20:00` : "", now, now));
    }
  }
  // Viðburðir yfir allan sólarhringinn (á hverjum degi), svo alltaf sjáist eitthvað „Í gangi“.
  const DAY = [
    ["08:00", "09:30", "annad", "Morgunjóga með lifandi tónlist", false, 1],
    ["10:00", "11:30", "annad", "Morgunkaffi og harmonikka", false, 1],
    ["10:00", "18:00", "list", "Listsýning: Ljós og myrkur", false, 1],
    ["12:00", "13:00", "tonleikar", "Hádegistónleikar", true, 1],
    ["13:00", "14:30", "leikhus", "Barnaleikrit: Litli bátsmaðurinn", false, 1],
    ["14:00", "16:00", "annad", "Bingó", false, 1],
    ["15:00", "16:30", "tonleikar", "Kaffihúsatónleikar", true, 1],
    ["17:00", "19:00", "trubador", "Happy hour trúbador", true, 0],
    ["23:00", "05:00", "dj", "Næturvakt", true, 0],
  ];
  const places = [...chosen.values()];
  for (let day = -1; day < 42; day++) { // frá því í gær, svo næturviðburðir séu í gangi eftir miðnætti
    for (const [time, end, tag, base, music, fam] of DAY) {
      const pl = pick(places), by = music ? pick(bandsOnly) : pick(groups);
      const title = tag === "dj" ? `${base}: ${by.name}` : music ? `${base}: ${by.name}` : base;
      stmts.push(env.DB.prepare(
        `INSERT OR REPLACE INTO events (id,place_id,page_id,title,date,time,end_time,price,ticket,door,age,age_text,tags,genres,other_label,fam,descr,poster,status,cancelled,cancel_note,time_changed,old_time,created,updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(`demo-e-${n++}`, pl.id, by.id, title, addDays(day), time, end, tag === "dj" ? 2500 : 0, "", 0, tag === "dj" ? "20" : "", "",
        JSON.stringify(music ? ["tonlist", tag] : tag === "leikhus" ? ["leikhus", "barnaleikrit"] : [tag]),
        JSON.stringify(tag === "tonleikar" ? [pick(["klassik", "djass", "thjodlaga"])] : tag === "dj" ? ["raf"] : []),
        tag === "annad" ? (base === "Bingó" ? "Bingó" : "") : "", fam,
        "🧪 Prufuviðburður – ekki raunverulegur. Hér kæmi lýsing frá staðnum eða bandinu.", "", "approved", 0, "", 0, "", now, now));
    }
  }
  // Prufuhátíðir: bæjarhátíð í gangi núna (með böllum/tónleikum sem eru „hluti af“) og tónleikahátíð eftir rúma viku.
  const INS = `INSERT OR REPLACE INTO events (id,place_id,page_id,title,date,end_date,url,festival_id,time,end_time,price,ticket,door,age,age_text,tags,genres,other_label,fam,descr,poster,status,cancelled,cancel_note,time_changed,old_time,created,updated,headline)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const byTown = {};
  for (const p of places) if (p.town) (byTown[p.town] = byTown[p.town] || []).push(p);
  const towns = Object.entries(byTown).filter(([, ps]) => ps.length >= 3).map(([t]) => t);
  const fest = (id, town, title, from, to, sub, url, descr) => {
    // Bæjarhátíð er í öllum bænum: staðurinn er bærinn sjálfur (á miðjum bænum).
    const ps = byTown[town], tid = "town:" + town;
    const lat = ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon = ps.reduce((a, p) => a + p.lon, 0) / ps.length;
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO places (id,name,cat,town,muni,region,lat,lon,created) VALUES (?,?,?,?,?,?,?,?,?)`).bind(tid, town, "town", town, ps[0].muni, ps[0].region, lat, lon, now));
    const pl = sub === "baejarhatid" ? { id: tid } : byTown[town][0];
    stmts.push(env.DB.prepare(INS).bind(id, pl.id, pick(groups).id, title, addDays(from), addDays(to), url, "", "14:00", "", 0, "", 0, "", "",
      JSON.stringify(["hatid", sub]), "[]", "", 1, descr, "", "approved", 0, "", 0, "", now, now, 0));
    return byTown[town];
  };
  if (towns.length >= 2) {
    const ps1 = fest("demo-f-1", towns[0], "Fjarðadagar", -1, 2, "baejarhatid", "https://example.com/fjardadagar",
      "🧪 Prufuhátíð. Bæjarhátíð með tónleikum, böllum, uppistandi og alls konar fjöri um allan bæ.");
    const subs = [[0, "20:00", "23:00", "tonleikar", "Fjarðadagatónleikar"], [1, "23:00", "03:00", "ball", "Stórdansleikur Fjarðadaga"], [1, "16:00", "17:30", "uppistand", "Uppistand á Fjarðadögum"], [1, "21:00", "23:00", "trubador", "Trúbador á Fjarðadögum"], [2, "22:00", "02:00", "dj", "Lokapartý Fjarðadaga"]];
    subs.forEach(([d, t, et, tag, title], i) => {
      const music = tag !== "uppistand";
      stmts.push(env.DB.prepare(INS).bind(`demo-fs-${i}`, ps1[(i + 1) % ps1.length].id, (music ? pick(bandsOnly) : pick(groups)).id, title, addDays(d), "", "", "demo-f-1", t, et,
        tag === "ball" ? 4500 : 0, "", tag === "ball" ? 1 : 0, tag === "ball" ? "18" : "", "",
        JSON.stringify(music ? ["tonlist", tag] : [tag]), "[]", "", tag === "uppistand" ? 1 : 0, "🧪 Prufuviðburður – hluti af prufuhátíðinni Fjarðadögum.", "", "approved", 0, "", 0, "", now, now, tag === "ball" ? 1 : 0));
    });
    fest("demo-f-2", towns[1], "Norðanrokk", 9, 11, "tonleikahatid", "https://example.com/nordanrokk",
      "🧪 Prufuhátíð. Þriggja daga rokkhátíð með fjölda hljómsveita.");
    n += 7;
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
