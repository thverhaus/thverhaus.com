package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.ChannelGroup
import app.mulehead.data.HomeModel
import app.mulehead.data.Programme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeModelTest {

    private val now = 1_700_000_000_000L

    private fun ch(name: String, group: String = "Íslenskar", tvgId: String = ""): Channel =
        Channel(name = name, url = "http://p/$name", tvgId = tvgId, group = group)

    private fun rowsOf(channels: List<Channel>, merge: Boolean = true, sort: Boolean = true) =
        HomeModel.rows(channels, emptyMap(), List(channels.size) { null }, now, 0L, merge, sort)

    @Test
    fun sameinarAfbrigdiIOraLinu() {
        val rows = rowsOf(listOf(ch("RÚV HD", tvgId = "ruv.is"), ch("RÚV")))
        assertEquals(1, rows.size)
        assertEquals("RÚV", rows[0].name)
        assertEquals(2, rows[0].variants)
        assertEquals("RÚV HD", rows[0].channel.name) // besta afbrigðið er primary
    }

    @Test
    fun mergeAfSlokktGefurEinaLinuARas() {
        val rows = rowsOf(listOf(ch("RÚV HD"), ch("RÚV")), merge = false)
        assertEquals(2, rows.size)
        assertTrue(rows.all { it.variants == 1 })
    }

    @Test
    fun radarIFlokkarod() {
        // Röð flokka ræður fyrst (Sport kemur fyrst í listanum), svo stafrófsröð innan flokks.
        val rows = rowsOf(listOf(ch("B", "Sport"), ch("A", "Íslenskar"), ch("C", "Íslenskar")))
        assertEquals(listOf("B", "A", "C"), rows.map { it.name })
        assertEquals(listOf("Sport", "Íslenskar"), HomeModel.groupCounts(rows).map { it.name })
    }

    @Test
    fun providerRodHeldurSerEfSortAf() {
        val rows = rowsOf(listOf(ch("Z"), ch("A"), ch("M")), sort = false)
        assertEquals(listOf("Z", "A", "M"), rows.map { it.name })
    }

    @Test
    fun nuOgNaestUrDagskra() {
        val programmes = mapOf(
            "ruv.is" to listOf(
                Programme(now - 3_600_000, now + 3_600_000, "Kastljós", ""),
                Programme(now + 3_600_000, now + 7_200_000, "Kvöldfréttir", "")
            )
        )
        val rows = HomeModel.rows(
            listOf(ch("RÚV", tvgId = "ruv.is")),
            programmes,
            listOf("ruv.is"),
            now
        )
        assertEquals("Kastljós", rows[0].now?.title)
        assertEquals("Kvöldfréttir", rows[0].next?.title)
        assertEquals(1, rows[0].number)
    }

    @Test
    fun enginDagskraGefurNull() {
        val rows = rowsOf(listOf(ch("RÚV")))
        assertNull(rows[0].now)
        assertNull(rows[0].next)
    }

    @Test
    fun hlidrunDagskrarFyrirNu() {
        val programmes = mapOf(
            "ruv.is" to listOf(
                Programme(now - 5 * 3_600_000, now - 3 * 3_600_000, "Gamalt", ""),
                Programme(now - 3 * 3_600_000, now + 3_600_000, "Núna", "")
            )
        )
        val channels = listOf(ch("RÚV", tvgId = "ruv.is"))
        val noOffset = HomeModel.rows(channels, programmes, listOf("ruv.is"), now)
        assertEquals("Núna", noOffset[0].now?.title)
        val shifted = HomeModel.rows(channels, programmes, listOf("ruv.is"), now, 4 * 3_600_000L)
        assertEquals("Gamalt", shifted[0].now?.title)
        assertEquals("Núna", shifted[0].next?.title)
    }

    @Test
    fun flokkurSiaOgFjoldi() {
        val rows = rowsOf(listOf(ch("A", "Sport"), ch("B", "Íslenskar"), ch("C", "Íslenskar")))
        assertEquals(3, HomeModel.forGroup(rows, null).size)
        assertEquals(listOf("B", "C"), HomeModel.forGroup(rows, "Íslenskar").map { it.name })
        assertEquals(
            listOf(ChannelGroup("Sport", 1), ChannelGroup("Íslenskar", 2)),
            HomeModel.groupCounts(rows)
        )
    }

    @Test
    fun framvindaAtridis() {
        val p = Programme(now - 1_800_000, now + 1_800_000, "x", "")
        assertEquals(0.5f, HomeModel.progress(p, now, 0L), 0.001f)
        assertEquals(1f, HomeModel.progress(p, now + 5 * 3_600_000L, 0L), 0.001f)
        assertEquals(0f, HomeModel.progress(p, now - 5 * 3_600_000L, 0L), 0.001f)
        assertEquals(0f, HomeModel.progress(null, now, 0L), 0.001f)
    }
}
