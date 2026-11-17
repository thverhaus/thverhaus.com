package app.mulehead

import app.mulehead.data.VodFilter
import app.mulehead.data.VodItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VodFilterTest {

    private val items = listOf(
        VodItem("1", "Saga Íslands", "a"),
        VodItem("2", "Þór og Ævintýrið", "a"),
        VodItem("3", "Drama (2020)", "b"),
        VodItem("4", "Saga Norðursins", "b")
    )

    @Test
    fun `tóm leit skilar öllu`() {
        assertEquals(4, VodFilter.search(items, "").size)
        assertEquals(4, VodFilter.search(items, "   ").size)
    }

    @Test
    fun `broddar og háletur skipta ekki máli`() {
        assertEquals(listOf("1", "4"), VodFilter.search(items, "saga").map { it.id })
        assertEquals(listOf("2"), VodFilter.search(items, "THOR").map { it.id })
        assertEquals(listOf("2"), VodFilter.search(items, "aevintyrid").map { it.id })
    }

    @Test
    fun `öll orð þurfa að finnast`() {
        assertEquals(listOf("4"), VodFilter.search(items, "saga nordur").map { it.id })
        assertTrue(VodFilter.search(items, "saga ekki").isEmpty())
    }

    @Test
    fun `flokkur takmarkar leit`() {
        assertEquals(listOf("4"), VodFilter.search(items, "saga", "b").map { it.id })
        assertEquals(listOf("3", "4"), VodFilter.search(items, "", "b").map { it.id })
        assertTrue(VodFilter.search(items, "saga", "c").isEmpty())
    }

    @Test
    fun `fold fjarlægir brodda`() {
        assertEquals("thor og aevintyrid", VodFilter.fold("Þór og Ævintýrið"))
        assertEquals("island", VodFilter.fold("Ísland"))
        assertEquals("draumur", VodFilter.fold("DRAUMUR"))
        assertFalse(VodFilter.fold("Þór").contains("þ"))
    }
}
