package app.mulehead

import app.mulehead.data.EpgRepository
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.PlaylistSettings
import app.mulehead.pairing.PairPayload
import app.mulehead.pairing.PlaylistInstaller
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PlaylistInstallerTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val m3u = """
        #EXTM3U
        #EXTINF:-1 group-title="Íslenskar",RÚV
        http://prov.example/ruv
        #EXTINF:-1 group-title="Sport",Sky Sports F1
        http://prov.example/f1
    """.trimIndent()

    private var lastUrl = ""
    private var fail = false

    private class FakeSettings(override var playlist: Playlist? = null) : PlaylistSettings {
        override val refreshHours: Int = 12
        override val userAgent: String = ""
    }

    private val settings = FakeSettings()

    private fun playlists() = PlaylistRepository(
        dir = tmp.root,
        transport = object : PlaylistRepository.Transport {
            override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                lastUrl = url
                if (fail) throw IOException("no net")
                return m3u.toByteArray(Charsets.UTF_8)
            }
        }
    )

    private fun epg() = EpgRepository(tmp.root)

    private fun installer() = PlaylistInstaller(
        settings = settings,
        playlists = playlists(),
        epg = epg()
    )

    @Test
    fun seturInnSlodOgTelurRasir() {
        val r = installer().install(
            PairPayload.Link(name = "Frá síma", url = "http://prov.example/list.m3u", epgUrl = "")
        )
        assertNull(r.error)
        assertEquals(2, r.count)
        assertEquals("Frá síma", settings.playlist!!.name)
        assertEquals("http://prov.example/list.m3u", settings.playlist!!.url)
        assertEquals("http://prov.example/list.m3u", lastUrl)
    }

    @Test
    fun nafnErSottUrSlodEfThadVantar() {
        installer().install(PairPayload.Link(name = "  ", url = "http://prov.example/list.m3u"))
        assertEquals("prov.example", settings.playlist!!.name)
    }

    @Test
    fun saveUrlVistarSlodina() {
        val r = installer().saveUrl("Frá vef", " http://prov.example/list.m3u ", "http://epg.example/g.xml")
        assertEquals(2, r.count)
        assertEquals("Frá vef", settings.playlist!!.name)
        assertEquals("http://prov.example/list.m3u", settings.playlist!!.url)
        assertEquals("http://epg.example/g.xml", settings.playlist!!.epgUrl)
    }

    @Test
    fun xtreamVerdurAdVenjulegriM3uSlod() {
        val r = installer().install(
            PairPayload.XtreamAccount(
                name = "",
                server = "prov.example:8080/",
                username = "jon",
                password = "leyni 1"
            )
        )
        assertEquals(2, r.count)
        assertEquals(
            "http://prov.example:8080/get.php?username=jon&password=leyni%201&type=m3u_plus",
            settings.playlist!!.url
        )
        assertEquals("jon", settings.playlist!!.name)
    }

    @Test
    fun saveXtreamNotarNotandanafnSemNafn() {
        installer().saveXtream(
            name = "  ",
            server = "https://prov.example",
            username = "jon",
            password = "p"
        )
        assertEquals("jon", settings.playlist!!.name)
        assertEquals(
            "https://prov.example/get.php?username=jon&password=p&type=m3u_plus",
            settings.playlist!!.url
        )
    }

    @Test
    fun netvillaSkilarVilluEnSlodinErVistud() {
        fail = true
        val r = installer().install(PairPayload.Link(name = "X", url = "http://prov.example/list.m3u"))
        assertNotNull(r.error)
        assertTrue(r.error!!.contains("Náði ekki í"))
        assertEquals("http://prov.example/list.m3u", settings.playlist!!.url)
    }

    @Test
    fun xtreamInnsetningSaekirBeinarRasirMedPlayerApi() {
        val urls = ArrayList<String>()
        val repo = PlaylistRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                    urls.add(url)
                    return when {
                        url.contains("action=get_live_categories") ->
                            """[{"category_id":"1","category_name":"Íslenskar"}]""".toByteArray()
                        url.contains("action=get_live_streams") ->
                            """[{"stream_id":5,"name":"RÚV","category_id":"1"}]""".toByteArray()
                        url.contains("player_api.php") ->
                            """{"user_info":{"auth":1}}""".toByteArray()
                        else -> throw app.mulehead.data.PlaylistException("get.php má ekki vera sótt")
                    }
                }
            }
        )
        val r = PlaylistInstaller(settings = settings, playlists = repo)
            .saveXtream(name = "X", server = "prov.example:8080", username = "jon", password = "p")

        assertEquals(1, r.count)
        assertNull(r.error)
        assertEquals(
            "http://prov.example:8080/get.php?username=jon&password=p&type=m3u_plus",
            settings.playlist!!.url
        )
        assertTrue(urls.none { it.contains("/get.php") })
        assertEquals(3, urls.size)
    }

    @Test
    fun dagskraErHreinsudThegarSkiptErUmThjonustu() {
        val cache = epg().cacheFile("main")
        cache.parentFile!!.mkdirs()
        cache.writeText("<tv/>")

        installer().install(PairPayload.Link(name = "Nýr", url = "http://nyr.example/list.m3u"))
        assertFalse(cache.exists())
    }

    @Test
    fun dagskraHelstEfSamaSlodErSettInn() {
        val inst = installer()
        inst.install(PairPayload.Link(name = "A", url = "http://prov.example/list.m3u"))
        val cache = epg().cacheFile("main")
        cache.parentFile!!.mkdirs()
        cache.writeText("<tv/>")

        inst.install(PairPayload.Link(name = "A", url = "http://prov.example/list.m3u"))
        assertTrue(cache.exists())
    }
}
