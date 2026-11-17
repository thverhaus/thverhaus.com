package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.ChannelRows
import app.mulehead.data.FolderOrder
import app.mulehead.data.HomeModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderOrderTest {

    private fun rows(vararg names: String): List<HomeModel.RowView> {
        val channels = names.map { Channel(it, "http://x/$it", group = "G") }
        return HomeModel.rows(channels, emptyMap(), List(channels.size) { null }, 0L, merge = false, sort = false)
    }

    @Test
    fun azSortsByNameIgnoringCountryPrefix() {
        val r = rows("UK: Sky", "UK: BBC", "UK: Alibi")
        assertEquals(listOf("UK: Alibi", "UK: BBC", "UK: Sky"), FolderOrder.arrange(r, FolderOrder.AZ, emptyList()).map { it.name })
    }

    @Test
    fun providerKeepsListOrder() {
        val r = rows("C", "A", "B").reversed()
        assertEquals(listOf("C", "A", "B"), FolderOrder.arrange(r, FolderOrder.PROVIDER, emptyList()).map { it.name })
    }

    @Test
    fun customPutsUnknownRowsLastInProviderOrder() {
        val r = rows("A", "B", "C", "D")
        val out = FolderOrder.arrange(r, FolderOrder.CUSTOM, listOf("C", "A"))
        assertEquals(listOf("C", "A", "B", "D"), out.map { it.name })
    }

    @Test
    fun moveReturnsNewOrderAndIgnoresOutOfRange() {
        val r = rows("A", "B", "C")
        assertEquals(listOf("A", "C", "B"), FolderOrder.move(r, 2, 1))
        assertEquals(listOf("B", "A", "C"), FolderOrder.move(r, 0, 1))
        assertEquals(listOf("A", "B", "C"), FolderOrder.move(r, 0, -1))
        assertEquals(listOf("A", "B", "C"), FolderOrder.move(r, 3, 2))
    }

    @Test
    fun markedToTopKeepsTheirOrder() {
        val shown = listOf("Iceland", "UK Sport", "Arabic", "USA ABC", "Ireland Prime", "Music")
        assertEquals(
            listOf("UK Sport", "USA ABC", "Music", "Iceland", "Arabic", "Ireland Prime"),
            FolderOrder.toTop(shown, setOf("Music", "UK Sport", "USA ABC"))
        )
    }

    @Test
    fun stepMovesOneAndStopsAtEnds() {
        val shown = listOf("A", "B", "C")
        assertEquals(listOf("B", "A", "C"), FolderOrder.step(shown, "B", -1))
        assertEquals(listOf("A", "C", "B"), FolderOrder.step(shown, "B", 1))
        assertEquals(shown, FolderOrder.step(shown, "A", -1))
        assertEquals(shown, FolderOrder.step(shown, "X", 1))
    }

    @Test
    fun customGroupOrderFirstThenProviderAndGoneGroupsDropped() {
        assertEquals(
            listOf("Music", "UK", "Iceland", "Arabic"),
            FolderOrder.withCustom(listOf("Iceland", "UK", "Arabic", "Music"), listOf("Music", "Horfið", "UK"))
        )
        assertEquals(listOf("A", "B"), FolderOrder.withCustom(listOf("A", "B"), emptyList()))
    }

    @Test
    fun nextCyclesThroughModes() {
        assertEquals(FolderOrder.PROVIDER, FolderOrder.next(FolderOrder.AZ))
        assertEquals(FolderOrder.CUSTOM, FolderOrder.next(FolderOrder.PROVIDER))
        assertEquals(FolderOrder.AZ, FolderOrder.next(FolderOrder.CUSTOM))
    }

    @Test
    fun chipLabelMatchesMac() {
        assertEquals("Main", ChannelRows.chipLabel("RÚV"))
        assertEquals("FHD", ChannelRows.chipLabel("RÚV FHD"))
    }

    @Test
    fun groupOrderFromProviderComesFirst() {
        val channels = listOf(
            Channel("X", "u1", group = "Án flokks"),
            Channel("RÚV", "u2", group = "Iceland"),
            Channel("BBC", "u3", group = "UK")
        )
        val r = HomeModel.rows(channels, emptyMap(), List(3) { null }, 0L, groupOrder = listOf("Iceland", "UK"))
        assertEquals(listOf("Iceland", "UK", "Án flokks"), r.map { it.group })
        assertEquals(listOf("Iceland", "UK", "Án flokks"), HomeModel.groupCounts(r, listOf("Iceland", "UK")).map { it.name })
    }
}

class NormWordsTest {
    // Gamla útgáfan með reglulegum segðum: nýja lykkjan á að gefa nákvæmlega það sama.
    private fun old(base: String): List<String> {
        val flat = Regex("[\\u0300-\\u036f]").replace(
            java.text.Normalizer.normalize(base.lowercase(), java.text.Normalizer.Form.NFKD), ""
        )
        val cleaned = Regex("[^a-z0-9: ]+").replace(flat, " ")
        return Regex("\\s+").split(cleaned).filter { it.isNotEmpty() }.map { w ->
            if (w.length > 3 && w.endsWith("s")) w.dropLast(1) else w
        }
    }

    @Test
    fun sameAsRegexVersion() {
        val names = listOf(
            "UK: Sky Sports Premier League", "IS: RÚV 2", "Stöð 2 Sport 3", "Þjóðin ÆÐI",
            "beIN SPORTS 1 (FHD)", "DE| Sky Sport Bundesliga 1", "  Arte   Þýsk  ", "Canal+ Sport 360",
            "Viaplay IS: (12/11) 19:35 England - Króatía", "ESPN2", "ＦＵＬＬ　ＷＩＤＴＨ", "Ciné+ Frisson",
            "news", "BBC Ones", ""
        )
        for (n in names) {
            org.junit.Assert.assertEquals(n, old(n), app.mulehead.data.ChannelRows.normWords(n))
        }
    }
}

class SearchTest {
    private fun rows(vararg names: String): List<HomeModel.RowView> {
        val channels = names.map { Channel(it, "http://x/$it", group = "G") }
        return HomeModel.rows(channels, emptyMap(), List(channels.size) { null }, 0L, merge = false, sort = false)
    }

    @Test
    fun skySFindsSkySportsFirst() {
        val r = rows("UK: Discovery Sky", "UK: Sky Sports Premier League", "UK: Sky News", "BBC One")
        val out = HomeModel.search(r, "sky s").map { it.name }
        assertEquals("UK: Sky Sports Premier League", out.first())
        assertEquals(false, out.contains("BBC One"))
    }

    @Test
    fun allWordsMustMatchAndCaseIsIgnored() {
        val r = rows("RÚV", "RÚV 2", "Stöð 2")
        assertEquals(listOf("RÚV 2"), HomeModel.search(r, "rúv 2").map { it.name })
        assertEquals(emptyList<String>(), HomeModel.search(r, "   ").map { it.name })
    }
}

class FastRowsTest {
    private fun rows(): List<HomeModel.RowView> {
        val ch = listOf(
            Channel("A1", "u", group = "A"), Channel("B1", "u", group = "B"),
            Channel("A2", "u", group = "A"), Channel("C1", "u", group = "C")
        )
        return HomeModel.rows(ch, emptyMap(), List(ch.size) { null }, 0L, merge = false, sort = false)
    }

    @Test
    fun reorderGroupsKeepsOrderInsideGroup() {
        val out = HomeModel.reorderGroups(rows(), listOf("C", "A", "B")).map { it.name }
        assertEquals(listOf("C1", "A1", "A2", "B1"), out)
    }

    @Test
    fun withNowNextKeepsRowsWhenNothingChanges() {
        val r = rows()
        val out = HomeModel.withNowNext(r, emptyMap(), List(4) { null }, 0L)
        assertEquals(r.map { it.name }, out.map { it.name })
        assertTrue(r.zip(out).all { (a, b) -> a === b })
    }
}
