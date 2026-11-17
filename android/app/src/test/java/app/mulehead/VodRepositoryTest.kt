package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.VodKind
import app.mulehead.data.VodRepository
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class VodRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 1_700_000_000_000L
    private var calls = 0
    private val urls = mutableListOf<String>()

    private val xurl = "http://prov.example:8080/get.php?username=user&password=pass&type=m3u_plus"

    private val catsJson = """[{"category_id":"1","category_name":"Kvikmyndir"}]"""

    private val vodJson = """[{"stream_id":101,"name":"Mynd","category_id":"1","container_extension":"mp4"}]"""

    private val infoJson = """
        {"info":{"name":"Nafn"},"episodes":{"1":[{"id":11,"episode_num":1}]}}
    """.trimIndent()

    private fun repo(fail: Boolean = false) = VodRepository(
        dir = tmp.root,
        transport = object : PlaylistRepository.Transport {
            override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                calls++
                urls.add(url)
                if (fail) throw IOException("netið er niðri")
                val body = when {
                    url.contains("get_vod_categories") -> catsJson
                    url.contains("get_series_info") -> infoJson
                    else -> vodJson
                }
                return body.toByteArray(Charsets.UTF_8)
            }
        },
        clock = { now }
    )

    @Test
    fun `sækir myndir og vistar í skyndiminni`() {
        val r = repo()
        val d = r.load(xurl, emptyList(), VodKind.MOVIES)
        assertEquals("xtream", d.source)
        assertEquals(2, calls)
        assertEquals(1, d.categories.size)
        assertEquals(1, d.items.size)
        assertEquals("Mynd", d.items[0].name)
        assertEquals("http://prov.example:8080/movie/user/pass/101.mp4", d.items[0].url)
        assertTrue(urls[0].contains("action=get_vod_categories"))
        assertTrue(urls[1].contains("action=get_vod_streams"))

        // Annað skipti: ekkert net.
        val again = r.load(xurl, emptyList(), VodKind.MOVIES)
        assertEquals(2, calls)
        assertTrue(again.fromCache)
        assertEquals(1, again.items.size)
        assertEquals("Mynd", again.items[0].name)
        assertEquals("http://prov.example:8080/movie/user/pass/101.mp4", again.items[0].url)
    }

    @Test
    fun `force sækir alltaf aftur`() {
        val r = repo()
        r.load(xurl, emptyList(), VodKind.MOVIES)
        r.load(xurl, emptyList(), VodKind.MOVIES, force = true)
        assertEquals(4, calls)
    }

    @Test
    fun `gamalt skyndiminni er endurnýjað`() {
        val r = repo()
        r.load(xurl, emptyList(), VodKind.MOVIES)
        now += 13 * 3_600_000L
        r.load(xurl, emptyList(), VodKind.MOVIES, refreshHours = 12)
        assertEquals(4, calls)
    }

    @Test
    fun `netvilla notar gamla skyndiminnið`() {
        repo().load(xurl, emptyList(), VodKind.MOVIES)
        val d = repo(fail = true).load(xurl, emptyList(), VodKind.MOVIES, force = true)
        assertNotNull(d.error)
        assertTrue(d.error!!.contains("myndir"))
        assertEquals(1, d.items.size)
        assertTrue(d.fromCache)
    }

    @Test
    fun `netvilla án skyndiminnis skilar villu`() {
        val d = repo(fail = true).load(xurl, emptyList(), VodKind.MOVIES)
        assertNotNull(d.error)
        assertTrue(d.items.isEmpty())
    }

    @Test
    fun `m3u listi notar rásirnar og snertir ekki netið`() {
        val channels = listOf(
            Channel("Mynd A", "http://p/movie/1", group = "Kvikmyndir", kind = Channel.Kind.MOVIE)
        )
        val d = repo().load("http://prov.example/list.m3u", channels, VodKind.MOVIES)
        assertEquals("m3u", d.source)
        assertEquals(0, calls)
        assertEquals(1, d.items.size)
        assertEquals("http://p/movie/1", d.items[0].url)
    }

    @Test
    fun `þættir krefjast xtream hlekks`() {
        val e = assertThrows(PlaylistException::class.java) {
            repo().seriesInfo("http://prov.example/list.m3u", "7")
        }
        assertEquals(VodRepository.NOT_XTREAM, e.message)
    }

    @Test
    fun `series info biður um réttan þátt`() {
        val s = repo().seriesInfo(xurl, "7")
        assertTrue(urls.last().contains("action=get_series_info"))
        assertTrue(urls.last().contains("series_id=7"))
        assertEquals("Nafn", s.name)
        assertEquals(1, s.seasons.size)
        assertEquals("http://prov.example:8080/series/user/pass/11.mp4", s.seasons[0].episodes[0].url)
    }

    @Test
    fun `clear eyðir skyndiminni`() {
        val r = repo()
        r.load(xurl, emptyList(), VodKind.MOVIES)
        assertNotNull(r.cached(xurl, VodKind.MOVIES))
        r.clear(VodKind.MOVIES)
        assertNull(r.cached(xurl, VodKind.MOVIES))
    }
}
