package app.mulehead

import app.mulehead.player.BufferAlerts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BufferAlertsTest {

    private fun run(a: BufferAlerts, vararg secs: Int): List<Int?> = secs.map { a.update(it) }

    @Test
    fun silentWhileFillingAtStart() {
        val a = BufferAlerts()
        assertEquals(List(5) { null }, run(a, 0, 5, 12, 25, 39))
    }

    @Test
    fun safeZoneIsQuiet() {
        val a = BufferAlerts()
        assertEquals(List(6) { null }, run(a, 45, 60, 52, 41, 58, 40))
    }

    @Test
    fun eachLevelOnceWhenDropping() {
        val a = BufferAlerts()
        assertEquals(listOf(null, 40, null, 30, null, 20, null, 10), run(a, 50, 39, 35, 29, 25, 19, 15, 9))
    }

    @Test
    fun flickeringAroundALevelAlertsOnce() {
        val a = BufferAlerts()
        a.update(50)
        assertEquals(40, a.update(39))
        assertEquals(listOf(30, null, null, null, null, null), run(a, 29, 31, 29, 31, 35, 29))
    }

    @Test
    fun levelRearmsTenSecondsAboveIt() {
        val a = BufferAlerts()
        a.update(50)
        run(a, 39, 29, 19)
        assertNull(a.update(25))
        assertNull(a.update(30))          // 20 er aftur virkt (>= 30)
        assertEquals(20, a.update(19))
    }

    @Test
    fun backInSafeZoneResetsEverything() {
        val a = BufferAlerts()
        a.update(50)
        run(a, 39, 29)
        assertNull(a.update(45))
        assertEquals(40, a.update(38))
    }

    @Test
    fun bigDropReportsWorstLevelOnly() {
        val a = BufferAlerts()
        a.update(55)
        assertEquals(10, a.update(5))
        assertNull(a.update(8))
    }

    @Test
    fun resetSilencesUntilSafeAgain() {
        val a = BufferAlerts()
        a.update(50)
        a.reset()
        assertNull(a.update(5))
        assertNull(a.update(41))
        assertEquals(30, a.update(25))
    }

    @Test
    fun levelsAboveMarkAreIgnored() {
        val a = BufferAlerts()
        assertNull(a.update(25, mark = 30))   // 20 = öruggt svæði þegar markið er 30
        assertEquals(20, a.update(18, mark = 30))
    }
}
