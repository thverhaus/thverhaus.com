package app.mulehead

import app.mulehead.sync.MqttPackets
import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MqttPacketsTest {

    @Test
    fun `lengd pakkans er sjö bitar í einu`() {
        assertArrayEquals(byteArrayOf(0), MqttPackets.remainingLength(0))
        assertArrayEquals(byteArrayOf(127), MqttPackets.remainingLength(127))
        assertArrayEquals(byteArrayOf(0x80.toByte(), 1), MqttPackets.remainingLength(128))
        assertArrayEquals(byteArrayOf(0xFF.toByte(), 127), MqttPackets.remainingLength(16_383))
        assertArrayEquals(
            byteArrayOf(0x80.toByte(), 0x80.toByte(), 1),
            MqttPackets.remainingLength(16_384)
        )
        assertArrayEquals(
            byteArrayOf(0xFF.toByte(), 0xFF.toByte(), 0x7F),
            MqttPackets.remainingLength(2_097_151)
        )
    }

    @Test
    fun `strengur fær tveggja bæta lengd`() {
        assertArrayEquals(
            byteArrayOf(0, 3, 'a'.code.toByte(), 'b'.code.toByte(), 'c'.code.toByte()),
            MqttPackets.text("abc")
        )
        // Íslenskir stafir eru tveir bætir í UTF-8; lengdin telur bæti en ekki stafi.
        assertEquals(3, MqttPackets.text("ða").size - 2)
    }

    @Test
    fun `CONNECT segir MQTT 3_1_1 og inniheldur client-id`() {
        val p = MqttPackets.connect("mulehead-1", keepAliveSec = 30)
        assertEquals(0x10, p[0].toInt() and 0xFF)
        val body = String(p, 1, p.size - 1, Charsets.ISO_8859_1)
        assertTrue(body.contains("MQTT"))
        assertTrue(body.contains("mulehead-1"))
        // protocol level 3.1.1 er 4 (bæti 8) og keepalive er 30 sek (bæti 10–11).
        assertEquals(4, p[8].toInt())
        assertEquals(30, ((p[10].toInt() and 0xFF) shl 8) or (p[11].toInt() and 0xFF))
    }

    @Test
    fun `SUBSCRIBE biður um QoS 0`() {
        val p = MqttPackets.subscribe("mulehead/v1/room/ABCDE", id = 7)
        assertEquals(0x82, p[0].toInt() and 0xFF)
        assertEquals(7, p[3].toInt() and 0xFF)
        assertEquals(0, p[p.size - 1].toInt())
        assertTrue(String(p, 0, p.size, Charsets.ISO_8859_1).contains("mulehead/v1/room/ABCDE"))
    }

    @Test
    fun `PUBLISH má lesa aftur og þemað finnst`() {
        val payload = """{"id":"abc"}""".toByteArray(Charsets.UTF_8)
        val raw = MqttPackets.publish("mulehead/v1/room/KVOLD", payload)
        val read = MqttPackets.readPacket(ByteArrayInputStream(raw))
        assertEquals(0x30, read!!.first)
        val (topic, body) = MqttPackets.parsePublish(read.second)!!
        assertEquals("mulehead/v1/room/KVOLD", topic)
        assertArrayEquals(payload, body)
    }

    @Test
    fun `PING og DISCONNECT eru tveir bætir`() {
        assertArrayEquals(byteArrayOf(0xC0.toByte(), 0), MqttPackets.ping())
        assertArrayEquals(byteArrayOf(0xE0.toByte(), 0), MqttPackets.disconnect())
    }

    @Test
    fun `lokaður straumur skilar null og skemmdum pakka er hafnað`() {
        assertNull(MqttPackets.readPacket(ByteArrayInputStream(ByteArray(0))))
        assertNull(MqttPackets.parsePublish(byteArrayOf(0, 9, 'a'.code.toByte())))
        assertNull(MqttPackets.parsePublish(ByteArray(0)))
    }
}
