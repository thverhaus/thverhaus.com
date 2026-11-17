# Parun við vafra (thverhaus.com/tengja)

Sjónvarpið sýnir stuttan kóða, notandinn sendir listann á vefnum og appið sækir
hann sjálft yfir HTTPS. Ekkert port er opið á sjónvarpinu og ekkert er geymt á
vefnum lengur en í 10 mínútur.

```
  Sjónvarp (app)                 Cloudflare Worker            Vafri (notandi)
  ─────────────                  ─────────────────            ───────────────
1. POST /api/pair          ───▶  býr til kóða + leynilykil
   ◀── 201 {code, secret, expiresInSeconds}
2. sýnir „ABCD-EFGH“                                        ◀── slær inn kóðann
                                                             og sendir listann
3. GET /api/pair/ABCDEFGH  ───▶  204 = bíður
   (Authorization: Bearer …)     200 = listinn (einnota)
   á 5 sek fresti                404 = útrunninn
                                 403 = rangur lykill
4. vistar listann og sækir hann; skjárinn hættir að spyrja
```

Vefurinn (Worker + `/tengja`) er í loftinu á **thverhaus.com** og er ekki í
þessari möppu. Þetta skjal lýsir því sem appið gerir og hvaða hegðun það þarf
frá vefnum.

## API

Allt fer yfir HTTPS. Slóðir, notandanafn og lykilorð fara í líkama beiðnanna
(ekki í vefslóð) og eru aldrei skrifuð í logga.

### `POST /api/pair` — nýtt paratilvik

Engin gögn með. Svar `201`:

```json
{"code":"ABCDEFGH","secret":"<64 stafir í hex>","expiresInSeconds":600}
```

- `code` — 8 stafir úr `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (engin 0/O/1/I).
  Kóðinn er sá sem notandinn sér á sjónvarpinu og slær inn á vefnum.
- `secret` — 32 bæti af öruggu slembi; aðeins appið þekkir hann. Vefurinn geymir
  aðeins SHA-256 hak af honum.
- `expiresInSeconds` — líftími tilviksins (10 mínútur).

Kóði sem er þegar í notkun er endurnýjaður innanhúss; appið þarf ekkert að gera.
Ef beðið er of oft er svarað `429` og appið bíður með skýringu á skjánum.

### `PUT /api/pair/{code}` — listinn sendur úr vafranum

Þetta gerir `/tengja` (vafrinn), ekki appið. Líkaminn er annar tveggja:

```json
{"type":"m3u","name":"","url":"https://…/list.m3u","epgUrl":""}
{"type":"xtream","name":"","server":"http://host:8080","username":"…","password":"…","epgUrl":""}
```

`name` og `epgUrl` mega vera tómir. Vefurinn svarar `{"ok":true}` eða
`{"error":"not_found" | "used" | "invalid" | "too_large"}`.

### `GET /api/pair/{code}` — appið spyr

Haus: `Authorization: Bearer <secret>`. Svarið er:

| Staða | Merking | Appið |
|-------|---------|-------|
| `204` | ekkert sent enn | sefur 5 sek og spyr aftur |
| `200` | listinn (sama JSON og sent var) | setur hann inn og hættir |
| `404` | kóðinn er óþekktur/útrunninn/þegar sóttur | sækir nýjan kóða og sýnir |
| `403` | rangur eða vantar leynilykil | hættir og birtir villu |
| `429` | of margar beiðnir | bíður og reynir aftur |

`200` má aðeins fá einu sinni: eftir lestur er tilvikinu eytt. Það á líka við ef
appið hættir við — tilvikið lifir þá þar til `expiresInSeconds` er liðinn, en
leynilykillinn er aðeins hjá appinu svo enginn annar kemst í gögnin.

Engin `DELETE` er til (vefurinn svarar `405`); appið þarf því ekki að „loka“
tilvikinu sérstaklega.

## Öryggi

- **Ekkert opið port.** Fyrri útgáfa rak vefstjórnborð á staðarnetinu án
  innskráningar; það er fjarlægt úr appinu (ekki bara slökkt).
- **Tveir þættir.** Kóðinn er sýnilegur á skjánum; leynilykillinn er 256 bitar og
  fer aðeins í `Authorization`-haus. Sá sem sést yfir kóðann getur hvorki lesið
  né eytt neinu.
- **Stuttur líftími.** 10 mínútur, einnota lestur, `Cache-Control: no-store`.
- **Hak, ekki geymsla.** Vefurinn geymir SHA-256 af leynilyklinum, svo gögn úr
  gagnagrunni leysa ekki lykilinn.
- **Takmörkun.** `429` á bæði `POST` og `GET` svo ekki sé hægt að fara í gegnum
  allt kóðarúmið (40 bitar) innan líftímans.
- **Engin gögn í loggum.** Hvorki appið né vefurinn skrifar slóðir, notandanöfn
  eða lykilorð; appið skrifar heldur engan logg yfirhöfuð.
- **Aðeins HTTPS.** `PairingClient.BASE_URL` er `https://thverhaus.com` og appið
  opnar ekkert til baka.

## Appið (það sem er í þessari möppu)

| Skrá | Hlutverk |
|------|----------|
| `pairing/PairingClient.kt` | `POST /api/pair`, `GET /api/pair/{kóði}`; túlkar 204/200/403/404/429 |
| `pairing/PairCode.kt` | `PairSession` (kóði, lykill, líftími) + snið kóðans (`ABCD-EFGH`) |
| `pairing/PairPayload.kt` | Les `type: m3u` og `type: xtream` úr svarinu; hafnar ógildum slóðum |
| `pairing/PairController.kt` | Lykkjan: 5 sek, endurnýjun á útrunnum kóða, stöður á skjá |
| `pairing/PlaylistInstaller.kt` | `saveUrl(…)` / `saveXtream(…)`: vistar og sækir strax |
| `ui/PairScreen.kt` | Skjárinn: kóðinn, niðurtalning, stöðulína, hnappar |

Hegðun sem prófin festa (`PairControllerTest`, `PairingClientTest`,
`PairPayloadTest`, `PlaylistInstallerTest`):

- Spurt er á **5 sekúndna fresti** (`PairController.POLL_MS`).
- **204** → bíða; **200** → setja inn (`saveUrl` eða `saveXtream`) og hætta;
  **404** → sækja nýjan kóða og sýna hann (skjárinn heldur áfram);
  **403** → hætta með villu.
- **Skjárinn lokast** → `LaunchedEffect` afturkallar lykkjuna; engar beiðnir fara
  út eftir það (prófað sérstaklega).
- Netvilla er reynd aftur (`MAX_FAILURES` = 6) áður en gefist er upp.
- `name` tómt → nafn úr hýsingu slóðarinnar (`hostOf`) eða notandanafn Xtream.
- Xtream verður að `…/get.php?username=…&password=…&type=m3u_plus`, sama og í
  Mac-útgáfunni; dagskrá (EPG) er hreinsuð þegar skipt er um þjónustu.

## Handprófun

1. `./build.sh` og setja APK á tækið.
2. Opna **Tengja úr vafra** í appinu; kóðinn birtist.
3. Á tölvu/síma: `https://thverhaus.com/tengja`, slá inn kóðann, velja tegund og
   senda.
4. Innan 5 sekúndna birtast rásirnar í appinu.

Viljir þú prófa API-ið án vafrans má gera það með `curl`:

```bash
R=$(curl -s -X POST https://thverhaus.com/api/pair)
C=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["code"])')
S=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])')
curl -s -X PUT "https://thverhaus.com/api/pair/$C" -H 'Content-Type: application/json' \
  -d '{"type":"m3u","name":"","url":"https://…/list.m3u","epgUrl":""}'
curl -s "https://thverhaus.com/api/pair/$C" -H "Authorization: Bearer $S"
```
