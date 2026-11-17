package app.mulehead.player

import java.util.Locale

/**
 * Tegund straums — sama flokkun og `streamType()` í Mac (renderer/player.js).
 *
 * Hún ræður því hvernig klukkan í „Horfa saman“ er reiknuð: í MPEG-TS er PTS lesinn beint
 * úr straumnum (sama tala og Mac sendir), í öðrum straumum er notuð rauntíma-klukka.
 */
enum class StreamKind {
    /** MPEG-TS (`.ts` og slóðir án endingar): PTS er lesinn úr straumnum. */
    Ts,

    /** HLS (`.m3u8`). */
    Hls,

    /** Venjuleg skrá (mp4, mkv …). */
    Native;

    companion object {
        private val FILE_EXT = Regex("\\.(mp4|mkv|mov|avi|webm|m4v)$")

        fun of(url: String): StreamKind {
            val u = url.substringBefore('?').lowercase(Locale.ROOT)
            if (u.endsWith(".m3u8") || u.contains("/hls/") || u.contains(".m3u8")) return Hls
            if (FILE_EXT.containsMatchIn(u)) return Native
            return Ts
        }
    }
}
