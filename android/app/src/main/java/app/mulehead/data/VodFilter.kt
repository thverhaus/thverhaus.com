package app.mulehead.data

/**
 * Leit í myndum og þáttum. Öll orðin í leitarstrengnum þurfa að finnast í nafninu.
 * Broddar (á, é, æ, ö …) eru fjarlægðir svo „saga“ finni „Saga“.
 */
object VodFilter {

    // Á/é/í/ó/ú/ý/þ/æ/ö/ð og nokkur norræn tákn verða að venjulegum stöfum.
    private val FOLD = mapOf(
        'á' to "a", 'é' to "e", 'í' to "i", 'ó' to "o", 'ú' to "u", 'ý' to "y",
        'þ' to "th", 'æ' to "ae", 'ö' to "o", 'ð' to "d", 'å' to "a", 'ø' to "o"
    )

    // Atriði sem passa við leit og flokk (categoryId null = allir flokkar).
    fun search(items: List<VodItem>, query: String, categoryId: String? = null): List<VodItem> {
        val words = fold(query).split(' ').filter { it.isNotEmpty() }
        return items.filter { item ->
            (categoryId == null || item.categoryId == categoryId) && matches(item.name, words)
        }
    }

    fun matches(name: String, words: List<String>): Boolean {
        if (words.isEmpty()) return true
        val n = fold(name)
        return words.all { n.contains(it) }
    }

    // Lágstafir og broddar fjarlægðir.
    fun fold(s: String): String {
        val lower = s.lowercase()
        val sb = StringBuilder(lower.length)
        for (ch in lower) {
            val f = FOLD[ch]
            if (f != null) sb.append(f) else sb.append(ch)
        }
        return sb.toString()
    }
}
