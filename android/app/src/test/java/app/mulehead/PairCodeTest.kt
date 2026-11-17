package app.mulehead

import app.mulehead.pairing.PairCode
import app.mulehead.pairing.PairSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairCodeTest {

    @Test
    fun stafrofidSleppirTviraedumStofum() {
        for (c in "01OI") assertFalse(c in PairCode.ALPHABET)
        assertEquals(32, PairCode.ALPHABET.length)
        assertEquals(8, PairCode.LENGTH)
    }

    @Test
    fun normalizeHreinsarBandstrikOgBil() {
        assertEquals("ABCD2345", PairCode.normalize("abcd-2345"))
        assertEquals("ABCD2345", PairCode.normalize(" AB CD 2345 "))
        assertNull(PairCode.normalize("ABCD-23O5"))
        assertNull(PairCode.normalize(""))
    }

    @Test
    fun isCompleteKrefstAttaStafa() {
        assertTrue(PairCode.isComplete("ABCD-2345"))
        assertFalse(PairCode.isComplete("ABCD-234"))
        assertFalse(PairCode.isComplete("ABCD-234O"))
    }

    @Test
    fun formatSeturBandstrikMilliFjogurraStafa() {
        assertEquals("ABCD-2345", PairCode.format("abcd2345"))
        assertEquals("ABCD-2345", PairCode.format("ABCD-2345"))
    }

    @Test
    fun sessionRennurUtEftirTima() {
        val s = PairSession(
            code = "ABCD2345",
            secret = "s3cret",
            createdAt = 1_000_000L,
            expiresAt = 1_000_000L + PairSession.TTL_MS
        )
        assertFalse(s.isExpired(1_000_000L))
        assertFalse(s.isExpired(1_000_000L + PairSession.TTL_MS - 1))
        assertTrue(s.isExpired(1_000_000L + PairSession.TTL_MS))
        assertEquals(10 * 60_000L, PairSession.TTL_MS)
    }
}
