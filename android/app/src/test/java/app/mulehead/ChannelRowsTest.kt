package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.ChannelRows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelRowsTest {

    private fun ch(name: String, group: String = "G") =
        Channel(name = name, url = "http://localhost/$name", group = group)

    // ---------- splitName ----------

    @Test
    fun splitNameSkilurGaedamerki() {
        val sp = ChannelRows.splitName("RÚV HD")
        assertEquals("RÚV", sp.base)
        assertEquals("HD", sp.tag)
    }

    @Test
    fun splitNameTekurFleiriEnEittMerki() {
        val sp = ChannelRows.splitName("Stöð 2 Sport FHD B")
        assertEquals("Stöð 2 Sport", sp.base)
        assertEquals("FHD B", sp.tag)
    }

    @Test
    fun splitNameSkilarSamaNafniEfEkkertMerki() {
        val sp = ChannelRows.splitName("RÚV")
        assertEquals("RÚV", sp.base)
        assertEquals("", sp.tag)
    }

    @Test
    fun splitNameEturEkkiAlltNafnid() {
        assertEquals("HD", ChannelRows.splitName("HD").base)
        val sp = ChannelRows.splitName("UK: HD")
        assertEquals("UK: HD", sp.base)
        assertEquals("", sp.tag)
    }

    @Test
    fun splitNameFjarlaegirSviga() {
        val sp = ChannelRows.splitName("RÚV (Backup)")
        assertEquals("RÚV", sp.base)
        assertEquals("Backup", sp.tag)
    }

    @Test
    fun splitNameHeldurLandsforskeyti() {
        val sp = ChannelRows.splitName("UK: Sky Sports Main Event FHD")
        assertEquals("UK: Sky Sports Main Event", sp.base)
        assertEquals("FHD", sp.tag)
        assertEquals("Sky Sports Main Event", ChannelRows.sortKey(sp.base))
    }

    // ---------- variantRank ----------

    @Test
    fun variantRankRafarGaedum() {
        assertEquals(0, ChannelRows.variantRank("FHD"))
        assertEquals(1, ChannelRows.variantRank("HD"))
        assertEquals(2, ChannelRows.variantRank(""))
        assertEquals(3, ChannelRows.variantRank("4K"))
        assertEquals(4, ChannelRows.variantRank("SD"))
    }

    @Test
    fun variantRankFaerirBackupOgSkyGoAftar() {
        assertEquals(10, ChannelRows.variantRank("FHD B"))
        assertEquals(11, ChannelRows.variantRank("HD Backup"))
        assertEquals(6, ChannelRows.variantRank("SKY GO HD"))
    }

    // ---------- mergeKey / normWords ----------

    @Test
    fun mergeKeyFelldirSamanEintoluOgFleirtolu() {
        assertEquals(
            ChannelRows.mergeKey("UK: Sky Sport Main Events"),
            ChannelRows.mergeKey("UK: SKY SPORT MAIN EVENT")
        )
    }

    // ---------- íslensk röðun ----------

    @Test
    fun rodunErIslensk() {
        assertTrue(ChannelRows.compare("Anna", "Árni") < 0)
        assertTrue(ChannelRows.compare("Zeta", "Þór") < 0)
        assertTrue(ChannelRows.compare("Þór", "Ægir") < 0)
        assertTrue(ChannelRows.compare("Örn", "Þór") > 0)
    }

    @Test
    fun rodunErLoglegMedTolur() {
        assertTrue(ChannelRows.compare("Rás 2", "Rás 10") < 0)
        assertEquals(0, ChannelRows.compare("RÚV", "rúv"))
    }

    // ---------- makeRows ----------

    @Test
    fun makeRowsSameinarGaedaafbrigdi() {
        val channels = listOf(
            ch("Sky Sports Main Event"),
            ch("Sky Sports Main Event FHD"),
            ch("Sky Sports Main Event 4K")
        )
        val rows = ChannelRows.makeRows(channels)
        assertEquals(1, rows.size)
        val row = rows[0]
        assertEquals("Sky Sports Main Event", row.base)
        assertEquals(listOf(1, 0, 2), row.variants) // FHD fremst, svo venjulegt, svo 4K
        assertEquals(1, row.primary)
    }

    @Test
    fun makeRowsSameinarSkyttingar() {
        val channels = listOf(
            ch("UK: Sky Sport PL"),
            ch("UK: Sky Sport Premier League")
        )
        val rows = ChannelRows.makeRows(channels)
        assertEquals(1, rows.size)
        assertEquals(2, rows[0].variants.size)
        assertEquals("UK: Sky Sport Premier League", rows[0].base)
    }

    @Test
    fun makeRowsAnSameiningarGefurEinaLinuARas() {
        val channels = listOf(ch("RÚV"), ch("RÚV HD"))
        val rows = ChannelRows.makeRows(channels, merge = false)
        assertEquals(2, rows.size)
        assertEquals("RÚV", rows[0].base)
        assertEquals("RÚV HD", rows[1].base)
    }

    @Test
    fun makeRowsRadarEftirIslenskuInnanHopts() {
        val channels = listOf(ch("Þór"), ch("Anna"), ch("Zeta"))
        val rows = ChannelRows.makeRows(channels)
        assertEquals(listOf("Anna", "Zeta", "Þór"), rows.map { it.base })
    }

    @Test
    fun makeRowsHeldurHopumIFyrriRod() {
        val channels = listOf(ch("Zeta", "Sport"), ch("Anna", "Fréttir"))
        val rows = ChannelRows.makeRows(channels)
        assertEquals(listOf("Zeta", "Anna"), rows.map { it.base })
    }

    @Test
    fun makeRowsAnRodunarHeldurProviderRod() {
        val channels = listOf(ch("Zeta"), ch("Anna"))
        val rows = ChannelRows.makeRows(channels, sort = false)
        assertEquals(listOf("Zeta", "Anna"), rows.map { it.base })
    }
}
