package app.mulehead

import app.mulehead.data.Json
import app.mulehead.data.Xtream
import app.mulehead.data.XtreamCreds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class XtreamTest {

    @Test
    fun `þekkir get php hlekk`() {
        val c = Xtream.fromUrl("http://prov.example:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts")
        assertNotNull(c)
        assertEquals("http://prov.example:8080", c!!.server)
        assertEquals("user", c.username)
        assertEquals("pass", c.password)
    }

    @Test
    fun `þekkir player api hlekk`() {
        val c = Xtream.fromUrl("https://prov.example/player_api.php?username=a&password=b")
        assertEquals("https://prov.example", c!!.server)
        assertEquals("a", c.username)
        assertEquals("b", c.password)
    }

    @Test
    fun `venjulegur m3u hlekkur er ekki xtream`() {
        assertNull(Xtream.fromUrl("http://prov.example/list.m3u"))
        assertNull(Xtream.fromUrl("http://prov.example/get.php?username=user"))
        assertNull(Xtream.fromUrl(""))
        assertNull(Xtream.fromUrl("ekki slóð"))
    }

    @Test
    fun `býr til api slóðir`() {
        val c = XtreamCreds("http://prov.example:8080", "user", "pass")
        assertEquals("http://prov.example:8080/player_api.php?username=user&password=pass", c.apiUrl())
        assertEquals(
            "http://prov.example:8080/player_api.php?username=user&password=pass&action=get_vod_streams",
            c.apiUrl("get_vod_streams")
        )
        assertEquals(
            "http://prov.example:8080/player_api.php?username=user&password=pass&action=get_series_info&series_id=42",
            c.apiUrl("get_series_info", "series_id=42")
        )
        assertEquals("http://prov.example:8080/xmltv.php?username=user&password=pass", c.liveEpgUrl)
    }

    @Test
    fun `slóðir mynda og þátta`() {
        val c = XtreamCreds("prov.example:8080/", "us er", "p@ss")
        assertEquals("http://prov.example:8080/movie/us%20er/p%40ss/12.mp4", c.movieUrl("12"))
        assertEquals("http://prov.example:8080/movie/us%20er/p%40ss/12.mkv", c.movieUrl("12", "mkv"))
        assertEquals("http://prov.example:8080/series/us%20er/p%40ss/7.mp4", c.seriesUrl("7"))
        assertEquals("http://prov.example:8080/series/us%20er/p%40ss/7.mkv", c.seriesUrl("7", "mkv"))
    }

    @Test
    fun `hreinsar server slóð`() {
        assertEquals("http://prov.example:8080", Xtream.cleanServer("prov.example:8080/"))
        assertEquals("http://prov.example", Xtream.cleanServer("http://prov.example/player_api.php?x=1"))
        assertEquals("https://prov.example/iptv", Xtream.cleanServer("https://prov.example/iptv/"))
    }

    // auth = 0 eða "0" er röng innskráning; vantar user_info líka (sama og Mac).
    @Test
    fun `túlkar innskráningarsvar`() {
        assertTrue(Xtream.authOk(Json.parse("""{"user_info":{"auth":1}}""")))
        assertTrue(Xtream.authOk(Json.parse("""{"user_info":{"auth":"1"}}""")))
        assertFalse(Xtream.authOk(Json.parse("""{"user_info":{"auth":0}}""")))
        assertFalse(Xtream.authOk(Json.parse("""{"user_info":{"auth":"0"}}""")))
        assertFalse(Xtream.authOk(Json.parse("""{"user_info":{"auth":false}}""")))
        assertFalse(Xtream.authOk(Json.parse("""{"server_info":{}}""")))
        assertFalse(Xtream.authOk(Json.parse("null")))
        // user_info til en auth vantar: Mac telur það gilt.
        assertTrue(Xtream.authOk(Json.parse("""{"user_info":{}}""")))
    }

    @Test
    fun `tv archive er sannleiksgildi eins og js`() {
        assertTrue(Xtream.truthy(Json.parse("1")))
        assertTrue(Xtream.truthy(Json.parse("\"0\"")))
        assertFalse(Xtream.truthy(Json.parse("0")))
        assertFalse(Xtream.truthy(Json.parse("null")))
        assertFalse(Xtream.truthy(Json.parse("\"\"")))
        assertTrue(Xtream.truthy(Json.parse("true")))
    }
}
