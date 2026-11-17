package app.mulehead

import app.mulehead.data.Json
import app.mulehead.data.JsonException
import app.mulehead.data.JsonStream
import app.mulehead.data.PlaylistException
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class JsonStreamTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun file(text: String, gzip: Boolean = false): File {
        val f = tmp.newFile()
        if (gzip) {
            val bos = ByteArrayOutputStream()
            GZIPOutputStream(bos).use { it.write(text.toByteArray(Charsets.UTF_8)) }
            f.writeBytes(bos.toByteArray())
        } else {
            f.writeText(text)
        }
        return f
    }

    @Test
    fun lesurFylkiAtridiFyrirAtridi() {
        val items = ArrayList<Any?>()
        val ok = JsonStream.eachItem(
            file("""[{"id":1,"name":"A"},{"id":2,"name":"B"}]""")
        ) { items.add(it) }
        assertTrue(ok)
        assertEquals(2, items.size)
        assertEquals("A", Json.str(Json.obj(items[0])["name"]))
        assertEquals("B", Json.str(Json.obj(items[1])["name"]))
    }

    // Innfelldir hlutir, svigrar inni í strengjum og escape mega ekki rugla dýptina.
    @Test
    fun floknarUppbyggingOgStrengir() {
        val text = """
            [
              {"name":"A {B} [C]","tags":["x",{"y":"}"}],"q":"\" , ]"},
              {"name":"B \\ end"}
            ]
        """.trimIndent()
        val items = ArrayList<Any?>()
        assertTrue(JsonStream.eachItem(file(text)) { items.add(it) })
        assertEquals(2, items.size)
        assertEquals("A {B} [C]", Json.str(Json.obj(items[0])["name"]))
        assertEquals("B \\ end", Json.str(Json.obj(items[1])["name"]))
    }

    @Test
    fun BOMOgGzipVirkar() {
        val items = ArrayList<Any?>()
        assertTrue(JsonStream.eachItem(file("\uFEFF[1,2,3]")) { items.add(it) })
        assertEquals(3, items.size)
        assertEquals(3.0, items[2])

        val gz = ArrayList<Any?>()
        assertTrue(JsonStream.eachItem(file("""[{"a":1}]""", gzip = true)) { gz.add(it) })
        assertEquals(1, gz.size)
    }

    @Test
    fun hluturErEkkiFylki() {
        assertFalse(JsonStream.eachItem(file("""{"user_info":{"auth":1}}""")) { })
        assertFalse(JsonStream.eachItem(file("<html>404</html>")) { })
    }

    @Test
    fun tomtFylkiOgBil() {
        var n = 0
        assertTrue(JsonStream.eachItem(file("  [ ]  ")) { n++ })
        assertEquals(0, n)
    }

    @Test
    fun litidSvarErLesid() {
        assertEquals("""{"a":1}""", JsonStream.readText(file("""{"a":1}""")))
    }

    @Test
    fun ofStortSvarGefurVillu() {
        val e = assertThrows(PlaylistException::class.java) {
            JsonStream.readText(file("[" + "1,".repeat(1000) + "1]"), max = 64)
        }
        assertEquals(JsonStream.TOO_BIG, e.message)
    }

    @Test
    fun skemmtJsonGefurVillu() {
        val e = assertThrows(JsonException::class.java) {
            JsonStream.eachItem(file("""[{"a":1}""")) { }
        }
        assertTrue(e.message!!.contains("JSON"))
    }

    @Test
    fun nullGildi() {
        val items = ArrayList<Any?>()
        assertTrue(JsonStream.eachItem(file("[null,true,false]")) { items.add(it) })
        assertEquals(3, items.size)
        assertNull(items[0])
    }
}
