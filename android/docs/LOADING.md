# Hleðsla — hvernig appið byrjar

Þetta skjal lýsir því sem var gert í útgáfu 0.4 (streymt niðurhal, skref á
skjánum, tímamörk, skyndimyndir) og 0.5 (Xtream-þjónustur sóttar með
`player_api.php`), svo appið festist ekki á „Sæki lista…“ á litlum Android TV
boxum (t.d. Mi TV box með ~2 GB minni). Hér er líka hvernig má mæla það.

## Xtream-hlekkir (0.5)

Xtream-hlekkur (`get.php` eða `player_api.php` með `username` og `password`)
fer ekki lengur beint í `get.php`. Hann fer sömu leið og Mac-útgáfan:

1. `player_api.php?username=…&password=…` — innskráning; `user_info.auth` = 0
   þýðir ranga innskráningu og þá birtist
   „Innskráning tókst ekki – athugaðu notandanafn og lykilorð“ (engar
   varaleiðir, endurtaka má með „Reyna aftur“).
2. `…&action=get_live_categories` — flokkar í þeirri röð sem þjónustan sendir.
3. `…&action=get_live_streams` — aðeins beinar rásir. Svarið er streymt á disk
   og lesið atriði fyrir atriði (`JsonStream`), svo 60.000 rásir þurfi ekki að
   vera allar í minni sem JSON-texti.

Rásir verða að `{server}/live/{notandi}/{lykilorð}/{stream_id}.ts`, með
`tvg-id` úr `epg_channel_id`, merki úr `stream_icon`, flokk úr `category_name`
og catchup úr `tv_archive`. Dagskráin er `{server}/xmltv.php?username=…&password=…`
nema notandinn hafi sett aðra slóð. VOD (myndir/þættir) er áfram sótt aðeins
þegar skjárinn fyrir þau er opnaður — ekkert `get_vod_streams` við ræsingu.

Ef `player_api.php` bregst eða skilar 0 rásum er farið í M3U-varaleiðina
(`get.php` eða venjulegur listi), eins og í Mac. Villur og logg innihalda
aldrei notandanafn/lykilorð í slóð — aðeins vefþjónsnafn.

Tilvísanir (3xx) eru fylgt handvirkt (allt að 5 skref), þar með taldar
tilvísanir milli `http` og `https`, sem `HttpURLConnection` fylgir ekki sjálfur.

## Vandinn (0.3)

1. `HomeViewModel` hlaðaði listanum **og** dagskránni áður en nokkuð var birt.
   Rásir birtust því ekki fyrr en 150 MB XMLTV-skrá hafði verið sótt og þáttuð.
2. `HttpTransport.get()` notaði `readBytes()`: öll skráin fór í minnið sem
   `ByteArray`. Á 2 GB boxi (192 MB heap) varð þetta `OutOfMemoryError` — appið
   hrundi eða virðist hanga. Sama gildir um `readText()` fyrir M3U-listann.
3. XMLTV-skráin var þáttuð upp á nýtt í **hverri** ræsingu.
4. `readTimeout` endurnýjast við hvern lestur, svo hægfara þjónn gat haldið
   sambandinu opnu að eilífu án þess að nokkur tími rynni út.

## Núverandi flæði (0.4)

```
LaunchedEffect
  ├── vm.load()                      // rásalistinn
  │     Sæki lista…   → M3U streymt í cache/playlists/main.m3u.tmp
  │     Les lista…    → línu-fyrir-línu lestur, sameining/flokkun
  │     ↓ rásir birtast strax (engar dagskrárlínur)
  │     ↓ skyndimynd dagskrár (ef hún passar) bætist við án nets
  └── vm.loadEpg()                   // dagskráin, í sér coroutine
        Sæki dagskrá… → XMLTV streymt í cache/epg/main.xml.tmp
        Les dagskrá…  → SAX beint úr skránni
        ↓ raðir uppfærast með „nú og næst“
```

Skrefin birtast á skjánum: í miðjunni á meðan engar rásir eru, annars í hausnum
(„Sæki lista…“, „Les lista…“, „Sæki dagskrá…“, „Les dagskrá…“). Ef appið
festist sér maður því hvort það er listinn eða dagskráin sem bíður.

Rásirnar lifa alltaf af: villa eða `OutOfMemoryError` í dagskránni setur
viðvörunarlínu en fjarlægir ekki rásirnar. Villa í listanum setur villuskjá með
„Reyna aftur“ (sem endurnýjar bæði listann og dagskrána).

## Skyndimyndir (cache)

| Skrá | Innihald | Gildir meðan |
| --- | --- | --- |
| `cache/playlists/<id>.m3u` | hráa M3U-skráin | alltaf til fallbak |
| `cache/playlists/<id>.snap` | þáttaður rásalisti (tvöfalt) | `sourceAt` passar við `.meta` |
| `cache/epg/<id>.xml` | hráa XMLTV-skráin (≤ 64 MB) | 12 klst (`refreshHours`) |
| `cache/epg/<id>.snap` | aðeins rásir listans í glugganum | sama og hráa skráin **og** |

Dagskrár-skyndimyndin er bundin við:

- `sourceAt` — hvenær hráa skráin var sótt (ný sókn ógildir hana),
- `sig` — fingerprent af `tvgId`/`name`/`tvgName` allra rása (bætist við rás eða
  nafn breytist ógildir hana),
- gluggann `[now − 6 klst, now + 48 klst]`; hún er ekki notuð ef minna en 12 klst
  eru eftir af honum.

Skrifin eru í `.tmp` + `rename`, svo hrun mitt í skrifum skemmir aldrei þá
skyndimynd sem fyrir var. Skyndimynd er aukaatriði: mistakist lestur eða skrif er
skráin bara þáttuð á ný.

Á 2 GB boxi var 150 MB dagskrá með ~216.000 atriðum í glugganum. Skyndimyndin
(29 MB á diski) kemur í stað þess að keyra SAX yfir 150 MB við hverja ræsingu.

## Tímamörk

- `PlaylistRepository.load(timeoutMs = 180_000)` og
  `EpgRepository.load(timeoutMs = 300_000)` setja bæði `connectTimeout` og
  `readTimeout`, **auk** þess sem vaktþráður lokar sambandinu þegar heildartíminn
  rennur út. Þannig getur hægfara þjónn ekki haldið appinu í hleðslu að eilífu.
- Þegar tíminn rennur út birtist „Sóknin tók of langan tíma (N sek) — þjónninn
  svarar ekki“ og „Reyna aftur“; gamli listinn/dagskráin er notuð ef hún er til.

## Villur og minni

- `readBytes()`/`readText()` eru ekki lengur notuð fyrir listann eða dagskrána:
  `HttpTransport.getTo()` streymir í skrá í 64 KB bútum, M3U er lesið línu fyrir
  línu og XMLTV með SAX beint af diski.
- `OutOfMemoryError` er gripin í báðum hleðslum (`HomeViewModel`, repo-in og
  `HttpTransport`) og birt sem „Minnið er fullt — skráin er of stór fyrir þetta
  tæki“ í stað hruns.

## Mælingar

Hermir: `sdk_google_atv64_arm64`, 2 GB RAM (192 MB heap), 1920×1080.
Listi: 60.000 rásir (5,8 MB M3U) eða 3.000 rásir. Dagskrá: 154 MB XMLTV
(2.000 rásir × 7 dagar, ~672.000 atriði). Þjónn á `10.0.2.2:8130`.

| Atburður | 0.3 | 0.4 |
| --- | --- | --- |
| Fyrsta rás, 60.000 rásir + 154 MB dagskrá | **aldrei** (OOM/hrun eftir ~25 s) | **7,2 s** |
| Fyrsta rás, 60.000 rásir, engin dagskrá | 7,5 s | 7,2 s |
| Fyrsta rás, 3.000 rásir + 154 MB dagskrá | bíður dagskrár | **3,3 s** (fyrsta mynd) |
| Dagskrá sýnileg, 3.000 rásir + 154 MB | — (hangir) | 24,1 s |
| Dagskrá sýnileg, 60.000 rásir + 154 MB | — (hangir) | 36,3 s |
| Önnur ræsing (skyndimyndir) | endurþáttar allt | 7,3 s á rásir, 11,4 s á dagskrá |
| Hægur þjónn (`1 KB / 2 s`) | hangir að eilífu | „Sæki lista…“ sýnilegt í 3 mín, þá skýr tímamörknavilla (180 sek) |
| Dagskrá sem þegir (`/stall.xml`) | rásir birtust aldrei | rásir 7 s, „Sæki dagskrá…“ í haus; eftir 300 s viðvörun en rásir haldast |

Ath: tölurnar eru frá hægum hermi; appið sjálft er ~3 s að ræsa sér þar, svo
„fyrsta rás“ felur í sér ræsingu. Tölurnar í 0.3-dálkinum fyrir hægan/þegjandi
þjón eru ekki mældar heldur leiddar af kóðanum (0.3 hafði engan heildartíma og
`readBytes()` sem bíður þess að allt sambandið lokist).

### Xtream-hlekkir (0.5)

Gervi-Xtream-þjónn á `10.0.2.2:8130`: `/get.php` hangir (eins og stórir listar
hjá sumum þjónustum), `player_api.php` svarar með 60.000 eða 3.000 beinum
rásum, 30 flokkum og lítilli XMLTV-dagskrá. Sami 2 GB hermir.

| Atburður | 0.4 | 0.5 |
| --- | --- | --- |
| Fyrsta rás, 60.000 Xtream-rásir | `get.php` hangir í 180 s, svo tímamörknavilla | **8,1 s** („Les lista…“ 3,6 s, svo rásir) |
| Dagskrá sýnileg, 60.000 rásir | — | 12,5–17,8 s |
| Fyrsta rás, 3.000 Xtream-rásir | sama hang | **3,5 s** |
| Dagskrá sýnileg, 3.000 rásir | — | 5,6 s |
| Önnur ræsing (skyndimynd) | — | 5,4 s, **engar beiðnir** |
| Röng innskráning (`auth: 0`) | 180 s tímamörk á `get.php` | villa eftir ~3 s, engin `get.php`-beiðni |

Í öllum ræsingum fékk þjónninn aðeins þrjár `player_api.php`-beiðnir
(innskráning, flokkar, rásir) og eina `xmltv.php`; `get.php` var aldrei sótt og
ekkert `get_vod_streams`/`get_series` barst (VOD er áfram aðeins sótt þegar
myndaskjárinn er opnaður). Heit ræsing les skyndimyndina (þar á meðal flokkaröð
þjónustunnar) og snertir netið ekki.

## Hvernig má endurtaka

```bash
# sýniskrár (M3U + XMLTV) og þjónn á porti 8130
python3 /tmp/mhbig/gen.py
python3 /tmp/mhbig/serve.py &

# stilla herminn á stóra listann og stóru dagskrána
/tmp/mhbig/prefs.sh http://10.0.2.2:8130/big.m3u http://10.0.2.2:8130/big.xml

# fylgjast með hvenær rásir/dagskrá birtast
/tmp/mhbig/measure.sh after
```

`/slow.m3u` (1 KB á 2 s) og `/stall.xml` (sendir haus og þegir) eru í
`serve.py` til að prófa tímamörk. Xtream-mælingin notar `/tmp/mhbig/xcserve.py`
(gervi-`player_api.php`, `get.php` hangir) og `/tmp/mhbig/measure.py` /
`measure2.py`:

```bash
python3 /tmp/mhbig/xcserve.py 8130 60000 &       # 60.000 beinar rásir
python3 /tmp/mhbig/measure.py                    # fyrsta rás + beiðnir í xc.log
python3 /tmp/mhbig/measure2.py                   # skref, heit ræsing, röng innskráning
```

Einingaprófin (`./gradlew testDebugUnitTest`) ná yfir sömu atburðarás með
latches: rásir birtast þótt dagskrá hangi, gömul dagskrá yfirskrifar ekki nýjan
lista, `OutOfMemoryError` verður villa, og slitið niðurhal skemmir ekki gömlu
skrána. Fyrir Xtream bætast við `XtreamLoadTest` (13 próf: get.php hangir en
rásir koma, rétt slóðauppbygging, flokkaröð, skyndimynd, röng innskráning, 0
rásir → varaleið, lykilorð hvergi í villum), `JsonStreamTest` (9),
`HttpRedirectTest` (8: http→https, afstæðar tilvísanir, hámark) og ný próf í
`XtreamTest`/`PlaylistInstallerTest` — samtals 267 próf, 0 bilað.

