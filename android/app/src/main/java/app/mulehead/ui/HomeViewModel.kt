package app.mulehead.ui

import app.mulehead.tr

import app.mulehead.data.Channel
import app.mulehead.data.ChannelGroup
import app.mulehead.data.EpgData
import app.mulehead.data.EpgRepository
import app.mulehead.data.FolderOrder
import app.mulehead.data.HomeModel
import app.mulehead.data.LoadStep
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistData
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.PlaylistSettings
import app.mulehead.data.Programme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

// Allt sem skjárinn þarf að vita.
data class HomeState(
    val loading: Boolean = false,
    val playlist: Playlist? = null,
    val groups: List<ChannelGroup> = emptyList(),
    val rows: List<HomeModel.RowView> = emptyList(),
    val channelCount: Int = 0,
    val fetchedAt: Long = 0,
    val error: String? = null,
    val notice: String? = null,
    // Hvaða skref er verið að vinna í (sýnt á skjánum svo sjáist hvar bíður).
    val step: LoadStep = LoadStep.IDLE,
    // Dagskráin er að koma; rásirnar eru þegar sýnilegar.
    val epgLoading: Boolean = false,
    // Allar rásir listans (afbrigði sameinaðrar línu eru vísar inn í þennan lista).
    val channels: List<Channel> = emptyList(),
    // Allar möppur, líka faldar (fyrir „Fela möppur“ í stillingum).
    val allGroups: List<ChannelGroup> = emptyList(),
    val hidden: Set<String> = emptySet()
)

/**
 * Heldur utan um stöðuna á rásalistanum: sækir playlist og dagskrá, setur saman
 * línur og „nú og næst“.
 *
 * Listinn og dagskráin eru aðskilin: [load] birtir rásirnar um leið og þær eru
 * til (með dagskrá úr skyndimynd ef hún er til) og [loadEpg] sækir dagskrána í
 * sér coroutine. Þannig bíða rásirnar aldrei eftir stórri XMLTV-skrá.
 */
class HomeViewModel(
    private val settings: PlaylistSettings,
    private val playlists: PlaylistRepository,
    private val epg: EpgRepository,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    private val _state = MutableStateFlow(
        HomeState(playlist = settings.playlist, loading = settings.playlist != null)
    )
    val state: StateFlow<HomeState> = _state.asStateFlow()

    // Síðasta útkoma — notuð til að uppfæra „nú og næst“ án þess að sækja aftur.
    private var channels: List<Channel> = emptyList()
    private var programmes: Map<String, List<Programme>> = emptyMap()
    private var chanMap: List<String?> = emptyList()
    private var epgUrl = ""
    private var listNotice: String? = null
    private var groupOrder: List<String> = emptyList()
    private var providerGroups: List<String> = emptyList()
    // Allar línur (líka í földum möppum); það sem er sýnt er síað úr þessu.
    private var allRows: List<HomeModel.RowView> = emptyList()
    private var hidden: Set<String> = settings.hiddenGroups

    private fun shownRows(): List<HomeModel.RowView> =
        if (hidden.isEmpty()) allRows else allRows.filter { it.group !in hidden }

    // Setur allRows og birtir sýnilegu línurnar (síun og talning eru ódýr).
    private fun publishRows(rows: List<HomeModel.RowView>) {
        allRows = rows
        val shown = shownRows()
        _state.value = _state.value.copy(
            rows = shown,
            groups = HomeModel.groupCounts(shown, groupOrder),
            allGroups = HomeModel.groupCounts(allRows, groupOrder),
            hidden = hidden
        )
    }

    // Hver hleðsla fær númer. Eldri hleðsla sem klárast seinna má ekki skrifa
    // yfir nýrri (t.d. ef skipt er um lista eða ýtt er á „Reyna aftur“).
    private var epoch = 0
    private var epgSeq = 0

    /**
     * Sækir listann og birtir rásirnar. Bíður ekki eftir dagskránni; kallaðu á
     * [loadEpg] næst.
     */
    suspend fun load(force: Boolean = false) {
        val pl = settings.playlist
        if (pl == null) {
            _state.value = HomeState()
            return
        }
        val mine = ++epoch
        _state.value = _state.value.copy(
            loading = true,
            step = LoadStep.LIST_FETCH,
            playlist = pl,
            error = null,
            notice = null,
            epgLoading = false
        )
        try {
            val data = withContext(Dispatchers.IO) {
                playlists.load(
                    p = pl,
                    force = force,
                    refreshHours = settings.refreshHours,
                    userAgent = settings.userAgent,
                    onStep = { s -> stepIf(mine, s) }
                )
            }
            if (mine != epoch) return
            // Rásirnar birtast strax — án þess að bíða eftir skyndimynd eða neti.
            publishList(pl, data, notice = null)
            val snap = withContext(Dispatchers.IO) { epg.snapshot(data.epgUrl, data.channels, pl.id, clock()) }
            if (mine != epoch) return
            if (snap != null) applyEpg(snap, loading = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: OutOfMemoryError) {
            if (mine == epoch) fail(pl, PlaylistRepository.OOM_MESSAGE)
        } catch (e: PlaylistException) {
            if (mine != epoch) return
            val cached = withContext(Dispatchers.IO) { playlists.cached(pl) }
            if (mine != epoch) return
            if (cached == null) {
                fail(pl, e.message)
            } else {
                publishList(pl, cached, notice = e.message)
                val snap = withContext(Dispatchers.IO) {
                    epg.snapshot(cached.epgUrl, cached.channels, pl.id, clock())
                }
                if (mine != epoch) return
                if (snap != null) applyEpg(snap, loading = false)
            }
        } catch (e: Exception) {
            if (mine == epoch) fail(pl, tr("Unexpected error: ${e.message ?: e.javaClass.simpleName}", "Óvænt villa: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    /**
     * Sækir dagskrána og uppfærir raðirnar þegar hún kemur. Rásirnar sem þegar
     * eru sýnilegar haldast alveg þótt þetta mistakist.
     */
    suspend fun loadEpg(force: Boolean = false) {
        val pl = _state.value.playlist ?: return
        val chans = channels
        if (chans.isEmpty()) return
        val myEpoch = epoch
        val mine = ++epgSeq
        val url = epgUrl
        _state.value = _state.value.copy(
            epgLoading = true,
            step = LoadStep.EPG_FETCH,
            notice = listNotice
        )
        try {
            val data = withContext(Dispatchers.IO) {
                epg.load(
                    url = url,
                    channels = chans,
                    key = pl.id,
                    force = force,
                    refreshHours = settings.refreshHours,
                    userAgent = settings.userAgent,
                    now = clock(),
                    onStep = { s -> if (mine == epgSeq && myEpoch == epoch) step(s) }
                )
            }
            if (mine != epgSeq || myEpoch != epoch) return
            applyEpg(data)
        } catch (e: CancellationException) {
            throw e
        } catch (e: OutOfMemoryError) {
            finishEpg(mine, myEpoch, PlaylistRepository.OOM_MESSAGE)
        } catch (e: Exception) {
            finishEpg(mine, myEpoch, tr("Unexpected EPG error: ${e.message ?: e.javaClass.simpleName}", "Óvænt villa í dagskrá: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    /** Notandinn raðaði flokkunum: vista og birta strax (ekkert net). */
    suspend fun setGroupOrder(order: List<String>) {
        (settings as? app.mulehead.data.SettingsStore)?.customGroupOrder = order
        groupOrder = FolderOrder.withCustom(providerGroups, order)
        // Aðeins röð flokkanna breytist: línurnar eru færðar til, ekki smíðaðar upp á nýtt.
        publishRows(withContext(Dispatchers.Default) { HomeModel.reorderGroups(allRows, groupOrder) })
    }

    /** Stillingar → Fela möppur. */
    fun setHidden(groups: Set<String>) {
        (settings as? app.mulehead.data.SettingsStore)?.hiddenGroups = groups
        hidden = groups
        publishRows(allRows)
    }

    fun currentGroupOrder(): List<String> = groupOrder

    // Endurreiknar „nú og næst“ (kallað á mínútufresti eða eftir að stillingum er breytt).
    // Notar sama dagskrárgögn og síðasta sókn — ekkert net.
    suspend fun tick() {
        if (channels.isEmpty() || allRows.isEmpty()) return
        // Aðeins „nú og næst“ breytist á mínútu fresti: línurnar sjálfar eru óbreyttar.
        val rows = withContext(Dispatchers.Default) {
            HomeModel.withNowNext(allRows, programmes, chanMap, clock(), offsetMs())
        }
        publishRows(rows)
    }

    private fun step(s: LoadStep) {
        _state.value = _state.value.copy(step = s)
    }

    private fun stepIf(mine: Int, s: LoadStep) {
        if (mine == epoch) step(s)
    }

    private fun offsetMs(): Long = settings.epgOffsetMin * 60_000L

    private fun rowsNow(): List<HomeModel.RowView> = HomeModel.rows(
        channels = channels,
        programmes = programmes,
        chanMap = chanMap,
        nowMs = clock(),
        offsetMs = offsetMs(),
        merge = settings.mergeVariants,
        sort = settings.sortAZ,
        groupOrder = groupOrder
    )

    private suspend fun publishList(pl: Playlist, data: PlaylistData, notice: String?) {
        channels = data.channels
        providerGroups = data.groups.map { it.name }
        groupOrder = FolderOrder.withCustom(providerGroups, settings.customGroupOrder)
        epgUrl = data.epgUrl
        listNotice = notice
        programmes = emptyMap()
        chanMap = emptyList()
        // Raðirnar eru byggðar í bakgrunni: 60.000 rásir taka sinn tíma og
        // skjárinn á ekki að frjósa meðan.
        // Tímamæling fyrir `adb logcat -s Mulehead` (Android-föllin eru ekki til í JVM-prófum).
        val t0 = runCatching { android.os.SystemClock.elapsedRealtime() }.getOrDefault(0L)
        val rows = withContext(Dispatchers.Default) { rowsNow() }
        runCatching {
            val now = android.os.SystemClock.elapsedRealtime()
            android.util.Log.i(
                "Mulehead",
                "list: rows=${rows.size} build=${now - t0}ms ${app.mulehead.data.ChannelRows.lastTimings}"
            )
        }
        allRows = rows
        val shown = shownRows()
        val groups = withContext(Dispatchers.Default) { HomeModel.groupCounts(shown, groupOrder) }
        _state.value = HomeState(
            loading = false,
            playlist = pl,
            groups = groups,
            rows = shown,
            allGroups = HomeModel.groupCounts(rows, groupOrder),
            hidden = hidden,
            channelCount = data.channels.size,
            fetchedAt = data.fetchedAt,
            error = null,
            notice = notice,
            step = LoadStep.IDLE,
            epgLoading = false,
            channels = data.channels
        )
    }

    private suspend fun applyEpg(data: EpgData, loading: Boolean = false) {
        programmes = data.programmes
        chanMap = data.chanMap
        // Ný dagskrá: sömu línur, nýtt „nú og næst“ (ekki smíða allt upp á nýtt).
        val rows = withContext(Dispatchers.Default) {
            if (allRows.isNotEmpty()) HomeModel.withNowNext(allRows, programmes, chanMap, clock(), offsetMs())
            else rowsNow()
        }
        publishRows(rows)
        _state.value = _state.value.copy(
            notice = listNotice ?: data.error,
            step = LoadStep.IDLE,
            epgLoading = loading
        )
    }

    private fun finishEpg(mine: Int, myEpoch: Int, error: String) {
        if (mine != epgSeq || myEpoch != epoch) return
        _state.value = _state.value.copy(
            notice = listNotice ?: error,
            step = LoadStep.IDLE,
            epgLoading = false
        )
    }

    private fun fail(pl: Playlist, message: String?) {
        channels = emptyList()
        programmes = emptyMap()
        chanMap = emptyList()
        epgUrl = ""
        listNotice = null
        _state.value = HomeState(
            playlist = pl,
            error = message ?: tr("Unknown error", "Óþekkt villa"),
            step = LoadStep.IDLE
        )
    }
}

