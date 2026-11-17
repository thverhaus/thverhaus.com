package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.VodKind
import app.mulehead.data.VodParser
import app.mulehead.data.XtreamCreds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VodParserTest {

    private val creds = XtreamCreds("http://prov.example:8080", "user", "pass")

    private val movies = """
        [
          {"stream_id":101,"name":"Mynd (1999)","category_id":"3","stream_icon":"http://img/1.png",
           "rating":"7.5","year":"1999","added":"1600000000","container_extension":"mkv"},
          {"stream_id":102,"name":"Önnur mynd","category_id":"3","rating":0,"rating_5based":4,
           "releaseDate":"2005-01-01","container_extension":""},
          {"stream_id":"","name":"Engin id"},
          {"stream_id":103,"name":"Þriðja (2010)","category_id":"9"}
        ]
    """.trimIndent()

    private val series = """
        [
          {"series_id":7,"name":"Þættir","category_id":"2","cover":"http://img/c.png",
           "releaseDate":"2015-09-01","last_modified":"1650000000","rating_5based":4.5},
          {"name":"án id"}
        ]
    """.trimIndent()

    private val cats = """
        [
          {"category_id":"3","category_name":"Kvikmyndir"},
          {"category_id":"9","category_name":"Aðrar"},
          {"category_id":"5","category_name":"Tómir"},
          {"category_id":"6"}
        ]
    """.trimIndent()

    private val info = """
        {
          "info": {"name":"Nafn","plot":"Saga","cover":"http://img/s.png"},
          "episodes": {
            "2": [{"id":22,"title":"","episode_num":1,"container_extension":"mkv",
                   "info":{"plot":"P2","duration":"00:45:00","movie_image":"http://img/e2.png"}}],
            "1": [{"id":11,"episode_num":3,"title":"Fyrsti","container_extension":"","info":{"plot":"P1"}}]
          }
        }
    """.trimIndent()

    @Test
    fun `myndir fá nafn flokk ártal og slóð`() {
        val items = VodParser.items(movies, VodKind.MOVIES, creds)
        assertEquals(3, items.size)

        val a = items[0]
        assertEquals("101", a.id)
        assertEquals("Mynd (1999)", a.name)
        assertEquals("3", a.categoryId)
        assertEquals("http://img/1.png", a.poster)
        assertEquals("7.5", a.rating)
        assertEquals("1999", a.year)
        assertEquals(1_600_000_000L, a.added)
        assertEquals("http://prov.example:8080/movie/user/pass/101.mkv", a.url)
        assertFalse(a.episode)

        // rating 0 -> rating_5based * 2; ár úr releaseDate; tóm endingu -> mp4
        assertEquals("8", items[1].rating)
        assertEquals("2005", items[1].year)
        assertEquals("http://prov.example:8080/movie/user/pass/102.mp4", items[1].url)

        // ekkert ár annars staðar -> ár úr nafninu
        assertEquals("2010", items[2].year)
        assertEquals("", items[2].rating)
    }

    @Test
    fun `þættir fá ár og mynd en enga slóð`() {
        val items = VodParser.items(series, VodKind.SERIES, creds)
        assertEquals(1, items.size)
        val s = items[0]
        assertEquals("7", s.id)
        assertEquals("Þættir", s.name)
        assertEquals("2", s.categoryId)
        assertEquals("http://img/c.png", s.poster)
        assertEquals("9", s.rating)
        assertEquals("2015", s.year)
        assertEquals(1_650_000_000L, s.added)
        assertEquals("", s.url)
    }

    @Test
    fun `flokkar fá fjölda og tómir hverfa`() {
        val items = VodParser.items(movies, VodKind.MOVIES, creds)
        val c = VodParser.categories(cats, items)
        assertEquals(2, c.size)
        assertEquals("3", c[0].id)
        assertEquals("Kvikmyndir", c[0].name)
        assertEquals(2, c[0].count)
        assertEquals("9", c[1].id)
        assertEquals("Aðrar", c[1].name)
        assertEquals(1, c[1].count)
    }

    @Test
    fun `tímabil eru í númeraröð með þáttum`() {
        val s = VodParser.seriesInfo(info, creds)
        assertEquals("Nafn", s.name)
        assertEquals("Saga", s.plot)
        assertEquals("http://img/s.png", s.cover)
        assertEquals(2, s.seasons.size)

        val s1 = s.seasons[0]
        assertEquals("1", s1.season)
        assertEquals(1, s1.episodes.size)
        assertEquals("Fyrsti", s1.episodes[0].title)
        assertEquals(3, s1.episodes[0].num)
        assertEquals("P1", s1.episodes[0].plot)
        assertEquals("http://prov.example:8080/series/user/pass/11.mp4", s1.episodes[0].url)

        val e2 = s.seasons[1].episodes[0]
        assertEquals("Þáttur 1", e2.title)
        assertEquals("00:45:00", e2.duration)
        assertEquals("http://img/e2.png", e2.poster)
        assertEquals("http://prov.example:8080/series/user/pass/22.mkv", e2.url)
    }

    @Test
    fun `m3u listi gefur myndir úr rásum`() {
        val channels = listOf(
            Channel("RÚV", "http://p/ruv", group = "Íslenskar"),
            Channel("Mynd A (2001)", "http://p/movie/1", group = "Kvikmyndir", kind = Channel.Kind.MOVIE),
            Channel("Mynd B", "http://p/movie/2", group = "Kvikmyndir", kind = Channel.Kind.MOVIE),
            Channel("Þáttur 1", "http://p/series/3", group = "Þættir", kind = Channel.Kind.SERIES)
        )
        val (c, items) = VodParser.fromChannels(channels, VodKind.MOVIES)
        assertEquals(1, c.size)
        assertEquals("Kvikmyndir", c[0].name)
        assertEquals(2, c[0].count)
        assertEquals(2, items.size)
        assertEquals("m1", items[0].id)
        assertEquals("2001", items[0].year)
        assertEquals("http://p/movie/1", items[0].url)
        assertFalse(items[0].episode)

        val (sc, sitems) = VodParser.fromChannels(channels, VodKind.SERIES)
        assertEquals(1, sc.size)
        assertEquals("Þættir", sc[0].name)
        assertEquals(1, sitems.size)
        assertTrue(sitems[0].episode)
        assertEquals("http://p/series/3", sitems[0].url)
    }

    @Test
    fun `hjálparföll um ár og tóma strengi`() {
        assertEquals("1999", VodParser.nameYear("Mynd (1999)"))
        assertEquals("", VodParser.nameYear("Mynd"))
        assertEquals("", VodParser.nameYear("Gömul (1899)"))
        assertEquals("", VodParser.firstOf("", "0", " "))
        assertEquals("2015", VodParser.firstOf("", "0", "2015-09-01").take(4))
        assertEquals("2020", VodParser.yearOf("2020-01-01"))
        assertEquals("20", VodParser.yearOf("20"))
    }
}
