package app.mulehead

import app.mulehead.data.Resume
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ResumeStoreTest {

    private fun entry(pos: Long, dur: Long = 3_600_000L, at: Long = 1) = Resume.Entry(pos, dur, at)

    @Test
    fun `vistun og lestur skila sama lista`() {
        var map = emptyMap<String, Resume.Entry>()
        map = Resume.put(map, "https://x.is/a.m3u8", entry(120_000, at = 5))
        map = Resume.put(map, "https://x.is/b.m3u8", entry(60_000, at = 6))
        val back = Resume.decode(Resume.encode(map))
        assertEquals(map, back)
        assertEquals(120_000L, back["https://x.is/a.m3u8"]!!.pos)
    }

    @Test
    fun `slóð með gæsalöppum og íslenskum stöfum kemst heil í gegn`() {
        val url = "https://þjónn.is/mynd/„Stöð 2“?x=\"1\"&y=ð"
        val map = Resume.put(emptyMap(), url, entry(5_000))
        val back = Resume.decode(Resume.encode(map))
        assertEquals(5_000L, back[url]!!.pos)
    }

    @Test
    fun `nýjasta færslan er fyrst og sama slóð kemur ekki tvisvar`() {
        var map = emptyMap<String, Resume.Entry>()
        map = Resume.put(map, "a", entry(1))
        map = Resume.put(map, "b", entry(2))
        map = Resume.put(map, "a", entry(3))
        assertEquals(listOf("a", "b"), map.keys.toList())
        assertEquals(3L, map["a"]!!.pos)
    }

    @Test
    fun `listinn stækkar ekki endalaust`() {
        var map = emptyMap<String, Resume.Entry>()
        for (i in 0 until 250) map = Resume.put(map, "u$i", entry(i.toLong()))
        assertEquals(Resume.MAX, map.size)
        assertTrue(map.containsKey("u249"))
        assertEquals(249L, map["u249"]!!.pos)
    }

    @Test
    fun `klukka sýnir mínútur eða klukkustundir`() {
        assertEquals("0:05", Resume.clock(5_000))
        assertEquals("12:34", Resume.clock(754_000))
        assertEquals("1:02:03", Resume.clock(3_723_000))
        assertEquals("0:00", Resume.clock(-5))
    }

    @Test
    fun `tómt eða skemmt skjal gefur tóman lista`() {
        assertTrue(Resume.decode("").isEmpty())
        assertTrue(Resume.decode("ekki json").isEmpty())
        assertTrue(Resume.decode("[]").isEmpty())
        // Færslur án slóðar eru sleppt en hinar haldast.
        assertEquals(1, Resume.decode("""[{"p":5},{"u":"a","p":7}]""").size)
    }
}
