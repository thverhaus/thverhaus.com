package app.mulehead.data

/**
 * Setur saman það sem rásalistinn á skjánum þarf: línur (sameinaðar og raðaðar í
 * ChannelRows) og „nú og næst“ úr dagskránni (ChannelMatcher).
 */
object HomeModel {

    // Ein lína á skjánum: rás + dagskrá hennar.
    data class RowView(
        val row: ChannelRows.ChannelRow,
        val channel: Channel,
        val number: Int,
        val now: Programme?,
        val next: Programme?
    ) {
        val name: String get() = row.base
        val variants: Int get() = row.variants.size
        val group: String get() = row.group
    }

    /**
     * Rásir + dagskrá -> línur í lista. chanMap er útkoma ChannelMatcher.buildChanMap
     * (sama röð og channels); programmes er útkoma XmltvParser.
     */
    fun rows(
        channels: List<Channel>,
        programmes: Map<String, List<Programme>>,
        chanMap: List<String?>,
        nowMs: Long,
        offsetMs: Long = 0L,
        merge: Boolean = true,
        sort: Boolean = true,
        groupOrder: List<String> = emptyList()
    ): List<RowView> {
        val chRows = ChannelRows.makeRows(channels, channels.indices.toList(), merge, sort, groupOrder)
        return chRows.map { r ->
            val nn = ChannelMatcher.nowNext(
                ChannelMatcher.programmesFor(chanMap, programmes, r.primary),
                nowMs,
                offsetMs
            )
            RowView(r, channels[r.primary], r.primary + 1, nn.now, nn.next)
        }
    }

    /**
     * Sömu línur með nýju „nú og næst“ (ný dagskrá eða ný mínúta). Raðirnar sjálfar
     * (sameining afbrigða, röðun) eru óbreyttar, svo ekki þarf að smíða þær upp á nýtt —
     * það tók sekúndur á Mi TV boxi og gerðist áður á mínútu fresti.
     */
    fun withNowNext(
        rows: List<RowView>,
        programmes: Map<String, List<Programme>>,
        chanMap: List<String?>,
        nowMs: Long,
        offsetMs: Long = 0L
    ): List<RowView> = rows.map { r ->
        val nn = ChannelMatcher.nowNext(
            ChannelMatcher.programmesFor(chanMap, programmes, r.row.primary),
            nowMs,
            offsetMs
        )
        if (nn.now == r.now && nn.next == r.next) r else r.copy(now = nn.now, next = nn.next)
    }

    /** Raðar línum eftir nýrri röð flokka; röð innan hvers flokks helst (stöðugt). */
    fun reorderGroups(rows: List<RowView>, groupOrder: List<String>): List<RowView> {
        val rank = HashMap<String, Int>(groupOrder.size * 2)
        groupOrder.forEachIndexed { i, g -> rank.putIfAbsent(g, i) }
        return rows.sortedBy { rank[it.group] ?: Int.MAX_VALUE }
    }

    // Línur eins flokks; null = allt.
    fun forGroup(rows: List<RowView>, group: String?): List<RowView> =
        if (group == null) rows else rows.filter { it.group == group }

    // Flokkar eins og þeir birtast í línum (röð fyrstu birtingar).
    fun groupCounts(rows: List<RowView>, groupOrder: List<String> = emptyList()): List<ChannelGroup> {
        val counts = LinkedHashMap<String, Int>()
        for (g in groupOrder) counts[g] = 0
        for (r in rows) counts[r.group] = (counts[r.group] ?: 0) + 1
        return counts.filterValues { it > 0 }.map { ChannelGroup(it.key, it.value) }
    }

    private val SEARCH_SPLIT = Regex("[^\\p{L}\\p{N}]+")

    /**
     * Leit í öllum rásum (Mac: hvert orð í leitinni þarf að vera í nafninu). Nöfn þar sem
     * orðin eru upphaf orða koma fyrst: „sky s“ setur „Sky Sports …“ efst.
     */
    fun search(rows: List<RowView>, query: String, limit: Int = 300): List<RowView> {
        val words = query.lowercase().trim().split(SEARCH_SPLIT).filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val hits = ArrayList<Pair<RowView, Int>>()
        for (r in rows) {
            val n = r.name.lowercase()
            if (!words.all { n.contains(it) }) continue
            // Hversu mörg leitarorð eru upphaf orða í nafninu, í sömu röð og skrifað var
            // („sky s“: Sky Sports = 2, Discovery Sky = 1).
            val nameWords = n.split(SEARCH_SPLIT)
            var at = 0
            var inOrder = 0
            for (w in words) {
                val hit = (at until nameWords.size).firstOrNull { nameWords[it].startsWith(w) } ?: continue
                inOrder++
                at = hit + 1
            }
            hits.add(r to inOrder)
        }
        return hits.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    // Lykill línu sem helst þótt raðir séu endurbyggðar (fókus, röðun).
    fun keyOf(r: RowView): String = r.group + "\u0000" + r.name

    // Hversu langt er liðið á atriðið (0 = rétt byrjað, 1 = búið).
    fun progress(p: Programme?, nowMs: Long, offsetMs: Long = 0L): Float {
        if (p == null) return 0f
        val span = (p.stop - p.start).toFloat()
        if (span <= 0f) return 0f
        return ((nowMs - offsetMs - p.start) / span).coerceIn(0f, 1f)
    }
}
