package app.mulehead.data

/**
 * Tengir rás úr playlista við dagskrá (xmltv-id). Þýðing á buildChanMap() í
 * reference/mac-electron/main.js og progsFor()/nowNext() í renderer/app.js.
 *
 * Keðjan er í þessari röð: tvg-id (nákvæmt) -> tvg-id (há/lágstafir) ->
 * nafn (tvgName, svo name) -> laust nafn (sama röð). Annars null = engin dagskrá.
 */
object ChannelMatcher {

    // Hvaða id og nöfn á að biðja XmltvParser um að halda.
    data class Wanted(
        val ids: Set<String>,
        val names: Set<String>,
        val loose: Set<String>
    )

    // Núverandi og næsta atriði á rás.
    data class NowNext(val now: Programme?, val next: Programme?)

    // Söfnin sem XmltvParser þarf til að hleypa réttum rásum inn.
    fun wanted(channels: List<Channel>): Wanted {
        val ids = LinkedHashSet<String>()
        val names = LinkedHashSet<String>()
        val loose = LinkedHashSet<String>()
        for (c in channels) {
            if (c.tvgId.isNotEmpty()) {
                ids.add(c.tvgId)
                ids.add(c.tvgId.lowercase())
            }
            names.add(XmltvParser.norm(c.tvgName))
            names.add(XmltvParser.norm(c.name))
            loose.add(XmltvParser.looseNorm(c.tvgName))
            loose.add(XmltvParser.looseNorm(c.name))
        }
        names.remove("")
        loose.remove("")
        return Wanted(ids, names, loose)
    }

    // Dagskrár-id fyrir hverja rás, í sömu röð og channels. null = engin dagskrá.
    fun buildChanMap(channels: List<Channel>, epg: XmltvResult): List<String?> {
        val ids = epg.programmes.keys
        val lowerIds = LinkedHashMap<String, String>()
        for (id in ids) lowerIds.putIfAbsent(id.lowercase(), id)
        val nameToId = epg.nameToId
        val nameToIdLoose = epg.nameToIdLoose
        return channels.map { c ->
            val tid = c.tvgId
            val lower = tid.lowercase()
            when {
                tid.isNotEmpty() && ids.contains(tid) -> tid
                tid.isNotEmpty() && lowerIds.containsKey(lower) -> lowerIds[lower]
                else -> nameToId[XmltvParser.norm(c.tvgName)]
                    ?: nameToId[XmltvParser.norm(c.name)]
                    ?: nameToIdLoose[XmltvParser.looseNorm(c.tvgName)]
                    ?: nameToIdLoose[XmltvParser.looseNorm(c.name)]
            }
        }
    }

    // Dagskrá á rás númer idx (tómur listi ef rásin hefur enga dagskrá).
    fun programmesFor(
        chanMap: List<String?>,
        programmes: Map<String, List<Programme>>,
        idx: Int
    ): List<Programme> {
        val id = chanMap.getOrNull(idx) ?: return emptyList()
        return programmes[id] ?: emptyList()
    }

    // Sama og progsFor() + nowNext() í Mac: t er skekkt um offset (epgOffsetMin).
    fun nowNext(list: List<Programme>, nowMs: Long, offsetMs: Long = 0L): NowNext {
        if (list.isEmpty()) return NowNext(null, null)
        val t = nowMs - offsetMs
        var lo = 0
        var hi = list.size - 1
        var pos = -1
        while (lo <= hi) {
            val m = (lo + hi) ushr 1
            if (list[m].start <= t) {
                pos = m
                lo = m + 1
            } else {
                hi = m - 1
            }
        }
        val now = if (pos >= 0 && list[pos].stop > t) list[pos] else null
        return NowNext(now, list.getOrNull(pos + 1))
    }

    // Sama og nowNext() en byrjar á rás númer idx.
    fun channelNowNext(
        chanMap: List<String?>,
        programmes: Map<String, List<Programme>>,
        idx: Int,
        nowMs: Long,
        offsetMs: Long = 0L
    ): NowNext = nowNext(programmesFor(chanMap, programmes, idx), nowMs, offsetMs)

    // Færir dagskrá til í tíma (stillingin epgOffsetMin).
    fun shift(p: Programme?, offsetMs: Long): Programme? =
        p?.let { it.copy(start = it.start + offsetMs, stop = it.stop + offsetMs) }
}
