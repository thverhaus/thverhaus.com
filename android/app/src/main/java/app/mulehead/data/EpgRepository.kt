package app.mulehead.data

import app.mulehead.tr

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

// Dagskrá + hvaða xmltv-id passaru hverri rás (chanMap í sömu röð og channels).
data class EpgData(
    val programmes: Map<String, List<Programme>>,
    val chanMap: List<String?>,
    val fetchedAt: Long,
    val fromCache: Boolean = false,
    val error: String? = null
)

/**
 * Sækir XMLTV-dagskrá, geymir hana á disk og les hana með XmltvParser.
 * Þýðing á fetchEpg() í reference/mac-electron/epg.js (sókn + gluggi), en
 * skyndiminnið hér er hráa XML-skjalið — það er lesið aftur með nýjum glugga.
 */
class EpgRepository(
    private val dir: File,
    private val transport: PlaylistRepository.Transport = HttpTransport(),
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    private val epgDir = File(dir, "epg")

    /**
     * Dagskrá úr skyndimynd ef hún passar (réttur rásalisti og glugginn enn í
     * gildi). Engin net- eða XML-lestur: þetta má kalla strax við ræsingu.
     */
    fun snapshot(
        url: String,
        channels: List<Channel>,
        key: String = "main",
        now: Long = clock()
    ): EpgData? {
        if (url.isBlank() || channels.isEmpty()) return null
        val at = cachedAt(key)
        if (at <= 0) return null
        return snapshotOf(key, channels, at, Snapshots.signature(channels), now)
    }

    /**
     * Skilar dagskrá fyrir channels. url má vera tómur (þá kemur villa í staðinn).
     * Ef netið bregst er gamalt skyndiminni/skyndimynd notað ef það er til.
     */
    fun load(
        url: String,
        channels: List<Channel>,
        key: String = "main",
        force: Boolean = false,
        refreshHours: Int = 12,
        timeoutMs: Int = 300_000,
        userAgent: String = "",
        now: Long = clock(),
        onStep: (LoadStep) -> Unit = {}
    ): EpgData {
        if (url.isBlank()) {
            return EpgData(emptyMap(), List(channels.size) { null }, 0, error = NO_URL)
        }
        val want = ChannelMatcher.wanted(channels)
        val sig = Snapshots.signature(channels)
        val f = cacheFile(key)
        val at = cachedAt(key)
        val fresh = at > 0 && (now - at) / HOUR_MS.toDouble() < refreshHours

        if (!force && fresh) {
            // 1) Þáttuð skyndimynd passar: engin lestur á stóru skránni.
            snapshotOf(key, channels, at, sig, now)?.let { return it }
            // 2) Hráa skráin er nýleg: lesum hana og vistum skyndimynd.
            parseFile(f, channels, want, key, sig, now, at, fromCache = true)?.let { return it }
        }

        onStep(LoadStep.EPG_FETCH)
        epgDir.mkdirs()
        val tmp = File(epgDir, PlaylistRepository.safe(key) + ".xml.tmp")
        try {
            transport.getTo(url, userAgent.ifEmpty { PlaylistRepository.DEFAULT_UA }, timeoutMs, tmp)
        } catch (e: PlaylistException) {
            tmp.delete()
            return staleOrError(key, channels, want, sig, now, e.message ?: NO_URL)
        } catch (e: IOException) {
            tmp.delete()
            return staleOrError(
                key, channels, want, sig, now,
                tr("Couldn't load EPG (${hostOf(url)}): ${e.message ?: tr("unknown error", "óþekkt villa")}", "Náði ekki í dagskrá (${hostOf(url)}): ${e.message ?: tr("unknown error", "óþekkt villa")}")
            )
        } catch (e: OutOfMemoryError) {
            tmp.delete()
            return staleOrError(key, channels, want, sig, now, PlaylistRepository.OOM_MESSAGE)
        }

        onStep(LoadStep.EPG_PARSE)
        val result = try {
            tmp.inputStream().use { XmltvParser.parse(it, want.ids, want.names, want.loose, now) }
        } catch (e: Exception) {
            tmp.delete()
            return staleOrError(
                key, channels, want, sig, now,
                tr("Couldn't read the EPG: ${e.message ?: tr("unknown error", "óþekkt villa")}", "Gat ekki lesið dagskrána: ${e.message ?: tr("unknown error", "óþekkt villa")}")
            )
        } catch (e: OutOfMemoryError) {
            tmp.delete()
            return staleOrError(key, channels, want, sig, now, PlaylistRepository.OOM_MESSAGE)
        }
        if (result.programmes.isEmpty()) {
            tmp.delete()
            return staleOrError(key, channels, want, sig, now, EMPTY)
        }

        val fetched = clock()
        // Stór skrá er ekki geymd: skyndimyndin inniheldur allt sem þarf.
        if (tmp.length() > MAX_RAW_BYTES) {
            tmp.delete()
        } else if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) {
                tmp.copyTo(f, overwrite = true)
                tmp.delete()
            }
        }
        try {
            metaFile(key).writeText(fetched.toString())
        } catch (e: IOException) {
            // Ekki banvænt: lastModified() kemur í staðinn.
        }
        val data = EpgData(
            programmes = result.programmes,
            chanMap = ChannelMatcher.buildChanMap(channels, result),
            fetchedAt = fetched
        )
        Snapshots.writeEpg(
            snapFile(key),
            Snapshots.Epg(
                sourceAt = fetched,
                from = now - XmltvParser.PAST_MS,
                to = now + XmltvParser.FUTURE_MS,
                sig = sig,
                programmes = result.programmes,
                nameToId = result.nameToId,
                nameToIdLoose = result.nameToIdLoose
            )
        )
        return data
    }

    fun cacheFile(key: String): File = File(epgDir, PlaylistRepository.safe(key) + ".xml")

    // Eyðir geymdri dagskrá (t.d. þegar skipt er um þjónustu í paraskjánum).
    fun clear(key: String = "main") {
        cacheFile(key).delete()
        metaFile(key).delete()
        snapFile(key).delete()
        File(epgDir, PlaylistRepository.safe(key) + ".xml.tmp").delete()
    }

    private fun metaFile(key: String): File = File(epgDir, PlaylistRepository.safe(key) + ".meta")

    private fun snapFile(key: String): File = File(epgDir, PlaylistRepository.safe(key) + ".snap")

    private fun cachedAt(key: String): Long {
        try {
            val at = metaFile(key).readText().trim().toLong()
            if (at > 0) return at
        } catch (e: Exception) {
            // ekkert
        }
        val f = cacheFile(key)
        return if (f.isFile) f.lastModified() else 0
    }

    private fun snapshotOf(
        key: String,
        channels: List<Channel>,
        at: Long,
        sig: Long,
        now: Long
    ): EpgData? {
        if (at <= 0) return null
        val snap = Snapshots.readEpg(snapFile(key), at, sig, now) ?: return null
        val res = XmltvResult(snap.programmes, snap.nameToId, snap.nameToIdLoose)
        return EpgData(
            programmes = snap.programmes,
            chanMap = ChannelMatcher.buildChanMap(channels, res),
            fetchedAt = at,
            fromCache = true
        )
    }

    private fun parseFile(
        f: File,
        channels: List<Channel>,
        want: ChannelMatcher.Wanted,
        key: String,
        sig: Long,
        now: Long,
        at: Long,
        fromCache: Boolean
    ): EpgData? {
        if (!f.isFile) return null
        val result = try {
            f.inputStream().use { XmltvParser.parse(it, want.ids, want.names, want.loose, now) }
        } catch (e: IOException) {
            return null
        } catch (e: OutOfMemoryError) {
            return null
        }
        if (result.programmes.isEmpty()) return null
        Snapshots.writeEpg(
            snapFile(key),
            Snapshots.Epg(
                sourceAt = at,
                from = now - XmltvParser.PAST_MS,
                to = now + XmltvParser.FUTURE_MS,
                sig = sig,
                programmes = result.programmes,
                nameToId = result.nameToId,
                nameToIdLoose = result.nameToIdLoose
            )
        )
        return EpgData(
            programmes = result.programmes,
            chanMap = ChannelMatcher.buildChanMap(channels, result),
            fetchedAt = at,
            fromCache = fromCache
        )
    }

    private fun staleOrError(
        key: String,
        channels: List<Channel>,
        want: ChannelMatcher.Wanted,
        sig: Long,
        now: Long,
        error: String
    ): EpgData {
        val at = cachedAt(key)
        if (at > 0) {
            snapshotOf(key, channels, at, sig, now)?.let { return it.copy(error = error) }
            parseFile(cacheFile(key), channels, want, key, sig, now, at, fromCache = true)
                ?.let { return it.copy(error = error) }
        }
        return EpgData(emptyMap(), List(channels.size) { null }, 0, error = error)
    }

    companion object {
        val NO_URL: String get() = tr("No EPG link in the playlist", "Enginn dagskrárhlekkur í listanum")
        val EMPTY: String get() = tr("The EPG had nothing for these channels", "Dagskráin innihélt ekkert fyrir þessar rásir")

        private const val HOUR_MS = 3_600_000L

        // Hráa XML-skráin er aðeins fallbak; stærri skrám er hent eftir þáttun.
        private const val MAX_RAW_BYTES = 64L * 1024 * 1024
    }
}
