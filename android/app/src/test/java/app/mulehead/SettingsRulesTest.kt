package app.mulehead

import app.mulehead.data.SettingsRules
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsRulesTest {

    @Test
    fun bufferHækkarUmSkref() {
        assertEquals(65, SettingsRules.stepBuffer(60, 5))
    }

    @Test
    fun bufferStopparÁMörkum() {
        assertEquals(SettingsRules.BUFFER_MAX, SettingsRules.stepBuffer(118, 5))
        assertEquals(SettingsRules.BUFFER_MIN, SettingsRules.stepBuffer(3, -5))
    }

    @Test
    fun hliðrunFerÍ30MínSkrefum() {
        assertEquals(30, SettingsRules.stepOffset(0, 30))
        assertEquals(-30, SettingsRules.stepOffset(0, -30))
    }

    @Test
    fun hliðrunStopparVið12Klst() {
        assertEquals(720, SettingsRules.stepOffset(720, 30))
        assertEquals(-720, SettingsRules.stepOffset(-720, -30))
    }

    @Test
    fun uppfærslaHringekja() {
        assertEquals(12, SettingsRules.cycleChoice(SettingsRules.REFRESH_CHOICES, 6, 1))
        assertEquals(6, SettingsRules.cycleChoice(SettingsRules.REFRESH_CHOICES, 72, 1))
        assertEquals(72, SettingsRules.cycleChoice(SettingsRules.REFRESH_CHOICES, 6, -1))
    }

    @Test
    fun óþekktGildiByrjaÁFyrstaValkosti() {
        assertEquals(12, SettingsRules.cycleChoice(SettingsRules.REFRESH_CHOICES, 13, 1))
    }

    @Test
    fun textarÁÍslensku() {
        assertEquals("60 sek", SettingsRules.bufferLabel(60))
        assertEquals("0 mín", SettingsRules.offsetLabel(0))
        assertEquals("+30 mín", SettingsRules.offsetLabel(30))
        assertEquals("-90 mín", SettingsRules.offsetLabel(-90))
        assertEquals("sólarhring", SettingsRules.refreshLabel(24))
        assertEquals("3 dagar", SettingsRules.refreshLabel(72))
        assertEquals("12 klst", SettingsRules.refreshLabel(12))
    }
}
