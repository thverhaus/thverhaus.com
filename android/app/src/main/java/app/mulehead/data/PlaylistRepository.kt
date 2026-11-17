package app.mulehead.data

import app.mulehead.tr

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

// Vistaður playlisti notandans: hlekkur + valfrí dagskrárslóð.
data class Playlist(
    val id: String,
    val name: String,
    val url: String,
    val epgUrl: String = ""
)

// Einn flokkur í rásalista (t.d. "Íslenskar rásir") með fjölda rása.
data class ChannelGroup(val name: String, val count: Int)

// Útkoma úr PlaylistRepository: rásir, flokkar og hvenær listinn var sóttur.
data class PlaylistData(
    val channels: List<Channel>,
    val groups: List<ChannelGroup>,
    val epgUrl: String,
    val fetchedAt: Long,
    val fromCache: Boolean = false
)

// Villa sem á að birtast notandanum beint (textinn er á íslensku).
open class PlaylistException(message: String) : Exception(message)

/**
 * Sækir M3U-lista úr hlekk og geymir hann á disk svo appið geti byrjað án nets.
 * Þýðing á httpGet()/loadM3U() í reference/mac-electron/playlists.js og
 * refreshPlaylist() í main.js.
 *
 * Allt er blokkerandi — kallaðu úr bakgrunnsþræði (Dispatchers.IO í skjánum).
 */
class PlaylistRepository(
    private val dir: File,
    private val transport: Transport = HttpTransport(),
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    // Sækjari sem hægt er að skipta út í prófum.
    interface Transport {
        fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray

        /**
         * Skrifar svarinu beint í [out] í stað þess að hlaða því öllu í minni.
         * Stórar M3U- og XMLTV-skrár eiga alltaf að fara þessa leið.
         * Sjálfgefið fellur á [get] (fyrir litlar skrár og próf).
         */
        fun getTo(url: String, userAgent: String, timeoutMs: Int, out: File) {
            out.writeBytes(get(url, userAgent, timeoutMs))
        }
    }

    private val plDir = File(dir, "playlists")

    // Rásir úr skyndiminni, eða null ef ekkert er vistað. Snertir ekki netið.
    // Notar þáttaða skyndimynd ef hún er til, svo stór skrá þurfi ekki að vera
    // lesin aftur við hverja ræsingu.
    fun cached(p: Playlist): PlaylistData? {
        val creds = Xtream.fromUrl(p.url)
        val kind = cachedKind(p, creds != null) ?: return null
        val raw = rawFile(p, kind)
        if (!raw.isFile) return null
        val at = cachedAt(p, raw)

        val snap = Snapshots.readChannels(snapFile(p), at)
        if (snap != null && snap.channels.isNotEmpty()) {
            return dataOf(snap.channels, snap.groupOrder, snap.epgUrl.ifEmpty { p.epgUrl }, at)
        }

        // Engin skyndimynd: lesa hráa skrána (M3U eða Xtream JSON) — ekki netið.
        val parsed = try {
            if (kind == KIND_XC) {
                if (creds == null) return null
                parseXtreamFiles(p, creds)
            } else {
                val m3u = M3uParser.parseFile(raw)
                if (m3u.channels.isEmpty()) return null
                XtreamResult(m3u.channels, emptyList(), p.epgUrl.ifEmpty { m3u.epgUrl })
            }
        } catch (e: Exception) {
            return null
        } catch (e: OutOfMemoryError) {
            return null
        }
        if (parsed.channels.isEmpty()) return null
        Snapshots.writeChannels(
            snapFile(p), at,
            Snapshots.Channels(parsed.epgUrl, parsed.channels, parsed.groupOrder)
        )
        return dataOf(parsed.channels, parsed.groupOrder, parsed.epgUrl, at)
    }

    private fun dataOf(
        channels: List<Channel>,
        order: List<String>,
        epgUrl: String,
        at: Long
    ) = PlaylistData(
        channels = channels,
        groups = groupsOf(channels, order),
        epgUrl = epgUrl,
        fetchedAt = at,
        fromCache = true
    )

    /**
     * Skilar listanum: úr skyndiminni ef hann er nýlegri en refreshHours, annars
     * er hann sóttur. force = true sækir alltaf. Skilar PlaylistException ef
     * eitthvað fer úrskeiðis (slóð, net, ekki M3U).
     *
     * Skráin er sótt í .tmp og þáttuð línu fyrir línu; aðeins er skipt um
     * skrá þegar allt hefur gengið upp. Gamli listinn eyðileggst því aldrei
     * þótt sambandið slitni í miðjum niðurhali.
     */
    fun load(
        p: Playlist,
        force: Boolean = false,
        refreshHours: Int = 12,
        timeoutMs: Int = 180_000,
        userAgent: String = "",
        onStep: (LoadStep) -> Unit = {}
    ): PlaylistData {
        if (!force) {
            val cachedData = cached(p)
            if (cachedData != null) {
                val ageH = (clock() - cachedData.fetchedAt) / HOUR_MS.toDouble()
                if (ageH < refreshHours) return cachedData
            }
        }

        plDir.mkdirs()

        // Xtream-hlekkur (get.php/player_api.php með username og password): sótt
        // með player_api.php — aðeins beinar rásir, ekki allur M3U-listinn með
        // myndum og þáttum sem sumar þjónustur eru mínútur að búa til.
        val creds = Xtream.fromUrl(p.url)
        if (creds != null) {
            try {
                return loadXtream(p, creds, timeoutMs, userAgent, onStep)
            } catch (e: XtreamAuthException) {
                throw e
            } catch (e: OutOfMemoryError) {
                throw PlaylistException(OOM_MESSAGE)
            } catch (e: Exception) {
                // Varaleið eins og í Mac: M3U-skráin sjálf (t.d. get.php).
            }
        }
        return loadM3u(p, timeoutMs, userAgent, onStep)
    }

    // M3U-varaleiðin: sækir skrána (get.php eða venjulegan lista) og þáttar.
    private fun loadM3u(
        p: Playlist,
        timeoutMs: Int,
        userAgent: String,
        onStep: (LoadStep) -> Unit
    ): PlaylistData {
        val tmp = File(plDir, safe(p.id) + ".m3u.tmp")
        onStep(LoadStep.LIST_FETCH)
        try {
            transport.getTo(p.url, userAgent.ifEmpty { DEFAULT_UA }, timeoutMs, tmp)
        } catch (e: PlaylistException) {
            tmp.delete()
            throw e
        } catch (e: IOException) {
            tmp.delete()
            throw PlaylistException(tr("Couldn't reach ${hostOf(p.url)}: ${e.message ?: tr("unknown error", "óþekkt villa")}", "Náði ekki í ${hostOf(p.url)}: ${e.message ?: tr("unknown error", "óþekkt villa")}"))
        } catch (e: OutOfMemoryError) {
            tmp.delete()
            throw PlaylistException(OOM_MESSAGE)
        }

        onStep(LoadStep.LIST_PARSE)
        val parsed = try {
            M3uParser.parseFile(tmp)
        } catch (e: Exception) {
            tmp.delete()
            throw PlaylistException(tr("Couldn't read the list: ${e.message ?: tr("unknown error", "óþekkt villa")}", "Gat ekki lesið listann: ${e.message ?: tr("unknown error", "óþekkt villa")}"))
        } catch (e: OutOfMemoryError) {
            tmp.delete()
            throw PlaylistException(OOM_MESSAGE)
        }
        if (!parsed.hasExtinf && !parsed.hasUrlLine) {
            tmp.delete()
            throw PlaylistException(NOT_M3U)
        }

        moveInto(tmp, cacheFile(p))
        // Gömlum Xtream-skrám af sama lista er hent — þær eiga ekki við lengur.
        xcFile(p).delete()
        catsFile(p).delete()

        val at = clock()
        writeMeta(p, at, KIND_M3U)
        val epgUrl = p.epgUrl.ifEmpty { parsed.epgUrl }
        Snapshots.writeChannels(
            snapFile(p), at,
            Snapshots.Channels(epgUrl, parsed.channels, emptyList())
        )
        return PlaylistData(
            channels = parsed.channels,
            groups = groupsOf(parsed.channels),
            epgUrl = epgUrl,
            fetchedAt = at,
            fromCache = false
        )
    }

    /**
     * Xtream-flæðið (sama og loadXtream() í Mac):
     *   1. player_api.php               — innskráning (user_info.auth)
     *   2. …&action=get_live_categories — flokkar í röð þjónustunnar
     *   3. …&action=get_live_streams    — beinar rásir (streymt á disk og lesið
     *                                     atriði fyrir atriði)
     *
     * Niðurstaðan er vistuð sem skyndimynd, svo næsta ræsing þurfi ekkert net.
     * XtreamAuthException þýðir ranga innskráningu (þá á ekki að fara
     * M3U-varaleiðina); allar aðrar villur og 0 rásir fara í varaleiðina.
     */
    private fun loadXtream(
        p: Playlist,
        c: XtreamCreds,
        timeoutMs: Int,
        userAgent: String,
        onStep: (LoadStep) -> Unit
    ): PlaylistData {
        val base = safe(p.id)
        val loginTmp = File(plDir, "$base.xc-login.tmp")
        val catsTmp = File(plDir, "$base.xc-cats.tmp")
        val streamsTmp = File(plDir, "$base.xc.tmp")
        val ua = userAgent.ifEmpty { DEFAULT_UA }

        // Eitt heildartímamark fyrir allar þrjár sóknirnar (ekki þrisvar sinnum).
        val deadline = clock() + timeoutMs
        fun left(): Int {
            val ms = deadline - clock()
            if (ms <= 0) throw PlaylistException(timeoutText(timeoutMs))
            return ms.toInt()
        }

        try {
            onStep(LoadStep.XTREAM_LOGIN)
            transport.getTo(c.apiUrl(), ua, left(), loginTmp)
            val info = try {
                Json.parse(JsonStream.readText(loginTmp))
            } catch (e: JsonException) {
                throw PlaylistException(tr("Unexpected response from ${hostOf(c.server)} — is the link right?", "Óvænt svar frá ${hostOf(c.server)} — er slóðin rétt?"))
            }
            if (!Xtream.authOk(info)) throw XtreamAuthException(AUTH_FAILED)

            onStep(LoadStep.XTREAM_CATS)
            transport.getTo(c.apiUrl("get_live_categories"), ua, left(), catsTmp)
            val cats = readCategories(catsTmp)

            onStep(LoadStep.XTREAM_STREAMS)
            transport.getTo(c.apiUrl("get_live_streams"), ua, left(), streamsTmp)

            onStep(LoadStep.LIST_PARSE)
            val res = buildChannels(c, streamsTmp, cats)
            if (res.channels.isEmpty()) throw PlaylistException(EMPTY_XTREAM)

            // Allt gekk: setja skrárnar á sinn stað (og henda gömlu M3U).
            moveInto(streamsTmp, xcFile(p))
            moveInto(catsTmp, catsFile(p))
            cacheFile(p).delete()

            val at = clock()
            writeMeta(p, at, KIND_XC)
            val epgUrl = p.epgUrl.ifEmpty { c.liveEpgUrl }
            Snapshots.writeChannels(
                snapFile(p), at,
                Snapshots.Channels(epgUrl, res.channels, res.groupOrder)
            )
            return PlaylistData(
                channels = res.channels,
                groups = groupsOf(res.channels, res.groupOrder),
                epgUrl = epgUrl,
                fetchedAt = at,
                fromCache = false
            )
        } finally {
            loginTmp.delete()
            catsTmp.delete()
            streamsTmp.delete()
        }
    }

    // Flokkar úr get_live_categories: id -> nafn, í sömu röð og þjónustan sendir.
    private fun readCategories(f: File): Cats {
        val ids = LinkedHashMap<String, String>()
        val ok = JsonStream.eachItem(f) { v ->
            val o = Json.obj(v)
            val name = Json.str(o["category_name"]).trim()
            if (name.isNotEmpty()) ids[Json.str(o["category_id"]).trim()] = name
        }
        if (!ok) throw PlaylistException(tr("Unexpected response from the provider (categories)", "Óvænt svar frá þjónustunni (flokkar)"))
        return Cats(ids, ids.values.toList())
    }

    // Byggir rásirnar úr get_live_streams — atriði fyrir atriði, án þess að
    // lesa allt svarið inn í minni.
    private fun buildChannels(c: XtreamCreds, f: File, cats: Cats): XtreamResult {
        val list = ArrayList<Channel>()
        val ok = JsonStream.eachItem(f) { v ->
            val o = Json.obj(v)
            val id = Json.str(o["stream_id"]).trim()
            if (id.isNotEmpty()) {
                val name = Json.str(o["name"]).trim().ifEmpty { NO_NAME }
                list.add(
                    Channel(
                        name = name,
                        url = c.liveUrl(id),
                        tvgId = Json.str(o["epg_channel_id"]).trim(),
                        tvgName = name,
                        logo = Json.str(o["stream_icon"]).trim(),
                        group = cats.ids[Json.str(o["category_id"]).trim()] ?: NO_GROUP,
                        kind = Channel.Kind.LIVE,
                        catchup = if (Xtream.truthy(o["tv_archive"])) "xc" else "",
                        catchupDays = Json.str(o["tv_archive_duration"]).trim()
                    )
                )
            }
        }
        if (!ok) throw PlaylistException(tr("Unexpected response from the provider (channels)", "Óvænt svar frá þjónustunni (rásir)"))
        return XtreamResult(list, cats.order)
    }

    // Sama þáttun úr vistuðum skrám (án nets) — notuð ef skyndimynd vantar.
    private fun parseXtreamFiles(p: Playlist, c: XtreamCreds): XtreamResult {
        val cats = if (catsFile(p).isFile) {
            readCategories(catsFile(p))
        } else {
            Cats(emptyMap(), emptyList())
        }
        return buildChannels(c, xcFile(p), cats)
            .copy(epgUrl = p.epgUrl.ifEmpty { c.liveEpgUrl })
    }

    // Eyðir skyndiminni þessa lista.
    fun clear(p: Playlist) {
        cacheFile(p).delete()
        metaFile(p).delete()
        snapFile(p).delete()
        xcFile(p).delete()
        catsFile(p).delete()
        val base = safe(p.id)
        File(plDir, "$base.m3u.tmp").delete()
        File(plDir, "$base.xc.tmp").delete()
        File(plDir, "$base.xc-cats.tmp").delete()
        File(plDir, "$base.xc-login.tmp").delete()
    }

    fun cacheFile(p: Playlist): File = File(plDir, safe(p.id) + ".m3u")

    // Hrátt get_live_streams-svar (Xtream) og flokkarnir sem það vísar í.
    internal fun xcFile(p: Playlist): File = File(plDir, safe(p.id) + ".xc")

    internal fun catsFile(p: Playlist): File = File(plDir, safe(p.id) + ".xc-cats")

    private fun metaFile(p: Playlist): File = File(plDir, safe(p.id) + ".meta")

    private fun snapFile(p: Playlist): File = File(plDir, safe(p.id) + ".snap")

    private fun rawFile(p: Playlist, kind: String): File =
        if (kind == KIND_XC) xcFile(p) else cacheFile(p)

    /**
     * Hvers konar skyndiminni á við hlekkinn núna (KIND_M3U eða KIND_XC), eða
     * null ef ekkert er vistað fyrir hann. Gamalt meta (aðeins tími) gildir sem
     * M3U — það var eina tegundin þá.
     */
    private fun cachedKind(p: Playlist, xtream: Boolean): String? {
        val meta = try {
            metaFile(p).readText()
        } catch (e: Exception) {
            ""
        }
        val lines = meta.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
        val kind = lines.getOrNull(1).orEmpty().ifEmpty {
            when {
                cacheFile(p).isFile -> KIND_M3U
                xcFile(p).isFile -> KIND_XC
                else -> return null
            }
        }
        val want = if (xtream) KIND_XC else KIND_M3U
        return if (kind == want) kind else null
    }

    private fun cachedAt(p: Playlist, raw: File): Long {
        val meta = try {
            metaFile(p).readText()
        } catch (e: Exception) {
            ""
        }
        val at = meta.substringBefore('\n').trim().toLongOrNull()
        return at ?: raw.lastModified()
    }

    private fun writeMeta(p: Playlist, at: Long, kind: String) {
        try {
            metaFile(p).writeText("$at\n$kind")
        } catch (e: IOException) {
            // Ekki banvænt: þá er lastModified() notað í staðinn.
        }
    }

    // Skiptir um skrá (tmp -> endanleg); afrit ef rename virkar ekki.
    private fun moveInto(from: File, to: File) {
        if (from.renameTo(to)) return
        to.delete()
        if (from.renameTo(to)) return
        from.copyTo(to, overwrite = true)
        from.delete()
    }

    companion object {
        // Sama og í Mac.
        const val DEFAULT_UA = "VLC/3.0.20 LibVLC/3.0.20"
        val NOT_M3U: String get() = tr("This doesn't look like an M3U playlist", "Þetta lítur ekki út eins og M3U playlist")
        val OOM_MESSAGE: String get() = tr("Out of memory — the file is too large for this device", "Minnið er fullt — skráin er of stór fyrir þetta tæki")
        val AUTH_FAILED: String get() = tr("Login failed – check username and password", "Innskráning tókst ekki – athugaðu notandanafn og lykilorð")
        val EMPTY_XTREAM: String get() = tr("The provider returned no live channels", "Þjónustan skilaði engum beinum rásum")
        val NO_GROUP: String get() = tr("Uncategorized", "Án flokks")
        val NO_NAME: String get() = tr("Channel", "Rás")

        // Tegund skyndiminnis (sjá cachedKind).
        internal const val KIND_M3U = "m3u"
        internal const val KIND_XC = "xc"

        private const val HOUR_MS = 3_600_000L
        private val SAFE_RE = Regex("[^A-Za-z0-9_-]")

        /**
         * Rásir -> flokkar með fjölda. Ef [order] er gefið (Xtream) gildir röð
         * þjónustunnar; flokkar án rása eru felldir út (eins og í Mac). Annars
         * gildir röð fyrstu birtingar.
         */
        fun groupsOf(channels: List<Channel>, order: List<String> = emptyList()): List<ChannelGroup> {
            val counts = LinkedHashMap<String, Int>()
            for (g in order) counts[g] = 0
            for (c in channels) counts[c.group] = (counts[c.group] ?: 0) + 1
            return counts.filterValues { it > 0 }.map { ChannelGroup(it.key, it.value) }
        }

        internal fun safe(id: String): String = SAFE_RE.replace(id, "_")
    }
}

// Xtream-þjónusta með röngu notandanafni/lykilorði: þá er engin varaleið.
class XtreamAuthException(message: String) : PlaylistException(message)

// Flokkar Xtream: id -> nafn og röðin sem þjónustan sendir.
internal data class Cats(val ids: Map<String, String>, val order: List<String>)

// Útkoma úr Xtream-þáttun (rásir, flokkaröð og dagskrárhlekkur).
internal data class XtreamResult(
    val channels: List<Channel>,
    val groupOrder: List<String>,
    val epgUrl: String = ""
)


// Skilaboð þegar heildartíminn rennur út (ekki bara einn lestur).
internal fun timeoutText(timeoutMs: Int): String =
    tr("The request took too long (${(timeoutMs / 1000).coerceAtLeast(1)} s) — the server is not responding", "Sóknin tók of langan tíma (${(timeoutMs / 1000).coerceAtLeast(1)} sek) — þjónninn svarar ekki")

// Sækir yfir http/https með sama User-Agent og Mac-útgáfan.
// open svo próf geti skipt út sambandinu (sjá HttpRedirectTest).
open class HttpTransport : PlaylistRepository.Transport {

    override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
        // Upphlaðin skrá (vefstjórnborðið vistar .m3u á disk og notar file://…).
        if (url.startsWith("file:", ignoreCase = true)) {
            val f = localFile(url)
            return try {
                f.readBytes()
            } catch (e: IOException) {
                throw PlaylistException(tr("Couldn't read the file: ${e.message ?: f.name}", "Gat ekki lesið skrána: ${e.message ?: f.name}"))
            }
        }
        val out = ByteArrayOutputStream()
        try {
            stream(url, userAgent, timeoutMs) { inp -> inp.copyTo(out, CHUNK) }
        } catch (e: OutOfMemoryError) {
            throw PlaylistException(PlaylistRepository.OOM_MESSAGE)
        }
        return out.toByteArray()
    }

    /**
     * Streymir svarinu í skrá. Heildartíminn er hafður í gildi með vaktþræði
     * sem lokar sambandinu þegar hann rennur út — readTimeout einn og sér
     * endurnýjast við hvern lestur, svo hægfara þjónn gæti hangið að eilífu.
     */
    override fun getTo(url: String, userAgent: String, timeoutMs: Int, out: File) {
        if (url.startsWith("file:", ignoreCase = true)) {
            val src = localFile(url)
            try {
                src.inputStream().use { inp ->
                    out.outputStream().use { o -> inp.copyTo(o, CHUNK) }
                }
            } catch (e: IOException) {
                out.delete()
                throw PlaylistException(tr("Couldn't read the file: ${e.message ?: src.name}", "Gat ekki lesið skrána: ${e.message ?: src.name}"))
            }
            return
        }

        try {
            out.outputStream().use { o ->
                stream(url, userAgent, timeoutMs) { inp -> inp.copyTo(o, CHUNK) }
            }
        } catch (e: PlaylistException) {
            out.delete()
            throw e
        } catch (e: IOException) {
            out.delete()
            throw PlaylistException(tr("Couldn't reach ${hostOf(url)}: ${e.message ?: tr("unknown error", "óþekkt villa")}", "Náði ekki í ${hostOf(url)}: ${e.message ?: tr("unknown error", "óþekkt villa")}"))
        } catch (e: OutOfMemoryError) {
            out.delete()
            throw PlaylistException(PlaylistRepository.OOM_MESSAGE)
        }
    }

    private fun localFile(url: String): File {
        val f = try {
            File(URI(url))
        } catch (e: Exception) {
            // Slóðin getur innihaldið lykilorð — það má aldrei birtast í villu.
            throw PlaylistException(tr("The link is not valid", "Slóðin er ekki gild"))
        }
        if (!f.isFile) throw PlaylistException(tr("File not found: ${f.name}", "Skráin fannst ekki: ${f.name}"))
        return f
    }

    internal open fun open(url: String): HttpURLConnection {
        val u = try {
            URI(url).toURL()
        } catch (e: Exception) {
            throw PlaylistException(tr("The link is not valid", "Slóðin er ekki gild"))
        }
        val c = u.openConnection()
        return c as? HttpURLConnection
            ?: throw PlaylistException(tr("Only http:// and https:// links can be loaded", "Aðeins er hægt að sækja http:// og https:// slóðir"))
    }

    /**
     * Sækir [url] og lætur [sink] lesa svarið.
     *
     * Tilvísanir (3xx) eru fylgt handvirkt: HttpURLConnection fylgir ekki
     * tilvísun milli http og https, en Mac-útgáfan gerir það og margir þjónar
     * vísa http -> https. Hámark er [MAX_REDIRECTS] skref.
     *
     * Heildartíminn (ekki bara hver lestur) er hafður í gildi með vaktþræði
     * sem lokar sambandinu þegar hann rennur út.
     */
    private fun stream(url: String, userAgent: String, timeoutMs: Int, sink: (InputStream) -> Unit) {
        val deadline = System.currentTimeMillis() + timeoutMs
        val timedOut = AtomicBoolean(false)
        val current = AtomicReference<HttpURLConnection?>(null)
        val watchdog = Thread {
            try {
                val left = deadline - System.currentTimeMillis()
                if (left > 0) Thread.sleep(left)
                timedOut.set(true)
                // Lokar sambandinu undir lestrinum, svo hann vakni strax.
                try {
                    current.get()?.disconnect()
                } catch (e: Exception) {
                    // ekkert
                }
            } catch (e: InterruptedException) {
                // Venjulega lokið: sóknin kláraðist fyrir tímann.
            }
        }
        watchdog.isDaemon = true
        watchdog.start()
        try {
            var target = url
            var hops = 0
            while (true) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) throw PlaylistException(timeoutText(timeoutMs))
                val conn = open(target)
                current.set(conn)
                try {
                    conn.connectTimeout = left.toInt()
                    conn.readTimeout = left.toInt()
                    conn.instanceFollowRedirects = false
                    conn.setRequestProperty("User-Agent", userAgent)
                    conn.setRequestProperty("Accept", "*/*")
                    val code = conn.responseCode
                    if (code in REDIRECT_CODES) {
                        val loc = conn.getHeaderField("Location")
                            ?: throw PlaylistException(tr("HTTP $code from ${hostOf(target)} without a redirect", "HTTP $code frá ${hostOf(target)} án tilvísunar"))
                        hops++
                        if (hops > MAX_REDIRECTS) {
                            throw PlaylistException(
                                tr("Too many redirects (over $MAX_REDIRECTS) from ${hostOf(url)}", "Of margar tilvísanir (yfir $MAX_REDIRECTS) frá ${hostOf(url)}")
                            )
                        }
                        // Ný slóð getur verið á öðru sniði (http -> https).
                        target = resolveRedirect(target, loc)
                        continue
                    }
                    if (code !in 200..299) {
                        throw PlaylistException(tr("HTTP $code from ${hostOf(target)}", "HTTP $code frá ${hostOf(target)}"))
                    }
                    conn.inputStream.use(sink)
                    return
                } finally {
                    current.set(null)
                    conn.disconnect()
                }
            }
        } catch (e: IOException) {
            if (timedOut.get()) throw PlaylistException(timeoutText(timeoutMs))
            throw e
        } finally {
            watchdog.interrupt()
        }
    }

    private companion object {
        const val CHUNK = 64 * 1024
        const val MAX_REDIRECTS = 5
        val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
    }
}

/**
 * Ný slóð úr tilvísun ([location]), leyst miðað við [base]. Styður afstæðar
 * slóðir (`/x`, `x`, `//host/x`) og aðra slóðategund (http <-> https).
 */
internal fun resolveRedirect(base: String, location: String): String {
    val loc = location.trim()
    if (loc.isEmpty()) throw PlaylistException(tr("Redirect is missing a location", "Tilvísun vantar slóð"))
    return try {
        URI(base).resolve(loc).toString()
    } catch (e: Exception) {
        throw PlaylistException(tr("The redirect is not valid", "Tilvísunin er ekki gild"))
    }
}


// Nafn vefþjóns úr slóð — notað í villuskilaboðum.
internal fun hostOf(url: String): String = try {
    URI(url).host ?: url
} catch (e: Exception) {
    url
}
