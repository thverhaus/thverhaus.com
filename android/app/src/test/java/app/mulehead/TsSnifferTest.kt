package app.mulehead

import app.mulehead.sync.TsSniffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TsSnifferTest {

    // 33-bita tímastimpill í 5 bæti (PTS/DTS sniðið sem straumurinn notar).
    private fun stamp(v: Long): ByteArray = byteArrayOf(
        (0x21 or ((((v ushr 30) and 0x07).toInt()) shl 1)).toByte(),
        ((v ushr 22) and 0xff).toByte(),
        (((((v ushr 15) and 0x7f).toInt()) shl 1) or 1).toByte(),
        ((v ushr 7) and 0xff).toByte(),
        ((((v and 0x7f).toInt()) shl 1) or 1).toByte()
    )

    // Einn 188-bæta TS-pakki með PES-haus (eins og í raunverulegu streymi).
    private fun packet(pid: Int, sid: Int, pts: Long, dts: Long? = null): ByteArray {
        val b = ByteArray(188) { 0xFF.toByte() }
        b[0] = 0x47
        b[1] = (0x40 or ((pid shr 8) and 0x1f)).toByte()   // PES byrjar hér
        b[2] = (pid and 0xff).toByte()
        b[3] = 0x10                                        // aðeins payload
        var p = 4
        b[p++] = 0
        b[p++] = 0
        b[p++] = 1
        b[p++] = sid.toByte()
        b[p++] = 0
        b[p++] = 0
        b[p++] = 0x80.toByte()
        b[p++] = if (dts != null) 0xC0.toByte() else 0x80.toByte()
        b[p++] = if (dts != null) 0x0A else 0x05
        stamp(pts).copyInto(b, p)
        p += 5
        if (dts != null) {
            stamp(dts).copyInto(b, p)
            p += 5
        }
        return b
    }

    private val video = packet(pid = 0x0100, sid = 0xE0, pts = 9_000_000, dts = 9_000_000)
    private val audio = packet(pid = 0x0101, sid = 0xC0, pts = 8_999_100)

    @Test
    fun `les grunn úr mynd og hljóði`() {
        val s = TsSniffer()
        s.push(video + audio)
        assertEquals(8_999_100 / 90000.0, s.base()!!, 1e-9)
        assertTrue(s.done)
    }

    @Test
    fun `grunnur er lægri stimpillinn`() {
        val s = TsSniffer()
        s.push(audio + video)
        assertEquals(8_999_100 / 90000.0, s.base()!!, 1e-9)
    }

    @Test
    fun `býr til grunn þótt aðeins annar vanti`() {
        val s = TsSniffer()
        s.push(video)
        assertEquals(9_000_000 / 90000.0, s.base()!!, 1e-9)
    }

    @Test
    fun `bætir saman bútum sem klofna`() {
        val all = video + audio
        val s = TsSniffer()
        s.push(all, 100)              // klofnar inni í fyrsta pakka
        assertNull(s.base())
        s.push(all.copyOfRange(100, all.size))
        assertEquals(8_999_100 / 90000.0, s.base()!!, 1e-9)
    }

    @Test
    fun `hunsar rusl fyrir framan fyrsta pakka`() {
        val s = TsSniffer()
        s.push(ByteArray(37) { 0x11 } + audio)
        assertEquals(8_999_100 / 90000.0, s.base()!!, 1e-9)
    }

    @Test
    fun `hættir eftir fjórar megabætur af rusli`() {
        val s = TsSniffer()
        var left = 4_100_000
        val junk = ByteArray(10_000) { 0x22 }
        while (left > 0) {
            s.push(junk)
            left -= junk.size
        }
        assertTrue(s.done)
        assertNull(s.base())
    }

    @Test
    fun `readTs les 33-bita töluna`() {
        val v = 5_000_000_123L
        assertEquals(v, TsSniffer.readTs(stamp(v), 0))
        assertEquals(0L, TsSniffer.readTs(stamp(0), 0))
        assertEquals(8_589_934_591L, TsSniffer.readTs(stamp(8_589_934_591L), 0))
    }
}
