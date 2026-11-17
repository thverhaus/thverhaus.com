package app.mulehead.ui

import app.mulehead.tr

import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.SettingsStore
import app.mulehead.data.VodKind
import app.mulehead.data.VodList
import app.mulehead.data.VodRepository
import app.mulehead.data.VodSeriesInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

// Allt sem skjár myndanna/þáttanna þarf að vita.
data class VodState(
    val kind: VodKind = VodKind.MOVIES,
    val loading: Boolean = false,
    val list: VodList? = null,
    val error: String? = null
)

// Staða eins þáttaraðar-skjás (tímabil og þættir).
data class SeriesState(
    val loading: Boolean = false,
    val info: VodSeriesInfo? = null,
    val error: String? = null
)

/**
 * Heldur utan um myndir og þætti. Sækir allt í bakgrunni (Dispatchers.IO) og
 * notar skyndiminnið í VodRepository þegar það er nýlegt.
 */
class VodViewModel(
    private val settings: SettingsStore,
    private val playlists: PlaylistRepository,
    private val vod: VodRepository
) {

    private val _state = MutableStateFlow(VodState())
    val state: StateFlow<VodState> = _state.asStateFlow()

    private val _series = MutableStateFlow(SeriesState())
    val series: StateFlow<SeriesState> = _series.asStateFlow()

    // Opnar myndir eða þætti (force = true sækir alltaf á netið).
    suspend fun open(kind: VodKind = _state.value.kind, force: Boolean = false) {
        val pl = settings.playlist
        if (pl == null) {
            _state.value = VodState(kind, error = NO_PLAYLIST)
            return
        }
        _state.value = VodState(kind, loading = true)
        _state.value = withContext(Dispatchers.IO) {
            // Fyrir M3U-lista koma myndirnar úr rásunum sjálfum (engin söfnun).
            val channels = playlists.cached(pl)?.channels.orEmpty()
            val data = vod.load(
                url = pl.url,
                channels = channels,
                kind = kind,
                key = pl.id,
                force = force,
                refreshHours = settings.refreshHours,
                userAgent = settings.userAgent
            )
            VodState(kind, list = data, error = data.error)
        }
    }

    // Sækir tímabil og þætti einnar þáttaraðar.
    suspend fun openSeries(id: String) {
        val pl = settings.playlist
        if (pl == null) {
            _series.value = SeriesState(error = NO_PLAYLIST)
            return
        }
        _series.value = SeriesState(loading = true)
        _series.value = withContext(Dispatchers.IO) {
            try {
                SeriesState(info = vod.seriesInfo(pl.url, id, userAgent = settings.userAgent))
            } catch (e: PlaylistException) {
                SeriesState(error = e.message)
            } catch (e: Exception) {
                SeriesState(error = tr("Unexpected error: ${e.message ?: e.javaClass.simpleName}", "Óvænt villa: ${e.message ?: e.javaClass.simpleName}"))
            }
        }
    }

    fun clearSeries() {
        _series.value = SeriesState()
    }

    companion object {
        val NO_PLAYLIST: String get() = tr("No list is set up", "Enginn listi er uppsettur")
    }
}
