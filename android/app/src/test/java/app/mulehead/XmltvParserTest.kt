package app.mulehead

import app.mulehead.data.XmltvParser
import app.mulehead.data.Programme
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class XmltvParserTest {

    // 2024-01-01 12:00:00 UTC
    private val now = 1704110400000L

    @Test
    fun timiMedOgAnTimabeltis() {
        assertEquals(now, XmltvParser.parseXmltvTime("20240101120000 +0000"))
        assertEquals(now + 5 * 3_600_000L, XmltvParser.parseXmltvTime("20240101120000 -0500"))
        assertEquals(now - 2 * 3_600_000L, XmltvParser.parseXmltvTime("20240101120000 +0200"))
        assertEquals(now, XmltvParser.parseXmltvTime("20240101120000"))
        assertEquals(0L, XmltvParser.parseXmltvTime(""))
        assertEquals(0L, XmltvParser.parseXmltvTime(null))
        assertEquals(0L, XmltvParser.parseXmltvTime("rusl"))
    }

    @Test
    fun normHreinsarAfleysingarOgGaedi() {
        assertEquals("ruv", XmltvParser.norm("RÚV"))
        assertEquals("ruv", XmltvParser.norm("RÚV HD"))
        assertEquals("sto2sport", XmltvParser.norm("Stöð 2 Sport"))
        assertEquals("", XmltvParser.norm(""))
        assertEquals("", XmltvParser.norm(null))
    }

    @Test
    fun looseNormFelldirSamanLondOgUtgafur() {
        assertEquals(
            "skysportsmainevent",
            XmltvParser.looseNorm("UK: Sky Sports Main Event FHD B")
        )
        assertEquals("skysportsmainevent", XmltvParser.looseNorm("Sky Sports Main Event"))
    }

    private val xml = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
         <channel id="ruv.is"><display-name>RÚV</display-name></channel>
         <channel id="stod2.is"><display-name>Stöð 2 Sport HD</display-name></channel>
         <programme start="20240101110000 +0000" stop="20240101120000 +0000" channel="ruv.is">
          <title>Fréttir</title>
          <desc>Daglegar fréttir</desc>
         </programme>
         <programme start="20240101120000 +0000" channel="ruv.is">
          <title>Næsti þáttur</title>
         </programme>
         <programme start="20240101100000 +0000" stop="20240101110000 +0000" channel="stod2.is">
          <title>Sport</title>
         </programme>
         <programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="okunn">
          <title>Ekki þetta</title>
         </programme>
         <programme start="20231201120000 +0000" stop="20231201130000 +0000" channel="ruv.is">
          <title>Gamalt</title>
         </programme>
        </tv>
    """.trimIndent()

    @Test
    fun lesDagskraOgTengirNofn() {
        val r = XmltvParser.parse(
            xml,
            wantIds = setOf("ruv.is"),
            wantNames = setOf("ruv", "sto2sport"),
            now = now
        )
        assertEquals(setOf("ruv.is", "stod2.is"), r.programmes.keys)
        assertFalse(r.programmes.containsKey("okunn"))
        assertTrue(r.programmes.containsKey("stod2.is"))
        val ruv = r.programmes.getValue("ruv.is")
        assertEquals(2, ruv.size)
        assertEquals("Fréttir", ruv[0].title)
        assertEquals("Daglegar fréttir", ruv[0].desc)
        assertEquals(now - 3_600_000L, ruv[0].start)
        assertEquals(now, ruv[0].stop)
        assertEquals("Næsti þáttur", ruv[1].title)
        // stop vantar -> start + 1 klst
        assertEquals(now + 3_600_000L, ruv[1].stop)
        assertEquals("ruv.is", r.nameToId["ruv"])
        assertEquals("stod2.is", r.nameToId["sto2sport"])
    }

    @Test
    fun tengirMedLausuNafni() {
        val text = """
            <tv>
             <channel id="uk.sky"><display-name>UK: Sky Sports Main Event FHD B</display-name></channel>
             <programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="uk.sky">
              <title>Fótbolti</title>
             </programme>
            </tv>
        """.trimIndent()
        val r = XmltvParser.parse(
            text, emptySet(), emptySet(), setOf("skysportsmainevent"), now
        )
        assertEquals("uk.sky", r.nameToIdLoose["skysportsmainevent"])
        assertEquals(1, r.programmes.getValue("uk.sky").size)
    }

    @Test
    fun lesGzipStreymi() {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(xml.toByteArray(Charsets.UTF_8)) }
        val r = XmltvParser.parse(
            java.io.ByteArrayInputStream(bos.toByteArray()),
            setOf("ruv.is"), setOf("ruv"), null, now
        )
        assertEquals(2, r.programmes.getValue("ruv.is").size)
    }

    @Test
    fun langLysingStyttist() {
        val long = "x".repeat(500)
        val text = "<tv><programme start=\"20240101120000 +0000\" channel=\"a\">" +
            "<title>T</title><desc>" + long + "</desc></programme></tv>"
        val r = XmltvParser.parse(text, setOf("a"), emptySet(), null, now)
        assertEquals(400, r.programmes.getValue("a")[0].desc.length)
    }

    @Test
    fun sortUniqRadarOgFjarlaegirTvitekningar() {
        val a = Programme(now, now + 1000, "A", "")
        val b = Programme(now + 5000, now + 9000, "B", "")
        val out = XmltvParser.sortUniq(listOf(b, a, a))
        assertEquals(2, out.size)
        assertEquals("A", out[0].title)
        assertEquals("B", out[1].title)
    }
}
