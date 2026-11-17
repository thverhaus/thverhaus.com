package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.sync.PeerView
import app.mulehead.sync.SyncRoom
import app.mulehead.sync.SyncManager
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Ok
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import app.mulehead.ui.theme.Warn

/**
 * „Horfa saman“ (sama og í Mac): búa til eða taka þátt í herbergi og sjá hverjir eru
 * með. Allir í sama herbergi fara á sömu rás og þeir sem eru á undan seinka aðeins svo
 * allir haldist í takt. Skjárinn virkar bæði utan spilara og sem yfirlag yfir myndinni.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun SyncPanel(
    sync: SyncManager,
    onFollow: (key: String, name: String) -> Unit,
    onClose: () -> Unit
) {
    val ui by sync.ui.collectAsState()
    var nick by remember(ui.nickname) { mutableStateOf(ui.nickname) }
    var code by remember { mutableStateOf(sync.savedRoom()) }
    var editNick by remember { mutableStateOf(false) }
    var editCode by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }

    val first = remember { FocusRequester() }
    val nickFocus = remember { FocusRequester() }
    val codeFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocus() }
    LaunchedEffect(editNick) { if (editNick) nickFocus.requestFocus() }
    LaunchedEffect(editCode) { if (editCode) codeFocus.requestFocus() }

    BackHandler { onClose() }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .background(Color.Black.copy(alpha = 0.94f))
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 56.dp, vertical = 36.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("🤝 Watch together", "🤝 Horfa saman"), style = MaterialTheme.typography.displaySmall, color = Text1)
            Spacer(Modifier.width(18.dp))
            if (ui.joined) {
                Text(
                    if (ui.connected) tr("🟢 Connected", "🟢 Tengt") else tr("🟠 Connecting…", "🟠 Tengist…"),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (ui.connected) Ok else Warn
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            tr(
                "Everyone in the same room goes to the same channel and the app keeps them in sync " +
                    "(whoever is ahead waits a little). Nothing is sent except name, channel and time.",
                "Allir í sama herbergi fara á sömu rás og appið heldur þeim í takt " +
                    "(sá sem er á undan seinkar aðeins). Ekkert er sent nema nafn, rás og tími."
            ),
            style = MaterialTheme.typography.bodyMedium,
            color = Text2
        )

        Spacer(Modifier.height(20.dp))
        if (!ui.joined) Join(nick, code, editNick, editCode, nickFocus, codeFocus, first, hint,
            onEditNick = { editNick = it },
            onEditCode = { editCode = it },
            onNick = { nick = it; sync.setNickname(it) },
            onCode = { code = it.uppercase().filter { c -> c.isLetterOrDigit() } },
            onCreate = { sync.create() },
            onJoin = {
                val c = code.trim()
                if (c.isEmpty()) {
                    editCode = true
                    hint = tr("First enter the code from the others.", "Sláðu fyrst inn kóðann frá hinum.")
                } else {
                    sync.join(c)
                }
            }
        ) else Room(sync, ui.peers, nick, editNick, nickFocus,
            myChannel = ui.channelName,
            onNick = { nick = it; sync.setNickname(it) },
            onEditNick = { editNick = it },
            onFollow = onFollow,
            onLeave = {
                sync.leave()
                code = ""
                editCode = false
            }
        )

        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(tr("Back", "Til baka"), onClick = onClose)
        }
    }
}


// Sýnir kóðann og alla gesti; hér eru líka hnapparnir sem stýra samstillingunni.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Room(
    sync: SyncManager,
    peers: List<PeerView>,
    nick: String,
    editNick: Boolean,
    nickFocus: FocusRequester,
    myChannel: String,
    onNick: (String) -> Unit,
    onEditNick: (Boolean) -> Unit,
    onFollow: (key: String, name: String) -> Unit,
    onLeave: () -> Unit
) {
    val ui by sync.ui.collectAsState()
    Text(
        tr("Room ${ui.room}", "Herbergi ${ui.room}"),
        style = MaterialTheme.typography.displaySmall,
        color = Accent
    )
    Text(
        tr("Tell the others the code “${ui.room}” — you will then go to the same channel and stay in sync.", "Segðu hinum kóðann „${ui.room}“ — þið farið þá á sömu rás og haldist í takt."),
        style = MaterialTheme.typography.bodyMedium,
        color = Text2
    )

    Spacer(Modifier.height(16.dp))
    if (editNick) {
        TvField(
            label = tr("Your name (shown to the others)", "Nafnið þitt (sést hjá hinum)"),
            value = nick,
            onChange = onNick,
            modifier = Modifier.fillMaxWidth(0.5f),
            hint = tr("e.g. Julli", "t.d. Júlli"),
            requester = nickFocus,
            onDone = { onEditNick(false) }
        )
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                tr("Your name: ${nick.ifEmpty { "Guest" }}", "Nafnið þitt: ${nick.ifEmpty { "Gestur" }}"),
                style = MaterialTheme.typography.bodyMedium,
                color = Text1
            )
            Spacer(Modifier.width(14.dp))
            TvButton(tr("Change name", "Breyta nafni"), onClick = { onEditNick(true) })
        }
    }

    Spacer(Modifier.height(18.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            tr("${peers.size + 1} in the room", "${peers.size + 1} í herberginu"),
            style = MaterialTheme.typography.titleMedium,
            color = Text1
        )
        Spacer(Modifier.width(14.dp))
        TvButton(
            if (ui.auto) tr("Auto sync: On", "Sjálfvirk samstilling: Á") else tr("Auto sync: Off", "Sjálfvirk samstilling: Af"),
            onClick = { sync.setAuto(!ui.auto) }
        )
    }
    Spacer(Modifier.height(8.dp))
    if (peers.isEmpty()) {
        Text(
            tr("Waiting for others… (they need the same code)", "Bíð eftir fleirum… (þeir þurfa sama kóða)"),
            style = MaterialTheme.typography.labelMedium,
            color = Text2
        )
    }
    for (p in peers) {
        PeerRow(p, myChannel, onFollow)
    }

    Spacer(Modifier.height(10.dp))
    if (ui.lastAction.isNotEmpty()) {
        Text(ui.lastAction, style = MaterialTheme.typography.labelMedium, color = Text2)
    }

    Spacer(Modifier.height(18.dp))
    Text(tr("Delay me manually", "Seinka mér handvirkt"), style = MaterialTheme.typography.labelMedium, color = Text2)
    Spacer(Modifier.height(6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        TvButton(tr("0.5 s", "0,5 sek")) { sync.delay(0.5) }
        TvButton(tr("1 s", "1 sek")) { sync.delay(1.0) }
        TvButton(tr("3 s", "3 sek")) { sync.delay(3.0) }
    }
    Spacer(Modifier.height(16.dp))
    TvButton(tr("Leave room", "Hætta í herbergi"), onClick = onLeave)
}


// Einn gestur: nafn, rás og hvar hann er miðað við mig. `myChannel` er rásin sem ÉG er
// á (tóm þegar ég er ekki í spilun) svo skýringin sé rétt: það er ég sem er ekki á rás,
// ekki gesturinn — hann er einmitt á rás.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PeerRow(
    p: PeerView,
    myChannel: String,
    onFollow: (key: String, name: String) -> Unit
) {
    val status = when {
        p.channel.isEmpty() -> tr("nothing playing", "ekkert í gangi")
        myChannel.isEmpty() -> tr("you're not on a channel", "þú ert ekki á rás")
        !p.sameChannel -> tr("on another channel", "á annarri rás")
        p.otherKind -> tr("different kind of playback", "önnur tegund spilunar")
        p.mismatch -> tr("the time doesn't match", "tíminn passar ekki")
        p.diff == null -> tr("waiting", "bíður")
        !p.playing -> tr("paused", "á pásu")
        else -> SyncRoom.diffText(p.diff)
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            p.name,
            style = MaterialTheme.typography.bodyLarge,
            color = if (p.sameChannel) Text1 else Text2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.width(220.dp)
        )
        Text(
            p.channel.ifEmpty { "—" },
            style = MaterialTheme.typography.bodyMedium,
            color = Text2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.width(280.dp)
        )
        Text(
            status,
            style = MaterialTheme.typography.bodyMedium,
            color = when {
                p.sameChannel && p.diff != null && p.inSync -> Ok
                p.sameChannel && p.diff != null -> Warn
                else -> Text2
            }
        )
        if (!p.sameChannel && p.channel.isNotEmpty()) {
            Spacer(Modifier.width(14.dp))
            TvButton(tr("Switch", "Skipta yfir"), onClick = { onFollow(SyncRoom.channelKey(p.channel), p.channel) })
        }
    }
}

// Upphafsskjár herbergis: nafn, kóði og tveir hnappar.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Join(
    nick: String,
    code: String,
    editNick: Boolean,
    editCode: Boolean,
    nickFocus: FocusRequester,
    codeFocus: FocusRequester,
    first: FocusRequester,
    hint: String?,
    onEditNick: (Boolean) -> Unit,
    onEditCode: (Boolean) -> Unit,
    onNick: (String) -> Unit,
    onCode: (String) -> Unit,
    onCreate: () -> Unit,
    onJoin: () -> Unit
) {
    Text(tr("Your name (shown to the others)", "Nafnið þitt (sést hjá hinum)"), style = MaterialTheme.typography.labelMedium, color = Text2)
    Spacer(Modifier.height(6.dp))
    if (editNick) {
        TvField(
            label = "",
            value = nick,
            onChange = onNick,
            modifier = Modifier.fillMaxWidth(0.5f),
            hint = tr("e.g. Julli", "t.d. Júlli"),
            requester = nickFocus,
            onDone = { onEditNick(false) }
        )
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(nick.ifEmpty { tr("Guest", "Gestur") }, style = MaterialTheme.typography.bodyLarge, color = Text1)
            Spacer(Modifier.width(14.dp))
            TvButton(
                tr("Change name", "Breyta nafni"),
                modifier = Modifier.focusRequester(first),
                onClick = { onEditNick(true) }
            )
        }
    }

    Spacer(Modifier.height(18.dp))
    Text(tr("Room code", "Kóði herbergis"), style = MaterialTheme.typography.labelMedium, color = Text2)
    Spacer(Modifier.height(6.dp))
    if (editCode) {
        TvField(
            label = "",
            value = code,
            onChange = onCode,
            modifier = Modifier.fillMaxWidth(0.35f),
            hint = tr("e.g. NIGHT", "t.d. KVOLD"),
            requester = codeFocus,
            onDone = { onEditCode(false) }
        )
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                code.ifEmpty { "—" },
                style = MaterialTheme.typography.titleLarge,
                color = if (code.isEmpty()) Text2 else Accent
            )
            Spacer(Modifier.width(14.dp))
            TvButton(tr("Enter code", "Slá inn kóða"), onClick = { onEditCode(true) })
        }
    }

    Spacer(Modifier.height(22.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TvButton(tr("Create room", "Búa til herbergi"), primary = true, onClick = onCreate)
        TvButton(tr("Join", "Taka þátt"), onClick = onJoin)
    }
    if (hint != null) {
        Spacer(Modifier.height(12.dp))
        Text(hint, style = MaterialTheme.typography.labelMedium, color = Warn)
    }
    Spacer(Modifier.height(6.dp))
    Text(
        tr("The name is saved in settings; the code is kept so it is easy to join again.", "Nafnið er vistað í stillingum; kóðinn er geymdur svo auðvelt sé að taka þátt aftur."),
        style = MaterialTheme.typography.labelMedium,
        color = Text2
    )
}
