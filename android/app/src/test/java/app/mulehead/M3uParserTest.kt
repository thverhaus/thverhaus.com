package app.mulehead

import app.mulehead.data.Channel
import app.mulehead.data.M3uParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class M3uParserTest {

    @Test
    fun lesTvaerRasirMedFlokki() {
        val text = "#EXTM3U url-tvg=\"http://x.is/epg.xml\"\n" +
            "#EXTINF:-1 tvg-id=\"ruv\" tvg-logo=\"http://x.is/ruv.png\" group-title=\"Íslenskar\",RÚV\n" +
            "http://x.is/ruv.m3u8\n" +
            "#EXTINF:-1 group-title=\"Sport\",Stöð 2 Sport\n" +
            "http://x.is/sport.m3u8"
        val list = M3uParser.parse(text)
        assertEquals("http://x.is/epg.xml", list.epgUrl)
        assertEquals(2, list.channels.size)
        assertEquals("RÚV", list.channels[0].name)
        assertEquals("ruv", list.channels[0].tvgId)
        assertEquals("http://x.is/ruv.png", list.channels[0].logo)
        assertEquals("Íslenskar", list.channels[0].group)
        assertEquals("http://x.is/ruv.m3u8", list.channels[0].url)
        assertEquals(Channel.Kind.LIVE, list.channels[0].kind)
        assertEquals("Sport", list.channels[1].group)
        assertEquals("Stöð 2 Sport", list.channels[1].name)
    }

    @Test
    fun kommaInniIGaesaloppumErEkkiNafnaskil() {
        val line = "#EXTINF:-1 tvg-name=\"A, B\" group-title=\"X\",Raunverulegt nafn"
        assertEquals("Raunverulegt nafn", M3uParser.extractName(line))
        val a = M3uParser.parseAttrs(line)
        assertEquals("A, B", a["tvg-name"])
        assertEquals("X", a["group-title"])
    }

    @Test
    fun ogiltGildiAnGaesalappa() {
        val a = M3uParser.parseAttrs("#EXTINF:-1 tvg-id=ruv group-title=Sport,RÚV")
        assertEquals("ruv", a["tvg-id"])
        assertEquals("Sport", a["group-title"])
    }

    @Test
    fun undirstrikVerdaBandstrik() {
        val a = M3uParser.parseAttrs("#EXTINF:-1 group_title=Sport,RUV")
        assertEquals("Sport", a["group-title"])
    }

    @Test
    fun extgrpOgSjalfgefinnFlokkur() {
        val text = "#EXTM3U\n#EXTGRP:Sport\n#EXTINF:-1,A\nhttp://x.is/a.m3u8\n" +
            "#EXTINF:-1,B\nhttp://x.is/b.m3u8"
        val ch = M3uParser.parse(text).channels
        assertEquals("Sport", ch[0].group)
        assertEquals(M3uParser.NO_GROUP, ch[1].group)
    }

    @Test
    fun fyrstiEpgHlekkurErNotadur() {
        val list = M3uParser.parse("#EXTM3U x-tvg-url=\"http://a.is/e.xml,http://b.is/e.xml\"\n")
        assertEquals("http://a.is/e.xml", list.epgUrl)
    }

    @Test
    fun vlcUserAgent() {
        val text = "#EXTM3U\n#EXTINF:-1,A\n#EXTVLCOPT:http-user-agent=Mulehead/1.0\nhttp://x.is/a.m3u8"
        assertEquals("Mulehead/1.0", M3uParser.parse(text).channels[0].userAgent)
    }

    @Test
    fun tegundRasar() {
        assertEquals(Channel.Kind.MOVIE, M3uParser.guessKind("http://x.is/movie/123.mp4"))
        assertEquals(Channel.Kind.SERIES, M3uParser.guessKind("http://x.is/Series/1/2.mkv"))
        assertEquals(Channel.Kind.LIVE, M3uParser.guessKind("http://x.is/live/ruv.m3u8"))
    }

    @Test
    fun bomOgWindowsLinuskil() {
        val text = "\uFEFF#EXTM3U\r\n#EXTINF:-1 group-title=\"X\",RÚV\r\nhttp://x.is/ruv.m3u8\r\n"
        val ch = M3uParser.parse(text).channels
        assertEquals(1, ch.size)
        assertEquals("RÚV", ch[0].name)
        assertEquals("X", ch[0].group)
    }

    @Test
    fun slodAnExtinfFaerNafnUrSlodinni() {
        val ch = M3uParser.parse("#EXTM3U\nhttp://x.is/kanal1.m3u8").channels
        assertEquals(1, ch.size)
        assertEquals("kanal1.m3u8", ch[0].name)
        assertEquals(M3uParser.NO_GROUP, ch[0].group)
    }

    @Test
    fun nafnUrTvgNefniOgAnnNafns() {
        val text = "#EXTM3U\n#EXTINF:-1 tvg-name=\"Tegund\",\nhttp://x.is/a.m3u8\n" +
            "#EXTINF:-1,\nhttp://x.is/b.m3u8"
        val ch = M3uParser.parse(text).channels
        assertEquals("Tegund", ch[0].name)
        assertEquals(M3uParser.NO_NAME, ch[1].name)
    }

    // Lestr úr streymi (línu fyrir línu) á að skila nákvæmlega sama lista.
    @Test
    fun streymislesturSkilarSamaOgTexti() {
        val text = "#EXTM3U url-tvg=\"http://x.is/epg.xml\"\r\n" +
            "#EXTINF:-1 tvg-id=\"ruv\" group-title=\"Íslenskar\",RÚV\r\n" +
            "#EXTVLCOPT:http-user-agent=TestUA\r\n" +
            "http://x.is/ruv.m3u8\r\n" +
            "#EXTINF:-1 group-title=\"Sport\",Stöð 2 Sport\r\n" +
            "http://x.is/sport.m3u8\r\n"
        val a = M3uParser.parse(text)
        val b = M3uParser.parse(java.io.ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))
        assertEquals(a.epgUrl, b.epgUrl)
        assertEquals(a.channels, b.channels)
        assertEquals("TestUA", b.channels[0].userAgent)
        assertTrue(b.hasExtinf)
        assertTrue(b.hasUrlLine)
    }

    @Test
    fun gzipStreymurErOpnadur() {
        val text = "#EXTM3U\n#EXTINF:-1,RÚV\nhttp://x.is/ruv.m3u8\n"
        val bos = java.io.ByteArrayOutputStream()
        java.util.zip.GZIPOutputStream(bos).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        val list = M3uParser.parse(java.io.ByteArrayInputStream(bos.toByteArray()))
        assertEquals(1, list.channels.size)
        assertEquals("RÚV", list.channels[0].name)
    }

    // HTML-villuskjal (t.d. 404 síða) er ekki M3U: engin EXTINF og engin http-lína.
    @Test
    fun htmlSkjalErEkkiM3u() {
        val p = M3uParser.parse("<html><body>404</body></html>")
        assertFalse(p.hasExtinf)
        assertFalse(p.hasUrlLine)
    }
}
