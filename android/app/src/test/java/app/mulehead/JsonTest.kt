package app.mulehead

import app.mulehead.data.Json
import app.mulehead.data.JsonException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonTest {

    @Test
    fun `les hlut með lista og dýpkun`() {
        val m = Json.obj(Json.parse("""{"a":1,"b":[true,null,"x"],"c":{"d":2}}"""))
        assertEquals(1.0, Json.num(m["a"])!!, 0.0)
        val b = Json.list(m["b"])
        assertEquals(3, b.size)
        assertEquals(true, b[0])
        assertNull(b[1])
        assertEquals("x", Json.str(b[2]))
        assertEquals(2.0, Json.num(Json.obj(m["c"])["d"])!!, 0.0)
    }

    @Test
    fun `tölur verða texti eins og í JavaScript`() {
        assertEquals("8", Json.numText(8.0))
        assertEquals("7.5", Json.numText(7.5))
        assertEquals("1250", Json.str(Json.parse("1250")))
    }

    @Test
    fun `strengjaflótti og unicode`() {
        val m = Json.obj(Json.parse("""{"t":"lina\nnæst","q":"gæsalappir \"hér\"","u":"\u00cdsland"}"""))
        assertEquals("lina\nnæst", Json.str(m["t"]))
        assertEquals("gæsalappir \"hér\"", Json.str(m["q"]))
        assertEquals("Ísland", Json.str(m["u"]))
    }

    @Test
    fun `tómur listi og hlutur`() {
        assertEquals(0, Json.list(Json.parse("[]")).size)
        assertTrue(Json.obj(Json.parse("{}")).isEmpty())
        assertTrue(Json.obj(Json.parse("null")).isEmpty())
    }

    @Test
    fun `ógilt JSON kastar villu`() {
        assertThrows(JsonException::class.java) { Json.parse("{a:1}") }
        assertThrows(JsonException::class.java) { Json.parse("[1,]") }
        assertThrows(JsonException::class.java) { Json.parse("") }
        assertThrows(JsonException::class.java) { Json.parse("{\"a\":1} tail") }
    }

    @Test
    fun `hjálparföll skila sjálfgefnum gildum`() {
        assertEquals("", Json.str(null))
        assertEquals("x", Json.str(null, "x"))
        assertEquals(0L, Json.long(null))
        assertEquals(5L, Json.long("5"))
        assertTrue(Json.bool("true"))
        assertEquals(0, Json.list("ekki listi").size)
    }
}
