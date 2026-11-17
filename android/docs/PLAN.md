# PLAN — hvað er næst

Stuttur listi. Allt sem er hakað er búið. Frekari skýringar eru í `HANDOFF.md`.

## Búið
- [x] Nýtt Android-project (Kotlin + Compose fyrir síma og Android TV)
- [x] Nafn: Mulehead, pakki `app.mulehead`, minSdk 26
- [x] Dökkur þema, íslenskur byrjunarskjár
- [x] Heimildir: internet + leyfi fyrir `http://` streymi
- [x] Kóði Mac-útgáfunnar í `reference/mac-electron/`
- [x] Bygging prófuð: `./build.sh` skilar APK og appið opnast á `Television_1080p`
      (`docs/screenshot-tv.png`)
- [x] **0.4 — hleðslan (sjá `docs/LOADING.md`)**
  - [x] Rásir bíða ekki eftir dagskránni: `vm.load()` birtir þær, `vm.loadEpg()` sækir
        dagskrána í sér coroutine
  - [x] Skref á skjánum: „Sæki lista…“, „Les lista…“, „Sæki dagskrá…“, „Les dagskrá…“
  - [x] Heildartímamörk á alla sókn (vaktþráður lokar sambandinu), skýr villa + „Reyna aftur“
  - [x] `OutOfMemoryError` gripið í bæði listanum og dagskránni; rásir lifa áfram
  - [x] Þáttuð skyndimynd af listanum og dagskránni (ógildist við nýja sókn, nýjan lista
        eða útrunna tímaglugga)
  - [x] Niðurhal streymt í `.tmp` (64 KB bútar) + línu-fyrir-línu M3U og SAX af diski
  - [x] Raðbygging (60.000 rásir) færð af aðalþræði og röðunarlykill reiknaður einu sinni
  - [x] Mælt á 2 GB hermi með 60.000 rásum og 154 MB XMLTV: rásir 7,2 s (0.3: hrun),
        dagskrá 36 s; 3.000 rásir: rásir 3,3 s, dagskrá 24 s
- [x] **0.5 — Xtream-hlekkir (sjá `docs/LOADING.md`)**
  - [x] `PlaylistRepository` fylgir Mac-flæðinu: `Xtream.fromUrl()` -> `player_api.php`
        (innskráning, `get_live_categories`, `get_live_streams`), aðeins beinar rásir
  - [x] Rásir: `/live/{notandi}/{lykilorð}/{stream_id}.ts`, `tvg-id`, merki, flokkur
        þjónustunnar og catchup úr `tv_archive`; dagskrá úr `xmltv.php`
  - [x] Röng innskráning (`auth: 0`) gefur skýra villu; aðrar villur/0 rásir -> M3U-varaleið
  - [x] `JsonStream`: `get_live_streams` streymt á disk og lesið atriði fyrir atriði
  - [x] Skyndimyndin geymir líka flokkaröð þjónustunnar; sama `LoadStep`, tímamörk og OOM
  - [x] Tilvísanir milli `http`/`https` fylgt handvirkt (allt að 5 skref)
  - [x] Lykilorð birtist hvergi í villum/loggum; VOD er áfram aðeins sótt þegar það er opnað
  - [x] Mælt á 2 GB hermi: `get.php` hangir en rásir birtast eftir 8,1 s (60.000) /
        3,5 s (3.000); heit ræsing 5,4 s án nets; röng innskráning ~3 s

## Næst (í þessari röð)
1. [x] `M3uParser.kt` — lesa M3U/M3U8 texta í lista af rásum. Próf með sýnishorni.
2. [x] `XmltvParser.kt` — lesa dagskrá (SAX), sama gluggi og í Mac. 8 próf.
3. [x] `ChannelMatcher.kt` — tengja rás við dagskrá (sama keðja og í Mac: tvg-id -> nafn -> laust nafn). 14 próf.
4. [x] `ChannelRows.kt` — sameina HD/FHD/4K í eina línu + íslensk röðun. 17 próf.
5. [x] Sækja playlist úr hlekk (`PlaylistRepository.kt`) + geyma í símanum. 13 próf.
6. [x] Skjár: flokkar vinstra megin, rásalisti, „nú og næst“.
7. [x] Spilari (Media3) með endurtengingu.
8. [x] Stillingar (buffer, UA, hliðrun dagskrár).
9. [x] Myndir/þættir (VOD): Xtream-API, flokkar, leit, tímabil/þættir, spilun.
10. [x] „Tengja úr vafra“: kóði á sjónvarpinu, listinn sendur á thverhaus.com/tengja og
       sóttur yfir HTTPS (`docs/PAIRING.md`). Vefstjórnborðið (opið port) er fjarlægt.
11. [ ] Leikir dagsins (sports) og „Horfa saman“ (seinna).

## Myndir og þættir — hvað er prófað (nóv. 2026)
- „Myndir“ í hausnum á rásalistanum opnar `VodScreen`; flipar „Myndir“/„Þættir“ sóttu
  hvort fyrir sig og flokkar (með fjölda) birtast vinstra megin.
- Xtream-hlekkurinn (`get.php?username=…&password=…`) er þekktur sjálfkrafa: flokkar og
  atriði koma úr `player_api.php` (`get_vod_categories`, `get_vod_streams`,
  `get_series_categories`, `get_series`). Svarið er vistað í `cache/vod/` í 12 klst.
- Venjulegur M3U-listi: myndir/þættir eru þau atriði sem hafa `/movie/` eða `/series/`
  í slóðinni (sama og Mac); ekkert net er notað.
- Ýtt á mynd opnar spilarann. Spilari myndar endar bara („Lokið“) og byrjar EKKI aftur
  þegar hún klárast; „Spila“ byrjar hana aftur frá byrjun. Yfirlagið sýnir aðeins
  nafn og ár/stig (engar dagskrárlínur, sem eiga bara við beinar rásir).
- Ýtt á þáttaröð opnar `SeriesScreen`: tímabil vinstra megin, þættir með
  „Tímabil X · Þáttur N · lengd“; ýtt á þátt spilar hann.
- „Leita“ opnar leitarreit (lyklaborðið kemur aðeins þá); leitin finnur án tillits til
  háleturs og brodda („saga“ finnur „Saga“) og virkar innan flokks. BACK lokar leitinni.
- Fókus: fyrsta mynd/þáttur fær fókus þegar skjárinn opnast og eftir að spilara er lokað.
- Reglur og textar prófuð í `JsonTest` (6), `XtreamTest` (6), `VodParserTest` (6),
  `VodRepositoryTest` (9) og `VodFilterTest` (5) — samtals 124 próf.

## Spilari — hvað er prófað (nóv. 2026)
- Ýtt á rás í listanum -> spilari opnast og straumur spilast (MPEG-TS yfir HTTP).
- Fókus: NIÐUR/HÆGRI/VINSTRI á myndinni setur fókus á „Spila“; HÆGRI/HÆGRI
  fer á „Endurtengja“ og „Til baka“; OK virkjar hnappinn.
- UPP úr hnapparöðinni felur yfirlagið; UPP eða OK á myndinni sýnir það aftur.
- BACK: fyrst felur yfirlagið, svo fer á rásalistann.
- Endurtenging: bilaður straumur -> „Endurtengi eftir N sekúndur…“ (1, 2, 4, 8,
  16, 30 sek) og textinn í miðjunni sýnir niðurtalninguna; straum sem endar
  (STATE_ENDED) byrjar líka aftur sjálfkrafa.
- Skjárinn slokknar ekki meðan horft er (FLAG_KEEP_SCREEN_ON).

## Stillingar — hvað er prófað (nóv. 2026)
- „Stillingar“ hnappur í hausnum á rásalistanum opnar `SettingsScreen`.
- Buffer: −/+ í 5 sek skrefum (2–120 sek). Gildir næst þegar rás er opnuð.
- User-agent: sýnir „Sjálfgefið (VLC)“; ýtt á „Breyta“ til að skrifa annan
  (lyklaborðið opnast aðeins þá). „Loka“ eða ✓ á lyklaborðinu lokar.
- Sameina HD/FHD/4K og raða A–Ö: Á/Af. Listinn endurreiknast strax við „Vista“
  (bæði línur og talningar í flokkunum).
- Uppfærsla: 6 klst / 12 klst / sólarhringur / 3 dagar.
- Hliðrun dagskrár: ±30 mín skref (±12 klst) og „Núll“.
- „Vista“ geymir allt í SharedPreferences; BACK eða „Til baka“ geymir ekki.
- Fókus fer sjálfkrafa á fyrstu stýringu; allt er geymt eftir endurræsingu.
- Eftir BACK úr stillingum fer fókus aftur á fyrstu rás í listanum (sama eftir spilara).
- Reglur og textar eru prófaðir í `SettingsRulesTest` (7 próf, samtals 92 próf).

## Reglur
- Allur texti á íslensku.
- Prófa þarf hvert skref áður en farið er í næsta.
- Ekki hanna flott UI fyrr en lestur playlistans virkar.
- Notandinn er ekki forritari: segja stuttlega hvað var gert og hvað á að gera.

## 0.6 (úttekt á Mi TV boxi, borið saman við Mac)
- [x] „Til baka“ úr spilara skilar í sama flokk og á sömu rás (flokkur og fókus geymd í MainActivity)
- [x] Spilun hættir þegar farið er úr appinu (ON_STOP); bein rás tengist aftur við endurkomu
- [x] Afbrigði (FHD/HD …): hnappar í yfirlagi, vinstri/hægri ör í spilara, heiti í listanum (ChannelRows.chipLabel)
- [x] Upp/niður í spilara skiptir um rás innan flokksins; yfirlag hverfur sjálft eftir 6 sek
- [x] Buffer: samfelld sókn (lágmark = hámark í DefaultLoadControl); hélst í ~60 sek eftir „Hlaða buffer“ á boxinu
- [x] Röðun í möppu: A–Ö / Röð þjónustu / Mín röð + „Raða“ (FolderOrder, geymt í SettingsStore)
- [x] Flokkar í röð þjónustunnar („Án flokks“ aftast), vinstri/hægri ör milli flokka og rása
- [x] Greining: `adb logcat -s Mulehead` sýnir buffer og villukóða (aldrei slóðir)

## 0.7
- [x] Bufferáminningar neðst í horni við 40/30/20/10 sek (player/BufferAlerts.kt, reglur í prófum): hver einu sinni, aftur aðeins 10 sek yfir mörkum; 20/10 rauðar, OK hleður buffer
- [x] Valmynd vinstra megin (ui/NavDrawer.kt): 🐴 Mulehead, Leit, Sjónvarp, Myndir, Þættir, Stillingar; mjó rönd sem opnast með fókus
- [x] 🤝 og ⚙️ uppi í hægra horni; hnapparöðin efst fjarlægð
- [x] Til baka á aðalskjá: fyrst valmyndin, svo „Viltu loka forritinu? Nei/Já“ (Nei valið)
- [x] Leit í öllum rásum, niðurstöður strax („sky s“ -> Sky Sport…); röðun eftir orðupphöfum í réttri röð
- [x] „Slá inn M3U“, „Tengja úr vafra“, „Endurnýja lista“ undir Stillingum
- [x] Hraðari ræsing: nöfn greind einu sinni á rás, röðunarlyklar reiknaðir fyrirfram (~10 s -> ~5,6 s á Mi TV boxi)
