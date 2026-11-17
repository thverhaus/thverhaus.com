package app.mulehead.data

import app.mulehead.tr

/**
 * Röðun mynda og þátta, og stafurinn sem hver titill fer undir í A–Z stikunni
 * (eins og í Plex). Raðað er eftir nafni án forskeytis veitandans („EN - “, „[4K] “)
 * og án „The/A/An“ fremst, svo „The Matrix“ lendir undir M.
 */
object VodSort {
    const val AZ = "az"
    const val NEW = "new"
    const val YEAR = "year"
    const val PROVIDER = "provider"

    val MODES = listOf(AZ, NEW, YEAR, PROVIDER)

    fun next(mode: String): String = MODES[(MODES.indexOf(mode).coerceAtLeast(0) + 1) % MODES.size]

    fun label(mode: String): String = when (mode) {
        AZ -> "A–Z"
        NEW -> tr("Newest", "Nýjast")
        YEAR -> tr("Year", "Ár")
        else -> tr("Provider", "Röð þjónustu")
    }

    // „[EN] “, „(4K) “, „EN - “, „NF | “ fremst í nafni.
    private val TAG = Regex("""^\s*(?:[\[(][^\])]{1,12}[\])]\s*|[A-Z0-9+]{2,4}\s*\|\s*|[A-Z0-9+]{2,4}\s+[-–]\s+)""")
    private val ARTICLE = Regex("""^(?:the|a|an)\s+""")

    /** Lykillinn sem raðað er eftir: lágstafir, broddar fjarlægðir, án forskeytis og greinis. */
    fun key(name: String): String {
        var n = name
        repeat(2) { n = TAG.replaceFirst(n, "") }
        val folded = VodFilter.fold(n.trim())
        return ARTICLE.replaceFirst(folded, "").trimStart { !it.isLetterOrDigit() }
    }

    /** Stafurinn í stikunni: A–Z, annars „#“ (tölur og tákn). */
    fun letter(name: String): Char {
        val c = key(name).firstOrNull()?.uppercaseChar() ?: return '#'
        return if (c in 'A'..'Z') c else '#'
    }

    fun sort(items: List<VodItem>, mode: String): List<VodItem> = when (mode) {
        AZ -> items.map { key(it.name) to it }
            .sortedWith(compareBy<Pair<String, VodItem>> { p ->
                val c = p.first.firstOrNull()?.uppercaseChar()
                if (c != null && c in 'A'..'Z') 1 else 0
            }.thenBy { it.first })
            .map { it.second }
        NEW -> items.sortedByDescending { it.added }
        YEAR -> items.sortedWith(compareByDescending<VodItem> { it.year.take(4).toIntOrNull() ?: 0 }
            .thenBy { key(it.name) })
        else -> items
    }

    /** Fyrsta sæti hvers stafs í (A–Z raðaða) listanum. */
    fun index(rows: List<VodItem>): List<Pair<Char, Int>> {
        val out = ArrayList<Pair<Char, Int>>()
        var last: Char? = null
        rows.forEachIndexed { i, item ->
            val l = letter(item.name)
            if (l != last) {
                if (out.none { it.first == l }) out.add(l to i)
                last = l
            }
        }
        return out
    }
}
