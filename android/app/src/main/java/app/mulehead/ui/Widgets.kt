package app.mulehead.ui

import app.mulehead.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.composed
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Ink
import app.mulehead.ui.theme.Ink2
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val TIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

// 20:45 á staðartíma.
fun hhmm(ms: Long): String =
    Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(TIME_FMT)

// Hnappur sem virkar bæði með fjarlægðarstýringu (fókus) og fingri.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvButton(
    label: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    // Valinn hnappur (fókus) er alltaf hvítur með dökkum texta og stækkar aðeins – sést úr sófanum.
    // „primary“ (t.d. kveikt „Á“ eða valið gildi) er aðeins blár rammi og blár texti, svo það
    // ruglist ALDREI við fókusinn (áður voru bæði blá og nánast eins).
    val bg = when {
        focused -> Text1
        primary -> Accent.copy(alpha = 0.18f)
        else -> Text1.copy(alpha = 0.07f)
    }
    val fg = when {
        focused -> Ink
        primary -> Accent
        else -> Text1
    }
    Box(
        modifier
            .graphicsLayer {
                val k = if (focused) 1.08f else 1f
                scaleX = k
                scaleY = k
            }
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .border(
                width = if (focused) 3.dp else if (primary) 1.5.dp else 0.dp,
                color = if (focused) Accent else if (primary) Accent else Color.Transparent,
                shape = RoundedCornerShape(10.dp)
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 12.dp)
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = fg
        )
    }
}

// Textareitur með fókusramma (TV-fjarlægðin eða lyklaborðið).
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    hint: String = "",
    requester: FocusRequester? = null,
    onDone: (() -> Unit)? = null
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Text2)
        Spacer(Modifier.height(6.dp))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Text1),
            cursorBrush = SolidColor(Accent),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
            modifier = Modifier
                .fillMaxWidth()
                .then(if (requester != null) Modifier.focusRequester(requester) else Modifier)
                .onFocusChanged { focused = it.isFocused }
                .background(Ink2, RoundedCornerShape(10.dp))
                .border(
                    width = if (focused) 2.dp else 1.dp,
                    color = if (focused) Accent else Text2.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(10.dp)
                )
                .padding(horizontal = 16.dp, vertical = 14.dp),
            decorationBox = { inner ->
                if (value.isEmpty() && hint.isNotEmpty()) {
                    Text(
                        hint,
                        style = MaterialTheme.typography.bodyLarge,
                        color = Text2.copy(alpha = 0.55f)
                    )
                }
                inner()
            }
        )
    }
}

/**
 * Flokkalisti vinstra megin (rásir, myndir eða þættir) með „Allt“ efst.
 * groups eru nafn + fjöldi í sömu röð og þau eiga að birtast.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvRail(
    title: String,
    groups: List<Pair<String, Int>>,
    current: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    // Hægri ör: skilar true ef fókus fór annað (t.d. á rásalistann).
    onRight: () -> Boolean = { false },
    // Festur við valinn flokk, svo vinstri ör úr rásunum lendi alltaf á honum.
    selectedFocus: FocusRequester? = null,
    // Vinstri ör úr flokkunum: opnar valmyndina (skilar true ef fókus fór þangað).
    onLeft: () -> Boolean = { false },
    // „↕ Raða“ flokkum (sjá arrangeKeys).
    arranging: Boolean = false,
    marks: Set<String> = emptySet(),
    held: String? = null,
    onArrange: (() -> Unit)? = null,
    onToggleMark: (String) -> Unit = {},
    onHold: (String?) -> Unit = {},
    onStep: (String, Int) -> Unit = { _, _ -> },
    onTop: () -> Unit = {},
    // Sýndarmöppur efst (⭐ Uppáhalds, 🕘 Nýlegt): ekki raðað, ekki taldar með í „Allt“.
    pinned: List<Pair<String, Int>> = emptyList()
) {
    val total = remember(groups) { groups.sumOf { it.second } }
    val off = pinned.size
    // Listinn byrjar á völdum flokki, svo vinstri ör úr rásunum lendi á honum.
    val selectedIdx = remember {
        val p = pinned.indexOfFirst { it.first == current }
        when {
            p >= 0 -> p
            current == null -> off
            else -> off + groups.indexOfFirst { it.first == current } + 1
        }
    }
    val railState = rememberLazyListState(initialFirstVisibleItemIndex = (selectedIdx - 4).coerceAtLeast(0))
    Column(modifier.width(280.dp).fillMaxHeight().background(Ink2).padding(vertical = 18.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 10.dp, top = 2.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(title, style = MaterialTheme.typography.labelSmall, color = Text2, modifier = Modifier.weight(1f))
            if (onArrange != null) TvSmallButton(if (arranging) tr("✓ Done", "✓ Búið") else tr("↕ Arrange", "↕ Raða"), onArrange)
        }
        if (arranging) {
            Text(
                when {
                    held != null -> tr("▲▼ move · OK drop", "▲▼ færa · OK sleppa")
                    marks.isNotEmpty() -> tr("➡ moves ${marks.size} to top · OK marks more", "➡ setur ${marks.size} efst · OK merkir fleiri")
                    else -> tr("OK marks · hold OK = move", "OK merkir · halda OK inni = færa")
                },
                style = MaterialTheme.typography.labelSmall,
                color = Text2,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp)
            )
            if (marks.isNotEmpty() && held == null) {
                TvButton(
                    tr("⤒ Move ${marks.size} to top", "⤒ Færa ${marks.size} efst"),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    primary = true,
                    onClick = onTop
                )
            }
        }
        // Flokkur sem er tekinn upp: fókusinn fylgir honum þegar hann færist.
        val single = held
        val singleFocus = remember { FocusRequester() }
        LaunchedEffect(groups, single, arranging) {
            if (!arranging || single == null) return@LaunchedEffect
            val idx = off + groups.indexOfFirst { it.first == single } + 1
            val first = railState.firstVisibleItemIndex
            val last = first + railState.layoutInfo.visibleItemsInfo.size - 1
            if (idx <= first || idx >= last) railState.scrollToItem((idx - 4).coerceAtLeast(0))
            repeat(10) {
                withFrameNanos { }
                if (runCatching { singleFocus.requestFocus() }.isSuccess) return@LaunchedEffect
            }
        }
        LazyColumn(Modifier.fillMaxSize(), state = railState) {
            items(pinned.size) { i ->
                val g = pinned[i]
                TvRailItem(app.mulehead.data.Personal.shown(g.first), g.second, current == g.first, onRight, selectedFocus.takeIf { current == g.first }, onLeft) {
                    if (!arranging) onSelect(g.first)
                }
            }
            item {
                TvRailItem(tr("All", "Allt"), total, current == null, onRight, selectedFocus.takeIf { current == null }, onLeft) {
                    if (!arranging) onSelect(null)
                }
            }
            items(groups.size) { i ->
                val g = groups[i]
                val sel = current == g.first
                val marked = g.first in marks
                val isHeld = held == g.first
                TvRailItem(
                    when {
                        isHeld -> "↕ ${g.first}"
                        marked -> "✓ ${g.first}"
                        else -> g.first
                    },
                    g.second, sel || marked || isHeld, onRight,
                    if (isHeld) singleFocus else selectedFocus.takeIf { sel }, onLeft,
                    arrange = Modifier.arrangeKeys(
                        enabled = arranging,
                        isHeld = isHeld,
                        hasMarks = marks.isNotEmpty(),
                        onShort = { if (held != null) onHold(null) else onToggleMark(g.first) },
                        onLong = { onHold(if (isHeld) null else g.first) },
                        onTop = onTop,
                        onStep = { dir -> onStep(g.first, dir) },
                        fallbackRight = onRight
                    )
                ) { onSelect(g.first) }
            }
        }
    }
}


/**
 * Lyklar í „↕ Raða“ (bæði flokkar og rásir), ákveðið með notandanum 11. nóv.:
 * - OK (stutt) merkir ✓ / afmerkir. Ef eitthvað er tekið upp sleppir OK því.
 * - Halda OK inni tekur upp ↕ (eða sleppir); þá færa upp/niður um eitt sæti.
 * - Hægri ör: allt merkt fer efst í einu.
 * - Örvarnar fletta annars alltaf (merking festir ekkert).
 */
fun Modifier.arrangeKeys(
    enabled: Boolean,
    isHeld: Boolean,
    hasMarks: Boolean,
    onShort: () -> Unit,
    onLong: () -> Unit,
    onTop: () -> Unit,
    onStep: (Int) -> Unit,
    fallbackRight: () -> Boolean = { false }
): Modifier = composed {
    var longFired by remember { mutableStateOf(false) }
    // KeyUp telst aðeins ef KeyDown kom hingað líka: ýtið sem lokaði hjálpinni má ekki merkja.
    var down by remember { mutableStateOf(false) }
    this.onPreviewKeyEvent { e ->
        if (!enabled) return@onPreviewKeyEvent false
        val k = e.key
        val ok = k == Key.DirectionCenter || k == Key.Enter || k == Key.NumPadEnter
        when {
            ok && e.type == KeyEventType.KeyDown -> {
                if (e.nativeKeyEvent.repeatCount == 0) down = true
                if (e.nativeKeyEvent.repeatCount >= 1 && !longFired) {
                    longFired = true
                    onLong()
                }
                true
            }
            ok && e.type == KeyEventType.KeyUp -> {
                if (longFired) longFired = false else if (down) onShort()
                down = false
                true
            }
            e.type != KeyEventType.KeyDown -> false
            k == Key.DirectionRight -> if (hasMarks) {
                onTop()
                true
            } else fallbackRight()
            isHeld && k == Key.DirectionUp -> {
                onStep(-1)
                true
            }
            isHeld && k == Key.DirectionDown -> {
                onStep(1)
                true
            }
            else -> false
        }
    }
}

/**
 * Halda OK inni (utan röðunar): t.d. ⭐ uppáhalds. Stutt OK fer áfram í clickable eins og áður;
 * eftir langt ýti er KeyUp gleypt svo rásin opnist ekki líka.
 */
class LongOk { var fired = false }

fun Modifier.longOk(enabled: Boolean, holder: LongOk, onLong: () -> Unit): Modifier =
    this.onPreviewKeyEvent { e ->
        if (!enabled) return@onPreviewKeyEvent false
        val ok = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
        if (!ok) return@onPreviewKeyEvent false
        when (e.type) {
            KeyEventType.KeyDown -> if (e.nativeKeyEvent.repeatCount >= 1) {
                if (!holder.fired) {
                    holder.fired = true
                    onLong()
                }
                true
            } else false
            KeyEventType.KeyUp -> if (holder.fired) {
                holder.fired = false
                true
            } else false
            else -> false
        }
    }

/** Hjálp sem birtist þegar ýtt er á „↕ Raða“. Eitt OK lokar henni (og merkir ekkert). */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ArrangeHelp(what: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        val f = remember { FocusRequester() }
        LaunchedEffect(Unit) {
            repeat(10) {
                withFrameNanos { }
                if (runCatching { f.requestFocus() }.isSuccess) return@LaunchedEffect
            }
        }
        Column(
            Modifier.clip(RoundedCornerShape(18.dp)).background(Ink2).padding(horizontal = 36.dp, vertical = 28.dp)
        ) {
            Text(tr("↕ Arrange $what", "↕ Raða $what"), style = MaterialTheme.typography.headlineSmall, color = Text1)
            Spacer(Modifier.height(18.dp))
            for (line in listOf(
                tr("1.  OK selects ✓ – as many as you like", "1.  OK velur ✓ – eins margar og þú vilt"),
                tr("2.  ➡ right arrow moves them to the top", "2.  ➡ hægri ör setur þær efst"),
                tr("3.  Hold OK to move one: ▲▼ and OK drops it", "3.  Haltu OK inni til að færa eina: ▲▼ og OK sleppir")
            )) {
                Text(line, style = MaterialTheme.typography.titleMedium, color = Text1, modifier = Modifier.padding(vertical = 5.dp))
            }
            Spacer(Modifier.height(22.dp))
            TvButton(tr("Got it – start", "Skilið – byrja"), modifier = Modifier.focusRequester(f), primary = true, onClick = onDismiss)
        }
    }
}

// Lítill hnappur í haus vinstri dálksins (↕ Raða, ⤒ Efst).
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun TvSmallButton(label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) Accent.copy(alpha = 0.45f) else Ink.copy(alpha = 0.6f))
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Text1)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun TvRailItem(
    label: String,
    count: Int,
    selected: Boolean,
    onRight: () -> Boolean,
    focus: FocusRequester?,
    onLeft: () -> Boolean,
    // Lyklar í röðun (arrangeKeys); á undan venjulegum lyklum.
    arrange: Modifier = Modifier,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val bg = when {
        focused -> Accent.copy(alpha = 0.34f)
        selected -> Accent.copy(alpha = 0.12f)
        else -> Color.Transparent
    }
    Row(
        Modifier.fillMaxWidth()
            .then(if (focus != null) Modifier.focusRequester(focus) else Modifier)
            .background(bg)
            .then(arrange)
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    e.key == Key.DirectionRight -> onRight()
                    e.key == Key.DirectionLeft -> onLeft()
                    else -> false
                }
            }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = if (selected || focused) Text1 else Text2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(count.toString(), style = MaterialTheme.typography.labelSmall, color = Text2)
    }
}
