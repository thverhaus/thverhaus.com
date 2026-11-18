package app.mulehead

import android.app.Activity
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.focus.FocusRequester
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import app.mulehead.data.ChannelRows
import app.mulehead.data.EpgRepository
import app.mulehead.data.ChannelHealth
import app.mulehead.data.FolderOrder
import app.mulehead.data.Personal
import app.mulehead.data.VodKind
import app.mulehead.data.HomeModel
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.SettingsStore
import app.mulehead.data.VodItem
import app.mulehead.data.VodRepository
import app.mulehead.pairing.PairController
import app.mulehead.pairing.PairingClient
import app.mulehead.pairing.PlaylistInstaller
import app.mulehead.sync.SyncManager
import app.mulehead.update.Updater
import app.mulehead.sync.SyncRoom
import app.mulehead.ui.AddPlaylistScreen
import app.mulehead.ui.DRAWER_COLLAPSED
import app.mulehead.ui.ExitDialog
import app.mulehead.ui.HiddenGroupsScreen
import app.mulehead.ui.HomeScreen
import app.mulehead.ui.NavDrawer
import app.mulehead.ui.SearchScreen
import app.mulehead.ui.Section
import app.mulehead.ui.HomeViewModel
import app.mulehead.ui.PairScreen
import app.mulehead.ui.PlayerScreen
import app.mulehead.ui.SeriesScreen
import app.mulehead.ui.SettingsScreen
import app.mulehead.ui.SyncPanel
import app.mulehead.ui.VodScreen
import app.mulehead.ui.VodViewModel
import app.mulehead.ui.theme.MuleheadTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Eitthvað sem á að spila (mynd, þáttur eða bein rás).
private data class PlayRequest(val title: String, val subtitle: String, val url: String)

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalTvMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Svo imePadding virki þegar lyklaborðið opnast á innsláttarskjánum.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // Tungumálið er lesið áður en fyrsti skjárinn teiknast (enska ef ekkert er vistað).
        Lang.code = SettingsStore(this).language
        setContent {
            MuleheadTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    shape = RectangleShape
                ) {
                    MuleheadApp()
                }
            }
        }
    }
}

/**
 * Rót appins: fyrsta keyrsla -> skjár til að setja inn M3U-hlekk, annars rásalistinn.
 * Allt sem þarf net sækist í bakgrunni og skjárinn sýnir stöðuna meðan á því stendur.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MuleheadApp() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings = remember { SettingsStore(ctx) }
    val playlists = remember { PlaylistRepository(ctx.cacheDir) }
    val epgRepo = remember { EpgRepository(ctx.cacheDir) }
    val vm = remember {
        HomeViewModel(
            settings = settings,
            playlists = playlists,
            epg = epgRepo
        )
    }
    val vodVm = remember {
        VodViewModel(
            settings = settings,
            playlists = playlists,
            vod = VodRepository(ctx.cacheDir)
        )
    }
    val state by vm.state.collectAsState()
    // „Leita að uppfærslu“: athugað í bakgrunni 30 sek eftir ræsingu (mest einu sinni á
    // sólarhring) svo það tefji aldrei rásirnar.
    val updater = remember { Updater(ctx) }
    val updateUi by updater.ui.collectAsState()
    LaunchedEffect(Unit) {
        delay(30_000)
        updater.check(force = false)
    }
    val vodState by vodVm.state.collectAsState()
    val seriesState by vodVm.series.collectAsState()
    var editing by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    var hideOpen by remember { mutableStateOf(false) }
    var vodOpen by remember { mutableStateOf(false) }
    var seriesItem by remember { mutableStateOf<VodItem?>(null) }
    var playing by remember { mutableStateOf<PlayRequest?>(null) }
    var opened by remember { mutableStateOf<HomeModel.RowView?>(null) }
    // Valinn flokkur og síðasta rás lifa af spilarann (og snúning/endurræsingu skjás).
    var group by rememberSaveable { mutableStateOf<String?>(null) }
    var focusKey by rememberSaveable { mutableStateOf<String?>(null) }
    // Hvaða afbrigði sameinaðrar rásar er í spilun (0 = besta).
    var variantIdx by remember { mutableIntStateOf(0) }
    // Satt eftir rásaskipti/afbrigðaskipti í spilaranum: þá birtist ekki allt yfirlagið.
    var quiet by remember { mutableStateOf(false) }
    // Hækkar þegar röðun möppu breytist, svo listinn sé reiknaður aftur.
    var prefsGen by remember { mutableIntStateOf(0) }
    // Valmyndin vinstra megin: hvaða hluti er opinn, og „Viltu loka forritinu?“.
    var section by rememberSaveable { mutableStateOf(Section.TV) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    // Myndir/Þættir: flokkur og síðasta atriði lifa af spilarann.
    var vodCategory by rememberSaveable { mutableStateOf<String?>(null) }
    var vodSort by remember { mutableStateOf(settings.vodSort) }
    // Faldar möppur í myndum og þáttum, og hvort „Fela möppur“ fyrir þær er opið.
    var vodHiddenMovies by remember { mutableStateOf(settings.vodHidden(true)) }
    var vodHiddenSeries by remember { mutableStateOf(settings.vodHidden(false)) }
    var vodHideOpen by remember { mutableStateOf(false) }
    var vodFocusId by rememberSaveable { mutableStateOf<String?>(null) }
    var drawerFocused by remember { mutableStateOf(false) }
    var confirmExit by remember { mutableStateOf(false) }
    val drawerFocus = remember { FocusRequester() }

    // Persónulegt: uppáhalds (rásir, myndir, þættir hver í sínu lagi), nýlegt og heilsa rása.
    var favChannels by remember { mutableStateOf(settings.favChannels) }
    var favMovies by remember { mutableStateOf(settings.favMovies) }
    var favSeries by remember { mutableStateOf(settings.favSeries) }
    var recent by remember { mutableStateOf(settings.recentChannels) }
    var health by remember { mutableStateOf(ChannelHealth.decode(settings.chanHealth)) }
    fun saveFavChannels(v: List<String>) { favChannels = v; settings.favChannels = v }
    fun saveHealth(m: Map<String, ChannelHealth.Entry>?) {
        if (m == null) return
        health = m
        settings.chanHealth = ChannelHealth.encode(m)
    }
    fun toast(text: String) = android.widget.Toast.makeText(ctx, text, android.widget.Toast.LENGTH_SHORT).show()
    fun toggleFav(r: HomeModel.RowView) {
        val k = HomeModel.keyOf(r)
        val added = k !in favChannels
        saveFavChannels(Personal.toggle(favChannels, k))
        toast(if (added) tr("⭐ ${r.name} added to favourites", "⭐ ${r.name} bætt í uppáhalds") else tr("${r.name} removed from favourites", "${r.name} tekin úr uppáhalds"))
    }
    // Reiknað einu sinni þegar listinn eða heilsan breytist (ekki fyrir hverja línu við hverja flettingu).
    val favSet = remember(favChannels) { favChannels.toHashSet() }
    val healthByKey = remember(state.rows, state.channels, health) {
        if (health.isEmpty()) emptyMap() else buildMap {
            for (r in state.rows) {
                val lvl = ChannelHealth.worst(
                    r.row.variants.map { i -> ChannelHealth.level(state.channels.getOrNull(i)?.name?.let { health[it] }) }
                )
                if (lvl != 0) put(HomeModel.keyOf(r), lvl)
            }
        }
    }

    fun openRow(r: HomeModel.RowView, fromPlayer: Boolean = false) {
        opened = r
        variantIdx = 0
        quiet = fromPlayer
        focusKey = HomeModel.keyOf(r)
        recent = Personal.touch(recent, HomeModel.keyOf(r))
        settings.recentChannels = recent
    }
    var syncOpen by remember { mutableStateOf(false) }

    // „Horfa saman“ lifir á meðan appið er opið (og heldur sambandinu þó skipt sé um skjá).
    val sync = remember { SyncManager(settings) }
    DisposableEffect(Unit) { onDispose { sync.close() } }

    // Paraskjárinn (thverhaus.com/tengja) kemur í stað vefstjórnborðsins sem var
    // opið port á netinu án innskráningar. Appið sækir listann sjálft yfir HTTPS —
    // sjá docs/PAIRING.md.
    val installer = remember {
        PlaylistInstaller(
            settings = settings,
            playlists = playlists,
            epg = epgRepo
        )
    }
    val pairing = remember {
        PairController(
            client = PairingClient(),
            installer = { payload -> installer.install(payload) }
        )
    }
    var pairOpen by remember { mutableStateOf(false) }

    // Fyrsta lestur (notar skyndiminni ef það er til). Rásirnar birtast um leið
    // og listinn er til; dagskráin kemur í sér coroutine svo hún tefji þær ekki.
    LaunchedEffect(Unit) {
        vm.load()
        vm.loadEpg()
    }

    // Beiðni úr herberginu um að skipta á rás.
    val follow by sync.follow.collectAsState()
    LaunchedEffect(follow, state.rows) {
        val f = follow ?: return@LaunchedEffect
        sync.consumeFollow()
        val target = state.rows.firstOrNull { SyncRoom.channelKey(it.name) == f.key }
            ?: state.rows.firstOrNull { it.name.equals(f.name, ignoreCase = true) }
        if (target != null) {
            playing = null
            seriesItem = null
            vodOpen = false
            settingsOpen = false
            editing = false
            syncOpen = false
            val sameRow = opened?.let { HomeModel.keyOf(it) } == HomeModel.keyOf(target)
            if (!sameRow) openRow(target, fromPlayer = opened != null)
            // Sama afbrigði og hinn er á (ef það er til hér); annars það besta.
            if (f.variant.isNotEmpty()) {
                val labels = target.row.variants.map { i ->
                    state.channels.getOrNull(i)?.name?.let { ChannelRows.chipLabel(it) }.orEmpty()
                }
                val i = labels.indexOf(f.variant)
                if (i >= 0) {
                    variantIdx = i
                    quiet = true
                }
            }
            // Boð um nýju rásina fer út þegar spilarinn er kominn á hana.
            sync.notifyChannelChanged()
        }
    }

    // „Nú og næst“ á að vera rétt án endursóknar.
    LaunchedEffect(state.rows.isNotEmpty()) {
        while (state.rows.isNotEmpty()) {
            delay(60_000)
            vm.tick()
        }
    }

    val pl = state.playlist

    // Línurnar sem eru sýndar: flokkurinn, raðaður eftir hætti möppunnar (Mac: folderMode).
    // Sami listi ræður rásaskiptum með upp/niður í spilaranum.
    val favRows = remember(state.rows, favChannels) { Personal.pick(favChannels, state.rows) { HomeModel.keyOf(it) } }
    val recentRows = remember(state.rows, recent) { Personal.pick(recent, state.rows) { HomeModel.keyOf(it) } }
    val pinned = remember(favRows.size, recentRows.size) {
        buildList {
            add(Personal.FAV to favRows.size)
            if (recentRows.isNotEmpty()) add(Personal.RECENT to recentRows.size)
        }
    }
    val currentGroup = group?.takeIf { g -> state.groups.any { it.name == g } || pinned.any { it.first == g } }
    val virtual = currentGroup == Personal.FAV || currentGroup == Personal.RECENT
    val sortMode = currentGroup?.takeIf { !virtual }?.let {
        settings.folderSort(it) ?: if (settings.sortAZ) FolderOrder.AZ else FolderOrder.PROVIDER
    }
    val visibleRows = remember(state.rows, currentGroup, sortMode, prefsGen, favRows, recentRows) {
        when (currentGroup) {
            Personal.FAV -> favRows
            Personal.RECENT -> recentRows
            else -> {
                val base = HomeModel.forGroup(state.rows, currentGroup)
                if (currentGroup == null || sortMode == null) base
                else FolderOrder.arrange(base, sortMode, settings.folderOrder(currentGroup))
            }
        }
    }

    // Paraskjár: kóði á skjánum og listinn sóttur yfir HTTPS frá thverhaus.com.
    if (pairOpen) {
        PairScreen(
            controller = pairing,
            onDone = {
                pairOpen = false
                editing = false
                opened = null
                playing = null
                seriesItem = null
                vodOpen = false
                // Listinn er þegar sóttur og í skyndiminni (PlaylistInstaller).
                scope.launch {
                    vm.load()
                    vm.loadEpg()
                }
            },
            onManual = {
                pairOpen = false
                editing = true
            },
            onCancel = { pairOpen = false }
        )
        return
    }

    if (pl == null || editing) {
        AddPlaylistScreen(
            initial = pl,
            onPair = { pairOpen = true },
            onSave = { name, url, epgUrl ->
                settings.playlist = Playlist(SettingsStore.ID, name, url, epgUrl)
                editing = false
                opened = null
                playing = null
                seriesItem = null
                vodOpen = false
                scope.launch {
                    vm.load(force = true)
                    vm.loadEpg(force = true)
                }
            },
            onCancel = if (pl != null) ({ editing = false }) else null
        )
        return
    }

    if (vodHideOpen) {
        val movies = vodState.kind == VodKind.MOVIES
        val hiddenNow = if (movies) vodHiddenMovies else vodHiddenSeries
        val setHidden = { v: Set<String> ->
            if (movies) vodHiddenMovies = v else vodHiddenSeries = v
            settings.setVodHidden(movies, v)
        }
        HiddenGroupsScreen(
            groups = vodState.list?.categories.orEmpty().map { app.mulehead.data.ChannelGroup(it.name, it.count) },
            hidden = hiddenNow,
            onToggle = { g -> setHidden(if (g in hiddenNow) hiddenNow - g else hiddenNow + g) },
            onShowAll = { setHidden(emptySet()) },
            onBack = { vodHideOpen = false }
        )
        return
    }

    if (hideOpen) {
        HiddenGroupsScreen(
            groups = state.allGroups,
            hidden = state.hidden,
            onToggle = { g -> vm.setHidden(if (g in state.hidden) state.hidden - g else state.hidden + g) },
            onShowAll = { vm.setHidden(emptySet()) },
            onBack = {
                hideOpen = false
                settingsOpen = true
            }
        )
        return
    }

    if (settingsOpen) {
        SettingsScreen(
            initial = remember(settingsOpen) { settings.readDraft() },
            onLanguage = { code ->
                Lang.code = code
                settings.language = code
            },
            onPair = {
                settingsOpen = false
                pairOpen = true
            },
            onEditM3u = {
                settingsOpen = false
                editing = true
            },
            onHideGroups = {
                settingsOpen = false
                hideOpen = true
            },
            update = updateUi,
            onCheckUpdate = { scope.launch { updater.check(force = true) } },
            onInstallUpdate = { scope.launch { updater.downloadAndInstall() } },
            onRefresh = {
                settingsOpen = false
                scope.launch {
                    vm.load(force = true)
                    vm.loadEpg(force = true)
                }
            },
            onSave = { draft ->
                settings.write(draft)
                settingsOpen = false
                scope.launch { vm.tick() }
            },
            onCancel = { settingsOpen = false }
        )
        return
    }

    if (syncOpen) {
        SyncPanel(
            sync = sync,
            onFollow = { key, name -> sync.requestChannel(key, name) },
            onClose = { syncOpen = false }
        )
        return
    }

    val row = opened
    if (row != null) {
        val zapList = visibleRows
        val variantChannels = row.row.variants.mapNotNull { state.channels.getOrNull(it) }
        val vIdx = variantIdx.coerceIn(0, (variantChannels.size - 1).coerceAtLeast(0))
        val channel = variantChannels.getOrNull(vIdx) ?: row.channel
        PlayerScreen(
            title = row.name,
            group = row.group,
            url = channel.url,
            now = row.now,
            next = row.next,
            userAgent = settings.effectiveUserAgent,
            bufferSec = settings.bufferSec,
            growSlow = settings.growSlow,
            sync = sync,
            channelKey = SyncRoom.channelKey(row.name),
            variants = variantChannels.map { ChannelRows.chipLabel(it.name) },
            variantIndex = vIdx,
            onVariant = {
                variantIdx = it
                quiet = true
                // Afbrigðaskipti eru líka boðuð herberginu: ólík afbrigði eru ekki í takt.
                sync.notifyChannelChanged()
            },
            overlayAtStart = !quiet,
            fav = HomeModel.keyOf(row) in favChannels,
            onFav = { toggleFav(row) },
            onTrouble = { reason, severe ->
                saveHealth(ChannelHealth.trouble(health, channel.name, reason, severe, System.currentTimeMillis()))
            },
            onClean = { sec -> saveHealth(ChannelHealth.clean(health, channel.name, sec, System.currentTimeMillis())) },
            onZap = { dir ->
                val i = zapList.indexOfFirst { HomeModel.keyOf(it) == HomeModel.keyOf(row) }
                if (i >= 0 && zapList.size > 1) {
                    openRow(zapList[(i + dir + zapList.size) % zapList.size], fromPlayer = true)
                    sync.notifyChannelChanged()
                }
            },
            onBack = { opened = null }
        )
        return
    }

    // Mynd eða þáttur í spilaranum: engar dagskrárlínur og straumurinn endar
    // bara (byrjar ekki aftur) þegar honum lýkur.
    val play = playing
    if (play != null) {
        PlayerScreen(
            title = play.title,
            group = play.subtitle,
            url = play.url,
            now = null,
            next = null,
            userAgent = settings.effectiveUserAgent,
            bufferSec = settings.bufferSec,
            live = false,
            onBack = { playing = null }
        )
        return
    }

    val item = seriesItem
    if (item != null) {
        SeriesScreen(
            title = item.name,
            state = seriesState,
            onPlay = { title, url -> playing = PlayRequest(title, tr("Episode", "Þáttur"), url) },
            onBack = {
                seriesItem = null
                vodVm.clearSeries()
            }
        )
        return
    }

    // Myndir/Þættir: listinn sóttur þegar hlutinn er valinn (líka eftir endurræsingu).
    LaunchedEffect(section) {
        val kind = when (section) {
            Section.MOVIES -> VodKind.MOVIES
            Section.SERIES -> VodKind.SERIES
            else -> return@LaunchedEffect
        }
        if (vodState.kind != kind || vodState.list == null) vodVm.open(kind)
    }

    // Til baka á aðalskjánum: fyrst í valmyndina, svo „Viltu loka forritinu?“.
    fun backFromMain() {
        if (drawerFocused) {
            confirmExit = true
        } else {
            runCatching { drawerFocus.requestFocus() }
        }
    }

    if (confirmExit) {
        ExitDialog(
            onYes = { (ctx as? Activity)?.finish() },
            onNo = { confirmExit = false }
        )
        return
    }

    BackHandler { backFromMain() }

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().padding(start = DRAWER_COLLAPSED)) {
            when (section) {
                Section.MOVIES, Section.SERIES -> VodScreen(
                state = vodState,
                onKind = { kind -> scope.launch { vodVm.open(kind) } },
                onRefresh = { scope.launch { vodVm.open(force = true) } },
                onOpen = { item ->
                    vodFocusId = item.id
                    if (item.url.isNotEmpty()) {
                        // Mynd (eða þáttur úr M3U-lista) spilast beint.
                        val sub = listOfNotNull(
                            item.year.takeIf { it.isNotBlank() },
                            item.rating.takeIf { it.isNotBlank() }?.let { "★ $it" }
                        ).joinToString(" · ")
                        playing = PlayRequest(item.name, sub, item.url)
                    } else {
                        // Þáttaröð: sækja tímabil og þætti.
                        seriesItem = item
                        scope.launch { vodVm.openSeries(item.id) }
                    }
                },
                onBack = { backFromMain() },
                onMenu = { runCatching { drawerFocus.requestFocus() }.isSuccess },
                category = vodCategory,
                onCategory = { vodCategory = it },
                favs = if (vodState.kind == VodKind.MOVIES) favMovies else favSeries,
                onFav = { item ->
                    val movies = vodState.kind == VodKind.MOVIES
                    val list = if (movies) favMovies else favSeries
                    val added = item.id !in list
                    val next = Personal.toggle(list, item.id)
                    if (movies) { favMovies = next; settings.favMovies = next } else { favSeries = next; settings.favSeries = next }
                    toast(if (added) tr("⭐ ${item.name} added to favourites", "⭐ ${item.name} bætt í uppáhalds") else tr("${item.name} removed from favourites", "${item.name} tekin úr uppáhalds"))
                },
                focusId = vodFocusId,
                sort = vodSort,
                onSort = { mode ->
                    vodSort = mode
                    settings.vodSort = mode
                },
                hidden = if (vodState.kind == VodKind.MOVIES) vodHiddenMovies else vodHiddenSeries,
                onHideFolders = { vodHideOpen = true }
            )
                Section.SEARCH -> SearchScreen(
                    state = state,
                    query = searchQuery,
                    onQuery = { searchQuery = it },
                    onOpen = {
                        openRow(it)
                        sync.notifyChannelChanged()
                    },
                    favs = favSet,
                    health = healthByKey,
                    onFav = { toggleFav(it) }
                )
                else -> HomeScreen(
        state = state,
        group = group,
        onGroup = { group = it },
        focusKey = focusKey,
        rows = visibleRows,
        sortMode = sortMode,
        onSortMode = { mode ->
            currentGroup?.let { g ->
                // „Mín röð“ í fyrsta sinn byrjar á því sem er sýnt núna.
                if (mode == FolderOrder.CUSTOM && settings.folderOrder(g).isEmpty()) {
                    settings.setFolderOrder(g, visibleRows.map { it.name })
                } else {
                    settings.setFolderSort(g, mode)
                }
                prefsGen++
            }
        },
        onMove = { from, to ->
            if (currentGroup == Personal.FAV) {
                val keys = visibleRows.map { HomeModel.keyOf(it) }.toMutableList()
                keys.add(to, keys.removeAt(from))
                saveFavChannels(Personal.reorder(favChannels, keys))
            } else currentGroup?.let { g ->
                settings.setFolderOrder(g, FolderOrder.move(visibleRows, from, to))
                prefsGen++
            }
        },
        onRowsTop = { keys ->
            if (currentGroup == Personal.FAV) {
                saveFavChannels(Personal.reorder(favChannels, FolderOrder.toTop(visibleRows.map { HomeModel.keyOf(it) }, keys)))
            } else currentGroup?.let { g ->
                val names = visibleRows.filter { HomeModel.keyOf(it) in keys }.map { it.name }.toSet()
                settings.setFolderOrder(g, FolderOrder.toTop(visibleRows.map { it.name }, names))
                prefsGen++
            }
        },
        onGroupStep = { name, dir ->
            scope.launch { vm.setGroupOrder(FolderOrder.step(state.groups.map { it.name }, name, dir)) }
        },
        onGroupsTop = { names ->
            scope.launch { vm.setGroupOrder(FolderOrder.toTop(state.groups.map { it.name }, names)) }
        },
        onOpen = {
            openRow(it)
            // Rásarskipti eru boðuð herberginu (ef við erum í einu).
            sync.notifyChannelChanged()
        },
        onRefresh = {
            scope.launch {
                vm.load(force = true)
                vm.loadEpg(force = true)
            }
        },
        onEdit = { editing = true },
        onSync = { syncOpen = true },
        onSettings = { settingsOpen = true },
        onMenu = { runCatching { drawerFocus.requestFocus() }.isSuccess },
        updateDot = updateUi.available != null,
        pinned = pinned,
        canSort = !virtual,
        arrangeOnly = currentGroup == Personal.FAV,
        favs = favSet,
        health = healthByKey,
        onFav = { toggleFav(it) }
    )
            }
        }
        NavDrawer(
            current = section,
            focus = drawerFocus,
            onSelect = { s ->
                if (s == Section.SETTINGS) settingsOpen = true else section = s
            },
            onFocused = { drawerFocused = it }
        )
    }
}

