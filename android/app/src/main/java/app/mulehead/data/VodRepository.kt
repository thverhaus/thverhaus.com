package app.mulehead.data

import app.mulehead.tr

import java.io.File
import java.io.IOException

// Útkoma úr VodRepository: flokkar, atriði og hvaðan þau komu.
data class VodList(
    val kind: VodKind,
    val categories: List<VodCategory> = emptyList(),
    val items: List<VodItem> = emptyList(),
    // "xtream" (player_api.php) eða "m3u" (slóðir í listanum sjálfum).
    val source: String = "",
    val fetchedAt: Long = 0,
    val fromCache: Boolean = false,
    val error: String? = null
)

/**
 * Sækir myndir og þætti (VOD). Þýðing á vod:get/vod:series í main.js og
 * skyndiminnið er hráa JSON-svarið (eins og Mac geymir það).
 *
 * Allt er blokkerandi — kallaðu úr bakgrunnsþræði (Dispatchers.IO í skjánum).
 */
class VodRepository(
    private val dir: File,
    private val transport: PlaylistRepository.Transport = HttpTransport(),
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    private val vodDir = File(dir, "vod")

    // Vistuð svör, eða null ef ekkert er vistað. Snertir ekki netið.
    fun cached(url: String, kind: VodKind, key: String = "main"): VodList? {
        val list = listFile(kind, key)
        val cats = catFile(kind, key)
        if (!list.isFile || !cats.isFile) return null
        val at = try {
            metaFile(kind, key).readText().trim().toLong()
        } catch (e: Exception) {
            list.lastModified()
        }
        return try {
            val creds = Xtream.fromUrl(url)
            val items = VodParser.items(list.readText(), kind, creds)
            VodList(kind, VodParser.categories(cats.readText(), items), items, "xtream", at, fromCache = true)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Skilar myndum/þáttum: úr skyndiminni ef þau eru nýrri en refreshHours,
     * annars sótt. Ef hlekkurinn er ekki Xtream eru atriðin tekin úr M3U-listanum
     * (channels) sem nú þegar er á disknum.
     */
    fun load(
        url: String,
        channels: List<Channel>,
        kind: VodKind,
        key: String = "main",
        force: Boolean = false,
        refreshHours: Int = 12,
        timeoutMs: Int = 120_000,
        userAgent: String = ""
    ): VodList {
        val creds = Xtream.fromUrl(url)
        if (creds == null) {
            val (cats, items) = VodParser.fromChannels(channels, kind)
            return VodList(kind, cats, items, "m3u")
        }
        val cachedData = cached(url, kind, key)
        if (!force && cachedData != null) {
            val ageH = (clock() - cachedData.fetchedAt) / HOUR_MS.toDouble()
            if (ageH < refreshHours) return cachedData
        }
        return try {
            val catAction = if (kind == VodKind.MOVIES) "get_vod_categories" else "get_series_categories"
            val listAction = if (kind == VodKind.MOVIES) "get_vod_streams" else "get_series"
            val catsJson = fetch(creds, catAction, timeoutMs, userAgent)
            val listJson = fetch(creds, listAction, timeoutMs, userAgent)
            val items = VodParser.items(listJson, kind, creds)
            val cats = VodParser.categories(catsJson, items)
            val at = clock()
            writeCache(kind, key, catsJson, listJson, at)
            VodList(kind, cats, items, "xtream", at)
        } catch (e: Exception) {
            val msg = errorText(url, e)
            if (cachedData != null) cachedData.copy(error = msg) else VodList(kind, source = "xtream", error = msg)
        }
    }

    /**
     * Tímabil og þættir einnar þáttaraðar (get_series_info). Þetta er ekki vistað.
     * Skilar PlaylistException ef hlekkurinn er ekki Xtream eða nettenging bregst.
     */
    fun seriesInfo(
        url: String,
        seriesId: String,
        timeoutMs: Int = 120_000,
        userAgent: String = ""
    ): VodSeriesInfo {
        val creds = Xtream.fromUrl(url) ?: throw PlaylistException(NOT_XTREAM)
        val json = fetch(creds, "get_series_info", timeoutMs, userAgent, "series_id=" + Xtream.enc(seriesId))
        return VodParser.seriesInfo(json, creds)
    }

    // Eyðir skyndiminni fyrir þennan lista.
    fun clear(kind: VodKind, key: String = "main") {
        listFile(kind, key).delete()
        catFile(kind, key).delete()
        metaFile(kind, key).delete()
    }

    private fun fetch(
        creds: XtreamCreds,
        action: String,
        timeoutMs: Int,
        userAgent: String,
        extra: String = ""
    ): String {
        val bytes = transport.get(
            creds.apiUrl(action, extra),
            userAgent.ifEmpty { PlaylistRepository.DEFAULT_UA },
            timeoutMs
        )
        return String(bytes, Charsets.UTF_8)
    }

    private fun errorText(url: String, e: Exception): String = when (e) {
        is PlaylistException -> e.message ?: UNKNOWN
        is IOException -> tr("Couldn't load movies (${hostOf(url)}): ${e.message ?: UNKNOWN}", "Náði ekki í myndir (${hostOf(url)}): ${e.message ?: UNKNOWN}")
        else -> tr("Unexpected error: ${e.message ?: e.javaClass.simpleName}", "Óvænt villa: ${e.message ?: e.javaClass.simpleName}")
    }

    private fun prefix(kind: VodKind): String = if (kind == VodKind.MOVIES) "vod-movies" else "vod-series"

    private fun listFile(kind: VodKind, key: String): File = File(vodDir, "${prefix(kind)}-$key.json")

    private fun catFile(kind: VodKind, key: String): File = File(vodDir, "${prefix(kind)}-$key-cats.json")

    private fun metaFile(kind: VodKind, key: String): File = File(vodDir, "${prefix(kind)}-$key.meta")

    private fun writeCache(kind: VodKind, key: String, cats: String, list: String, at: Long) {
        vodDir.mkdirs()
        write(listFile(kind, key), list)
        write(catFile(kind, key), cats)
        metaFile(kind, key).writeText(at.toString())
    }

    private fun write(f: File, text: String) {
        val tmp = File(vodDir, f.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
    }

    companion object {
        val NOT_XTREAM: String get() = tr("Series are only supported for Xtream subscriptions", "Þættir eru aðeins studdir fyrir Xtream-áskriftir")
        private val UNKNOWN: String get() = tr("unknown error", "óþekkt villa")
        private const val HOUR_MS = 3_600_000L
    }
}
