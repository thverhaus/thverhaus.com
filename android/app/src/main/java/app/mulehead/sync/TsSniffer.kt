package app.mulehead.sync

/**
 * Les fyrstu tíma-stimpla (PTS/DTS) úr MPEG-TS-streymi.
 *
 * ExoPlayer byrjar alltaf að telja frá 0, en Mac-útgáfan (renderer/player.js) les sömu
 * bæti og reiknar „algeran“ straumtíma sem `grunnur + staða`. Með sama grunn á báðum
 * hliðum er hægt að bera tímann saman í herbergi þar sem Mac og Android-tæki eru saman —
 * annars myndu hvorki Mac né Android þekkja klukkuna hins.
 *
 * Þetta er bein þýðing á `TsSniffer` í Mac: sömu bæti, sama röð, sama 4 MB hámark.
 */
class TsSniffer {

    private var left: ByteArray? = null
    private var videoDts: Long? = null
    private var audioPts: Long? = null
    private var bytes = 0L

    /** Búið að finna bæði mynd og hljóð (eða 4 MB liðin) — ekkert meira er lesið. */
    var done: Boolean = false
        private set

    /**
     * Les bút úr straumnum (það sem kemur úr HTTP-tengingunni). [length] er fjöldi
     * gildra bæta í [chunk] (ExoPlayer les stundum í stærra fylki).
     */
    fun push(chunk: ByteArray, length: Int = chunk.size) {
        if (done || length <= 0) return
        val l = left
        val b: ByteArray = if (l != null && l.isNotEmpty()) {
            ByteArray(l.size + length).also { m ->
                l.copyInto(m, 0)
                chunk.copyInto(m, l.size, 0, length)
            }
        } else {
            chunk.copyOf(length)
        }
        var i = 0
        while (i < b.size && b[i] != SYNC) i++
        while (i + PACKET <= b.size) {
            if (b[i] != SYNC) {
                // Ekki á 188-bæta takti: leita að næsta 0x47.
                i++
                while (i < b.size && b[i] != SYNC) i++
                continue
            }
            if (!packet(b, i)) {
                i += PACKET
                continue
            }
            i += PACKET
        }
        // Ef ekkert 0x47 fannst í bútnum er ekkert hægt að bíða eftir: geymum aðeins
        // stutta skottið svo minnið stækki ekki við hvert niðurhal sem er ekki TS.
        val keepFrom = if (i >= b.size) maxOf(0, b.size - PACKET) else i
        left = b.copyOfRange(keepFrom.coerceAtMost(b.size), b.size)
        bytes += length
        if ((videoDts != null && audioPts != null) || bytes > MAX_BYTES) done = true
    }

    /** Upphaf straumsins í sekúndum (sama tala og `sniffer.base()` í Mac), eða `null`. */
    fun base(): Double? {
        val v = minOf(videoDts ?: Long.MAX_VALUE, audioPts ?: Long.MAX_VALUE)
        return if (v == Long.MAX_VALUE) null else v / 90000.0
    }

    // Les einn 188-bæta pakka; skilar `true` ef hann var PES-haus með tíma-stimpli sem við notum.
    private fun packet(b: ByteArray, i: Int): Boolean {
        if ((b[i + 1].toInt() and 0x40) == 0) return false          // PES byrjar ekki hér
        val afc = (b[i + 3].toInt() shr 4) and 3
        if (afc == 2) return false                                   // aðeins adaptation field
        var p = i + 4
        if (afc == 3) p += 1 + (b[i + 4].toInt() and 0xff)
        if (p + 19 > i + PACKET) return false
        if (b[p] != 0.toByte() || b[p + 1] != 0.toByte() || b[p + 2] != 1.toByte()) return false
        val sid = b[p + 3].toInt() and 0xff
        val isVideo = sid in 0xe0..0xef
        val isAudio = sid in 0xc0..0xdf || sid == 0xbd
        if (!isVideo && !isAudio) return false
        val flags = (b[p + 7].toInt() shr 6) and 3
        if (flags and 2 == 0) return false                           // enginn PTS í hausnum
        val pts = readTs(b, p + 9)
        val dts = if (flags == 3) readTs(b, p + 14) else pts
        if (isVideo && videoDts == null) videoDts = dts
        if (isAudio && audioPts == null) audioPts = pts
        return true
    }

    companion object {
        /** 33-bita PTS hringur (~26,5 klst). Sami fasti og `PTS_WRAP` í Mac. */
        const val PTS_WRAP: Double = 8589934592.0 / 90000.0

        private const val PACKET = 188
        private const val MAX_BYTES = 4_000_000L
        private val SYNC = 0x47.toByte()

        /** 33-bita tíma-stimpill úr 5 bætum (sama útreikningur og `readTs` í Mac). */
        fun readTs(b: ByteArray, i: Int): Long {
            val hi = (b[i].toInt() and 0x0e).toLong()
            val lo = ((b[i + 1].toLong() and 0xff) shl 22) or
                ((b[i + 2].toLong() and 0xfe) shl 14) or
                ((b[i + 3].toLong() and 0xff) shl 7) or
                ((b[i + 4].toLong() and 0xfe) shr 1)
            return hi * 536870912L + lo
        }
    }
}
