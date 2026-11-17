package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.EpgRepository
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EpgRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 1_700_000_000_000L
    private var calls = 0

    private val url = "http://prov.example/guide.xml"
    private val ruv = Channel(name = "RÚV", url = "http://p/ruv", tvgId = "ruv.is", group = "Íslenskar")
    private val stod2 = Channel(name = "Stöð 2", url = "http://p/stod2", tvgId = "stod2.is", group = "Íslenskar")

    private fun ts(ms: Long): String =
        Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC)
            .format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + " +0000"

    private val xml: String
        get() = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tv>
              <channel id="ruv.is"><display-name>RÚV</display-name></channel>
              <channel id="stod2.is"><display-name>Stöð 2</display-name></channel>
              <programme start="${ts(now - 3_600_000)}" stop="${ts(now + 3_600_000)}" channel="ruv.is">
                <title>Kastljós</title><desc>Fréttaskýringar</desc>
              </programme>
              <programme start="${ts(now + 3_600_000)}" stop="${ts(now + 7_200_000)}" channel="ruv.is">
                <title>Kvöldfréttir</title>
              </programme>
              <programme start="${ts(now - 1_800_000)}" stop="${ts(now + 1_800_000)}" channel="stod2.is">
                <title>Eitthvað</title>
              </programme>
            </tv>
        """.trimIndent()

    private fun repo(response: () -> ByteArray = { xml.toByteArray(Charsets.UTF_8) }) =
        EpgRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                    calls++
                    return response()
                }
            },
            clock = { now }
        )

    private val channels = listOf(ruv, stod2)

    @Test
    fun saekirOgLesDagskra() {
        val d = repo().load(url, channels)
        assertEquals(1, calls)
        assertFalse(d.fromCache)
        assertNull(d.error)
        assertEquals(now, d.fetchedAt)
        assertTrue(d.programmes.containsKey("ruv.is"))
        assertEquals(2, d.programmes["ruv.is"]!!.size)
        assertEquals("Kastljós", d.programmes["ruv.is"]!![0].title)
        assertEquals(listOf("ruv.is", "stod2.is"), d.chanMap)
    }

    @Test
    fun notarSkyndiminniEfFerskt() {
        val r = repo()
        r.load(url, channels)
        val again = r.load(url, channels)
        assertEquals(1, calls)
        assertTrue(again.fromCache)
        assertEquals(2, again.programmes["ruv.is"]!!.size)
    }

    @Test
    fun forceSaekirAftur() {
        val r = repo()
        r.load(url, channels)
        r.load(url, channels, force = true)
        assertEquals(2, calls)
    }

    @Test
    fun gamaltSkyndiminniErEndursott() {
        val r = repo()
        r.load(url, channels)
        now += 13 * 3_600_000L
        val fresh = r.load(url, channels, refreshHours = 12)
        assertEquals(2, calls)
        assertFalse(fresh.fromCache)
    }

    @Test
    fun netVillaNotarGamaltSkyndiminni() {
        var fail = false
        val r = repo { if (fail) throw PlaylistException("HTTP 500 frá prov.example") else xml.toByteArray() }
        r.load(url, channels)
        fail = true
        // refreshHours = 0 þvingar endursókn, sem mistekst -> nota skal gamla skyndiminnið
        val d = r.load(url, channels, refreshHours = 0)
        assertEquals("HTTP 500 frá prov.example", d.error)
        assertTrue(d.fromCache)
        assertTrue(d.programmes.isNotEmpty())
    }

    @Test
    fun netVillaAnSkyndiminnis() {
        val d = repo { throw IOException("Connection timed out") }.load(url, channels)
        assertNotNull(d.error)
        assertTrue(d.error!!.contains("Náði ekki í dagskrá"))
        assertTrue(d.error!!.contains("prov.example"))
        assertTrue(d.programmes.isEmpty())
        assertEquals(2, d.chanMap.size)
        assertNull(d.chanMap[0])
        assertEquals(1, calls)
    }

    @Test
    fun enginnHlekkurGefurSkilabod() {
        val d = repo().load("", channels)
        assertEquals(EpgRepository.NO_URL, d.error)
        assertEquals(0, calls)
        assertEquals(2, d.chanMap.size)
    }

    @Test
    fun chanMapTengirEftirNafniANId() {
        val noIds = listOf(
            Channel(name = "RÚV", url = "http://p/ruv", tvgName = "RÚV"),
            Channel(name = "Stöð 2", url = "http://p/stod2", tvgName = "Stöð 2")
        )
        val d = repo().load(url, noIds)
        assertEquals(listOf("ruv.is", "stod2.is"), d.chanMap)
    }

    // Næsta ræsing les þáttuðu skyndimyndina, ekki XML-skjalið.
    @Test
    fun notarSkyndimyndAnXmlLesturs() {
        val r = repo()
        r.load(url, channels)
        // Skemmi hráu skrána en skiljum .meta eftir: skyndimyndin á að duga.
        r.cacheFile("main").writeText("<tv></tv>")
        val again = r.load(url, channels)
        assertEquals(1, calls)
        assertTrue(again.fromCache)
        assertEquals(2, again.programmes["ruv.is"]!!.size)
        assertEquals(listOf("ruv.is", "stod2.is"), again.chanMap)
    }

    // Breytist rásalistinn passar skyndimyndin ekki og skráin er lesin aftur.
    @Test
    fun skyndimyndOngilidistEfRasumFjolgar() {
        val r = repo()
        r.load(url, listOf(ruv))
        val d = r.load(url, channels)
        assertEquals(1, calls)
        assertTrue(d.programmes.containsKey("stod2.is"))
        assertEquals(2, d.programmes["ruv.is"]!!.size)
    }

    // Skyndimyndin gildir aðeins á meðan glugginn nær yfir núið.
    @Test
    fun skyndimyndOngilidistEfGlugginnErUtunninn() {
        val r = repo()
        r.load(url, channels)
        assertNotNull(r.snapshot(url, channels))
        assertNull(r.snapshot(url, channels, now = now + 47 * 3_600_000L))
    }

    // Slitið niðurhal má ekki skemma þá dagskrá sem fyrir var.
    @Test
    fun hlutadNedurhalSkemmirEkkkiGomluDagskra() {
        val r = repo()
        r.load(url, channels)
        val broken = EpgRepository(
            dir = tmp.root,
            transport = object : PlaylistRepository.Transport {
                override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray = xml.toByteArray()

                override fun getTo(url: String, userAgent: String, timeoutMs: Int, out: java.io.File) {
                    out.writeText("<?xml version=\"1.0\"?><tv><programme ")
                    throw IOException("samband slitnaði")
                }
            },
            clock = { now }
        )
        val d = broken.load(url, channels, refreshHours = 0)
        assertNotNull(d.error)
        assertTrue(d.error!!.contains("samband slitnaði"))
        assertTrue(d.fromCache)
        assertEquals(2, d.programmes["ruv.is"]!!.size)
        assertEquals(1, calls)
    }

    @Test
    fun skrefinBerastTilSkjás() {
        val steps = ArrayList<app.mulehead.data.LoadStep>()
        repo().load(url, channels, onStep = { steps.add(it) })
        assertEquals(
            listOf(app.mulehead.data.LoadStep.EPG_FETCH, app.mulehead.data.LoadStep.EPG_PARSE),
            steps
        )
    }
}
