# MULEHEAD → ANDROID · Handoff

Skrifað 10. nóvember 2026 í gömlu Mulehead-vinnustofunni (Electron-útgáfan 1.5.6).
Skjalið á að gera nýrri Cline-lotu kleift að byggja Android-útgáfu án þess að lesa Electron-kóðann fyrst.
Allt hér er staðfest í kóða og prófunum. Heimildarkóðinn er í `reference/mac-electron/`.

---

## 0. Vinnureglur

- Notandinn (Júlíus) er EKKI forritari. Útskýrðu stuttlega á íslensku eftir hvert skref.
- Allur texti í appinu á að vera á íslensku.
- Ekki hanna UI fyrr en lestur playlistans (M3U/XMLTV) virkar og er prófaður.
- Allt sem hægt er að prófa án síma á að fá JUnit-próf.

---

## 1. Samhengi

Mulehead er IPTV-spilari (íslenskur, allur texti á íslensku) fyrir Mac.
Notandi: Júlíus Sigfússon. Frændi hans notar líka appið (fær zip-pakka).
Áskriftin er IPTV-þjónusta (Xtream Codes eða M3U-hlekkur) sem notandi setur sjálfur inn.
Appið er EKKI með neinn straum sjálft; það sækir allt frá þjónustunni.

Nú á að gera Android-útgáfu: sími + Android TV. Markmið fyrstu útgáfu:
beinar rásir, rásalisti, dagskrá (nú/næst), uppáhalds, leit, stillingar.
VOD og „Horfa saman“ má bíða en á að hanna með þau í huga.

Mac-útgáfan er í: `/Users/juliussigfusson/Downloads/mulehead` (útgáfa 1.5.6).
Ekkert git-repo, ekkert LICENSE-skjal (ákvarða þarf fyrir útgáfu).

---

## 2. Mac-útgáfan: bygging og dreifing

- `node build/pack.js` → `dist/Mulehead-darwin-arm64/Mulehead.app`
  (arm64, appVersion 1.5.6, asar, ffmpeg sem extraResource)
- Zip fyrir frænda: `ditto -c -k --keepParent /tmp/Mulehead-1.5.6 dist/Mulehead-1.5.6-arm64.zip`
- Uppsetning hjá notanda: draga í `/Applications`, svo
  `xattr -dr com.apple.quarantine /Applications/Mulehead.app`
- Zip-ið er ~128 MB og er EKKI í þessu projecti; það er í `dist/` hjá gömlu vinnustofunni
  (SHA-256 `4f436c1d7101412ae16035ce978f9d8fa216fa25fa2325ea09580c9e88e7e5cc`).
- Gögn notandans: `~/Library/Application Support/Mulehead` (config.json, files/, cache/)
- Cache-skrár: `pl-<id>.json` (rásir), `epg-<id>.json` (dagskrá),
  `vod-movies-<id>.json`, `vod-series-<id>.json`

---

## 3. Skráakort gamla appsins (til að fletta í)

| Skrá | Hlutverk |
|---|---|
| main.js (465 l) | Electron-main: IPC, playlist-stjórnun, EPG-sæking, vefsíða, leikir, ffmpeg |
| preload.js | contextBridge: `window.api.*` (öll IPC á einum stað) |
| lib/m3u.js (95 l) | M3U/M3U8 þáttun |
| lib/playlists.js (190 l) | sækir M3U / Xtream / skrá; VOD og þættir |
| lib/epg.js (155 l) | XMLTV þáttun, tímar, nafnaeining, afritahreinsun |
| lib/sports.js (511 l) | Leikir dagsins: ESPN/FotMob/TheSportsDB, krækir á rásir |
| lib/vodproxy.js (300 l) | ffmpeg-vefþjónn fyrir myndir/þætti (remux, seek) |
| lib/webserver.js (86 l) | lítill vefþjónn (port 8899) fyrir playlista |
| lib/store.js (76 l) | config.json, cache, sjálfgefin gildi |
| renderer/app.js (1747 l) | allt UI: flokkar, listi, sameining, dagskrá, VOD, herbergi |
| renderer/player.js (872 l) | spilarinn: buffer, bank, vaktir, endurtenging, ffmpeg-relay |
| renderer/sync.js (225 l) | „Horfa saman“ yfir MQTT |
| renderer/index.html | UI-uppbygging (id-in eru góð leiðsögn fyrir Compose) |
| renderer/games.html/js | gluggi „Leikir dagsins“ |

---

## 4. Stillingar (config.json → settings) — sjálfgefin gildi

| Lykill | Sjálfgefið | Merking |
|---|---|---|
| bufferSec | 60 | buffer-mark í sekúndum (sleði 2–120) |
| growSlow | true | safna í buffer með því að spila 5% hægar |
| sortAZ | true | raða rásum innan flokks |
| mergeVariants | true | HD/FHD/4K/backup í eina línu |
| userAgent | `''` → `VLC/3.0.20 LibVLC/3.0.20` | sumar áskriftir krefjast ákveðins UA |
| format | `ts` | Xtream streymis-snið: `ts` \| `hls` |
| refreshHours | 12 | hversu oft playlists + dagskrá endursækjast |
| webPort | 8899 | vefsíða fyrir playlista (Mac) |
| nickname | `''` | nafn í herbergi |
| syncRoom | `''` | herbergiskóði — geymdur en appið tengist honum ALDREI sjálft |
| epgOffsetMin | 0 | hliðrun dagskrár í mínútum (neyðarúrræði) |
| liveRelay | `always` | beinar rásir í gegnum staðbundið ffmpeg (Mac) |

Per playlist (`per[playlistId]`): `favorites[]`, `recent[]`, `groupOrder[]`,
`hiddenGroups[]`, `lastChannel`, `lastGroup`, `chanHealth{ rás → { fails, at } }`.

Playlistar: `{ id, name, type: 'url'|'file'|'xtream', url, server, username,
password, epgUrl, lastCount }`

---

## 5. Playlistar

**M3U/M3U8** — lesið úr hlekk (timeout 180 s) eða úr skrá sem notandi hleður upp.

- `#EXTM3U url-tvg="…"` / `x-tvg-url` / `tvg-url` → epgUrl (ef kommur: fyrsti hlekkur)
- `#EXTINF:-1 tvg-id="" tvg-name="" tvg-logo="" group-title="…",Nafn`
  — gildi mega vera í `"…"`, `'…'` eða ógilt; nafn er textinn eftir kommuna
  sem kemur Á EFTIR attribute-listanum (komma inni í gildi telst ekki)
- `#EXTGRP:Nafn` → flokkur ef `group-title` vantar; annars „Án flokks“
- `#EXTVLCOPT:http-user-agent=…` → UA fyrir þessa rás
- Tegund rásar: `/movie/` í slóð → movie, `/series/` → series, annars live
- Gzip (0x1f 0x8b) er afþjappað sjálfkrafa

**Xtream Codes** — server + notandi + lykilorð (eða M3U-hlekkur með `get.php?username=…`).

- `player_api.php?username&password` → auth (`user_info.auth != 0`), `exp_date` → expires
- `&action=get_live_categories`, `get_live_streams` (timeout 120 s)
- Rás: `{base}/live/{user}/{pass}/{stream_id}.ts` eða `.m3u8` eftir `format`
- Dagskrá sjálfgefið: `{base}/xmltv.php?username={user}&password={pass}`
- VOD: `get_vod_categories`, `get_vod_streams` → `{base}/movie/{u}/{p}/{id}.{container_extension}`
- Þættir: `get_series_categories`, `get_series`, `get_series_info&series_id=`
  → `{base}/series/{u}/{p}/{id}.ext`

---

## 6. Dagskrá (XMLTV) — MIKILVÆGASTI KAFLINN

**Þáttun**: streymandi SAX (`javax.xml.parsers`) í bæði Mac og Android — EKKI DOM, skráin er
28 MB / ~94.000 þættir). Gluggi: þættir sem enda ≥ now−6 klst og byrja ≤ now+48 klst.
Sæking: timeout 300 s, UA sama og annars staðar.

**Tímastimplar**: `parseXmltvTime` tekur `YYYYMMDDhhmmss[ ±HHMM]`.
Reiknar `Date.UTC(...)` og dregur síðan frá offset `sign * (klst*60 + mín) * 60000`.
Dæmi: `20261109223000 +0100` → 21:30 UTC. Rétt. Ótvírætt.
Vantar offset → tíminn er tekinn sem UTC.

**Þetta á EKKI að „laga“.** Þjónustan stimplar ALLT `+0100` (staðfest: 94.200 af 94.200 þáttum),
og breskir þættir koma rétt út (Newsnight 22:30, ITV News at Ten 22:05, BBC One NI Newsline 22:30
— borið saman við bbc.co.uk/ITV handvirkt 10. nóv. 2026). Ekki bæta við
„ef England er í sumartíma“-kvísl.

**Afritahreinsun**: þjónustan listar sama þátt tvisvar (sama start, sama stop, sama titill)
— 647 sinnum í heild. `sortUniq`: raða eftir start, sleppa lið ef
`${start}|${stop}|${title}` hefur sést. Tveir MISMUNANDI þættir sem byrja á sama tíma
eru báðir haldnir. Þetta þarf að flytja.

**Nafnaeining rása → dagskrár** (`chanMap`), í þessari röð:

1. `tvg-id` passar nákvæmlega við id í XML
2. `tvg-id` lágstafað
3. `nameToId[norm(tvgName)]`, svo `nameToId[norm(name)]`
4. `nameToIdLoose[looseNorm(tvgName)]`, svo `looseNorm(name)`
5. annars null → „Engin dagskrá fyrir þessa rás“

`norm(s)` = lágstafir → NFKD → fjarlægja stafi með merkjum → fjarlægja orðin
`hd|fhd|uhd|4k|sd|hevc|h265|+1` (orðamörk) → fjarlægja allt sem er ekki `[a-z0-9]`.
`looseNorm(s)` = fjarlægja landsefnið `^[A-Z]{2,4}\s*[:|]\s*` og orðin
`backup|alt|raw|b|8k|hdr|4k|uhd|fhd|hd|sd|hevc|h265|\d{3,4}p`, svo `norm()`.
Dæmi: „UK: Sky Sports Main Event FHD B“ ↔ „Sky Sports Main Event“ → `skysportsmainevent`.

**Þrjú þekkt vandamál í gögnunum (ekki endurtaka mistökin):**

1. **„+1“ rásir.** `norm()` fjarlægir `+1`, svo „ITV1+1“ fellur saman við „ITV1“.
   Hjá notandanum er `UK: Channel 5  1` (Channel 5 +1) með `tvg-id = Channel 5 HD.uk`
   → dagskráin sýnir það sem kemur NÆST (1 klst á undan myndinni).
   Í Android: **beislaðu `+1`/`+2` sem sjálfstæða rás**. Ef heitið er timeshift en
   dagskrár-id ekki, skilaðu `null` (betra en rangt). Aldrei blanda.
2. **BBC One (venjuleg)** hefur `<channel id="BBCOne.uk">` en NÚLL þætti.
   Aðeins NI / Scotland / Wales virka.
3. **Tvítekningar** — sjá `sortUniq` hér að ofan.

**Nú/næst**: `t = Date.now() - epgOff()`; tvöfalt leit í sorteruðum lista; `now` ef
`stop > t`, `next` = næsti liður. Hliðrun (`epgOffsetMin`) bætist við birtan tíma.
ATH: notandinn hefur tekið skýrt fram að misræmi upp á sekúndur–2 mínútur milli myndar
og dagskrár **skiptir hann engu máli**. Ekki eyða tíma í að láta dagskrána „fylgja skjánum“.

---

## 7. Rásalisti og UI

**Uppbygging (Mac)**: vinstri dálkur = flokkar; miðja = rásalisti; hægri = spilari + „nú“ +
dagskráarlisti. Efst: playlistaval, leit, 🔄 uppfæra, 🤝 Horfa saman, ➕ Playlistar, ⚙️ stillingar.
Þrír hamar: 📺 Beint / 🎬 Myndir / 📼 Þættir.

**Sérflokkar efst**: ⭐ Uppáhalds, 🕘 Nýlegt, 📺 Allar rásir, ⚽ Beint í dag, svo raðir flokkar
(notandi getur raðað og falið flokka í „✏️ Raða og fela flokka“).

**Sameining variant-a** (`mergeVariants`): eitt „row“ = ein eða fleiri rásir.

- `splitName`: hentar af ENDA upp að 6 „quality“-tögum:
  `FHD|HD|UHD|SD|4K|8K|HDR|HEVC|H.265|RAW|B|BACKUP|ALT|P00` + `\d{3,4}[PI]|\d{2}FPS`
  + svæði í hornklofa/sviga
- `variantRank` (lægst spilar fyrst): FHD 0, HD 1, venjulegt 2, UHD/4K 3, SD 4;
  +10 fyrir B/BACKUP/ALT; +5 fyrir SKY GO
- `mergeKey`: lágstafir, NFKD, aðeins `[a-z0-9: ]`, orð >3 stafir sem enda á `s` sleppa `s`
- Skammstöfun jafngildir útskrifuðu nafni AÐEINS ef forskeytið er eins, vantar orð eru
  almennileg orð og NÁKVÆMLEGA eitt nafn passar („Sky Sport PL“ = „Sky Sport Premier League“)
- Röðun: íslensk stafrófsröð (`a á b c d ð e é f g h i í j k l m n o ó p q r s t u ú v w x y ý z þ æ ø`)
  + náttúruleg töluröð (2 fyrir 10). Flokkar halda röð frá þjónustunni.

**Annað í listanum**: „recent“ síðustu 30 sek, uppáhald (⭐), leit (⌘F, getur leitað í öllum
flokkum), fjölval með Shift og tilfærsla með örvum, gul/rauð merking eftir mistökum á rás
(`chanHealth`) sem hreinsast eftir góða spilun.

**Lyklaborð (Mac)**: `F` fullskjár, `M` hljóð, `B` „Hlaða buffer“, `R` endurtengja, `⌘F` leit.

---

## 8. Spilarinn (mikilvægasta upplifunin)

Tegund streymis: `.m3u8`/`/hls/` → HLS; `.mp4|.mkv|.mov|.avi|.webm|.m4v` → native; annars MPEG-TS.
Í Mac: mpegts.js (TS), hls.js (HLS), `<video>` (native), og bundled ffmpeg sem relay/proxy.

**Buffer-hermílur** (allt þetta er lærdómur af raunverulegum vandamálum):

- Spilun hefst þegar `readyState ≥ 2` og buffer ≥ mark, eða eftir mark+20 s
- `growSlow`: `playbackRate = 0.95` þar til marki er náð (óþekkjanlegt); eftir frost `0.90`
- Mark: 60 s sjálfgefið (2–120)
- Tæmist buffer: fylla aðeins 15 s (`REBUFFER_SEC`) — biðja um fulla mínútu heldur myndinni
  frostri 3–4x lengur
- Tæmist aftur innan 2 mín (`DRY_ESCALATE_MS`): þá má fylla fullt mark
- Eftir stökk (live edge/gat): bíða aðeins 8 s, ekki fullan buffer
- Þögn >3 s þegar buffer er þurr → endurtengja STRAX (Wi-Fi drop gefur enga villu)
- Engin gögn í 7 s við opnun → „Rásin svarar ekki“; 25 s ef gögn bárust en hægt
- `LIVE_EDGE_SEC = 40`: gat í streyminu stærra en 40 s = stökk á live-brún
- Rammavakt: tíminn gengur en enginn rammi birtist → endurstilla (5 mín sleppt ef alltaf)
- Þrjú mistök á sömu rás → rás merkt „dauð“; notandi fær „Reyna aftur“ / „Velja aðra rás“
- „Hlaða buffer“ (bank): pása og safna upp að 560 s (`BANK_MAX_SEC`), vakt 20 s, stall 12 s
- PiP, fullskjár, hljóðstika, stór skjátexti (OSD) í 4 s eftir skipti

**Af hverju ffmpeg-relay**: sumar TS-rásir og MKV/AC3/DTS myndir ráða ekki við í vafranum.
Loka-ffmpeg (`127.0.0.1/live?src=…`) heldur sambandi við þjónustuna opnu og myndin heldur
áfram úr buffer þótt netið detti. Ef relay virkar ekki → fer beint á þráðinn (`relayFallback`).
**Í Android á þetta EKKI við**: Media3/ExoPlayer spilar TS, HLS, MKV, HEVC og fleira sjálft.

---

## 9. „Horfa saman“ (herbergi) — protocol sem þarf að halda

- MQTT yfir WebSocket, opinberir ókeypis brokerar: `wss://broker.hivemq.com:8884/mqtt`,
  `wss://test.mosquitto.org:8081/mqtt` (varaleið ef fyrri neitar)
- Topic: `mulehead/v1/room/<KÓÐI>`; kóði 5 stafir úr `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- Hver app birtir sína stöðu 1x á sekúndu; á 6 s fresti er hún fjarlægð hjá hinum
- Skilaboð (JSON): `{ id, n: nafn, ch: heiti, ck: sameiningarlykill, cat: hvenær rás var valin,
  k: 'ts'|'pts', t: streymistími, w: wall clock, p: er að spila, bank: til hvenær,
  bm: markað buffer, bye: true }`
- Samanburður: `peerNow = p.t + (p.p ? (Date.now() - p.w)/1000 : 0)`, `d = myNow - peerNow`
  (PTS-hringur: `2^33/90000 ≈ 95443,7 s` — leiðrétta `d` ef `|d| > hringur/2`)
- `|d| > 60` → „ekki sama efni“; annars stýring:
  `d > 1.0` → pása í `d-0.05` s; `d > 0.15` → `0.92x`; annars `1.0x`; cooldown eftir inngrip
- Rásin fylgir þeim sem breytti síðast (`cat = max(chAt, followAt)`); nýliði á að sjá `cat > 0`
  (mistök 11. nóv.: nýr gluggi sat og gerði ekkert því hann hafði aðeins fylgt, `cat = 0`)
- `rateLocked`: á meðan verið er að sync-a má `growSlow` EKKI setja hraðann
- „Hlaða buffer“ í herbergi → allir pása samtímis (`bank`/`bm`)
- Appið tengist ALDREI sjálft við geymdan kóða; notandi ýtir á 🤝 og „Taka þátt“
- Android: sama topic og sama skilaboð → Mac og Android geta horft saman.
  Nota má Paho eða OkHttp WebSocket.

---

## 10. Leikir dagsins (valfrítt í fyrstu útgáfu)

- Leikir/staða: ESPN opinbert scoreboard JSON (engan lykil þarf); FotMob-league-id sem aðalheimild
- Sjónvarpsrásir eftir landi: TheSportsDB (valfrítt premium lykill) + eigin dagskrá
- Deildir: Premier League, Champions League, Europa, Conference, Championship, League One,
  FA Cup, Carabao, La Liga, Bundesliga, Serie A, Ligue 1, Skotland, Eredivisie, Liga Portugal,
  Besta deildin, Nations League, HM, EM (sjálfgefið: fyrstu 9)
- Lönd (sjálfgefin): Ísland, UK, USA, Ástralía, Nýja-Sjáland (+ Írland, Kanada, Arabíska)
- Kræking leikja á rásir: landsefni í heiti flokks/rásar (IS/UK/US…), þekkt gælunöfn liða
  (Man Utd, Spurs, Wolves…) og dagskráin til að staðfesta tíma
- Uppfært á mínútu fresti á meðan leikur er í gangi, annars 15 mín
- ⚽ flokkurinn „Beint í dag“ sýnir leiki uppáhaldsliðanna

---

## 11. Myndir og þættir (VOD)

- Xtream: `get_vod_streams` / `get_series` + `get_series_info` (þættir eftir seríum)
- M3U: liðir með `/movie/` eða `/series/` í slóð
- Mac-spilun fer í gegnum bundled ffmpeg (`lib/vodproxy.js`): remux í fragmented MP4
  (HEVC/AV1/VP9 vídeó og AAC/MP3/Opus hljóð eru leyfð; annað er transcodað), aðeins EIN
  tenging við þjónustuna í einu, seek = endurræsa ffmpeg á `-ss`
- Android: ExoPlayer spilar MKV/AC3/DTS sjálft — engin þörf fyrir proxy.
  Hafa bara `DefaultHttpDataSource` með UA og láta extractor-röðina um restina.

---

## 12. Íslenskir strengir (halda sama tón)

Beint · Myndir · Þættir · Uppáhalds · Nýlegt · Allar rásir · Beint í dag · Leikir ·
Horfa saman · Taka þátt · Búa til herbergi · Hlaða buffer · Reyna aftur · Velja aðra rás ·
Safnar í buffer… · Hleður… · Ekkert merki · Rásin svarar ekki · Streymi slitnaði ·
Streymi þagnaði · Rásin fannst ekki (HTTP 404) · Engin dagskrá fyrir þessa rás · Ekkert hér. ·
Enginn playlisti · Áskriftin er ekki með neitt hér. · Uppfæra playlista og dagskrá ·
Raða og fela flokka · Hliðra dagskrá

---

## 13. Villusaga og lærdómur (ekki endurtaka)

1. **„Dagskráin er klukkustund á undan“** — reyndist EKKI tímabeltisvilla. Tímastimplar eru
   réttir (sjá kafla 6). Raunverulegu orsakirnar: tvítekningar í gögnum, `+1` rás með dagskrá
   aðalrásar, og að notandanum finnst sekúndna–mínútna misræmi skipta engu máli.
   → Ekki eyða tíma í klukku„lagfæringar“.
2. **Tvítekningar** — 647 í heimild; leyst með `sortUniq` (1.5.6).
3. **`norm()` fjarlægir `+1`** — hættulegt; í Android á `+1` að vera hluti af auðkenni rásar.
4. **Sync**: `close` getur komið EFTIR að ný tenging er komin upp → nota `client.connected`,
   ekki eigin fána. Rás má ekki „echo-a“ til baka. `setRate(1)` á hverri sekúndu drepur
   buffer-vöxt.
5. **Eftir stökk** má ekki bíða fulls buffers (kveikti 60 sek „Safnar í buffer“).
6. **Buffer þurr** → 15 s, ekki 60; endurtenging strax ef þögn >3 s.
7. **Nýr ffmpeg í relay** kemur á live-brún → `jumpGap(40)` annars stendur myndin.
8. Rás sem HTTP 404-ar er ekki „hæg“ heldur dauð — sýna „Reyna aftur“.

---

## 14. Android-útgáfan: hvað passar við hvað

| Mac (Electron) | Android |
|---|---|
| mpegts.js / hls.js / `<video>` | **Media3 ExoPlayer** (TS, HLS, MP4, MKV í einu) |
| `growSlow` + `bufferedAhead` | Media3 `LiveConfiguration.setTargetOffsetMs()` + `DefaultLoadControl` |
| ffmpeg-relay fyrir beinar rásir | óþarft; `DefaultHttpDataSource` með UA |
| ffmpeg VOD-proxy | óþarft |
| SAX XMLTV | `javax.xml.parsers.SAXParserFactory` í `Dispatchers.IO` (sama og Mac), sama glugga-logík |
| config.json | `DataStore` (Preferences) + JSON-fæll fyrir playlists/dagskrá í `filesDir`/`cacheDir` |
| IPC (preload.js) | `ViewModel` + `Repository` + `StateFlow` |
| DOM-listi með fullskjá-OSD | Compose (TV Material3, D-pad focus) |
| setInterval-uppfærsla | `WorkManager` (12 klst) + `LaunchedEffect` fyrir nú/næst |
| mqtt.js | Paho eða OkHttp WebSocket, sama topic/skilaboð |

**Ákvarðanir sem þegar eru teknar í þessu projecti**

- Pakki: `app.mulehead` (EKKI `is.mulehead…` — `is` er Kotlin-lykilorð)
- `minSdk 26`, `compileSdk 37`, `targetSdk 37`, útgáfa `0.1`
- Allur texti á íslensku, tákn 🐴
- Fyrsta útgáfa: beinar rásir + dagskrá + uppáhalds + leit + stillingar. VOD og 🤝 næst.

**Verkfæri á þessari vél**

- Android Studio í `/Applications`, JDK 25 í `…/Contents/jbr/Contents/Home`
  (Java er ekki á PATH — `org.gradle.java.home` er stillt í `gradle.properties`)
- SDK: platform `android-37.0`, build-tools `36.0.0`
- Gradle 9.6.0 þegar niðurhalað í `~/.gradle/wrapper/dists`
- AVD: `Television_1080p`, `Medium_Phone`
- Fyrsta bygging sækir pakkana af netinu (5–15 mín).

---

## 15. Hvað er hvar í þessu projecti

- `app/` — Android-appið (Kotlin + Compose)
- `docs/HANDOFF.md` — þetta skjal
- `docs/PLAN.md` — stuttur verklisti (byrja hér)
- `reference/mac-electron/` — kóði Mac-útgáfunnar til að fletta í (ekki þýða)
- Zip-pakki Mac-útgáfunnar er EKKI hér (128 MB); hann er í `dist/` í
  `/Users/juliussigfusson/Downloads/mulehead`
- LICENSE: ekkert slíkt skjal er til. Ákveða þarf leyfi ef appið fer á Google Play.

---

## 16. Skilgreining á „búið“ fyrir fyrstu Android-útgáfu

- [ ] M3U-hlekkur setur upp rásir, flokka og dagskrárhlekk (eða Xtream: server/user/pass)
- [ ] Xtream-innskráning gengur og skilar rásum; M3U-skrá má velja úr síma
- [ ] Rásalisti: flokkar, leit, uppáhalds, Nýlegt; HD/FHD/4K sameinuð í eina línu
- [ ] Dagskrá: nú/næst í listanum, „Engin dagskrá“ ef ekkert; tvítekningar hverfa
- [ ] `+1` rás fær EKKI dagskrá aðalrásar
- [ ] Spilun: beint TS og HLS, skipti milli rása < 3 s, endurtenging og „Reyna aftur“
- [ ] Stillingar: buffer-mark, UA, format, refreshHours, epgOffsetMin, fela/raða flokka
- [ ] Uppfærsla á 12 klst fresti í bakgrunni, cache svo appið opnist strax
- [ ] Texti á íslensku, app-heiti Mulehead

---

## 17. Næstu skref (röð)

1. ✅ Búið: `lib/m3u.js` → `data/M3uParser.kt` + `data/Channel.kt`, 11 JUnit-próf (gzip fer í `PlaylistRepository`, skref 5)
2. ✅ Búið: `lib/epg.js` → `data/XmltvParser.kt` (SAX, gluggi, `sortUniq`, `parseXmltvTime`, gzip) + 8 próf í `XmltvParserTest`
3. ✅ Búið: `buildChanMap()` (main.js) + `nowNext()` (renderer/app.js) → `data/ChannelMatcher.kt` (`wanted`, `buildChanMap`, `nowNext`, `shift`) + 14 próf (`norm`/`looseNorm` búa í `XmltvParser`)
4. ✅ Búið: `splitName`/`variantRank`/`buildNameIndex`/`makeRows`/`coll` (renderer/app.js) → `data/ChannelRows.kt` + 17 próf
5. ✅ Búið (M3U-hluti): `httpGet`/`loadM3U`/`refreshPlaylist` (playlists.js, main.js) → `data/PlaylistRepository.kt` (`load`, `cached`, `clear`, `HttpTransport`, gzip, 180 s timeout, VLC UA, flokkar) + 13 próf. Eftir: Xtream (`loadXtream`) og DataStore fyrir stillingar
6. ✅ Búið: Compose-UI — flokkar / rásalisti / „nú og næst“ (`HomeScreen`) og stillingar (`SettingsScreen`, `SettingsRules`)
7. ✅ Búið: Media3-spilari með `DefaultHttpDataSource` (UA), buffer-stillingu og endurtengingu (`PlayerScreen`, `RetryPolicy`)
8. ✅ Búið (VOD): `data/Json.kt` (lítill JSON-lestur), `data/Xtream.kt` (þekkir
   `get.php`/`player_api.php`), `data/VodParser.kt`, `data/VodRepository.kt`,
   `data/VodFilter.kt` (leit), `ui/VodScreen.kt` (+ `SeriesScreen`),
   `ui/VodViewModel.kt` — 27 JUnit-próf. Eftir: Leikir dagsins (`lib/sports.js`)
   og 🤝 Horfa saman (`renderer/sync.js`).

---

## 18. VOD í Android — hvernig það virkar

- Hlekkurinn er skoðaður með `Xtream.fromUrl()`: ef hann er `…/get.php?username=…&password=…`
  eða `…/player_api.php?…` er um Xtream-áskrift að ræða og VOD sótt úr `player_api.php`.
- Sömu aðgerðir og í Mac: `get_vod_categories`, `get_vod_streams`,
  `get_series_categories`, `get_series`, `get_series_info&series_id=`.
- JSON er lesið með litlum innbyggðum lestri (`Json.kt`) — engin viðbót þarf.
  Gildi eru meðhöndluð eins og JavaScript gerir (`8` úr `8.0`,
  `rating || rating_5based * 2` og ár úr `releaseDate`/nafninu).
- Skyndiminni: `cache/vod/vod-movies-main.json` + `-cats.json` + `.meta`
  (samsvarar `vod-movies-<id>.json` í Mac). Endurnýjað eftir `refreshHours`; ef
  netið bregst er gamla svarið notað og villa birt í hausnum.
- Venjulegur M3U-listi: myndir/þættir eru atriði með `/movie/` eða `/series/` í slóð
  (`Channel.Kind`); flokkur fær númer í röð fyrstu birtingar (eins og í Mac).
- Þættir úr M3U-lista eru spilaðir beint (hver færsla er þáttur); Xtream-þættir opna
  `SeriesScreen`, sem sækir tímabil og þætti með `get_series_info` í hvert sinn.
- Spilarinn fær `live = false` fyrir myndir/þætti: hann endurtengist við villur, en
  þegar straumurinn klárast birtist „Lokið“ og hann byrjar EKKI aftur sjálfkrafa.




