package app.mulehead

import app.mulehead.data.AppUpdate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateTest {
    private val sha = "a".repeat(64)

    @Test
    fun readsAndroidEntry() {
        val json = """{"android":{"versionCode":9,"versionName":"0.9","url":"https://thverhaus.com/mulehead.apk","sha256":"$sha"},"mac":{"version":"1.5.8"}}"""
        val info = AppUpdate.parse(json)!!
        assertEquals(9L, info.versionCode)
        assertEquals("0.9", info.versionName)
        assertTrue(AppUpdate.isNewer(info, 8))
        assertFalse(AppUpdate.isNewer(info, 9))
    }

    @Test
    fun rejectsUnsafeOrBrokenEntries() {
        assertNull(AppUpdate.parse("""{"android":{"versionCode":9,"url":"http://x/a.apk","sha256":"$sha"}}"""))
        assertNull(AppUpdate.parse("""{"android":{"versionCode":9,"url":"https://x/a.apk","sha256":"abc"}}"""))
        assertNull(AppUpdate.parse("""{"android":{"url":"https://x/a.apk","sha256":"$sha"}}"""))
        assertNull(AppUpdate.parse("ekki json"))
        assertFalse(AppUpdate.isNewer(null, 1))
    }

    @Test
    fun autoCheckAtMostDaily() {
        assertTrue(AppUpdate.dueForAutoCheck(0, AppUpdate.AUTO_INTERVAL_MS))
        assertFalse(AppUpdate.dueForAutoCheck(1_000, 1_000 + AppUpdate.AUTO_INTERVAL_MS - 1))
    }
}
