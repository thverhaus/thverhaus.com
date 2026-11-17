package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
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
import app.mulehead.data.ChannelGroup
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2

/**
 * Stillingar → Fela möppur: allar möppur með ☑ (sýnd) / ☐ (falin). Breyting tekur gildi
 * strax: falin mappa hverfur úr flokkadálkinum, „Allt“ og leitinni (Mac: hiddenGroups).
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HiddenGroupsScreen(
    groups: List<ChannelGroup>,
    hidden: Set<String>,
    onToggle: (String) -> Unit,
    onShowAll: () -> Unit,
    onBack: () -> Unit
) {
    BackHandler { onBack() }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        repeat(10) {
            withFrameNanos { }
            if (runCatching { first.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 36.dp)) {
        Text(tr("Hide folders", "Fela möppur"), style = MaterialTheme.typography.titleLarge, color = Text1)
        Text(
            tr("Untick folders you don't want to see. ${groups.size - hidden.size} of ${groups.size} visible.", "Hakaðu úr möppur sem þú vilt ekki sjá. ${groups.size - hidden.size} af ${groups.size} sýnilegar."),
            style = MaterialTheme.typography.labelMedium,
            color = Text2
        )
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(tr("Back", "Til baka"), modifier = Modifier.focusRequester(first), onClick = onBack)
            if (hidden.isNotEmpty()) TvButton(tr("Show all", "Sýna allar"), onClick = onShowAll)
        }
        Spacer(Modifier.height(14.dp))
        LazyColumn(Modifier.fillMaxWidth()) {
            items(groups.size) { i ->
                val g = groups[i]
                GroupCheck(g.name, g.count, g.name !in hidden) { onToggle(g.name) }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun GroupCheck(name: String, count: Int, shown: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (focused) Accent.copy(alpha = 0.28f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(if (shown) "☑" else "☐", style = MaterialTheme.typography.titleMedium, color = if (shown) Accent else Text2)
        Spacer(Modifier.width(16.dp))
        Text(
            name,
            style = MaterialTheme.typography.bodyLarge,
            color = if (shown) Text1 else Text2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(count.toString(), style = MaterialTheme.typography.labelMedium, color = Text2)
    }
}
