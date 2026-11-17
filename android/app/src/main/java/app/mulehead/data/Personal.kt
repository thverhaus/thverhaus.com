package app.mulehead.data

import app.mulehead.tr

/**
 * Uppáhalds og nýlegt (eins og S.per.favorites / recent í Mac). Hreinar aðgerðir á listum
 * svo hægt sé að prófa þær; SettingsStore geymir listana.
 */
object Personal {
    // Sýndarmöppur efst í flokkadálkinum (nöfnin eru líka lyklarnir).
    const val FAV = "⭐ Uppáhalds"
    const val RECENT = "🕘 Nýlegt"
    const val RECENT_MAX = 40

    /** Nafnið sem birtist (lyklarnir FAV/RECENT haldast óbreyttir svo vistuð staða haldist). */
    fun shown(name: String): String = when (name) {
        FAV -> tr("⭐ Favourites", FAV)
        RECENT -> tr("🕘 Recent", RECENT)
        else -> name
    }

    /** Bætir við (aftast) eða tekur út. Skilar nýja listanum. */
    fun toggle(list: List<String>, key: String): List<String> =
        if (key in list) list - key else list + key

    /** Nýjasta fremst, engar tvítekningar, mest RECENT_MAX. */
    fun touch(list: List<String>, key: String, max: Int = RECENT_MAX): List<String> =
        (listOf(key) + list.filter { it != key }).take(max)

    /** Hlutir listans í röð listans (það sem er ekki lengur til er sleppt). */
    fun <T> pick(keys: List<String>, items: List<T>, keyOf: (T) -> String): List<T> {
        val by = HashMap<String, T>(items.size * 2)
        for (it in items) by.putIfAbsent(keyOf(it), it)
        return keys.mapNotNull { by[it] }
    }

    /**
     * Ný röð eftir röðun á skjánum: [shown] er listinn eins og hann er sýndur (eftir færslu),
     * lyklar sem ekki eru sýndir (rás horfin úr listanum í bili) halda sér aftast.
     */
    fun reorder(all: List<String>, shown: List<String>): List<String> {
        val set = shown.toHashSet()
        return shown + all.filter { it !in set }
    }
}

/**
 * Heilsa rása, sömu reglur og í Mac (renderer/app.js markTrouble/creditClean):
 * - vandi einu sinni = gult, oftar (eða rás sem gafst upp) = rautt;
 * - hálftími án vandræða = grænt; hreinar 10 mínútur létta á merki um eitt stig;
 * - eitt merki á mínútu dugar (rás sem hikstar tíu sinnum í röð er einn vandi);
 * - gleymt eftir 7 daga, mest 200 rásir.
 */
object ChannelHealth {
    data class Entry(val n: Int, val ok: Int, val last: Long, val why: String = "")

    const val CLEAN_CREDIT_SEC = 600
    const val GREEN_OK_SEC = 1800
    private const val KEEP_MS = 7L * 86_400_000L
    private const val KEEP_N = 200

    // 0 = ekkert, 1 = gult, 2 = rautt, 3 = grænt
    fun level(e: Entry?): Int = when {
        e == null -> 0
        e.n >= 2 -> 2
        e.n == 1 -> 1
        e.ok >= GREEN_OK_SEC -> 3
        else -> 0
    }

    /** Versta merki afbrigðanna (rautt > gult > grænt). */
    fun worst(levels: List<Int>): Int = when {
        2 in levels -> 2
        1 in levels -> 1
        3 in levels -> 3
        else -> 0
    }

    fun trouble(map: Map<String, Entry>, name: String, reason: String, severe: Boolean, now: Long): Map<String, Entry>? {
        val prev = map[name]
        if (!severe && prev != null && prev.n > 0 && now - prev.last < 60_000) return null
        val n = if (severe) maxOf(2, prev?.n ?: 0) else (prev?.n ?: 0) + 1
        return prune(map + (name to Entry(n, 0, now, reason)), now)
    }

    /** Kallað eftir hverjar CLEAN_CREDIT_SEC sek af hreinni spilun (cleanSec = samfelld hrein spilun). */
    fun clean(map: Map<String, Entry>, name: String, cleanSec: Int, now: Long): Map<String, Entry>? {
        val h = map[name]
        val out = when {
            h == null -> if (cleanSec < GREEN_OK_SEC) return null else map + (name to Entry(0, cleanSec, now))
            h.n > 1 -> map + (name to h.copy(n = h.n - 1, last = now))
            h.n == 1 -> map - name
            else -> map + (name to h.copy(ok = cleanSec, last = now))
        }
        return prune(out, now)
    }

    fun prune(map: Map<String, Entry>, now: Long): Map<String, Entry> =
        map.entries
            .filter { (_, h) -> (h.n > 0 || h.ok >= GREEN_OK_SEC) && now - h.last < KEEP_MS }
            .sortedByDescending { it.value.last }
            .take(KEEP_N)
            .associate { it.key to it.value }

    private fun clean(s: String) = s.replace('\t', ' ').replace('\n', ' ')

    fun encode(map: Map<String, Entry>): String =
        map.entries.joinToString("\n") { (k, e) -> "${clean(k)}\t${e.n}\t${e.ok}\t${e.last}\t${clean(e.why)}" }

    fun decode(text: String): Map<String, Entry> {
        val out = LinkedHashMap<String, Entry>()
        for (line in text.split('\n')) {
            val f = line.split('\t')
            if (f.size < 4) continue
            val n = f[1].toIntOrNull() ?: continue
            val ok = f[2].toIntOrNull() ?: continue
            val last = f[3].toLongOrNull() ?: continue
            out[f[0]] = Entry(n, ok, last, f.getOrElse(4) { "" })
        }
        return out
    }
}
