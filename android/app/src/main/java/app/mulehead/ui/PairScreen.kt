package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.pairing.PairCode
import app.mulehead.pairing.PairController
import app.mulehead.pairing.PairStatus
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Ink2
import app.mulehead.ui.theme.Ok
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import kotlinx.coroutines.delay

/**
 * Paraskjárinn: sýnir stuttan kóða sem notandinn slær inn á thverhaus.com/tengja.
 *
 * Þannig þarf sjónvarpið hvorki opinn vefþjón né opið port út á netið: appið
 * sækir listann sjálft yfir HTTPS þegar notandinn hefur sent hann á vefnum.
 * Skjárinn spyr á 5 sek fresti hvort listinn sé kominn; þegar hann lokast er
 * lykkjan afturkölluð og ekkert er spurt lengur.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PairScreen(
    controller: PairController,
    onDone: () -> Unit,
    onManual: () -> Unit,
    onCancel: () -> Unit
) {
    val state by controller.state.collectAsState()

    // Ný keyrsla (nýr kóði) þegar skjárinn opnast eða ýtt er á „Nýr kóði“.
    // Þegar skjárinn lokast eða keyrslan er endurræst er coroutine-ið afturkallað,
    // svo appið hættir að spyrja vefinn um leið.
    var runId by remember { mutableStateOf(0) }
    LaunchedEffect(runId) { controller.run() }

    BackHandler { onCancel() }

    // Niðurtalning: kóðinn gildir í 10 mínútur.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.expiresAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }

    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(state.status) { firstFocus.requestFocus() }

    val leftSec = ((state.expiresAt - now) / 1000).coerceAtLeast(0)
    val leftText = "%d:%02d".format(leftSec / 60, leftSec % 60)
    val done = state.status == PairStatus.DONE

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 64.dp, vertical = 36.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(tr("📱 Connect from a browser", "📱 Tengja úr vafra"), style = MaterialTheme.typography.displaySmall, color = Text1)
        Spacer(Modifier.height(10.dp))
        Text(
            tr(
                "Go to thverhaus.com/tengja on your phone or computer and enter the code below " +
                    "along with an M3U link or Xtream details. The list arrives here as soon as " +
                    "it is sent — the TV fetches it by itself.",
                "Farðu á thverhaus.com/tengja í símanum eða tölvunni og sláðu inn kóðann hér fyrir " +
                    "neðan ásamt M3U-hlekk eða Xtream-upplýsingum. Listinn kemur hingað um leið og " +
                    "hann er sendur — sjónvarpið sækir hann sjálft."
            ),
            style = MaterialTheme.typography.bodyLarge,
            color = Text2,
            modifier = Modifier.widthIn(max = 1000.dp)
        )

        Spacer(Modifier.height(30.dp))
        Column(
            Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(Ink2)
                .padding(horizontal = 36.dp, vertical = 20.dp)
        ) {
            Text(
                if (state.code.isEmpty()) "…" else PairCode.format(state.code),
                style = MaterialTheme.typography.displayLarge.copy(letterSpacing = 12.sp),
                color = Accent
            )
            Text(
                when (state.status) {
                    PairStatus.WAITING -> tr("Code valid for $leftText", "Kóðinn gildir í $leftText")
                    PairStatus.DONE -> " "
                    else -> " "
                },
                style = MaterialTheme.typography.labelMedium,
                color = Text2
            )
        }

        Spacer(Modifier.height(18.dp))
        Text(
            statusText(state.status, state.count, state.message),
            style = MaterialTheme.typography.titleMedium,
            color = statusColor(state.status)
        )

        Spacer(Modifier.height(26.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (done) {
                TvButton(tr("Continue", "Áfram"), primary = true, modifier = Modifier.focusRequester(firstFocus)) {
                    onDone()
                }
            } else {
                TvButton(
                    tr("New code", "Nýr kóði"),
                    primary = state.status == PairStatus.ERROR,
                    modifier = Modifier.focusRequester(firstFocus)
                ) {
                    runId++
                }
                TvButton(tr("Enter manually", "Setja inn handvirkt"), onClick = onManual)
                TvButton(tr("Back", "Til baka"), onClick = onCancel)
            }
        }

        Spacer(Modifier.height(22.dp))
        Text(
            tr(
                "Links and passwords travel encrypted (HTTPS) straight to the TV and are kept on the site " +
                    "for at most 10 minutes — they are deleted as soon as the TV fetches them.",
                "Slóðir og lykilorð fara dulkóðuð (HTTPS) beint í sjónvarpið og eru geymd á vefnum " +
                    "í mesta lagi 10 mínútur — þeim er eytt um leið og sjónvarpið sækir þau."
            ),
            style = MaterialTheme.typography.bodySmall,
            color = Text2,
            modifier = Modifier.widthIn(max = 1000.dp)
        )
    }
}

private fun statusColor(status: PairStatus) = when (status) {
    PairStatus.DONE -> Ok
    PairStatus.ERROR -> Bad
    else -> Accent
}

// Stöðulínan undir kóðanum (íslenskur texti).
private fun statusText(status: PairStatus, count: Int, message: String?): String = when (status) {
    PairStatus.STARTING -> tr("Getting a code from thverhaus.com…", "Sæki kóða frá thverhaus.com…")
    PairStatus.WAITING -> message ?: tr("Waiting for the list…", "Bíð eftir listanum…")
    PairStatus.APPLYING -> tr("List received — loading channels…", "Listinn kominn — sæki rásir…")
    PairStatus.DONE -> tr("✅ The list is in (${count} channels)", "✅ Listinn er kominn inn (${count} rásir)")
    PairStatus.ERROR -> message ?: tr("Something went wrong", "Eitthvað fór úrskeiðis")
}
