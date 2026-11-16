// Prufugögn til að sjá síðuna „í notkun“. Allt hefur id sem byrjar á "demo-"
// og hægt er að eyða öllu í einu. Nöfn staða og banda eru tilbúningur.

const TOWNS = {
  "Reykjavík": [-21.9335, 64.1458, "reykjavik", "hofudborg"],
  "Hafnarfjörður": [-21.96118, 64.07035, "hafnarfjordur", "hofudborg"],
  "Kópavogur": [-21.90868, 64.11222, "kopavogur", "hofudborg"],
  "Reykjanesbær": [-22.56032, 63.98391, "reykjanesbaer", "sudurnes"],
  "Selfoss": [-21.00597, 63.93733, "arborg", "sudurland"],
  "Hveragerði": [-21.1897, 63.99842, "hveragerdi", "sudurland"],
  "Vestmannaeyjar": [-20.28014, 63.44024, "vestmannaeyjar", "sudurland"],
  "Borgarnes": [-21.92352, 64.53929, "borgarbyggd", "vesturland"],
  "Akranes": [-22.08671, 64.31818, "akranes", "vesturland"],
  "Ísafjörður": [-23.12409, 66.07449, "isafjardarbaer", "vestfirdir"],
  "Stykkishólmur": [-22.73493, 65.07542, "stykkisholmur", "vesturland"],
  "Sauðárkrókur": [-19.63991, 65.74619, "skagafjordur", "nlv"],
  "Akureyri": [-18.09127, 65.68425, "akureyri", "nle"],
  "Siglufjörður": [-18.91067, 66.15256, "fjallabyggd", "nle"],
  "Húsavík": [-17.34034, 66.04532, "nordurthing", "nle"],
  "Egilsstaðir": [-14.39939, 65.26323, "mulathing", "austurland"],
  "Seyðisfjörður": [-14.0011, 65.26132, "mulathing", "austurland"],
  "Neskaupstaður": [-13.68498, 65.14984, "fjardabyggd", "austurland"],
  "Höfn": [-15.20509, 64.25383, "hornafjordur", "austurland"],
  "Vík": [-19.00653, 63.41881, "myrdalshreppur", "sudurland"],
  "Kirkjubæjarklaustur": [-18.04219, 63.7936, "skaftarhreppur", "sudurland"],
  "Hvolsvöllur": [-20.22537, 63.75125, "rangarthing-eystra", "sudurland"],
  "Blönduós": [-20.28243, 65.66169, "hunabyggd", "nlv"],
  "Patreksfjörður": [-24.00626, 65.59908, "vesturbyggd", "vestfirdir"],
  "Dalvík": [-18.53064, 65.97296, "dalvikurbyggd", "nle"],
  "Djúpivogur": [-14.27842, 64.65675, "mulathing", "austurland"],
};

// [heiti, bær, hversu dreift (í gráðum, aðeins fyrir stærri bæi)]
const VENUES = [
  ...["Kjallarinn", "Bláa ljónið", "Hornsílið", "Mýrin bar", "Gamla kaupfélagið", "Svarti svanurinn", "Lundinn", "Hjartastaður", "Bakgarðurinn",
    "Tunglið", "Rökkrið", "Vitinn", "Skúrinn", "Portbarinn", "Glerhúsið", "Hljómskálakjallarinn", "Ölstofa Óðins", "Steinhúsið", "Garðskálinn",
    "Litla leikhúsið", "Menningarsalurinn", "Sögusalurinn", "Djúpið", "Hafnarhúsbarinn", "Næturgalinn", "Bryggjubarinn", "Ljósvakinn", "Kaffi Klettur"]
    .map((n) => [n, "Reykjavík", 0.012]),
  ["Gamla smiðjan", "Hafnarfjörður", 0.006], ["Fjörusteinn", "Hafnarfjörður", 0.006], ["Bæjarskálinn", "Hafnarfjörður", 0.006],
  ["Klettasalurinn", "Kópavogur", 0.008], ["Hamraborgarkjallarinn", "Kópavogur", 0.008],
  ["Rokksalurinn", "Reykjanesbær", 0.006], ["Ostagerðin", "Selfoss", 0.005], ["Listhúsið", "Hveragerði", 0.003],
  ["Bryggjan", "Vestmannaeyjar", 0.004], ["Landnámssalurinn", "Borgarnes", 0.003], ["Vitakaffi", "Akranes", 0.004],
  ["Pollhúsið", "Ísafjörður", 0.003], ["Vatnasalurinn", "Stykkishólmur", 0.002], ["Gúttó", "Sauðárkrókur", 0.003],
  ["Hlaðan", "Akureyri", 0.008], ["Rauða húfan", "Akureyri", 0.008], ["Brekkusalurinn", "Akureyri", 0.008], ["Pollurinn", "Akureyri", 0.008],
  ["Síldarsalurinn", "Siglufjörður", 0.003], ["Hvalbarinn", "Húsavík", 0.003], ["Lagarbarinn", "Egilsstaðir", 0.004],
  ["Fjarðarhúsið", "Seyðisfjörður", 0.002], ["Netagerðin", "Neskaupstaður", 0.003], ["Hafnarskálinn", "Höfn", 0.003],
  ["Svarta fjaran", "Vík", 0.002], ["Kirkjuhvoll", "Kirkjubæjarklaustur", 0.002], ["Hvoll", "Hvolsvöllur", 0.002],
  ["Félagsheimilið", "Blönduós", 0.002], ["Fjarðarsalur", "Patreksfjörður", 0.002], ["Bergmál", "Dalvík", 0.002],
  ["Lækjarbúð", "Djúpivogur", 0.002],
];

const BANDS = [
  ["Brimsalt", "band"], ["Kvöldroði", "band"], ["Hrafnaspark", "band"], ["Þokan", "band"], ["Sjávarsól", "band"], ["DJ Norðurljós", "band"],
  ["Gunna og Gítarinn", "band"], ["Kór Suðurbæjar", "group"], ["Leikfélagið Grímur", "group"], ["Spurningalið Siggu", "group"],
  ["Uppistandshópurinn Hlátur", "group"], ["Lúðrasveit Norðurlands", "group"],
];

const TITLES = {
  tonleikar: (b) => [`${b}`, `${b} – útgáfutónleikar`, `${b} á heimavelli`, `Tónleikar: ${b}`, `${b} + gestir`, `Jólatónleikar ${b}`],
  dj: () => ["DJ kvöld", "Föstudagsdiskó", "Dansað fram á nótt", "Vínylkvöld", "90's kvöld", "Laugardagsklúbbur"],
  pubquiz: () => ["Pub quiz", "Barsvar", "Pub quiz – jólaþema", "Spurningakeppni"],
  uppistand: () => ["Uppistand", "Uppistandskvöld", "Opið míkrófónkvöld", "Hláturinn lengir lífið"],
  leikhus: () => ["Leiksýning: Síðasti strætóinn", "Spunaleikhús", "Leiklestur", "Jólaleikrit fyrir börn"],
  list: () => ["Myndlistaropnun: Ljós og skuggi", "Ljósmyndasýning", "Listamarkaður", "Opin vinnustofa"],
  annad: () => ["Bingó", "Íbúafundur", "Jólamarkaður", "Prjónakvöld", "Spilakvöld"],
};
const OTHER_LABEL = { "Bingó": "Bingó", "Íbúafundur": "Fundur", "Jólamarkaður": "Markaður", "Prjónakvöld": "Prjónakvöld", "Spilakvöld": "Spilakvöld" };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function createDemo(env, todayISO) {
  const r = rng(Date.now() % 100000);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const now = Date.now();
  const stmts = [];

  const places = VENUES.map(([name, town, spread], i) => {
    const [lon, lat, muni, region] = TOWNS[town];
    const id = `demo-pl-${i}`;
    const la = lat + (r() - 0.5) * spread * 0.45, lo = lon + (r() - 0.5) * spread;
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO places (id,name,town,muni,region,lat,lon,created) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, name, town, muni, region, +la.toFixed(5), +lo.toFixed(5), now));
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO pages (id,kind,name,code,place_id,created) VALUES (?,?,?,?,?,?)`)
      .bind(`demo-pv-${i}`, "venue", name, `DEMOV${i}`, id, now));
    return { id, page: `demo-pv-${i}`, name };
  });
  const bands = BANDS.map(([name, kind], i) => {
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO pages (id,kind,name,code,created) VALUES (?,?,?,?,?)`).bind(`demo-pb-${i}`, kind, name, `DEMOB${i}`, now));
    return { id: `demo-pb-${i}`, name };
  });

  const tagW = [["tonleikar", 45], ["dj", 15], ["pubquiz", 10], ["uppistand", 8], ["leikhus", 7], ["list", 7], ["annad", 8]];
  const total = tagW.reduce((a, b) => a + b[1], 0);
  const pickTag = () => { let x = r() * total; for (const [t, w] of tagW) { if ((x -= w) < 0) return t; } return "tonleikar"; };
  const addDays = (n) => { const d = new Date(todayISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  let n = 0;
  for (const pl of places) {
    const count = 2 + Math.floor(r() * 5);
    for (let k = 0; k < count; k++) {
      const tag = pickTag();
      const band = tag === "tonleikar" || tag === "leikhus" || tag === "uppistand" ? pick(bands) : null;
      const title = pick(TITLES[tag](band ? band.name : ""));
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
      ).bind(`demo-e-${n++}`, pl.id, band ? band.id : pl.page, title, date, time, end, price,
        price && price >= 3000 && r() < 0.5 ? "https://tix.is/" : "", price && r() < 0.5 ? 1 : 0, age, "",
        JSON.stringify(fam && tag === "tonleikar" ? [tag] : [tag]), tag === "annad" ? OTHER_LABEL[title] || "" : "", fam ? 1 : 0,
        "Prufuviðburður – ekki raunverulegur. Hér kæmi lýsing frá staðnum eða bandinu.", "", "approved", cancelled,
        cancelled ? "Veikindi í hljómsveitinni" : "", changed, changed ? `${date} 20:00` : "", now, now));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { places: places.length, pages: places.length + bands.length, events: n };
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
