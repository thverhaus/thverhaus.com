package app.mulehead.player

/**
 * Áminningar þegar bufferinn lækkar (40 / 30 / 20 / 10 sek).
 *
 * Reglurnar (ákveðnar með notandanum 11. nóv. 2026):
 * - 40–60 sek er öruggt svæði: þar er ekkert sagt.
 * - Hver viðvörun kemur aðeins einu sinni. Hún getur komið aftur þegar bufferinn
 *   hefur náð sér [rearmSec] sekúndum yfir mörkin (flökt á milli 29 og 31 = ein viðvörun).
 * - Þegar bufferinn er kominn aftur í öruggt svæði byrjar allt upp á nýtt.
 * - Ekkert er sagt á meðan bufferinn er að fyllast í byrjun (fyrr en hann hefur einu
 *   sinni náð öruggu svæði), og [reset] er kallað við nýja rás, endurtengingu og hleðslu.
 */
class BufferAlerts(
    private val levels: List<Int> = DEFAULT_LEVELS,
    private val rearmSec: Int = 10
) {
    private val fired = HashSet<Int>()
    private var armed = false

    fun reset() {
        fired.clear()
        armed = false
    }

    /**
     * Ný mæling á buffer (sekúndur). `mark` er buffer-markið í stillingum: mörk yfir því
     * eiga ekki við. Skilar lægstu mörkunum sem bufferinn var að fara niður fyrir, eða null.
     */
    fun update(sec: Int, mark: Int = 60): Int? {
        val active = levels.filter { it < mark }
        if (active.isEmpty()) return null
        val safe = active.max()
        if (sec >= safe) {
            armed = true
            fired.clear()
            return null
        }
        if (!armed) return null
        fired.removeAll { sec >= it + rearmSec }
        val crossed = active.filter { sec < it && it !in fired }
        if (crossed.isEmpty()) return null
        fired.addAll(crossed)
        return crossed.min()
    }

    companion object {
        val DEFAULT_LEVELS = listOf(40, 30, 20, 10)

        // Undir þessu er mælt með að hlaða buffer aftur.
        const val ACTION_LEVEL = 20
    }
}
