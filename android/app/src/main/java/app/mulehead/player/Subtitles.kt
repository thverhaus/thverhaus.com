package app.mulehead.player

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import app.mulehead.Lang
import app.mulehead.tr
import java.util.Locale

/** Einn valkostur í „Subtitles“: Off eða einn texti sem fylgir myndinni. */
data class SubOption(
    val key: String,          // "off" eða lykill textans (tungumál, annars nafn)
    val label: String,        // það sem birtist á takkanum
    val group: Tracks.Group?, // null = Off
    val index: Int = 0
)

/**
 * Textar í myndum og þáttum: listi yfir textana sem fylgja skránni, val á milli þeirra
 * og „Off“. Valið er munað (tungumálið), svo næsta mynd byrji eins.
 */
object Subtitles {
    const val OFF = "off"

    fun keyOf(f: Format): String =
        f.language?.takeIf { it.isNotBlank() && it != "und" }?.lowercase()
            ?: f.label?.takeIf { it.isNotBlank() }?.lowercase()
            ?: (f.id ?: "?")

    private fun labelOf(f: Format): String {
        val lang = f.language?.takeIf { it.isNotBlank() && it != "und" }
        val shown = if (lang != null) {
            val loc = if (Lang.isIcelandic) Locale.forLanguageTag("is") else Locale.ENGLISH
            Locale.forLanguageTag(lang).getDisplayLanguage(loc)
                .replaceFirstChar { it.titlecase(loc) }
                .ifBlank { lang }
        } else null
        val name = f.label?.takeIf { it.isNotBlank() && !it.equals(shown, ignoreCase = true) }
        val forced = (f.selectionFlags and C.SELECTION_FLAG_FORCED) != 0
        return listOfNotNull(shown ?: name ?: tr("Subtitle", "Texti"), if (shown != null) name else null)
            .joinToString(" · ") + if (forced) tr(" (forced)", " (þvingaður)") else ""
    }

    /** Off fyrst, svo allir textar sem spilarinn ræður við. Tómt ef enginn texti fylgir. */
    fun options(tracks: Tracks): List<SubOption> {
        val out = ArrayList<SubOption>()
        for (g in tracks.groups) {
            if (g.type != C.TRACK_TYPE_TEXT) continue
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                val f = g.getTrackFormat(i)
                out.add(SubOption(keyOf(f), labelOf(f), g, i))
            }
        }
        if (out.isEmpty()) return emptyList()
        // Sami lykill tvisvar (t.d. tveir enskir textar): nafnið greinir á milli.
        return listOf(SubOption(OFF, tr("Off", "Af"), null)) + out
    }

    /** Valkosturinn sem er í notkun núna (Off ef enginn texti er valinn). */
    fun current(player: Player, opts: List<SubOption>): SubOption? {
        if (opts.isEmpty()) return null
        val disabled = C.TRACK_TYPE_TEXT in player.trackSelectionParameters.disabledTrackTypes
        if (!disabled) {
            opts.firstOrNull { o -> o.group != null && o.group.isTrackSelected(o.index) }?.let { return it }
        }
        return opts.first()
    }

    fun apply(player: Player, opt: SubOption) {
        val b = player.trackSelectionParameters.buildUpon()
        if (opt.group == null) {
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(opt.group.mediaTrackGroup, opt.index))
        }
        player.trackSelectionParameters = b.build()
    }

    /**
     * Þegar textarnir koma inn: velur það sem notandinn valdi síðast.
     * pref "" = eins og skráin segir, "off" = slökkt, annars tungumálið (eða nafnið).
     */
    fun applyPreference(player: Player, opts: List<SubOption>, pref: String) {
        if (opts.isEmpty() || pref.isEmpty()) return
        val want = if (pref == OFF) opts.first() else opts.firstOrNull { it.key == pref } ?: return
        if (current(player, opts) != want) apply(player, want)
    }
}
