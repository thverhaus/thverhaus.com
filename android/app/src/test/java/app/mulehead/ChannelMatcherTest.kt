package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.ChannelMatcher
import app.mulehead.data.Programme
import app.mulehead.data.XmltvResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelMatcherTest {

    private val h = 3_600_000L

    // 2024-01-01 12:00:00 UTC
    private val t0 = 1704110400000L

    private fun ch(
        name: String,
        tvgId: String = "",
        tvgName: String = ""
    ) = Channel(name = name, url = "http://localhost/$name", tvgId = tvgId, tvgName = tvgName)

    private fun epg(
        programmes: Map<String, List<Programme>> = emptyMap(),
        nameToId: Map<String, String> = emptyMap(),
        loose: Map<String, String> = emptyMap()
    ) = XmltvResult(programmes, nameToId, loose)

    // ---------- buildChanMap ----------

    @Test
    fun tvgIdSemErTilVinnur() {
        val e = epg(programmes = mapOf("ruv.is" to emptyList()))
        val map = ChannelMatcher.buildChanMap(listOf(ch("RÚV", tvgId = "ruv.is")), e)
        assertEquals(listOf("ruv.is"), map)
    }

    @Test
    fun tvgIdErEkkiStafhvasstNamkvaemt() {
        val e = epg(programmes = mapOf("RUV.is" to emptyList()))
        val map = ChannelMatcher.buildChanMap(listOf(ch("RÚV", tvgId = "ruv.IS")), e)
        assertEquals(listOf("RUV.is"), map)
    }

    @Test
    fun nafnTengirThegarIdVantar() {
        val e = epg(
            programmes = mapOf("ruv.is" to emptyList()),
            nameToId = mapOf("ruv" to "ruv.is")
        )
        val map = ChannelMatcher.buildChanMap(listOf(ch("RÚV HD", tvgName = "RÚV")), e)
        assertEquals(listOf("ruv.is"), map)
    }

    @Test
    fun nafnReyndirTvgNameAdurEnName() {
        val e = epg(
            programmes = mapOf("a" to emptyList(), "b" to emptyList()),
            nameToId = mapOf("sto2" to "a", "sto2sport" to "b")
        )
        val map = ChannelMatcher.buildChanMap(listOf(ch("Stöð 2 Sport", tvgName = "Stöð 2")), e)
        assertEquals(listOf("a"), map)
    }

    @Test
    fun laustNafnTengirSkySport() {
        val e = epg(
            programmes = mapOf("uk.sky" to emptyList()),
            loose = mapOf("skysportsmainevent" to "uk.sky")
        )
        val map = ChannelMatcher.buildChanMap(
            listOf(ch("UK: Sky Sports Main Event FHD B")), e
        )
        assertEquals(listOf("uk.sky"), map)
    }

    @Test
    fun enginDagskraGefurNull() {
        val e = epg(programmes = mapOf("ruv.is" to emptyList()))
        val map = ChannelMatcher.buildChanMap(
            listOf(ch("Óþekkt", tvgId = "x.y"), ch("Annað", tvgName = "Annað")), e
        )
        assertEquals(listOf(null, null), map)
    }

    // ---------- wanted ----------

    @Test
    fun wantedSafnarIdOgNofnum() {
        val w = ChannelMatcher.wanted(
            listOf(
                ch("RÚV HD", tvgId = "Ruv.is", tvgName = "RÚV"),
                ch("Stöð 2 Sport", tvgName = "Stöð 2 Sport HD"),
                ch("")
            )
        )
        assertTrue(w.ids.containsAll(setOf("Ruv.is", "ruv.is")))
        assertTrue(w.names.contains("ruv"))
        assertTrue(w.names.contains("sto2sport"))
        assertTrue(w.loose.contains("ruv"))
        assertEquals(false, w.names.contains(""))
        assertEquals(false, w.loose.contains(""))
    }

    // ---------- programmesFor / nowNext ----------

    private val p1 = Programme(t0 - 2 * h, t0 - h, "Fyrri", "")
    private val p2 = Programme(t0 - h, t0 + h, "Núna", "lýsing")
    private val p3 = Programme(t0 + h, t0 + 2 * h, "Næst", "")
    private val programmes = mapOf("ruv.is" to listOf(p1, p2, p3))
    private val chanMap = listOf<String?>("ruv.is", null)

    @Test
    fun programmesForSkilarTomumListaEfEnginDagskra() {
        assertEquals(3, ChannelMatcher.programmesFor(chanMap, programmes, 0).size)
        assertTrue(ChannelMatcher.programmesFor(chanMap, programmes, 1).isEmpty())
        assertTrue(ChannelMatcher.programmesFor(chanMap, programmes, 99).isEmpty())
    }

    @Test
    fun nowNextFinnurNuOgNaest() {
        val nn = ChannelMatcher.channelNowNext(chanMap, programmes, 0, t0)
        assertEquals("Núna", nn.now?.title)
        assertEquals("lýsing", nn.now?.desc)
        assertEquals("Næst", nn.next?.title)
    }

    @Test
    fun nowNextFyrirFyrstaThatt() {
        val nn = ChannelMatcher.channelNowNext(chanMap, programmes, 0, t0 - 3 * h)
        assertNull(nn.now)
        assertEquals("Fyrri", nn.next?.title)
    }

    @Test
    fun nowNextEftirAdAlltErBuid() {
        val nn = ChannelMatcher.channelNowNext(chanMap, programmes, 0, t0 + 5 * h)
        assertNull(nn.now)
        assertNull(nn.next)
    }

    @Test
    fun nowNextTomDagskra() {
        val nn = ChannelMatcher.nowNext(emptyList(), t0)
        assertNull(nn.now)
        assertNull(nn.next)
    }

    @Test
    fun offsetFaerirTima() {
        // offset -1 klst -> t = now + 1 klst -> þriðja atriðið er "núna"
        val nn = ChannelMatcher.channelNowNext(chanMap, programmes, 0, t0, offsetMs = -h)
        assertEquals("Næst", nn.now?.title)
        assertNull(nn.next)
    }

    @Test
    fun shiftFaerirAtridi() {
        val s = ChannelMatcher.shift(p2, h)!!
        assertEquals(t0, s.start)
        assertEquals(t0 + 2 * h, s.stop)
        assertEquals("Núna", s.title)
        assertNull(ChannelMatcher.shift(null, h))
    }
}
