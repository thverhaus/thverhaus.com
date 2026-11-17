package app.mulehead

import app.mulehead.pairing.PairPayload
import app.mulehead.pairing.PairingException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairPayloadTest {

    private fun m3u(name: String = "Listi", epg: String = "") =
        """{"type":"m3u","name":"$name","url":"https://prov.example/list.m3u","epgUrl":"$epg"}"""

    @Test
    fun lesM3uSlod() {
        val p = PairPayload.parse(m3u(epg = "http://epg.example/g.xml")) as PairPayload.Link
        assertEquals("Listi", p.name)
        assertEquals("https://prov.example/list.m3u", p.url)
        assertEquals("http://epg.example/g.xml", p.epgUrl)
    }

    @Test
    fun nafnErSottUrSlodEfThadVantar() {
        val p = PairPayload.parse("""{"type":"m3u","name":"","url":"https://prov.example/list.m3u"}""")
            as PairPayload.Link
        assertEquals("prov.example", p.name)
        assertEquals("", p.epgUrl)
    }

    @Test
    fun lesXtreamInnskraningu() {
        val json = """{"type":"xtream","name":"","server":"http://host:8080/","username":"jon",
            "password":"leyni 1","epgUrl":""}""".trimIndent()
        val p = PairPayload.parse(json) as PairPayload.XtreamAccount
        assertEquals("jon", p.name)
        assertEquals("http://host:8080/", p.server)
        assertEquals("jon", p.username)
        assertEquals("leyni 1", p.password)
    }

    @Test
    fun tegundErFundinEfHunVantar() {
        assertTrue(PairPayload.parse("""{"url":"http://a/b.m3u"}""") is PairPayload.Link)
        assertTrue(
            PairPayload.parse("""{"username":"u","server":"h","password":"p"}""")
                is PairPayload.XtreamAccount
        )
    }

    @Test
    fun hafnarSlodSemErEkkiHttp() {
        val e = assertThrows(PairingException::class.java) {
            PairPayload.parse("""{"type":"m3u","url":"file:///etc/passwd"}""")
        }
        assertTrue(e.message!!.contains("http://"))
    }

    @Test
    fun hafnarM3uAnSlodar() {
        assertThrows(PairingException::class.java) {
            PairPayload.parse("""{"type":"m3u","name":"x"}""")
        }
    }

    @Test
    fun hafnarXtreamAnNotanda() {
        assertThrows(PairingException::class.java) {
            PairPayload.parse("""{"type":"xtream","server":"host:8080","username":""}""")
        }
    }

    @Test
    fun hafnarTomyggjuOgRusli() {
        assertThrows(PairingException::class.java) { PairPayload.parse("") }
        assertThrows(PairingException::class.java) { PairPayload.parse("[]") }
        assertThrows(PairingException::class.java) { PairPayload.parse("""{"type":"veit-ekki"}""") }
    }
}
