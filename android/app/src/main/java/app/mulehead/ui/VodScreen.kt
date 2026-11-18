package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.data.VodEpisode
import app.mulehead.data.VodFilter
import app.mulehead.data.VodSort
import app.mulehead.data.VodItem
import app.mulehead.data.VodKind
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import app.mulehead.ui.theme.Warn
import kotlinx.coroutines.delay

/**
 * Skjár fyrir myndir og þætti: flokkar vinstra megin, listi hægra megin og
 * leit. Ýtt á mynd opnar spilarann; ýtt á þáttaröð opnar [SeriesScreen].
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun VodScreen(
    state: VodState,
    onKind: (VodKind) -> Unit,
    onRefresh: () -> Unit,
    onOpen: (VodItem) -> Unit,
    onBack: () -> Unit,
    // Vinstri ör úr flokkunum fer í valmyndina.
    onMenu: () -> Boolean = { false },
    // Flokkur og síðasta mynd/þáttaröð eru geymd fyrir ofan skjáinn, svo „Til baka“ úr
    // spilaranum skili notandanum á sama stað (eins og í rásalistanum).
    category: String? = null,
    onCategory: (String?) -> Unit = {},
    focusId: String? = null,
    // Uppáhalds þessarar tegundar (myndir og þættir eru aðskildir listar), í röð notandans.
    favs: List<String> = emptyList(),
    onFav: (VodItem) -> Unit = {},
    // Röðun (sjá data/VodSort.kt): A–Z, nýjast, ár eða röð þjónustunnar.
    sort: String = VodSort.AZ,
    onSort: (String) -> Unit = {},
    // Faldar möppur (nöfn) og takkinn sem opnar „Fela möppur“.
    hidden: Set<String> = emptySet(),
    onHideFolders: () -> Unit = {}
) {
    var query by remember { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    // Hækkar þegar fókus á að fara á listann (leit lokað eða „Done“ á lyklaborðinu).
    // Listinn tekur EKKI fókus í hvert sinn sem leitarorðið breytist — það lokaði lyklaborðinu.
    var focusTick by remember { mutableStateOf(0) }
    // Á meðan leitað er tekur listinn aðeins fókus eftir „Done“ (einu sinni).
    var wantFocus by remember { mutableStateOf(false) }

    val list = state.list
    val allCats = list?.categories.orEmpty()
    // Faldar möppur hverfa úr dálkinum, „Allt“ og leitinni (eins og á Mac).
    val cats = remember(allCats, hidden) { allCats.filter { it.name !in hidden } }
    val hiddenIds = remember(allCats, hidden) { allCats.filter { it.name in hidden }.map { it.id }.toSet() }
    val current = category?.takeIf { c -> c == app.mulehead.data.Personal.FAV || cats.any { it.name == c } }
    val favItems = remember(list, favs) { app.mulehead.data.Personal.pick(favs, list?.items.orEmpty()) { it.id } }
    // Allur listinn raðaður einu sinni; leitin heldur röðinni.
    val sorted = remember(list, sort, hiddenIds) {
        VodSort.sort(list?.items.orEmpty().filter { it.categoryId !in hiddenIds }, sort)
    }
    val isFav = current == app.mulehead.data.Personal.FAV
    val rows = remember(sorted, current, query, favItems) {
        if (isFav) VodFilter.search(favItems, query, null)
        else VodFilter.search(sorted, query, cats.firstOrNull { it.name == current }?.id)
    }

    BackHandler {
        if (searching) {
            searching = false
            query = ""
            focusTick++
        } else {
            onBack()
        }
    }

    Row(Modifier.fillMaxSize()) {
        TvRail(
            title = tr("FOLDERS", "FLOKKAR"),
            groups = cats.map { it.name to it.count },
            current = current,
            onSelect = { onCategory(it) },
            onLeft = onMenu,
            pinned = listOf(app.mulehead.data.Personal.FAV to favItems.size)
        )
        Column(Modifier.weight(1f).fillMaxHeight()) {
            VodHeader(
                state = state,
                count = list?.items?.size ?: 0,
                searching = searching,
                onKind = onKind,
                onRefresh = onRefresh,
                onSearch = {
                    searching = !searching
                    wantFocus = false
                    if (!searching) {
                        query = ""
                        focusTick++
                    }
                },
                sort = sort,
                onSort = { onSort(VodSort.next(sort)) },
                onHideFolders = onHideFolders,
                onBack = onBack
            )
            if (searching) {
                SearchRow(
                    query = query,
                    onChange = { query = it },
                    // „Done“ á lyklaborðinu: leitin helst, fókus fer á niðurstöðurnar.
                    onDone = {
                        wantFocus = true
                        focusTick++
                    },
                    onClose = {
                        searching = false
                        query = ""
                        focusTick++
                    }
                )
            }
            when {
                state.loading && list?.items.isNullOrEmpty() -> CenterText(tr("Loading list…", "Sæki lista…"))
                !state.error.isNullOrEmpty() && list?.items.isNullOrEmpty() -> VodError(state.error, onRefresh, onBack)
                rows.isEmpty() -> CenterText(
                    when {
                        query.isNotBlank() -> tr("Nothing found", "Ekkert fannst")
                        list?.items.isNullOrEmpty() ->
                            if (state.kind == VodKind.MOVIES) tr("No movies in the list", "Engar myndir í listanum") else tr("No series in the list", "Engir þættir í listanum")
                        current == app.mulehead.data.Personal.FAV -> tr("No favourites yet – hold OK on a movie or series", "Ekkert í uppáhalds ennþá – haltu OK inni á mynd eða þáttaröð")
                        else -> tr("Nothing in this folder", "Ekkert í þessum flokki")
                    }
                )
                else -> VodItemList(
                    rows, state.kind, onOpen, focusId, favs.toSet(), onFav,
                    // Fókus fer á listann þegar hann opnast, flokki/röðun er breytt eða leit lokað —
                    // aldrei á meðan skrifað er í leitina.
                    focusKey = listOf(list, current, sort, focusTick),
                    grabFocus = !searching || wantFocus,
                    onFocused = { wantFocus = false },
                    searching = searching,
                    letters = sort == VodSort.AZ && !isFav
                )
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun VodHeader(
    state: VodState,
    count: Int,
    searching: Boolean,
    onKind: (VodKind) -> Unit,
    onRefresh: () -> Unit,
    onSearch: () -> Unit,
    onBack: () -> Unit,
    sort: String = VodSort.AZ,
    onSort: () -> Unit = {},
    onHideFolders: () -> Unit = {}
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                if (state.kind == VodKind.MOVIES) tr("Movies", "Myndir") else tr("Series", "Þættir"),
                style = MaterialTheme.typography.titleLarge,
                color = Text1,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            val from = if (state.list?.source == "m3u") tr(" · from M3U list", " · úr M3U-lista") else ""
            Text(tr("$count items$from", "$count atriði$from"), style = MaterialTheme.typography.labelMedium, color = Text2)
        }
        if (state.loading) {
            Text(tr("Updating…", "Uppfæri…"), style = MaterialTheme.typography.labelMedium, color = Accent)
            Spacer(Modifier.width(14.dp))
        }
        // Myndir/Þættir og „Til baka“ eru í valmyndinni vinstra megin; hér er bara leit og
        // endurnýjun, sem tákn svo hausinn passi við hliðina á flokkunum.
        TvButton(tr("Sort: ${VodSort.label(sort)}", "Röðun: ${VodSort.label(sort)}"), onClick = onSort)
        Spacer(Modifier.width(10.dp))
        TvButton(tr("📁 Hide folders", "📁 Fela möppur"), onClick = onHideFolders)
        Spacer(Modifier.width(10.dp))
        TvButton(if (searching) "✕" else "🔍", onClick = onSearch)
        Spacer(Modifier.width(10.dp))
        TvButton("↻", onClick = onRefresh)
    }
}

// Leitarreiturinn birtist aðeins þegar ýtt er á „Leita“ svo lyklaborðið
// opnist ekki þegar fókus fer yfir skjáinn.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun SearchRow(query: String, onChange: (String) -> Unit, onDone: () -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 4.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        TvField(
            label = tr("Search by name", "Leita að nafni"),
            value = query,
            onChange = onChange,
            modifier = Modifier.width(520.dp),
            hint = tr("e.g. star", "t.d. saga"),
            requester = focus,
            onDone = onDone
        )
        Spacer(Modifier.width(12.dp))
        TvButton(tr("Close", "Loka"), onClick = onClose)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun VodItemList(
    rows: List<VodItem>,
    kind: VodKind,
    onOpen: (VodItem) -> Unit,
    focusId: String? = null,
    favs: Set<String> = emptySet(),
    onFav: (VodItem) -> Unit = {},
    // Fókus er tekinn þegar þessi lykill breytist (ekki þegar leitarorðið breytist).
    focusKey: Any? = null,
    grabFocus: Boolean = true,
    onFocused: () -> Unit = {},
    searching: Boolean = false,
    // A–Z stikan hægra megin (aðeins þegar raðað er A–Z).
    letters: Boolean = false
) {
    val first = remember { FocusRequester() }
    // Byrjar á síðustu mynd sem var opnuð (eða þeirri fyrstu).
    val start = remember(focusKey) { rows.indexOfFirst { it.id == focusId }.coerceAtLeast(0) }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = (start - 3).coerceAtLeast(0))
    LaunchedEffect(focusKey) {
        if (rows.isEmpty() || !grabFocus) return@LaunchedEffect
        if (start > 0) listState.scrollToItem((start - 3).coerceAtLeast(0)) else listState.scrollToItem(0)
        // Eina myndrúllu seinkun svo hnúturinn sé kominn á skjáinn og fókusinn
        // lendi á fyrstu mynd en ekki á flokkalistanum.
        withFrameNanos { }
        runCatching { first.requestFocus() }
        // Compose getur fært fókus á flokkalistann þegar skjárinn opnast; biðjum aftur.
        delay(150)
        runCatching { first.requestFocus() }
        onFocused()
    }
    // Á meðan skrifað er: listinn fer efst án þess að taka fókusinn af leitarreitnum.
    LaunchedEffect(rows) {
        if (searching && rows.isNotEmpty()) listState.scrollToItem(0)
    }

    // A–Z: stafur -> fyrsta sæti. Fókus á staf flettir listanum þangað; OK fer í myndina.
    val index = remember(rows, letters) { if (letters) VodSort.index(rows) else emptyList() }
    val jumpReq = remember { FocusRequester() }
    var jumpTo by remember { mutableStateOf(-1) }
    var jumpTick by remember { mutableStateOf(0) }
    LaunchedEffect(jumpTick) {
        if (jumpTick == 0 || jumpTo < 0 || jumpTo >= rows.size) return@LaunchedEffect
        listState.scrollToItem(jumpTo)
        withFrameNanos { }
        runCatching { jumpReq.requestFocus() }
    }

    Row(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).fillMaxHeight(), state = listState) {
            items(rows.size) { i ->
                var m: Modifier = Modifier
                if (i == start) m = m.focusRequester(first)
                if (i == jumpTo) m = m.focusRequester(jumpReq)
                VodRow(
                    item = rows[i],
                    kind = kind,
                    modifier = m.longOk(true, remember { LongOk() }) { onFav(rows[i]) },
                    fav = rows[i].id in favs,
                    onClick = { onOpen(rows[i]) }
                )
            }
        }
        if (index.size > 1) {
            LetterBar(
                index = index,
                listState = listState,
                onPick = { at ->
                    jumpTo = at
                    jumpTick++
                }
            )
        }
    }
}

/**
 * Stafastika eins og í Plex: einn stafur í línu, aðeins stafir sem eru til í listanum.
 * Upp/niður flettir listanum strax; OK eða vinstri ör fer í fyrstu myndina undir stafnum.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun LetterBar(
    index: List<Pair<Char, Int>>,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onPick: (Int) -> Unit
) {
    LazyColumn(
        Modifier.width(44.dp).fillMaxHeight().padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        items(index.size) { i ->
            val (letter, at) = index[i]
            val interaction = remember { MutableInteractionSource() }
            val focused by interaction.collectIsFocusedAsState()
            // Fókus á staf flettir listanum þangað strax (fókusinn helst í stikunni).
            LaunchedEffect(focused) {
                if (focused) listState.scrollToItem(at)
            }
            Box(
                Modifier
                    .width(36.dp)
                    .height(26.dp)
                    .background(if (focused) Text1 else Color.Transparent, androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                    .clickable(interactionSource = interaction, indication = null) { onPick(at) },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    letter.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (focused) Color.Black else Text2
                )
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun VodRow(item: VodItem, kind: VodKind, modifier: Modifier = Modifier, fav: Boolean = false, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val bg = if (focused) Accent.copy(alpha = 0.20f) else Color.Transparent
    Row(
        modifier.fillMaxWidth()
            .background(bg)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            if (fav) "⭐ ${item.name}" else item.name,
            style = MaterialTheme.typography.bodyLarge,
            color = Text1,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        val parts = listOfNotNull(
            item.year.takeIf { it.isNotBlank() },
            item.rating.takeIf { it.isNotBlank() }?.let { "★ $it" }
        )
        if (parts.isNotEmpty()) {
            Spacer(Modifier.width(16.dp))
            Text(parts.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = Text2)
        }
        if (item.url.isEmpty()) {
            Spacer(Modifier.width(16.dp))
            Text(tr("Series", "Þættir"), style = MaterialTheme.typography.labelSmall, color = Text2)
        }
    }
}

/**
 * Skjár eins þáttaraðar: tímabil vinstra megin og þættir hægra megin.
 * Ýtt á þátt opnar spilarann.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun SeriesScreen(
    title: String,
    state: SeriesState,
    onPlay: (String, String) -> Unit,
    onBack: () -> Unit
) {
    var season by remember { mutableStateOf<String?>(null) }
    val info = state.info
    val seasons = info?.seasons.orEmpty()
    val names = seasons.map { tr("Season ${it.season}", "Tímabil ${it.season}") }
    val current = season?.takeIf { it in names }
    val episodes = remember(seasons, current) {
        seasons
            .filter { current == null || tr("Season ${it.season}", "Tímabil ${it.season}") == current }
            .flatMap { s -> s.episodes.map { s.season to it } }
    }

    BackHandler { onBack() }

    Row(Modifier.fillMaxSize()) {
        TvRail(
            title = tr("SEASONS", "TÍMABIL"),
            groups = seasons.map { tr("Season ${it.season}", "Tímabil ${it.season}") to it.episodes.size },
            current = current,
            onSelect = { season = it }
        )
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        info?.name?.takeIf { it.isNotBlank() } ?: title,
                        style = MaterialTheme.typography.titleLarge,
                        color = Text1,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    val plot = info?.plot.orEmpty()
                    if (plot.isNotBlank()) {
                        Text(
                            plot,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Text2,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    } else {
                        Text(tr("${episodes.size} episodes", "${episodes.size} þættir"), style = MaterialTheme.typography.labelMedium, color = Text2)
                    }
                }
                if (state.loading) {
                    Text(tr("Loading episodes…", "Sæki þætti…"), style = MaterialTheme.typography.labelMedium, color = Accent)
                    Spacer(Modifier.width(14.dp))
                }
                TvButton(tr("Back", "Til baka"), onClick = onBack)
            }
            when {
                state.loading && episodes.isEmpty() -> CenterText(tr("Loading episodes…", "Sæki þætti…"))
                !state.error.isNullOrEmpty() -> CenterText(state.error)
                episodes.isEmpty() -> CenterText(tr("No episodes found", "Engir þættir fundust"))
                else -> EpisodeList(episodes, onPlay)
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun EpisodeList(episodes: List<Pair<String, VodEpisode>>, onPlay: (String, String) -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(episodes) {
        if (episodes.isEmpty()) return@LaunchedEffect
        withFrameNanos { }
        first.requestFocus()
        delay(150)
        first.requestFocus()
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        items(episodes.size) { i ->
            val (season, e) = episodes[i]
            EpisodeRow(
                episode = e,
                season = season,
                modifier = if (i == 0) Modifier.focusRequester(first) else Modifier,
                onClick = { if (e.url.isNotEmpty()) onPlay(e.title, e.url) }
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun EpisodeRow(
    episode: VodEpisode,
    season: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val bg = if (focused) Accent.copy(alpha = 0.20f) else Color.Transparent
    Column(
        modifier.fillMaxWidth()
            .background(bg)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 10.dp)
    ) {
        Text(
            episode.title,
            style = MaterialTheme.typography.bodyLarge,
            color = Text1,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        val parts = listOfNotNull(
            tr("Season $season", "Tímabil $season"),
            tr("Episode ${episode.num}", "Þáttur ${episode.num}"),
            episode.duration.takeIf { it.isNotBlank() }
        )
        Text(
            parts.joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = Text2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun CenterText(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = Text2)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun VodError(error: String, onRefresh: () -> Unit, onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(tr("Couldn't load movies", "Náði ekki í myndir"), style = MaterialTheme.typography.titleMedium, color = Bad)
        Spacer(Modifier.height(8.dp))
        Text(error, style = MaterialTheme.typography.bodyMedium, color = Warn)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(tr("Try again", "Reyna aftur"), primary = true, onClick = onRefresh)
            TvButton(tr("Back", "Til baka"), onClick = onBack)
        }
    }
}
