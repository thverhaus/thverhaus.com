package app.mulehead.data

import app.mulehead.tr

// Hvort verið er að sækja myndir eða þætti.
enum class VodKind { MOVIES, SERIES }

// Einn flokkur í myndum/þáttum (t.d. „Kvikmyndir“) með fjölda.
data class VodCategory(val id: String, val name: String, val count: Int)

// Ein mynd eða þáttaröð í lista. url er tómt fyrir þætti (þeir sóttir sér).
data class VodItem(
    val id: String,
    val name: String,
    val categoryId: String,
    val poster: String = "",
    val rating: String = "",
    val year: String = "",
    val added: Long = 0,
    val url: String = "",
    val episode: Boolean = false
)

// Einn þáttur í þáttaröð.
data class VodEpisode(
    val id: String,
    val title: String,
    val num: Int,
    val plot: String = "",
    val duration: String = "",
    val poster: String = "",
    val url: String = ""
)

// Eitt tímabil („1“, „2“, …) með þáttum.
data class VodSeason(val season: String, val episodes: List<VodEpisode>)

// Upplýsingar um þáttaröð ásamt tímabilum.
data class VodSeriesInfo(
    val name: String,
    val plot: String = "",
    val cover: String = "",
    val seasons: List<VodSeason> = emptyList()
)

/**
 * Þýðing á loadVod()/loadSeries() í reference/mac-electron/playlists.js.
 * Allt er hreint (engar Android-klasar) svo prófa megi án síma.
 */
object VodParser {

    val NO_NAME: String get() = tr("No name", "Án nafns")
    val NO_CATEGORY: String get() = tr("Uncategorized", "Án flokks")

    private val YEAR_RE = Regex("\\((19|20)\\d\\d\\)")
    private val EMPTY_VALUES = setOf("", "0", "null", "undefined")

    /**
     * Þáttar get_vod_streams (myndir) eða get_series (þættir).
     * creds þarf til að búa til spilunarslóðir myndanna (má vera null í prófum).
     */
    fun items(json: String, kind: VodKind, creds: XtreamCreds?): List<VodItem> {
        val list = Json.list(Json.parse(json))
        val out = ArrayList<VodItem>(list.size)
        for (raw in list) {
            val m = Json.obj(raw)
            if (m.isEmpty()) continue
            if (kind == VodKind.MOVIES) {
                val id = Json.str(m["stream_id"])
                if (id.isEmpty()) continue
                out.add(
                    VodItem(
                        id = id,
                        name = Json.str(m["name"]).ifEmpty { NO_NAME },
                        categoryId = Json.str(m["category_id"]),
                        poster = Json.str(m["stream_icon"]),
                        rating = ratingOf(m),
                        year = yearOf(
                            firstOf(
                                Json.str(m["year"]),
                                Json.str(m["releaseDate"]),
                                Json.str(m["release_date"]),
                                nameYear(Json.str(m["name"]))
                            )
                        ),
                        added = Json.long(m["added"]),
                        url = creds?.movieUrl(id, Json.str(m["container_extension"])).orEmpty()
                    )
                )
            } else {
                val id = Json.str(m["series_id"])
                if (id.isEmpty()) continue
                out.add(
                    VodItem(
                        id = id,
                        name = Json.str(m["name"]).ifEmpty { NO_NAME },
                        categoryId = Json.str(m["category_id"]),
                        poster = Json.str(m["cover"]),
                        rating = ratingOf(m),
                        year = yearOf(
                            firstOf(
                                Json.str(m["releaseDate"]),
                                Json.str(m["release_date"]),
                                Json.str(m["year"])
                            )
                        ),
                        added = Json.long(m["last_modified"])
                    )
                )
            }
        }
        return out
    }

    // Flokkar úr get_vod_categories/get_series_categories, með fjölda úr items.
    // Flokkar sem eru tómir falla niður (sama og í Mac).
    fun categories(json: String, items: List<VodItem>): List<VodCategory> {
        val cats = Json.list(Json.parse(json))
        val counts = HashMap<String, Int>()
        for (i in items) counts[i.categoryId] = (counts[i.categoryId] ?: 0) + 1
        val out = ArrayList<VodCategory>(cats.size)
        for (raw in cats) {
            val m = Json.obj(raw)
            val id = Json.str(m["category_id"])
            if (id.isEmpty()) continue
            val n = counts[id] ?: 0
            if (n <= 0) continue
            out.add(VodCategory(id, Json.str(m["category_name"]).ifEmpty { NO_CATEGORY }, n))
        }
        return out
    }

    // Tímabil og þættir úr get_series_info (info + episodes).
    fun seriesInfo(json: String, creds: XtreamCreds?): VodSeriesInfo {
        val root = Json.obj(Json.parse(json))
        val info = Json.obj(root["info"])
        val eps = Json.obj(root["episodes"])
        val seasons = eps.keys
            .sortedBy { it.toIntOrNull() ?: Int.MAX_VALUE }
            .map { season ->
                VodSeason(
                    season = season,
                    episodes = Json.list(eps[season]).map { raw ->
                        val e = Json.obj(raw)
                        val num = Json.num(e["episode_num"])?.toInt() ?: 0
                        val ei = Json.obj(e["info"])
                        val id = Json.str(e["id"])
                        VodEpisode(
                            id = id,
                            title = Json.str(e["title"]).ifEmpty { tr("Episode $num", "Þáttur $num") },
                            num = num,
                            plot = Json.str(ei["plot"]),
                            duration = Json.str(ei["duration"]),
                            poster = Json.str(ei["movie_image"]),
                            url = creds?.seriesUrl(id, Json.str(e["container_extension"])).orEmpty()
                        )
                    }
                )
            }
        return VodSeriesInfo(
            name = Json.str(info["name"]),
            plot = Json.str(info["plot"]),
            cover = Json.str(info["cover"]),
            seasons = seasons
        )
    }

    /**
     * Myndir/þættir úr venjulegum M3U-lista (slóðir með /movie/ eða /series/).
     * Flokkur fær númer í röð fyrstu birtingar; id er „m“ + staða í listanum.
     */
    fun fromChannels(channels: List<Channel>, kind: VodKind): Pair<List<VodCategory>, List<VodItem>> {
        val want = if (kind == VodKind.MOVIES) Channel.Kind.MOVIE else Channel.Kind.SERIES
        val catIds = LinkedHashMap<String, String>()
        val counts = LinkedHashMap<String, Int>()
        val items = ArrayList<VodItem>()
        channels.forEachIndexed { i, c ->
            if (c.kind != want) return@forEachIndexed
            val group = c.group.ifEmpty { NO_CATEGORY }
            val catId = catIds.getOrPut(group) { catIds.size.toString() }
            counts[catId] = (counts[catId] ?: 0) + 1
            items.add(
                VodItem(
                    id = "m$i",
                    name = c.name.ifEmpty { NO_NAME },
                    categoryId = catId,
                    poster = c.logo,
                    year = nameYear(c.name),
                    added = i.toLong(),
                    url = c.url,
                    episode = kind == VodKind.SERIES
                )
            )
        }
        val cats = catIds.entries.map { (group, id) -> VodCategory(id, group, counts[id] ?: 0) }
        return cats to items
    }

    // Fyrsta gildið sem er ekki tómt („0“ telst tómt, eins og 0 í JavaScript).
    internal fun firstOf(vararg values: String): String =
        values.firstOrNull { it.trim().lowercase() !in EMPTY_VALUES }.orEmpty()

    // „Mynd (1999)“ -> „1999“ (aðeins ár úr nafninu, ef það vantar annars staðar).
    internal fun nameYear(name: String): String =
        YEAR_RE.find(name)?.value?.replace("(", "")?.replace(")", "").orEmpty()

    // JavaScript: slice(0, 4).
    internal fun yearOf(s: String): String = if (s.length > 4) s.substring(0, 4) else s

    // s.rating || s.rating_5based * 2 || '' (0 telst tómt, „0“ ekki).
    private fun ratingOf(m: Map<String, Any?>): String {
        val raw = m["rating"]
        val has = when (raw) {
            is Double -> raw != 0.0
            is String -> raw.isNotEmpty()
            else -> false
        }
        if (has) return Json.str(raw).trim()
        val five = Json.num(m["rating_5based"]) ?: 0.0
        return if (five != 0.0) Json.numText(five * 2) else ""
    }
}
