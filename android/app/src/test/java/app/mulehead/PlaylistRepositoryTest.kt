package app.mulehead

import app.mulehead.data.ChannelGroup
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PlaylistRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 1_700_000_000_000L
    private var calls = 0
    private var lastUrl = ""
    private var lastUa = ""

    private val m3u = """
        #EXTM3U url-tvg="http://epg.example/guide.xml"
        #EXTINF:-1 tvg-id="ruv.is" tvg-name="RÚV" group-title="Íslenskar",RÚV
        http://prov.example/ruv
        #EXTINF:-1 tvg-id="stod2.is" group-title="Íslenskar",Stöð 2
        http://prov.example/stod2
        #EXTINF:-1 group-title="Sport",Sky Sports F1
        http://prov.example/f1
    """.trimIndent()

    private val pl = Playlist(id = "pl1", name = "Test", url = "http://prov.example/list.m3u")

    private fun repo(response: () -> ByteArray = { m3u.toByteArray(Charsets.UTF_8) }) =
        PlaylistRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                    calls++
                    lastUrl = url
                    lastUa = userAgent
                    return response()
                }
            },
            clock = { now }
        )

    private fun gzip(text: String): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }

    @Test
    fun saekirOgLesLista() {
        val r = repo()
        val data = r.load(pl)
        assertEquals(1, calls)
        assertEquals(pl.url, lastUrl)
        assertEquals(PlaylistRepository.DEFAULT_UA, lastUa)
        assertEquals(3, data.channels.size)
        assertEquals("RÚV", data.channels[0].name)
        assertEquals("http://epg.example/guide.xml", data.epgUrl)
        assertEquals(now, data.fetchedAt)
        assertFalse(data.fromCache)
    }

    @Test
    fun flokkarIRodFyrstuBirtingar() {
        val data = repo().load(pl)
        assertEquals(
            listOf(ChannelGroup("Íslenskar", 2), ChannelGroup("Sport", 1)),
            data.groups
        )
    }

    @Test
    fun vistadurListiErLesinnAFNaestaKalli() {
        val r = repo()
        r.load(pl)
        val again = r.load(pl)
        assertEquals(1, calls)
        assertTrue(again.fromCache)
        assertEquals(3, again.channels.size)
        assertEquals(now, again.fetchedAt)
    }

    @Test
    fun forceSaekirAlltaf() {
        val r = repo()
        r.load(pl)
        r.load(pl, force = true)
        assertEquals(2, calls)
    }

    @Test
    fun gamallListiErSaekTurAdNyu() {
        val r = repo()
        r.load(pl)
        now += 13 * 3_600_000L
        val fresh = r.load(pl, refreshHours = 12)
        assertEquals(2, calls)
        assertFalse(fresh.fromCache)
        assertEquals(now, fresh.fetchedAt)
    }

    @Test
    fun cachedVirkarAnNets() {
        val r = repo()
        r.load(pl)
        val c = r.cached(pl)
        assertNotNull(c)
        assertTrue(c!!.fromCache)
        assertEquals(3, c.channels.size)
        assertEquals(1, calls)
    }

    @Test
    fun cachedSkilarNullEfEkkertErVistad() {
        assertNull(repo().cached(pl))
    }

    @Test
    fun gzipSvarErAfthjappad() {
        val data = repo { gzip(m3u) }.load(pl)
        assertEquals(3, data.channels.size)
    }

    @Test
    fun ekkiM3uGefurSkilabod() {
        val e = assertThrows(PlaylistException::class.java) {
            repo { "<html>404</html>".toByteArray() }.load(pl)
        }
        assertEquals(PlaylistRepository.NOT_M3U, e.message)
    }

    @Test
    fun netVillaSegirVefthjon() {
        val e = assertThrows(PlaylistException::class.java) {
            repo { throw IOException("Connection timed out") }.load(pl)
        }
        assertTrue(e.message!!.contains("prov.example"))
        assertTrue(e.message!!.contains("Connection timed out"))
    }

    @Test
    fun epgUrlParamVinnurYfirHausinn() {
        val withEpg = pl.copy(epgUrl = "http://mine.example/epg.xml")
        assertEquals("http://mine.example/epg.xml", repo().load(withEpg).epgUrl)
    }

    @Test
    fun clearFjarlaegirSkyndiminni() {
        val r = repo()
        r.load(pl)
        r.clear(pl)
        assertNull(r.cached(pl))
        assertFalse(r.cacheFile(pl).exists())
    }

    @Test
    fun idMedOheppilegumStofumErHreinsad() {
        val odd = pl.copy(id = "a/b:c d")
        assertEquals("a_b_c_d.m3u", repo().cacheFile(odd).name)
    }

    // Upphlaðin skrá úr vefstjórnborðinu er lesin beint af diski (file:// slóð).
    @Test
    fun fileSlodErLesinAfDiski() {
        val f = tmp.newFile("upphalad.m3u")
        f.writeText(m3u)
        val r = PlaylistRepository(dir = tmp.root)
        val up = Playlist(id = "up", name = "Upp", url = f.toURI().toString())
        assertEquals(3, r.load(up, force = true).channels.size)
    }

    // Skrá sem er ekki til gefur skýra villu í stað netsóknar.
    @Test
    fun fileSlodSemFannstEkkiGefurVillu() {
        val r = PlaylistRepository(dir = tmp.root)
        val missing = Playlist(id = "x", name = "X", url = "file://" + tmp.root.path + "/ekki-til.m3u")
        val e = assertThrows(PlaylistException::class.java) { r.load(missing, force = true) }
        assertTrue(e.message!!.contains("Skráin fannst ekki"))
    }

    // Listinn er sóttur beint í skrá (getTo), ekki sem allt fylki í minni.
    @Test
    fun listinnErStreymdurBeintISkra() {
        var streamed = 0
        var buffered = 0
        val r = PlaylistRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                    buffered++
                    return m3u.toByteArray()
                }

                override fun getTo(url: String, userAgent: String, timeoutMs: Int, out: java.io.File) {
                    streamed++
                    out.writeBytes(m3u.toByteArray())
                }
            },
            clock = { now }
        )
        val d = r.load(pl, force = true)
        assertEquals(3, d.channels.size)
        assertEquals(1, streamed)
        assertEquals(0, buffered)
        assertTrue(r.cacheFile(pl).isFile)
    }

    // Næsta ræsing þarf ekki að lesa M3U-skrána: skyndimyndin dugar.
    @Test
    fun notarSkyndimyndAnThessAdLesaM3u() {
        val r = repo()
        r.load(pl)
        r.cacheFile(pl).writeText("<html>ekki m3u</html>")
        val c = r.cached(pl)
        assertNotNull(c)
        assertEquals(3, c!!.channels.size)
        assertEquals("Stöð 2", c.channels[1].name)
        assertEquals(1, calls)
    }

    // Þegar listinn er endursóttur verður skyndimyndin að víkja.
    @Test
    fun skyndimyndOngilidistThegarListiErEndursottur() {
        var body = m3u
        val r = repo { body.toByteArray() }
        r.load(pl)
        body = "#EXTM3U\n#EXTINF:-1,Ný rás\nhttp://prov.example/ny\n"
        r.load(pl, force = true)
        val c = r.cached(pl)!!
        assertEquals(1, c.channels.size)
        assertEquals("Ný rás", c.channels[0].name)
    }

    // Slitið niðurhal má ekki skemma þann lista sem fyrir var.
    @Test
    fun slitidNedurhalSkemmirEkkkiGamlaSkra() {
        val r = repo()
        r.load(pl)
        val broken = PlaylistRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray = m3u.toByteArray()

                override fun getTo(url: String, userAgent: String, timeoutMs: Int, out: java.io.File) {
                    out.writeText("#EXTM3U\n#EXTINF:-1,Ný\nhttp://prov.example/ny\n")
                    throw IOException("samband slitnaði")
                }
            },
            clock = { now }
        )
        val e = assertThrows(PlaylistException::class.java) { broken.load(pl, force = true) }
        assertTrue(e.message!!.contains("samband slitnaði"))
        val still = broken.cached(pl)
        assertNotNull(still)
        assertEquals(3, still!!.channels.size)
        assertEquals("RÚV", still.channels[0].name)
        assertFalse(java.io.File(tmp.root, "playlists/pl1.m3u.tmp").exists())
    }

    @Test
    fun skrefinBerastTilSkjás() {
        val steps = ArrayList<app.mulehead.data.LoadStep>()
        repo().load(pl, onStep = { steps.add(it) })
        assertEquals(
            listOf(app.mulehead.data.LoadStep.LIST_FETCH, app.mulehead.data.LoadStep.LIST_PARSE),
            steps
        )
    }

    // Heildartíminn (ekki bara hver lestur) á að skila skýrum skilaboðum.
    @Test
    fun heildartimiBerstTilNotanda() {
        val r = PlaylistRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray = ByteArray(0)

                override fun getTo(url: String, userAgent: String, timeoutMs: Int, out: java.io.File) {
                    throw PlaylistException(app.mulehead.data.timeoutText(timeoutMs))
                }
            },
            clock = { now }
        )
        val e = assertThrows(PlaylistException::class.java) { r.load(pl, timeoutMs = 5000) }
        assertTrue(e.message!!.contains("tók of langan tíma"))
        assertTrue(e.message!!.contains("5 sek"))
    }
}
