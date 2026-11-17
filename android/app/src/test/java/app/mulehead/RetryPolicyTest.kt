package app.mulehead

import app.mulehead.player.RetryPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class RetryPolicyTest {

    @Test
    fun `biðtími hækkar tvöfalt upp að hámarki`() {
        val p = RetryPolicy()
        assertEquals(1_000L, p.nextDelayMs())
        assertEquals(2_000L, p.nextDelayMs())
        assertEquals(4_000L, p.nextDelayMs())
        assertEquals(8_000L, p.nextDelayMs())
        assertEquals(16_000L, p.nextDelayMs())
        assertEquals(30_000L, p.nextDelayMs())
    }

    @Test
    fun `biðtími fer aldrei yfir hámark`() {
        val p = RetryPolicy(maxMs = 10_000L)
        repeat(20) { p.nextDelayMs() }
        assertEquals(10_000L, p.nextDelayMs())
    }

    @Test
    fun `teljarinn hækkar með hverri tilraun`() {
        val p = RetryPolicy()
        assertEquals(0, p.attempt)
        p.nextDelayMs()
        p.nextDelayMs()
        assertEquals(2, p.attempt)
    }

    @Test
    fun `núllstillir eftir nógu langa góða spilun`() {
        val p = RetryPolicy(resetAfterMs = 20_000L)
        repeat(4) { p.nextDelayMs() }
        p.onStablePlayback(19_999L)
        assertEquals(4, p.attempt)
        p.onStablePlayback(20_000L)
        assertEquals(0, p.attempt)
        assertEquals(1_000L, p.nextDelayMs())
    }

    @Test
    fun `reset byrjar frá byrjun`() {
        val p = RetryPolicy()
        repeat(3) { p.nextDelayMs() }
        p.reset()
        assertEquals(0, p.attempt)
        assertEquals(1_000L, p.nextDelayMs())
    }
}
