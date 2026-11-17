package app.mulehead.ui

import app.mulehead.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.runtime.key as composeKey
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import androidx.activity.compose.BackHandler
import app.mulehead.data.Channel
import app.mulehead.data.ChannelRows
import app.mulehead.data.FolderOrder
import app.mulehead.data.HomeModel
import app.mulehead.data.LoadStep
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Ok
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import app.mulehead.ui.theme.Warn

/**
 * Aðalskjárinn: flokkar vinstra megin og rásalisti með „nú og næst“ hægra megin.
 * Fyrsta stigs uppbygging á lista í Mac-útgáfunni (renderer/app.js).
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HomeScreen(
    state: HomeState,
    // Valinn flokkur og síðasta rás sem var opnuð eru geymd fyrir ofan skjáinn, svo
    // „Til baka“ úr spilaranum skili notandanum í sama flokk og á sömu rás.
    group: String?,
    onGroup: (String?) -> Unit,
    focusKey: String?,
    // Línur flokksins eins og þær eru sýndar (þegar raðaðar eftir hætti möppunnar).
    rows: List<HomeModel.RowView>,
    // Röðunarháttur möppunnar (null í „Allt“), og breytingar á honum/röðinni.
    sortMode: String?,
    onSortMode: (String) -> Unit,
    onMove: (Int, Int) -> Unit,
    // Merktar rásir efst í möppunni (lyklar HomeModel.keyOf).
    onRowsTop: (Set<String>) -> Unit = {},
    // Röðun flokkanna sjálfra: eitt nafn um eitt sæti, eða merktir flokkar efst.
    onGroupStep: (String, Int) -> Unit = { _, _ -> },
    onGroupsTop: (Set<String>) -> Unit = {},
    onOpen: (HomeModel.RowView) -> Unit,
    onRefresh: () -> Unit,
    onEdit: () -> Unit,
    onSync: () -> Unit,
    onSettings: () -> Unit,
    // Vinstri ör úr flokkunum fer í valmyndina.
    onMenu: () -> Boolean = { false },
    // Ný útgáfa er til: punktur á tannhjólinu.
    updateDot: Boolean = false,
    // ⭐ Uppáhalds / 🕘 Nýlegt efst í flokkadálkinum.
    pinned: List<Pair<String, Int>> = emptyList(),
    // Röðunarhnappurinn („Röðun: A–Ö“) á ekki við í uppáhalds (þar ræður röð notandans).
    canSort: Boolean = true,
    // Hægt að „↕ Raða“ þó að röðunarháttur sé enginn (uppáhalds).
    arrangeOnly: Boolean = false,
    favs: Set<String> = emptySet(),
    // 0 ekkert · 1 gult · 2 rautt · 3 grænt (sjá ChannelHealth), eftir lykli línu; aðeins merktar.
    health: Map<String, Int> = emptyMap(),
    onFav: (HomeModel.RowView) -> Unit = {}
) {
    val current = group?.takeIf { g -> state.groups.any { it.name == g } || pinned.any { it.first == g } }
    // Hjálpin sem birtist þegar ýtt er á „↕ Raða“ ("möppum" / "rásum"); null = engin.
    var help by remember { mutableStateOf<String?>(null) }
    // „Raða“: OK merkir (✓) eins margar og vill. „⤒ Efst“ færir allar merktar efst;
    // ef aðeins ein er merkt færa upp/niður hana um eitt sæti.
    var arranging by remember(current) { mutableStateOf(false) }
    var marks by remember(current) { mutableStateOf(setOf<String>()) }
    var held by remember(current) { mutableStateOf<String?>(null) }
    // Sama fyrir flokkana í vinstri dálkinum.
    var railArranging by remember { mutableStateOf(false) }
    var railMarks by remember { mutableStateOf(setOf<String>()) }
    var railHeld by remember { mutableStateOf<String?>(null) }
    BackHandler(enabled = arranging || railArranging) {
        arranging = false
        marks = emptySet()
        held = null
        railArranging = false
        railMarks = emptySet()
        railHeld = null
    }
    // Hægri ör úr flokkunum fer á rásalistann (ekki í hnappana efst).
    val listFocus = remember { FocusRequester() }
    // Vinstri ör úr rásunum fer á valinn flokk (ekki þann sem er næstur á skjánum).
    val railFocus = remember { FocusRequester() }

    Row(Modifier.fillMaxSize()) {
        TvRail(
            title = tr("FOLDERS", "FLOKKAR"),
            groups = state.groups.map { it.name to it.count },
            current = current,
            onSelect = { g ->
                // Nýr flokkur: listinn er byggður upp á nýtt og tekur fókusinn sjálfur.
                if (g == current) runCatching { listFocus.requestFocus() } else onGroup(g)
            },
            onRight = { runCatching { listFocus.requestFocus() }.isSuccess },
            selectedFocus = railFocus,
            onLeft = onMenu,
            arranging = railArranging,
            marks = railMarks,
            held = railHeld,
            onArrange = {
                railArranging = !railArranging
                railMarks = emptySet()
                railHeld = null
                if (railArranging) help = tr("folders", "möppum")
            },
            onToggleMark = { g -> railMarks = if (g in railMarks) railMarks - g else railMarks + g },
            onHold = { railHeld = it },
            onStep = onGroupStep,
            onTop = {
                onGroupsTop(railMarks)
                railMarks = emptySet()
                runCatching { railFocus.requestFocus() }
            },
            pinned = pinned
        )
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Header(state, onSync, onSettings, updateDot)
            if (state.notice != null) {
                Text(
                    state.notice,
                    style = MaterialTheme.typography.labelMedium,
                    color = Warn,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 28.dp, vertical = 2.dp)
                )
            }
            if ((sortMode != null || arrangeOnly) && rows.size > 1) {
                FolderBar(
                    sortMode = sortMode.takeIf { canSort },
                    arranging = arranging,
                    marked = marks.size,
                    onSortMode = onSortMode,
                    onArrange = {
                        arranging = !arranging
                        marks = emptySet()
                        held = null
                        if (arranging) help = tr("channels", "rásum")
                    },
                    onTop = {
                        onRowsTop(marks)
                        marks = emptySet()
                        runCatching { listFocus.requestFocus() }
                    }
                )
            }
            when {
                state.loading && state.rows.isEmpty() -> CenterText(stepText(state.step))
                state.error != null && state.rows.isEmpty() -> ErrorBox(state.error, onRefresh, onEdit)
                rows.isEmpty() && current == app.mulehead.data.Personal.FAV ->
                    CenterText(tr("No favourite channels yet – hold OK on a channel to add it ⭐", "Engar uppáhaldsrásir ennþá – haltu OK inni á rás til að bæta henni við ⭐"))
                rows.isEmpty() -> CenterText(tr("No channels in this folder", "Engar rásir í þessum flokki"))
                else -> composeKey(current) {
                    ChannelList(
                        rows, focusKey, listFocus, onOpen, Modifier.weight(1f),
                        onLeft = { runCatching { railFocus.requestFocus() }.isSuccess },
                        arranging = arranging,
                        marks = marks,
                        held = held,
                        onToggleMark = { k -> marks = if (k in marks) marks - k else marks + k },
                        onHold = { held = it },
                        onTop = {
                            onRowsTop(marks)
                            marks = emptySet()
                        },
                        onMove = onMove,
                        channels = state.channels,
                        favs = favs,
                        health = health,
                        onFav = onFav
                    )
                }
            }
        }
    }
    help?.let { what ->
        ArrangeHelp(what) {
            help = null
            // Fókus beint þangað sem raðað er (OK-ið sem lokaði hjálpinni merkir ekkert).
            runCatching { if (what == tr("folders", "möppum")) railFocus.requestFocus() else listFocus.requestFocus() }
        }
    }
}

/**
 * Texti fyrir hvert skref hleðslunnar. Hann birtist bæði í miðjum skjánum (áður
 * en rásir koma) og í hausnum, svo sjáist hvar appið bíður ef eitthvað hangir.
 */
internal fun stepText(step: LoadStep): String = when (step) {
    LoadStep.LIST_FETCH -> tr("Loading list…", "Sæki lista…")
    LoadStep.LIST_PARSE -> tr("Reading list…", "Les lista…")
    LoadStep.XTREAM_LOGIN -> tr("Signing in…", "Skrái inn…")
    LoadStep.XTREAM_CATS -> tr("Loading folders…", "Sæki flokka…")
    LoadStep.XTREAM_STREAMS -> tr("Loading channels…", "Sæki rásir…")
    LoadStep.EPG_FETCH -> tr("Loading EPG…", "Sæki dagskrá…")
    LoadStep.EPG_PARSE -> tr("Reading EPG…", "Les dagskrá…")
    LoadStep.IDLE -> tr("Loading list…", "Sæki lista…")
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Header(
    state: HomeState,
    onSync: () -> Unit,
    onSettings: () -> Unit,
    updateDot: Boolean = false
) {
    // Tveggja lína haus: titill efst, hnappar fyrir neðan. Hnappar flæða í aðra línu
    // ef plássið er lítið (t.d. 720p) í stað þess að þrýsta titlinum saman.
    Column(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    state.playlist?.name ?: "Mulehead",
                    style = MaterialTheme.typography.titleLarge,
                    color = Text1,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                val fetched = if (state.fetchedAt > 0) tr(" · loaded ${hhmm(state.fetchedAt)}", " · sótt ${hhmm(state.fetchedAt)}") else ""
                Text(
                    tr("${state.channelCount} channels · ${state.rows.size} rows$fetched", "${state.channelCount} rásir · ${state.rows.size} línur$fetched"),
                    style = MaterialTheme.typography.labelMedium,
                    color = Text2,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (state.loading || state.epgLoading) {
                Text(stepText(state.step), style = MaterialTheme.typography.labelMedium, color = Accent)
                Spacer(Modifier.width(18.dp))
            }
            // Uppi í hægra horninu: Horfa saman og stillingar (tákn, ekki texti).
            TvButton("🤝", onClick = onSync)
            Spacer(Modifier.width(10.dp))
            TvButton(if (updateDot) "⚙️ 🔵" else "⚙️", onClick = onSettings)
        }
    }
}

@Composable
private fun ChannelList(
    rows: List<HomeModel.RowView>,
    focusKey: String?,
    focus: FocusRequester,
    onOpen: (HomeModel.RowView) -> Unit,
    modifier: Modifier = Modifier,
    onLeft: () -> Boolean = { false },
    arranging: Boolean = false,
    marks: Set<String> = emptySet(),
    held: String? = null,
    onToggleMark: (String) -> Unit = {},
    onHold: (String?) -> Unit = {},
    onTop: () -> Unit = {},
    onMove: (Int, Int) -> Unit = { _, _ -> },
    channels: List<Channel> = emptyList(),
    // false í leitinni: þar á fókusinn að vera í leitarreitnum á meðan skrifað er.
    autoFocus: Boolean = true,
    favs: Set<String> = emptySet(),
    health: Map<String, Int> = emptyMap(),
    onFav: (HomeModel.RowView) -> Unit = {}
) {
    // Fókus fer á rásina sem var síðast opnuð (eða þá fyrstu) þegar listinn birtist,
    // t.d. eftir að spilari lokast, svo notandinn haldi áfram þar sem hann var.
    val start = remember { rows.indexOfFirst { HomeModel.keyOf(it) == focusKey }.coerceAtLeast(0) }
    var focused by remember { mutableIntStateOf(start) }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = (start - 3).coerceAtLeast(0))
    // Listinn er ekki alltaf kominn á skjáinn í fyrsta ramma (stór listi í smíðum), svo
    // reynt er nokkra ramma í röð þar til fókusinn festist.
    LaunchedEffect(Unit) {
        if (!autoFocus) return@LaunchedEffect
        repeat(30) {
            withFrameNanos { }
            if (runCatching { focus.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
    // Rás sem er tekin upp: fókusinn fylgir henni þegar hún er færð.
    val single = held
    LaunchedEffect(rows, single) {
        val h = single ?: return@LaunchedEffect
        val idx = rows.indexOfFirst { HomeModel.keyOf(it) == h }
        if (idx < 0) return@LaunchedEffect
        focused = idx
        val first = listState.firstVisibleItemIndex
        val last = first + listState.layoutInfo.visibleItemsInfo.size - 1
        if (idx <= first || idx >= last) listState.scrollToItem((idx - 3).coerceAtLeast(0))
        repeat(10) {
            withFrameNanos { }
            if (runCatching { focus.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
    LazyColumn(modifier.fillMaxWidth(), state = listState) {
        items(rows.size) { i ->
            val r = rows[i]
            val key = HomeModel.keyOf(r)
            val isMarked = key in marks
            val isHeld = single == key
            // Fókusmerkið fylgir síðustu rás sem hafði fókus, svo hægri ör úr
            // flokkunum lendi á henni en ekki efst í listanum.
            val m = Modifier
                .onFocusChanged { if (it.isFocused) focused = i }
                .arrangeKeys(
                    enabled = arranging,
                    isHeld = isHeld,
                    hasMarks = marks.isNotEmpty(),
                    onShort = { if (held != null) onHold(null) else onToggleMark(key) },
                    onLong = { onHold(if (isHeld) null else key) },
                    onTop = onTop,
                    onStep = { dir ->
                        val j = i + dir
                        if (j in rows.indices) onMove(i, j)
                    }
                )
                .longOk(enabled = !arranging, holder = remember { LongOk() }) { onFav(r) }
                .onPreviewKeyEvent { e ->
                    e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft && !isHeld && onLeft()
                }
            val target by remember(i, rows.size) { derivedStateOf { i == focused.coerceAtMost(rows.size - 1) } }
            ChannelItem(
                r = r,
                channels = channels,
                fav = key in favs,
                health = health[key] ?: 0,
                modifier = if (target) m.focusRequester(focus) else m,
                held = isMarked || isHeld,
                onClick = { if (!arranging) onOpen(r) }
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ChannelItem(
    r: HomeModel.RowView,
    channels: List<Channel>,
    modifier: Modifier = Modifier,
    held: Boolean = false,
    fav: Boolean = false,
    health: Int = 0,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    // Fókus lesinn beint (ekki úr interaction) svo merkið sjáist líka þegar fókus er
    // settur sjálfkrafa um leið og listinn birtist.
    var focused by remember { mutableStateOf(false) }
    val bg = when {
        held -> Accent.copy(alpha = 0.45f)
        focused -> Accent.copy(alpha = 0.24f)
        else -> Color.Transparent
    }
    Column(
        modifier.fillMaxWidth()
            .onFocusChanged { focused = it.isFocused }
            .background(bg)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 9.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                r.number.toString(),
                style = MaterialTheme.typography.labelMedium,
                color = Text2,
                modifier = Modifier.width(48.dp)
            )
            if (health != 0) {
                // Heilsa rásarinnar (versta afbrigðið): rautt, gult eða grænt.
                Text(
                    "●",
                    style = MaterialTheme.typography.labelMedium,
                    color = when (health) { 2 -> Bad; 1 -> Warn; else -> Ok },
                    modifier = Modifier.padding(end = 8.dp)
                )
            }
            Text(
                (if (held) "✓ " else "") + (if (fav) "⭐ " else "") + r.name,
                style = MaterialTheme.typography.bodyLarge,
                color = Text1,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            if (r.variants > 1) {
                // Heitin eru reiknuð bara fyrir línur á skjánum (ekki allar 5.000).
                val labels = remember(r.row, channels) {
                    r.row.variants.mapNotNull { channels.getOrNull(it)?.name }.map { ChannelRows.chipLabel(it) }
                }
                val shown = labels.take(4).joinToString(" · ")
                val more = if (labels.size > 4) " +${labels.size - 4}" else ""
                Text(
                    if (shown.isNotEmpty()) shown + more else tr("${r.variants} variants", "${r.variants} afbrigði"),
                    style = MaterialTheme.typography.labelSmall,
                    color = Text2
                )
            }
        }
        Row(
            Modifier.padding(start = 48.dp, top = 1.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val nowText = r.now?.let { tr("Now ${hhmm(it.start)}–${hhmm(it.stop)} · ${it.title}", "Nú ${hhmm(it.start)}–${hhmm(it.stop)} · ${it.title}") } ?: tr("No EPG", "Engin dagskrá")
            Text(
                nowText,
                style = MaterialTheme.typography.bodySmall,
                color = Text2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            r.next?.let {
                Spacer(Modifier.width(16.dp))
                Text(
                    tr("Next ${hhmm(it.start)} · ${it.title}", "Næst ${hhmm(it.start)} · ${it.title}"),
                    style = MaterialTheme.typography.bodySmall,
                    color = Text2.copy(alpha = 0.7f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

/**
 * Leit í öllum rásum: niðurstöður birtast um leið og skrifað er („sky s“ -> Sky Sports).
 * Niður-ör úr leitarreitnum fer í niðurstöðurnar.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun SearchScreen(
    state: HomeState,
    query: String,
    onQuery: (String) -> Unit,
    onOpen: (HomeModel.RowView) -> Unit,
    favs: Set<String> = emptySet(),
    health: Map<String, Int> = emptyMap(),
    onFav: (HomeModel.RowView) -> Unit = {}
) {
    val results = remember(state.rows, query) { HomeModel.search(state.rows, query) }
    val fieldFocus = remember { FocusRequester() }
    val listFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        repeat(20) {
            withFrameNanos { }
            if (runCatching { fieldFocus.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
    Column(Modifier.fillMaxSize().padding(top = 22.dp)) {
        Column(Modifier.padding(horizontal = 28.dp)) {
            Text(tr("Search", "Leit"), style = MaterialTheme.typography.titleLarge, color = Text1)
            Spacer(Modifier.height(12.dp))
            TvField(
                label = tr("Channel name, e.g. “sky s”", "Nafn rásar, t.d. „sky s“"),
                value = query,
                onChange = onQuery,
                modifier = Modifier.fillMaxWidth(),
                requester = fieldFocus,
                onDone = { runCatching { listFocus.requestFocus() } }
            )
            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    query.isBlank() -> tr("Press OK to type. Results appear as you type.", "Ýttu á OK til að skrifa. Niðurstöður birtast um leið.")
                    results.isEmpty() -> tr("No channel found", "Engin rás fannst")
                    else -> tr("${results.size} channels", "${results.size} rásir")
                },
                style = MaterialTheme.typography.labelMedium,
                color = Text2
            )
        }
        Spacer(Modifier.height(8.dp))
        if (results.isNotEmpty()) {
            ChannelList(
                results, null, listFocus, onOpen, Modifier.weight(1f),
                channels = state.channels,
                autoFocus = false,
                favs = favs,
                health = health,
                onFav = onFav
            )
        }
    }
}

// Röðun möppunnar og „Raða“ (birtist aðeins í möppu, ekki í „Allt“).
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FolderBar(
    sortMode: String?,
    arranging: Boolean,
    marked: Int,
    onSortMode: (String) -> Unit,
    onArrange: () -> Unit,
    onTop: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (sortMode != null) TvButton(tr("Sort: ${FolderOrder.label(sortMode)}", "Röðun: ${FolderOrder.label(sortMode)}")) { onSortMode(FolderOrder.next(sortMode)) }
        TvButton(if (arranging) tr("✓ Done", "✓ Búið") else tr("↕ Arrange", "↕ Raða"), onClick = onArrange)
        if (arranging && marked > 0) TvButton(tr("⤒ Move $marked to top", "⤒ Færa $marked efst"), primary = true, onClick = onTop)
        if (arranging) {
            Text(
                if (marked > 0) tr("➡ moves $marked to top · OK marks more", "➡ setur $marked efst · OK merkir fleiri")
                else tr("OK marks · hold OK = move", "OK merkir · halda OK inni = færa"),
                style = MaterialTheme.typography.labelMedium,
                color = Text2
            )
        }
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
private fun ErrorBox(error: String, onRefresh: () -> Unit, onEdit: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(tr("Couldn't load the list", "Náði ekki í listann"), style = MaterialTheme.typography.titleMedium, color = Bad)
        Spacer(Modifier.height(8.dp))
        Text(error, style = MaterialTheme.typography.bodyMedium, color = Text2)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(tr("Try again", "Reyna aftur"), primary = true, onClick = onRefresh)
            TvButton(tr("Change link", "Breyta hlekk"), onClick = onEdit)
        }
    }
}

