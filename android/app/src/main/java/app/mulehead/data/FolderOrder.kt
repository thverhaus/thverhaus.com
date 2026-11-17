package app.mulehead.data

import app.mulehead.tr

import java.text.Collator
import java.util.Locale

/**
 * Röðun rása innan möppu (Mac: folderMode / folderSort / folderOrder í renderer/app.js).
 *
 * - [AZ]: stafrófsröð (sjálfgefið ef „Raða A–Ö“ er á í stillingum).
 * - [PROVIDER]: sama röð og þjónustan gefur.
 * - [CUSTOM]: „Mín röð“ — notandinn hefur raðað sjálfur; rásir sem bætast við síðar
 *   koma aftast, í röð þjónustunnar.
 */
object FolderOrder {
    const val AZ = "az"
    const val PROVIDER = "provider"
    const val CUSTOM = "custom"

    val MODES = listOf(AZ, PROVIDER, CUSTOM)

    fun label(mode: String): String = when (mode) {
        AZ -> tr("A–Z", "A–Ö")
        PROVIDER -> tr("Provider order", "Röð þjónustu")
        else -> tr("My order", "Mín röð")
    }

    // Næsti háttur þegar ýtt er á röðunarhnappinn.
    fun next(mode: String): String = MODES[(MODES.indexOf(mode).coerceAtLeast(0) + 1) % MODES.size]

    private val collator: Collator = Collator.getInstance(Locale.forLanguageTag("is")).apply {
        strength = Collator.SECONDARY
    }

    /** Raðar línum einnar möppu eftir hætti. `order` = nöfn í „Mín röð“. */
    fun arrange(rows: List<HomeModel.RowView>, mode: String, order: List<String>): List<HomeModel.RowView> {
        val provider = rows.sortedBy { r -> r.row.variants.minOrNull() ?: r.row.primary }
        return when (mode) {
            PROVIDER -> provider
            CUSTOM -> {
                val pos = HashMap<String, Int>(order.size * 2)
                order.forEachIndexed { i, n -> pos.putIfAbsent(n, i) }
                provider.withIndex()
                    .sortedBy { (i, r) -> pos[r.name] ?: (1_000_000 + i) }
                    .map { it.value }
            }
            else -> {
                val keys = HashMap<HomeModel.RowView, String>(rows.size * 2)
                for (r in rows) keys[r] = ChannelRows.sortKey(r.name)
                rows.withIndex()
                    .sortedWith { a, b ->
                        val c = collator.compare(keys.getValue(a.value), keys.getValue(b.value))
                        if (c != 0) c else a.index.compareTo(b.index)
                    }
                    .map { it.value }
            }
        }
    }

    /** Merkt nöfn efst (í þeirri röð sem þau eru sýnd), hin á eftir. */
    fun toTop(shown: List<String>, marked: Set<String>): List<String> =
        shown.filter { it in marked } + shown.filter { it !in marked }

    /** Færir eitt nafn um eitt sæti (dir = -1 upp, 1 niður). Utan marka: óbreytt. */
    fun step(shown: List<String>, name: String, dir: Int): List<String> {
        val i = shown.indexOf(name)
        val j = i + dir
        if (i < 0 || j !in shown.indices) return shown
        val out = shown.toMutableList()
        out[i] = out[j]
        out[j] = name
        return out
    }

    /** Eigin röð flokka á undan, svo flokkar þjónustunnar sem eru ekki í henni. */
    fun withCustom(provider: List<String>, custom: List<String>): List<String> {
        if (custom.isEmpty()) return provider
        val have = provider.toSet()
        val head = custom.filter { it in have }
        val seen = head.toSet()
        return head + provider.filter { it !in seen }
    }

    /**
     * Færir línu `from` á stað `to` og skilar nýju „Mín röð“ (nöfnum í röð).
     * Utan marka: óbreytt röð.
     */
    fun move(shown: List<HomeModel.RowView>, from: Int, to: Int): List<String> {
        val names = shown.map { it.name }.toMutableList()
        if (from !in names.indices || to !in names.indices || from == to) return names
        val n = names.removeAt(from)
        names.add(to, n)
        return names
    }
}
