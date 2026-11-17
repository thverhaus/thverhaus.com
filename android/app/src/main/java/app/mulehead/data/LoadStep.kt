package app.mulehead.data

/**
 * Skref í hleðslunni, svo skjárinn geti sýnt hvar hann er staddur.
 * Listinn og dagskráin eru sótt í sitthvoru lagi (sjá HomeViewModel), því
 * heitir ekkert skref „allt“.
 */
enum class LoadStep {
    IDLE,

    // Verið að sækja M3U-skrána yfir netið.
    LIST_FETCH,

    // Skráin er komin og verið að lesa hana (línu fyrir línu).
    LIST_PARSE,

    // Verið að skrá inn á Xtream-þjónustu (player_api.php).
    XTREAM_LOGIN,

    // Verið að sækja flokka (get_live_categories).
    XTREAM_CATS,

    // Verið að sækja beinar rásir (get_live_streams) — stærsta svarið.
    XTREAM_STREAMS,

    // Verið að sækja XMLTV-dagskrána yfir netið.
    EPG_FETCH,

    // Dagskráin er komin og verið að lesa hana (SAX).
    EPG_PARSE
}
