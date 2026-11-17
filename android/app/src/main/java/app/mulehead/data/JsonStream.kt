package app.mulehead.data

import app.mulehead.tr

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.util.zip.GZIPInputStream

/**
 * Lestr á JSON-fylki úr straumi: fylki er lesið atriði fyrir atriði og hvert
 * atriði þáttað eitt og sér með [Json].
 *
 * Ástæðan er Xtream-þjónustan: `get_live_streams` getur verið tugir megabæta
 * (60.000 rásir) og ef allt svarið væri lesið í streng og þáttað í eitt skipti
 * klárast minnið á litlum Android-boxum (192 MB heap). Hér er aðeins eitt atriði
 * í minni í einu — svarið er fyrst streymt á disk og síðan lesið þaðan.
 *
 * Allt er blokkerandi; kallaðu úr bakgrunnsþræði.
 */
internal object JsonStream {

    // Hámark fyrir lítil svör (innskráning, flokkar): 4 MB.
    private const val MAX_SMALL = 4 shl 20
    private const val CHUNK = 64 * 1024

    /**
     * Les fylki úr [f] og kallar á [onItem] fyrir hvert atriði.
     * Skilar false ef svarið er ekki fylki (t.d. hlutur eða HTML).
     */
    fun eachItem(f: File, onItem: (Any?) -> Unit): Boolean =
        open(f).use { inp -> eachItem(inp, onItem) }

    // Sama og hér fyrir ofan, fyrir straum sem er þegar opinn.
    fun eachItem(inp: InputStream, onItem: (Any?) -> Unit): Boolean {
        val r = Reader(inp)
        var c = r.nextNonWs()
        if (c == null || c != '['.code) return false
        while (true) {
            c = r.nextNonWs()
            if (c == null) throw JsonException(tr("JSON: unexpected end of text", "JSON: textinn endar óvænt"))
            when (c.toChar()) {
                ']' -> return true
                ',' -> continue
                else -> onItem(Json.parse(readElement(r, c)))
            }
        }
    }

    /**
     * Les lítið svar í streng (t.d. `player_api.php` innskráningu).
     * Skilar villu ef svarið er stærra en [max] — þá er eitthvað að.
     */
    fun readText(f: File, max: Int = MAX_SMALL): String {
        open(f).use { inp ->
            val out = ByteArrayOutputStream(minOf(max, CHUNK))
            val buf = ByteArray(CHUNK)
            while (true) {
                val n = inp.read(buf)
                if (n < 0) break
                if (out.size() + n > max) throw PlaylistException(TOO_BIG)
                out.write(buf, 0, n)
            }
            return String(out.toByteArray(), Charsets.UTF_8).removePrefix("\uFEFF")
        }
    }

    /**
     * Opnar skrá og afhjúpar gzip ef svo ber undir (sumir þjónar þjappa
     * `player_api.php` sjálfir). BOM er hunsað í [Reader].
     */
    private fun open(f: File): InputStream {
        val raw = BufferedInputStream(f.inputStream(), CHUNK)
        raw.mark(2)
        val b1 = raw.read()
        val b2 = raw.read()
        raw.reset()
        return if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(raw, CHUNK) else raw
    }

    /**
     * Les eitt atriði úr fylkinu, frá fyrsta staf [first] til loka þess.
     * Fylki og hlutir inni í atriðinu eru í sama streng; því er dýpt talin
     * og strengir/escape verndaðir. Afmörkunarstafurinn (`,` eða `]`) er
     * skilinn eftir ólesinn.
     */
    private fun readElement(r: Reader, first: Int): String {
        val sb = StringBuilder()
        var depth = 0
        var inStr = false
        var esc = false
        var c = first
        while (true) {
            if (c < 0) throw JsonException(tr("JSON: unexpected end of text", "JSON: textinn endar óvænt"))
            sb.append(c.toChar())
            when {
                inStr -> {
                    if (esc) esc = false
                    else if (c == '\\'.code) esc = true
                    else if (c == '"'.code) {
                        inStr = false
                        if (depth == 0) return sb.toString()
                    }
                }
                c == '"'.code -> inStr = true
                c == '{'.code || c == '['.code -> depth++
                c == '}'.code || c == ']'.code -> {
                    depth--
                    if (depth < 0) throw JsonException(tr("JSON: unexpected '}'", "JSON: óvænt '}'"))
                    if (depth == 0) return sb.toString()
                }
            }
            if (depth == 0 && !inStr) {
                // Taln eða true/false/null endar við bil eða afmörkunarstaf.
                val n = r.peek()
                if (n < 0 || n == ','.code || n == ']'.code) return sb.toString()
                if (Character.isWhitespace(n.toChar())) return sb.toString()
            }
            c = r.next()
        }
    }

    // Lítill lestur með eins stafs framsýn (peek).
    private class Reader(inp: InputStream) {

        private val r = InputStreamReader(inp, Charsets.UTF_8).buffered(CHUNK)

        private var peeked: Int = -2

        fun peek(): Int {
            if (peeked == -2) peeked = read()
            return peeked
        }

        fun next(): Int {
            if (peeked != -2) {
                val c = peeked
                peeked = -2
                return c
            }
            return read()
        }

        fun nextNonWs(): Int? {
            while (true) {
                val c = next()
                if (c < 0) return null
                // BOM (ef þjónninn setur það) og allt bil er sleppt.
                if (c == 0xFEFF) continue
                if (!Character.isWhitespace(c.toChar())) return c
            }
        }

        private fun read(): Int = try {
            r.read()
        } catch (e: IOException) {
            throw PlaylistException(tr("Couldn't read the response: ${e.message ?: tr("unknown error", "óþekkt villa")}", "Gat ekki lesið svarið: ${e.message ?: tr("unknown error", "óþekkt villa")}"))
        }
    }

    val TOO_BIG: String get() = tr("The response from the provider is too large", "Svarið frá þjónustunni er of stórt")
}
