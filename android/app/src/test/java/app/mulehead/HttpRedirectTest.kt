package app.mulehead

import app.mulehead.data.HttpTransport
import app.mulehead.data.PlaylistException
import app.mulehead.data.resolveRedirect
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class HttpRedirectTest {

    @get:Rule
    val tmp = TemporaryFolder()

    // HttpURLConnection sem svarar föstum kóða — engin raunnet.
    private class FakeConn(url: String, private val code: Int, private val loc: String? = null, private val body: String = "") :
        HttpURLConnection(URI(url).toURL()) {

        var closed = false

        override fun connect() {}

        override fun disconnect() {
            closed = true
        }

        override fun usingProxy(): Boolean = false

        override fun getResponseCode(): Int = code

        override fun getHeaderField(name: String?): String? =
            if (name.equals("Location", ignoreCase = true)) loc else null

        override fun getInputStream(): InputStream {
            check(code in 200..299) { "ekkert svar fyrir $code" }
            return body.toByteArray(Charsets.UTF_8).inputStream()
        }
    }

    private class FakeHttp(private val chain: Map<String, FakeConn>) : HttpTransport() {
        val opened = ArrayList<String>()

        override fun open(url: String): HttpURLConnection {
            opened.add(url)
            return chain[url] ?: throw AssertionError("Óvænt slóð: $url")
        }
    }

    private val start = "http://prov.example/get.php?username=jon&password=leyni&type=m3u_plus"

    @Test
    fun fylgirTilvisunMilliHttpOgHttps() {
        val m3u = "#EXTM3U\n#EXTINF:-1,RÚV\nhttp://prov.example/ruv\n"
        val t = FakeHttp(
            mapOf(
                start to FakeConn(start, 302, loc = "https://prov.example/secure/list.m3u"),
                "https://prov.example/secure/list.m3u" to FakeConn(
                    "https://prov.example/secure/list.m3u", 200, body = m3u
                )
            )
        )
        val out = tmp.newFile("svar.m3u")
        t.getTo(start, "ua", 5000, out)
        assertEquals(m3u, out.readText())
        assertEquals(2, t.opened.size)
        assertTrue(t.opened[1].startsWith("https://"))
    }

    @Test
    fun afstaedTilvisunErLeyst() {
        val t = FakeHttp(
            mapOf(
                start to FakeConn(start, 301, loc = "/nyr/listi.m3u"),
                "http://prov.example/nyr/listi.m3u" to FakeConn(
                    "http://prov.example/nyr/listi.m3u", 200, body = "#EXTM3U\n"
                )
            )
        )
        assertEquals("#EXTM3U\n", String(t.get(start, "ua", 5000), Charsets.UTF_8))
    }

    @Test
    fun ofMargarTilvisanirGefaVillu() {
        val t = FakeHttp(mapOf(start to FakeConn(start, 302, loc = start)))
        val e = assertThrows(PlaylistException::class.java) { t.get(start, "ua", 5000) }
        assertTrue(e.message!!.contains("Of margar tilvísanir"))
        assertFalse(e.message!!.contains("leyni"))
    }

    @Test
    fun tilvisunAnSlodarGefurVillu() {
        val t = FakeHttp(mapOf(start to FakeConn(start, 302, loc = "")))
        val e = assertThrows(PlaylistException::class.java) { t.get(start, "ua", 5000) }
        assertTrue(e.message!!.contains("Tilvísun"))
    }

    @Test
    fun httpVillaNefnirEkkiLykilord() {
        val t = FakeHttp(mapOf(start to FakeConn(start, 403)))
        val e = assertThrows(PlaylistException::class.java) { t.get(start, "ua", 5000) }
        assertEquals("HTTP 403 frá prov.example", e.message)
        assertFalse(e.message!!.contains("leyni"))
    }

    @Test
    fun tilvisunAstodur() {
        assertEquals(
            "https://prov.example/x/y",
            resolveRedirect("http://prov.example/a/b.php?u=1", "https://prov.example/x/y")
        )
        assertEquals("http://prov.example/x", resolveRedirect("http://prov.example/a/b.php", "/x"))
        assertEquals("http://prov.example/a/x", resolveRedirect("http://prov.example/a/b.php", "x"))
        assertEquals(
            "http://cdn.example/x",
            resolveRedirect("http://prov.example/a/b.php", "//cdn.example/x")
        )
    }

    @Test
    fun ologlegSlodNefnirEkkiLykilord() {
        val e = assertThrows(PlaylistException::class.java) {
            HttpTransport().get("http://[::1/get.php?username=jon&password=leyni", "ua", 5000)
        }
        assertEquals("Slóðin er ekki gild", e.message)
        assertFalse(e.message!!.contains("leyni"))
    }

    @Test
    fun adeinsHttpOgHttps() {
        val e = assertThrows(PlaylistException::class.java) {
            HttpTransport().get("ftp://prov.example/x", "ua", 5000)
        }
        assertTrue(e.message!!.contains("http://"))
    }
}
