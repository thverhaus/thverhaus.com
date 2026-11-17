package app.mulehead.player

/**
 * Biðtími milli endurtenginga á beinum rásum: 1, 2, 4, 8, 16, 30, 30 … sekúndur.
 * Teljarinn núllstillist þegar straumur hefur spilast vel í [resetAfterMs] án villu —
 * þannig byrjar rás sem dettur út sjaldan alltaf á 1 sekúndu, en rás sem er í rugli
 * fær lengri og lengri bið (svo appið hamri ekki á þjóninum).
 */
class RetryPolicy(
    private val baseMs: Long = 1_000L,
    private val maxMs: Long = 30_000L,
    private val resetAfterMs: Long = 20_000L
) {

    // Hversu oft hefur verið reynt síðan síðasta góða spilun.
    var attempt: Int = 0
        private set

    // Biðtími fyrir næstu tilraun; hækkar teljarann um eitt.
    fun nextDelayMs(): Long {
        val shift = attempt.coerceAtMost(5)
        attempt += 1
        return (baseMs shl shift).coerceAtMost(maxMs)
    }

    // Kallað þegar straumur hefur spilast án villu í [playedMs] millisekúndur.
    fun onStablePlayback(playedMs: Long) {
        if (playedMs >= resetAfterMs) attempt = 0
    }

    // Handvirk endurtenging (hnappur) byrjar alltaf frá byrjun.
    fun reset() {
        attempt = 0
    }
}
