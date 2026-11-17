# Mulehead Android – smíði

- Kóðinn hér á greininni `android` er sami kóði og í `~/AndroidStudioProjects/Mulehead` á Mac Júlla.
- Hver push á `android` keyrir `.github/workflows/android.yml` sem byggir release-APK á GitHub.
- Niðurstaðan fer á greinina `android-builds`: `STATUS`, `build.log`, `app-release.apk`, `SIGNATURE`, `VERSION`.
- Undirritunarlykillinn (debug.keystore af Mac Júlla) er dulkóðaður í `signing/debug.keystore.enc`.
  Lykilorðið er GitHub secret `MULEHEAD_KEY_PASS`. Án sama lykils setjast uppfærslur ekki yfir appið.
- Ekkert er birt á thverhaus.com sjálfkrafa. Birting = afrita APK í `public/mulehead.apk` og uppfæra
  `public/updates.json` á `main`, aðeins eftir samþykki Júlla.
