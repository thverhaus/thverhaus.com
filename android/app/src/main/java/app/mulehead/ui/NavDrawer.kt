package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.ui.res.painterResource
import app.mulehead.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Ink
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2

// Hlutar appsins í valmyndinni vinstra megin.
enum class Section(val icon: String, val label: String) {
    SEARCH("🔍", tr("Search", "Leit")),
    TV("📺", tr("Live TV", "Sjónvarp")),
    MOVIES("🎬", tr("Movies", "Myndir")),
    SERIES("🍿", tr("Series", "Þættir")),
    SETTINGS("⚙️", tr("Settings", "Stillingar"))
}

val DRAWER_COLLAPSED = 76.dp
private val DRAWER_OPEN = 260.dp

/**
 * Valmynd vinstra megin (eins og í Google TV): mjó rönd með táknum, sem opnast með
 * nöfnum þegar fókus fer í hana (vinstri ör úr möppunum). Hún liggur yfir efninu svo
 * það hliðrist ekki til þegar hún opnast.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun NavDrawer(
    current: Section,
    focus: FocusRequester,
    onSelect: (Section) -> Unit,
    onFocused: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    var open by remember { mutableStateOf(false) }
    val width by animateDpAsState(if (open) DRAWER_OPEN else DRAWER_COLLAPSED, label = "drawer")
    Column(
        modifier
            .width(width)
            .fillMaxHeight()
            .background(Ink)
            .onFocusChanged {
                open = it.hasFocus
                onFocused(it.hasFocus)
            }
            .padding(vertical = 22.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 22.dp, bottom = 26.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(R.drawable.logo),
                contentDescription = "Mulehead",
                modifier = Modifier.size(40.dp)
            )
            if (open) {
                Spacer(Modifier.width(12.dp))
                Text("Mulehead", style = MaterialTheme.typography.titleLarge, color = Text1, maxLines = 1)
            }
        }
        Section.entries.forEach { s ->
            DrawerItem(
                section = s,
                selected = s == current,
                open = open,
                modifier = if (s == current) Modifier.focusRequester(focus) else Modifier,
                onClick = { onSelect(s) }
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun DrawerItem(
    section: Section,
    selected: Boolean,
    open: Boolean,
    modifier: Modifier,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val bg = when {
        focused -> Accent.copy(alpha = 0.34f)
        selected -> Accent.copy(alpha = 0.14f)
        else -> Color.Transparent
    }
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .background(bg, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(section.icon, style = MaterialTheme.typography.titleMedium, color = Text1)
        if (open) {
            Spacer(Modifier.width(16.dp))
            Text(
                section.label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (selected || focused) Text1 else Text2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/** „Viltu loka forritinu?“ — Nei er valið fyrirfram svo eitt aukaýti loki ekki appinu. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ExitDialog(onYes: () -> Unit, onNo: () -> Unit) {
    val noFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        repeat(10) {
            withFrameNanos { }
            if (runCatching { noFocus.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
    BackHandler { onNo() }
    Box(Modifier.fillMaxSize().background(Ink), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(tr("Close the app?", "Viltu loka forritinu?"), style = MaterialTheme.typography.headlineMedium, color = Text1)
            Spacer(Modifier.height(28.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                TvButton(tr("No", "Nei"), modifier = Modifier.focusRequester(noFocus), primary = true, onClick = onNo)
                TvButton(tr("Yes", "Já"), onClick = onYes)
            }
        }
    }
}
