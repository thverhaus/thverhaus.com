package app.mulehead

import app.mulehead.data.ChannelGroup
import app.mulehead.data.LoadStep
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.XtreamAuthException
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Xtream-flæðið í PlaylistRepository: player_api.php (innskráning, flokkar,
 * beinar rásir) á undan M3U-varaleiðinni — sama og í Mac.
 */
class XtreamLoadTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val url = "http://prov.example:8080/get.php?username=jon&password=leyni&type=m3u_plus"
    private val pl = Playlist(id = "main", name = "XC", url = url)

    private val login = """{"user_info":{"auth":1,"status":"Active"},"server_info":{}}"""

    private val cats = """
        [{"category_id":"1","category_name":"Íslenskar"},
         {"category_id":"2","category_name":"Sport"},
         {"category_id":"3","category_name":"Tómur"}]
    """.trimIndent()

    private val streams = """
        [{"stream_id":101,"name":"RÚV","category_id":"1","epg_channel_id":"ruv.is",
          "stream_icon":"http://img.example/ruv.png","tv_archive":1,"tv_archive_duration":7},
         {"stream_id":102,"name":"Stöð 2 Sport","category_id":"2","epg_channel_id":"stod2sport.is",
          "stream_icon":"","tv_archive":0,"tv_archive_duration":0},
         {"stream_id":103,"name":"Óþekktur","category_id":"99"}]
    """.trimIndent()

    private val m3u = """
        #EXTM3U
        #EXTINF:-1 group-title="Varaleið",Frá M3U
        http://prov.example/fra-m3u
    """.trimIndent()

    // Gervi-þjónn: get.php getur hangað (eins og stórir listar gera) en
    // player_api.php svarar.
    private class Fake(
        private val login: String,
        private val cats: String,
        private val streams: String,
        private val m3u: String? = null,
        private val hangGetPhp: Boolean = false,
        private val failApi: Boolean = false,
        private val oom: Boolean = false
    ) : PlaylistRepository.Transport {

        val urls = ArrayList<String>()

        override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
            urls.add(url)
            if (oom) throw OutOfMemoryError("fake")
            if (!url.contains("player_api.php")) {
                if (hangGetPhp) {
                    throw PlaylistException("Sóknin tók of langan tíma (5 sek) — þjónninn svarar ekki")
                }
                return (m3u ?: throw PlaylistException("get.php á ekki að vera sótt")).toByteArray()
            }
            if (failApi) throw PlaylistException("HTTP 500 frá prov.example:8080")
            return when {
                url.contains("action=get_live_categories") -> cats.toByteArray()
                url.contains("action=get_live_streams") -> streams.toByteArray()
                else -> login.toByteArray()
            }
        }
    }

    private fun repo(f: PlaylistRepository.Transport, now: Long = 1_700_000_000_000L) =
        PlaylistRepository(dir = tmp.root, transport = f, clock = { now })

    @Test
    fun getPhpHangirEnPlayerApiSvarar() {
        val f = Fake(login, cats, streams, hangGetPhp = true)
        val steps = ArrayList<LoadStep>()
        val data = repo(f).load(pl, onStep = { steps.add(it) })

        // Rásirnar koma — þótt get.php hangi.
        assertEquals(3, data.channels.size)
        assertEquals(
            listOf(
                LoadStep.XTREAM_LOGIN,
                LoadStep.XTREAM_CATS,
                LoadStep.XTREAM_STREAMS,
                LoadStep.LIST_PARSE
            ),
            steps
        )
        assertTrue(f.urls.none { it.contains("/get.php") })
        assertTrue(f.urls.all { it.contains("player_api.php") })
        // VOD/þættir eru aldrei sóttir við ræsingu.
        assertTrue(f.urls.none { it.contains("vod") || it.contains("series") })
    }

    @Test
    fun rasirEruByggdarEinsOgIMac() {
        val data = repo(Fake(login, cats, streams, hangGetPhp = true)).load(pl)

        val ruv = data.channels[0]
        assertEquals("RÚV", ruv.name)
        assertEquals("http://prov.example:8080/live/jon/leyni/101.ts", ruv.url)
        assertEquals("ruv.is", ruv.tvgId)
        assertEquals("RÚV", ruv.tvgName)
        assertEquals("http://img.example/ruv.png", ruv.logo)
        assertEquals("Íslenskar", ruv.group)
        assertEquals("xc", ruv.catchup)
        assertEquals("7", ruv.catchupDays)

        // tv_archive = 0 -> ekkert catchup.
        assertEquals("", data.channels[1].catchup)
        assertEquals("Sport", data.channels[1].group)
        // Óþekktur flokkur.
        assertEquals(PlaylistRepository.NO_GROUP, data.channels[2].group)

        // Dagskráin kemur úr xmltv.php eins og í Mac (nema notandi hafi sett aðra).
        assertEquals(
            "http://prov.example:8080/xmltv.php?username=jon&password=leyni",
            data.epgUrl
        )
    }

    @Test
    fun notandiGeturSettEiginDagskra() {
        val withEpg = pl.copy(epgUrl = "http://mine.example/epg.xml")
        assertEquals("http://mine.example/epg.xml", repo(Fake(login, cats, streams)).load(withEpg).epgUrl)
    }

    @Test
    fun flokkarIRoduThjonustunnar() {
        val data = repo(Fake(login, cats, streams)).load(pl)
        assertEquals(
            listOf(
                ChannelGroup("Íslenskar", 1),
                ChannelGroup("Sport", 1),
                ChannelGroup(PlaylistRepository.NO_GROUP, 1)
            ),
            data.groups
        )
    }

    @Test
    fun lykilordOgNotandiEruKodudISlodum() {
        val odd = Playlist(
            id = "odd",
            name = "odd",
            url = "http://prov.example/get.php?username=jon%20h&password=p%40ss%20w&type=m3u_plus"
        )
        val data = repo(Fake(login, cats, streams)).load(odd)
        assertEquals("http://prov.example/live/jon%20h/p%40ss%20w/101.ts", data.channels[0].url)
    }

    @Test
    fun rongInnskraningGefurSkyraVilluAnVaraleidar() {
        val f = Fake("""{"user_info":{"auth":0}}""", cats, streams, m3u = m3u)
        val e = assertThrows(XtreamAuthException::class.java) { repo(f).load(pl, force = true) }
        assertEquals(PlaylistRepository.AUTH_FAILED, e.message)
        assertFalse(e.message!!.contains("leyni"))
        // Aðeins innskráningin var sótt — engin M3U-varaleið.
        assertEquals(1, f.urls.size)
        assertTrue(f.urls[0].endsWith("player_api.php?username=jon&password=leyni"))
    }

    @Test
    fun engarRasirFaraIVaraleid() {
        val f = Fake(login, cats, "[]", m3u = m3u)
        val data = repo(f).load(pl)
        assertEquals(1, data.channels.size)
        assertEquals("Frá M3U", data.channels[0].name)
        assertTrue(f.urls.any { it.contains("/get.php") })
    }

    @Test
    fun villaIPlayerApiFerIVaraleid() {
        val f = Fake(login, cats, streams, m3u = m3u, failApi = true)
        assertEquals("Frá M3U", repo(f).load(pl).channels[0].name)
    }

    @Test
    fun lykilordLeikurEkkiIVillum() {
        // Bæði player_api og get.php bregðast: skilaboðin mega ekki innihalda lykilorð.
        val f = Fake(login, cats, streams, m3u = "<html>404</html>", failApi = true)
        val e = assertThrows(PlaylistException::class.java) { repo(f).load(pl, force = true) }
        assertEquals(PlaylistRepository.NOT_M3U, e.message)
        assertFalse(e.message!!.contains("leyni"))
    }

    @Test
    fun minnidFulltGefurSkyraVillu() {
        val e = assertThrows(PlaylistException::class.java) {
            repo(Fake(login, cats, streams, oom = true)).load(pl, force = true)
        }
        assertEquals(PlaylistRepository.OOM_MESSAGE, e.message)
    }

    @Test
    fun skyndimyndinErNotudAnNets() {
        val f = Fake(login, cats, streams, hangGetPhp = true)
        val r = repo(f)
        val first = r.load(pl)
        assertEquals(3, f.urls.size)

        val second = r.load(pl)
        assertEquals(3, f.urls.size) // ekkert net
        assertTrue(second.fromCache)
        assertEquals(first.channels.size, second.channels.size)
        // Flokkaröð þjónustunnar er geymd í skyndimyndinni.
        assertEquals(first.groups, second.groups)
        assertEquals(
            "http://prov.example:8080/xmltv.php?username=jon&password=leyni",
            second.epgUrl
        )
    }

    @Test
    fun hraskraAFDiskiErThattudEfSkyndimyndVantar() {
        val f = Fake(login, cats, streams, hangGetPhp = true)
        val r = repo(f)
        r.load(pl)
        val snap = File(tmp.root, "playlists/main.snap")
        assertTrue(snap.exists())
        assertTrue(snap.delete())

        val c = r.cached(pl)
        assertNotNull(c)
        assertEquals(3, c!!.channels.size)
        assertEquals("http://prov.example:8080/live/jon/leyni/101.ts", c.channels[0].url)
        assertEquals(
            listOf(
                ChannelGroup("Íslenskar", 1),
                ChannelGroup("Sport", 1),
                ChannelGroup(PlaylistRepository.NO_GROUP, 1)
            ),
            c.groups
        )
        assertEquals(3, f.urls.size) // aðeins fyrri sókn
        assertTrue(File(tmp.root, "playlists/main.xc").exists())
        // Dagskrárslóðin verður áfram xmltv.php (annars myndi dagskráin hverfa).
        assertEquals(
            "http://prov.example:8080/xmltv.php?username=jon&password=leyni",
            c.epgUrl
        )
    }

    @Test
    fun m3uListiVirkarEinsOgAdur() {
        val plain = Playlist(id = "m3u", name = "M3U", url = "http://prov.example/list.m3u")
        val f = Fake(login, cats, streams, m3u = m3u)
        val steps = ArrayList<LoadStep>()
        val data = repo(f).load(plain, onStep = { steps.add(it) })
        assertEquals("Frá M3U", data.channels[0].name)
        assertEquals(listOf(LoadStep.LIST_FETCH, LoadStep.LIST_PARSE), steps)
        assertEquals(1, f.urls.size)
    }
}


