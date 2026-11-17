# Mulehead — Android

IPTV-spilari á íslensku fyrir Android-síma og Android TV.
Þetta er Android-útgáfa af Mulehead (Mac-appinu). Útgáfa 0.5 — í smíðum.

## Hvernig keyrt er
1. Opna þessa möppu í Android Studio.
2. Velja tæki (`Television_1080p` eða `Medium_Phone`) og ýta á ▶️ Run.

Í terminal: `./build.sh`
(APK verður í `app/build/outputs/apk/debug/app-debug.apk`.)
Ath: Java er ekki uppsett kerfislega á þessari vél — `build.sh` notar Java-ið
sem fylgir Android Studio, svo það þarf ekkert að sækja. Ef macOS býður að
setja upp Java: ýttu á Cancel.

## Skjöl
- `docs/PLAN.md` — hvað er næst (byrja hér)
- `docs/LOADING.md` — hleðslan: skref á skjánum, tímamörk, skyndimyndir og mælingar
- `docs/PAIRING.md` — „Tengja úr vafra“: kóði á sjónvarpinu, listinn sendur á thverhaus.com/tengja
- `docs/HANDOFF.md` — allar forskriftir úr Mac-útgáfunni
- `docs/screenshot-tv.png` — appið keyrt á Android TV hermi
- `docs/screenshot-tengja.png` — „Tengja úr vafra“: kóðinn á sjónvarpinu
- `docs/screenshot-stillingar.png` — stillingaskjárinn á Android TV hermi
- `docs/screenshot-myndir.png` — listi yfir myndir (VOD)
- `docs/screenshot-thaettir.png` — þáttaröð með tímabilum og þáttum
- `docs/screenshot-mynd-spilari.png` — mynd í spilaranum
- `reference/mac-electron/` — kóði Mac-útgáfunnar, aðeins til að fletta í

## Staða (nóv. 2026)
Beinar rásir, dagskrá (nú/næst), flokkar, stillingar, spilari með endurtengingu,
myndir/þættir (VOD) og „Tengja úr vafra“ (parun gegnum thverhaus.com án opins
ports) eru komin og prófuð á Android TV hermi. Xtream-hlekkir (`get.php` /
`player_api.php`) eru sóttir með `player_api.php` eins og í Mac — aðeins beinar
rásir — svo ræsingin bíði ekki eftir stórum M3U-lista; M3U er varaleið.
Næst: Leikir dagsins og „Horfa saman“.
