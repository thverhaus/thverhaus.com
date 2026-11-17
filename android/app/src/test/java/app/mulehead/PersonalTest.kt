package app.mulehead

import app.mulehead.data.ChannelHealth
import app.mulehead.data.Personal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PersonalTest {
    @Test fun toggleAddsAndRemoves() {
        assertEquals(listOf("a", "b"), Personal.toggle(listOf("a"), "b"))
        assertEquals(listOf("a"), Personal.toggle(listOf("a", "b"), "b"))
    }

    @Test fun touchPutsNewestFirstWithoutDuplicates() {
        assertEquals(listOf("b", "a", "c"), Personal.touch(listOf("a", "b", "c"), "b"))
        assertEquals(3, Personal.touch(listOf("a", "b", "c"), "d", max = 3).size)
    }

    @Test fun pickKeepsListOrderAndSkipsMissing() {
        assertEquals(listOf(3, 1), Personal.pick(listOf("3", "x", "1"), listOf(1, 2, 3)) { it.toString() })
    }

    @Test fun reorderKeepsHiddenKeysAtEnd() {
        assertEquals(listOf("c", "a", "gone"), Personal.reorder(listOf("a", "gone", "c"), listOf("c", "a")))
    }

    @Test fun healthYellowThenRedAndOncePerMinute() {
        var m = ChannelHealth.trouble(emptyMap(), "Sýn", "hægt", false, 1_000)!!
        assertEquals(1, ChannelHealth.level(m["Sýn"]))
        assertNull(ChannelHealth.trouble(m, "Sýn", "hægt", false, 30_000))
        m = ChannelHealth.trouble(m, "Sýn", "hægt", false, 70_000)!!
        assertEquals(2, ChannelHealth.level(m["Sýn"]))
    }

    @Test fun severeIsRedAtOnce() {
        val m = ChannelHealth.trouble(emptyMap(), "X", "dauð", true, 1_000)!!
        assertEquals(2, ChannelHealth.level(m["X"]))
    }

    @Test fun cleanPlayWearsMarkOffAndEarnsGreen() {
        var m = ChannelHealth.trouble(emptyMap(), "X", "", false, 0)!!
        m = ChannelHealth.clean(m, "X", 600, 1_000)!!
        assertNull(m["X"])
        assertNull(ChannelHealth.clean(m, "X", 600, 2_000))
        m = ChannelHealth.clean(m, "X", 1800, 3_000)!!
        assertEquals(3, ChannelHealth.level(m["X"]))
        // grænt glatast um leið og rásin hikstar
        m = ChannelHealth.trouble(m, "X", "", false, 4_000)!!
        assertEquals(1, ChannelHealth.level(m["X"]))
    }

    @Test fun worstWins() {
        assertEquals(2, ChannelHealth.worst(listOf(3, 2, 1)))
        assertEquals(3, ChannelHealth.worst(listOf(0, 3)))
    }

    @Test fun encodeRoundTrip() {
        val m = mapOf("A\tB" to ChannelHealth.Entry(1, 0, 5, "x\ny"))
        assertEquals(mapOf("A B" to ChannelHealth.Entry(1, 0, 5, "x y")), ChannelHealth.decode(ChannelHealth.encode(m)))
    }
}
