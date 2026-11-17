package app.mulehead.data

/**
 * Sameinar afbrigði sömu rásar (HD/FHD/4K/backup) í eina línu og raðar í íslenskri
 * stafrófsröð. Þýðing á splitName(), variantRank(), buildNameIndex(), makeRows() og
 * coll í reference/mac-electron/renderer/app.js.
 */
object ChannelRows {

    // Gæðaorð á eftir nafni rásar: "RÚV HD" -> tag "HD", base "RÚV".
    private val QUAL_RE = Regex(
        """(?:\s+|^)(?:F?HD|UHD|SD|4K|8K|HDR|HEVC|H\.?265|RAW|B|BACKUP|ALT|P\d{2}|\d{3,4}[PI]|\d{2}FPS|ᴴᴰ|ᶠᴴᴰ|ᵁᴴᴰ|[\(\[](?:[^\)\]]{1,14})[\)\]])$""",
        RegexOption.IGNORE_CASE
    )
    // "UK: ", "IS| ", ... (bara hástafir, eins og í Mac).
    private val COUNTRY_RE = Regex("""^[A-Z]{2,4}\s*[:|]\s*""")
    private val TAG_BRACKETS_RE = Regex("""[\(\)\[\]]""")
    // Sama og ^[a-z]{2,}$ (án reglulegrar segðar; keyrt þúsundum sinnum við ræsingu).
    private fun isInitialWord(w: String): Boolean = w.length >= 2 && w.all { it in 'a'..'z' }

    private val FHD_RE = Regex("""\bFHD\b|1080""")
    private val HD_RE = Regex("""\bHD\b|ᴴᴰ|720""")
    private val UHD_RE = Regex("""UHD|4K|8K|2160""")
    private val SD_RE = Regex("""\bSD\b""")
    private val BACKUP_RE = Regex("""\bB\b|BACKUP|ALT""")
    private val SKYGO_RE = Regex("""SKY ?GO""")

    // Íslensk stafrófsröð: á eftir a, ð eftir d, þ/æ/ö aftast.
    private const val IS_ORDER = "aábcdðeéfghiíjklmnoópqrstuúvwxyýzþæø"

    private val IS_RANK: Map<Char, Double> = LinkedHashMap<Char, Double>().also { m ->
        IS_ORDER.forEachIndexed { i, c -> m[c] = i.toDouble() }
        m['ö'] = (m['ø'] ?: 0.0) + 1
        m['ä'] = m['æ'] ?: 0.0
        m['å'] = (m['a'] ?: 0.0) + 0.5
    }

    // Nafn rásar skipt í grunn og gæðamerki: Split("RÚV", "HD").
    data class Split(val base: String, val tag: String)

    // Skilur að nafn og gæðamerki (allt að 6 merkjum, t.d. "FHD B").
    fun splitName(name: String): Split {
        var base = name.trim()
        val tags = ArrayList<String>()
        for (i in 0 until 6) {
            val m = QUAL_RE.find(base) ?: break
            if (m.range.first == 0) break
            val rest = base.substring(0, m.range.first).trim()
            // Ekki eta allt nafnið: eftir verða a.m.k. 2 stafir utan landsforskeytis.
            if (COUNTRY_RE.replace(rest, "").length < 2) break
            tags.add(0, m.value.trim().replace(TAG_BRACKETS_RE, ""))
            base = rest
        }
        return Split(base, tags.joinToString(" "))
    }

    private val CAMEL_RE = Regex("([a-záéíóúýðþæö])([A-ZÁÉÍÓÚÝÐÞÆÖ])")
    private val SPACES_RE = Regex("\\s+")

    /**
     * Stutt heiti afbrigðis á sameinaðri línu (Mac: chipLabel). „Main“ er útgáfan sem
     * þjónustan skráir án gæðaorðs, og orði sem er þegar í nafni rásarinnar er sleppt
     * („SkyGo“ á „Sky Sport …“ verður „Go“).
     */
    fun chipLabel(name: String): String {
        val sp = splitName(name)
        val t = sp.tag.ifEmpty { "Main" }
        val base = sp.base.lowercase()
        val words = CAMEL_RE.replace(t, "$1 $2").split(SPACES_RE).filter { it.isNotEmpty() }
        if (words.size > 1) {
            val keep = words.filter { it.length < 3 || !base.contains(it.lowercase()) }
            if (keep.isNotEmpty()) return keep.joinToString(" ")
        }
        return t
    }

    // Lægri tala = betra afbrigði. FHD fyrst, svo HD, svo venjulegt, 4K, SD.
    fun variantRank(tag: String): Int {
        val t = tag.uppercase()
        var r = 2
        when {
            FHD_RE.containsMatchIn(t) -> r = 0
            HD_RE.containsMatchIn(t) -> r = 1
            UHD_RE.containsMatchIn(t) -> r = 3
            SD_RE.containsMatchIn(t) -> r = 4
        }
        if (BACKUP_RE.containsMatchIn(t)) r += 10
        if (SKYGO_RE.containsMatchIn(t)) r += 5
        return r
    }

    // Nafn án landsforskeytis — notað við röðun.
    fun sortKey(base: String): String = COUNTRY_RE.replace(base, "")

    // "Sky Sport Main Events" og "SKY SPORT MAIN EVENT" eru sama rásin.
    fun normWords(base: String): List<String> {
        // Sama og: NFKD -> fjarlægja kommur (U+0300–036F) -> allt nema [a-z0-9:] verður
        // bil -> skipta á bilum. Skrifað sem ein lykkja: reglulegu segðirnar tóku
        // sekúndur á 5.000 rásum á litlu sjónvarpsboxi.
        val flat = java.text.Normalizer.normalize(base.lowercase(), java.text.Normalizer.Form.NFKD)
        val out = ArrayList<String>(4)
        val sb = StringBuilder(flat.length)
        fun flush() {
            if (sb.isEmpty()) return
            val w = sb.toString()
            out.add(if (w.length > 3 && w.endsWith("s")) w.dropLast(1) else w)
            sb.setLength(0)
        }
        for (ch in flat) {
            when {
                ch in '\u0300'..'\u036f' -> {}
                ch in 'a'..'z' || ch in '0'..'9' || ch == ':' -> sb.append(ch)
                else -> flush()
            }
        }
        flush()
        return out
    }

    fun mergeKey(base: String): String = normWords(base).joinToString(" ")

    // ---------- íslensk röðun ----------

    private fun tokens(s: String): List<String> {
        val str = s.lowercase()
        val out = ArrayList<String>()
        var i = 0
        while (i < str.length) {
            val c = str[i]
            if (c in '0'..'9') {
                var j = i
                while (j < str.length && str[j] in '0'..'9') j++
                out.add(str.substring(i, j))
                i = j
            } else {
                out.add(c.toString())
                i++
            }
        }
        return out
    }

    private fun rank(c: Char): Double =
        IS_RANK[c] ?: if (c.code < 97) -100.0 + c.code / 1000.0 else 1000.0 + c.code

    // Ber saman tvö nöfn í íslenskri röð; tölur í tölulegri röð ("Rás 2" < "Rás 10").
    fun compare(a: String, b: String): Int = compareTokens(tokens(a), tokens(b))

    // Sama og compare() en með tókum sem eru reiknaðir fyrirfram (við röðun eru þeir
    // reiknaðir einu sinni á línu í stað þess að vera brotnir upp í hverjum samanburði).
    private fun compareTokens(x: List<String>, y: List<String>): Int {
        val n = minOf(x.size, y.size)
        for (i in 0 until n) {
            val p = x[i]
            val q = y[i]
            if (p == q) continue
            val pd = p[0] in '0'..'9'
            val qd = q[0] in '0'..'9'
            if (pd && qd) return p.toDouble().compareTo(q.toDouble())
            if (pd != qd) return if (pd) -1 else 1
            val pr = rank(p[0])
            val qr = rank(q[0])
            if (pr != qr) return if (pr < qr) -1 else 1
        }
        return x.size.compareTo(y.size)
    }

    // Upplýsingar um nafn rásar í sameiningarskyni.
    data class NameInfo(
        val idx: Int,
        val name: String,
        val words: List<String>,
        val group: String,
        val key: String
    )

    // names: merge-lykill -> fyrsta nafnið; alias: stytting -> útskrifað nafn.
    data class NameIndex(
        val names: Map<String, NameInfo>,
        val alias: Map<String, String>
    )

    // Ein lína í lista: eitt eða fleiri afbrigði sömu rásar (variants í provider-röð).
    data class ChannelRow(
        val variants: List<Int>,
        val primary: Int,
        val base: String,
        val group: String
    )

    private fun nameInfo(
        channels: List<Channel>,
        idx: Int,
        split: Split? = null,
        normed: List<String>? = null
    ): NameInfo {
        val c = channels[idx]
        val sp = split ?: splitName(c.name)
        val words = normed ?: normWords(sp.base)
        return NameInfo(idx, sp.base, words, c.group, c.group + "\u0000" + words.joinToString(" "))
    }

    /**
     * Stytting á enda nafns er sama rás og orðin sem hún stendur fyrir:
     * "UK: Sky Sport PL" = "UK: Sky Sport Premier League". Aðeins ef orðin fyrir framan
     * passa nákvæmlega, öll orðin sem vantar eru alvöru orð og nákvæmlega eitt nafn
     * passar (annars gæti "… BC" átt við Birmingham City eða Bristol City).
     */
    fun buildNameIndex(
        channels: List<Channel>,
        idxs: List<Int>,
        splits: Map<Int, Split> = emptyMap(),
        words: Map<Int, List<String>> = emptyMap()
    ): NameIndex {
        val names = LinkedHashMap<String, NameInfo>()
        val collapsed = HashMap<String, MutableSet<String>>()
        for (i in idxs) {
            val n = nameInfo(channels, i, splits[i], words[i])
            names.putIfAbsent(n.key, n)
            for (k in 2..4) {
                if (k >= n.words.size) break
                val tail = n.words.subList(n.words.size - k, n.words.size)
                if (tail.any { !isInitialWord(it) }) continue // tölur eru ekki upphafsstafir
                val ck = n.group + "\u0000" +
                    n.words.subList(0, n.words.size - k).joinToString(" ") + " " +
                    tail.map { it[0] }.joinToString("")
                collapsed.getOrPut(ck) { HashSet() }.add(n.key)
            }
        }
        val alias = HashMap<String, String>()
        for ((key, n) in names) {
            val w = n.words
            val abbr = w.lastOrNull() ?: continue
            if (abbr.length !in 2..4 || !isInitialWord(abbr)) continue
            val set = collapsed[n.group + "\u0000" + w.dropLast(1).joinToString(" ") + " " + abbr]
                ?: continue
            if (set.size != 1) continue // enginn eða fleiri en einn passa
            val other = names[set.first()] ?: continue
            if (other.key == key || other.words.size <= w.size) continue
            alias[key] = other.key
        }
        return NameIndex(names, alias)
    }

    private class Row(val group: String, val first: Int, var base: String) {
        val variants = ArrayList<Int>()
    }

    /**
     * Rásir (idxs í provider-röð) -> línur í lista, sameinaðar og raðaðar.
     * merge = false -> ein lína á hverja rás. sort = false -> provider-röð heldur sér.
     */
    fun makeRows(
        channels: List<Channel>,
        idxs: List<Int> = channels.indices.toList(),
        merge: Boolean = true,
        sort: Boolean = true,
        // Röð flokka eins og þjónustan gefur hana (Mac: groupOrder). Flokkar sem
        // eru ekki í henni koma á eftir, í röð fyrstu birtingar.
        groupOrder: List<String> = emptyList()
    ): List<ChannelRow> {
        val rows = ArrayList<Row>()
        val byKey = HashMap<String, Row>()
        // splitName keyrir þunga reglulega segð; á litlu sjónvarpsboxi tók það sekúndur
        // að keyra hana þrisvar á hverja rás. Nú einu sinni.
        val t0 = System.nanoTime()
        val splits = HashMap<Int, Split>(idxs.size * 2)
        val words = HashMap<Int, List<String>>(idxs.size * 2)
        for (i in idxs) {
            val sp = splitName(channels[i].name)
            splits[i] = sp
            words[i] = normWords(sp.base)
        }
        val t1 = System.nanoTime()
        val index = if (merge) buildNameIndex(channels, idxs, splits, words) else null
        val t2 = System.nanoTime()
        for (i in idxs) {
            val c = channels[i]
            val sp = splits.getValue(i)
            val k0 = c.group + "\u0000" + words.getValue(i).joinToString(" ")
            val key = if (index != null) (index.alias[k0] ?: k0) else "x$i"
            val row = byKey.getOrPut(key) {
                val shown = index?.names?.get(key)
                Row(c.group, rows.size, shown?.name ?: sp.base).also { rows.add(it) }
            }
            row.variants.add(i)
        }
        for (row in rows) {
            if (row.variants.size > 1) {
                // Besta afbrigðið fremst (FHD -> HD -> venjulegt -> 4K -> SD, backup aftast).
                row.variants.sortWith(
                    compareBy({ variantRank(splits.getValue(it).tag) }, { it })
                )
            } else {
                row.base = channels[row.variants[0]].name
            }
        }
        val t3 = System.nanoTime()
        if (sort) {
            val gRank = LinkedHashMap<String, Int>()
            for (g in groupOrder) gRank.putIfAbsent(g, gRank.size)
            for (row in rows) gRank.putIfAbsent(row.group, gRank.size)
            // Röðunarlykillinn er reiknaður einu sinni fyrir hverja línu; annars
            // þyrfti að keyra reglulegar segðir í hverjum samanburði (60.000 rásir
            // = milljónir samanburða og margra sekúndna bið).
            val keys = HashMap<Row, List<String>>(rows.size * 2)
            for (row in rows) keys[row] = tokens(sortKey(row.base))
            rows.sortWith { a, b ->
                val g = gRank.getValue(a.group).compareTo(gRank.getValue(b.group))
                if (g != 0) {
                    g
                } else {
                    val n = compareTokens(keys.getValue(a), keys.getValue(b))
                    if (n != 0) n else a.first.compareTo(b.first)
                }
            }
        }
        val t4 = System.nanoTime()
        lastTimings = "split=${(t1 - t0) / 1_000_000}ms index=${(t2 - t1) / 1_000_000}ms " +
            "rows=${(t3 - t2) / 1_000_000}ms sort=${(t4 - t3) / 1_000_000}ms"
        return rows.map { ChannelRow(it.variants.toList(), it.variants[0], it.base, it.group) }
    }

    // Síðasta tímamæling makeRows (fyrir logcat á tækinu).
    @Volatile
    var lastTimings: String = ""
}
