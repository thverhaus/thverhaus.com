package app.mulehead.data

// Ein rás úr playlista. kind segir hvort um beina rás, mynd eða þáttaröð er að ræða.
data class Channel(
    val name: String,
    val url: String,
    val tvgId: String = "",
    val tvgName: String = "",
    val logo: String = "",
    val group: String = "",
    val kind: Kind = Kind.LIVE,
    val catchup: String = "",
    val catchupDays: String = "",
    val userAgent: String = ""
) {
    enum class Kind { LIVE, MOVIE, SERIES }
}

// Útkoma úr M3U-lestri: dagskrárhlekkur (ef hann er í hausnum) og allar rásir.
data class M3uPlaylist(
    val epgUrl: String = "",
    val channels: List<Channel> = emptyList(),
    // Var skráin í raun M3U? (Notað til að hafna HTML-villuskjölum.)
    val hasExtinf: Boolean = false,
    val hasUrlLine: Boolean = false
)
