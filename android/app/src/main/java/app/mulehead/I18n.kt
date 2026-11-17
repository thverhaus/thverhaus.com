package app.mulehead

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Tungumál appsins. Enska er sjálfgefin; íslenska er valin í stillingum.
 * `code` er Compose-ástand, svo skjárinn teiknast strax upp á nýju máli.
 */
object Lang {
    const val EN = "en"
    const val IS = "is"
    var code by mutableStateOf(EN)
    val isIcelandic: Boolean get() = code == IS
}

/** Texti á réttu máli: fyrst enska, svo íslenska. */
fun tr(en: String, isl: String): String = if (Lang.code == Lang.IS) isl else en
