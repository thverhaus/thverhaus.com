package app.mulehead.ui

import app.mulehead.tr

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.data.Playlist
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2

/**
 * Skjár til að setja inn M3U-hlekk (fyrsta keyrsla eða „Breyta hlekk“).
 * Athugar slóðina áður en hún er vistuð — sama regla og í Mac (http:// eða https://).
 *
 * Auðveldari leið er efst: parakóði sem notandinn slær inn á thverhaus.com/tengja (onPair).
 * Þá þarf ekki að skrifa löngu slóðina með fjarstýringunni.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun AddPlaylistScreen(
    initial: Playlist?,
    onPair: (() -> Unit)? = null,
    onSave: (name: String, url: String, epgUrl: String) -> Unit,
    onCancel: (() -> Unit)? = null
) {
    var name by remember(initial) { mutableStateOf(initial?.name.orEmpty()) }
    var url by remember(initial) { mutableStateOf(initial?.url.orEmpty()) }
    var epgUrl by remember(initial) { mutableStateOf(initial?.epgUrl.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 64.dp, vertical = 40.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("🐴 Mulehead", style = MaterialTheme.typography.displaySmall, color = Text1)
        Spacer(Modifier.height(10.dp))
        Text(
            tr("Paste the M3U link from your provider. It starts with http:// or https://", "Límdu M3U-hlekkinn frá veitandanum þínum. Hann byrjar á http:// eða https://"),
            style = MaterialTheme.typography.bodyLarge,
            color = Text2
        )
        if (onPair != null) {
            Spacer(Modifier.height(22.dp))
            TvButton(tr("📱 Connect from a browser", "📱 Tengja úr vafra"), primary = initial == null, onClick = onPair)
            Spacer(Modifier.height(8.dp))
            Text(
                tr(
                    "The TV shows a short code. Enter it at thverhaus.com/tengja and paste " +
                        "the link or Xtream details there — much easier than typing with the remote.",
                    "Sjónvarpið sýnir stuttan kóða. Sláðu hann inn á thverhaus.com/tengja og límdu " +
                        "slóðina eða Xtream-upplýsingarnar þar — miklu auðveldara en að skrifa með fjarstýringunni."
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = Accent
            )
        }
        Spacer(Modifier.height(26.dp))
        Text(tr("Or enter the link here:", "Eða setja slóðina inn hér:"), style = MaterialTheme.typography.labelLarge, color = Text2)
        Spacer(Modifier.height(10.dp))
        TvField(tr("Name (optional)", "Nafn (valfrítt)"), name, { name = it }, Modifier.widthIn(max = 900.dp))
        Spacer(Modifier.height(14.dp))
        TvField(tr("M3U link", "M3U-hlekkur"), url, { url = it }, Modifier.widthIn(max = 900.dp), KeyboardType.Uri)
        Spacer(Modifier.height(14.dp))
        TvField(
            tr("EPG / XMLTV (optional — usually included with the list)", "Dagskrá / XMLTV (valfrítt — oftast fylgir hún listanum)"),
            epgUrl, { epgUrl = it }, Modifier.widthIn(max = 900.dp), KeyboardType.Uri
        )
        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error!!, style = MaterialTheme.typography.bodyMedium, color = Bad)
        }
        Spacer(Modifier.height(28.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            TvButton(tr("Save and load", "Vista og sækja"), primary = true) {
                val u = url.trim()
                if (!u.startsWith("http://") && !u.startsWith("https://")) {
                    error = tr("The link must start with http:// or https://", "Slóðin þarf að byrja á http:// eða https://")
                } else {
                    error = null
                    onSave(name.trim(), u, epgUrl.trim())
                }
            }
            if (onCancel != null) TvButton(tr("Back", "Til baka"), onClick = onCancel)
        }
        Spacer(Modifier.height(22.dp))
        Text(
            tr("The first load can take up to a minute if the list is large. The list is then stored on the device.", "Fyrsta sókn getur tekið allt að mínútu ef listinn er stór. Listinn er síðan geymdur í símanum."),
            style = MaterialTheme.typography.bodySmall,
            color = Text2
        )
    }
}


