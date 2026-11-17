package app.mulehead.data

import app.mulehead.tr

/**
 * Hreinar reglur fyrir stillingaskjáinn: hve mikið má hliðra, hvaða skref eru í boði
 * og hvernig eigið að birta gildin. Enginn Android-kóði svo hægt sé að prófa þetta.
 */
object SettingsRules {

    // Buffer í sekúndum (sama bil og í Mac: 2–120).
    const val BUFFER_MIN = 2
    const val BUFFER_MAX = 120
    const val BUFFER_STEP = 5

    // Hliðrun dagskrár í mínútum, í 30 mín skrefum út í ±12 klst.
    const val OFFSET_STEP = 30
    const val OFFSET_MAX = 720

    // Uppfærslufrestir sem boðið er upp á (sama og í Mac).
    val REFRESH_CHOICES: List<Int> = listOf(6, 12, 24, 72)

    fun stepBuffer(current: Int, delta: Int): Int =
        (current + delta).coerceIn(BUFFER_MIN, BUFFER_MAX)

    fun stepOffset(current: Int, delta: Int): Int =
        (current + delta).coerceIn(-OFFSET_MAX, OFFSET_MAX)

    // Næsti/síðasti valkostur í lista (hringekja).
    fun cycleChoice(choices: List<Int>, current: Int, delta: Int): Int {
        if (choices.isEmpty()) return current
        val i = choices.indexOf(current).takeIf { it >= 0 } ?: 0
        val next = (i + delta).mod(choices.size)
        return choices[next]
    }

    fun bufferLabel(sec: Int): String = tr("$sec s", "$sec sek")

    fun offsetLabel(min: Int): String = when {
        min == 0 -> tr("0 min", "0 mín")
        min > 0 -> tr("+$min min", "+$min mín")
        else -> tr("$min min", "$min mín")
    }

    fun refreshLabel(hours: Int): String = when (hours) {
        24 -> tr("daily", "sólarhring")
        72 -> tr("3 days", "3 dagar")
        else -> tr("$hours h", "$hours klst")
    }
}
