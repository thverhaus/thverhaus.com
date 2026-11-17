package app.mulehead.ui

import app.mulehead.tr

import androidx.activity.compose.BackHandler
import app.mulehead.update.UpdateUi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.data.SettingsDraft
import app.mulehead.data.SettingsRules
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2

/**
 * Stillingar (sama hugmynd og „⚙️ Stillingar“ í Mac-útgáfunni): buffer, user-agent,
 * sameining rása, röðun og hliðrun dagskrár. Allt er vistað í einu þegar ýtt er á
 * „Vista“; BACK eða „Til baka“ skilar án þess að geyma.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun SettingsScreen(
    initial: SettingsDraft,
    onPair: (() -> Unit)? = null,
    // „Slá inn M3U“ (handvirkt) og „Endurnýja lista“ — fluttu hingað af forsíðunni.
    onEditM3u: (() -> Unit)? = null,
    onRefresh: (() -> Unit)? = null,
    // Fela möppur (opnar sér skjá).
    onHideGroups: (() -> Unit)? = null,
    // „Leita að uppfærslu“ (sjá update/Updater.kt).
    update: UpdateUi? = null,
    onCheckUpdate: (() -> Unit)? = null,
    onInstallUpdate: (() -> Unit)? = null,
    onSave: (SettingsDraft) -> Unit,
    onCancel: () -> Unit,
    // Tungumál: tekur gildi strax og vistast um leið (þarf ekki „Vista“).
    onLanguage: ((String) -> Unit)? = null
) {
    var draft by remember { mutableStateOf(initial) }
    // Fókus fer beint á fyrstu stýringu svo fjarlægðarstýringin virki strax.
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { firstFocus.requestFocus() }

    // User-agent er ekki textareitur fyrr en ýtt er á „Breyta“ — annars opnaðist
    // lyklaborðið um leið og fókus færi yfir reitinn.
    var editingUa by remember { mutableStateOf(false) }
    var editedUa by remember { mutableStateOf(false) }
    val uaFocus = remember { FocusRequester() }
    val breytaFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editingUa) {
        if (editingUa) uaFocus.requestFocus() else if (editedUa) breytaFocus.requestFocus()
    }

    BackHandler { onCancel() }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 44.dp, vertical = 30.dp)
    ) {
        Text(tr("⚙️ Settings", "⚙️ Stillingar"), style = MaterialTheme.typography.displaySmall, color = Text1)
        Spacer(Modifier.height(6.dp))
        Text(
            tr("Changes apply when you press “Save”. The player uses the new buffer and user-agent the next time a channel opens.", "Breytingar gilda þegar ýtt er á „Vista“. Spilarinn tekur buffer og user-agent í notkun næst þegar rás er opnuð."),
            style = MaterialTheme.typography.bodyMedium,
            color = Text2
        )

        if (onLanguage != null) {
            Section("🌐 Language / Tungumál")
            SettingRow(tr("Language", "Tungumál"), tr("Takes effect right away.", "Tekur gildi strax.")) {
                TvButton("English", primary = !app.mulehead.Lang.isIcelandic) { onLanguage(app.mulehead.Lang.EN) }
                TvButton("Íslenska", primary = app.mulehead.Lang.isIcelandic) { onLanguage(app.mulehead.Lang.IS) }
            }
        }

        Section(tr("📶 Streaming", "📶 Streymi"))
        SettingRow(tr("Buffer", "Buffer"), tr("Bigger buffer = steadier stream, but takes longer to start.", "Stærri buffer = stöðugra streymi, en tekur lengri tíma að byrja.")) {
            TvButton(
                tr("− ${SettingsRules.BUFFER_STEP} s", "− ${SettingsRules.BUFFER_STEP} sek"),
                modifier = Modifier.focusRequester(firstFocus)
            ) {
                draft = draft.copy(
                    bufferSec = SettingsRules.stepBuffer(draft.bufferSec, -SettingsRules.BUFFER_STEP)
                )
            }
            Value(SettingsRules.bufferLabel(draft.bufferSec))
            TvButton(tr("+ ${SettingsRules.BUFFER_STEP} s", "+ ${SettingsRules.BUFFER_STEP} sek")) {
                draft = draft.copy(
                    bufferSec = SettingsRules.stepBuffer(draft.bufferSec, SettingsRules.BUFFER_STEP)
                )
            }
        }
        // Sjálfvirk uppfylling (Mac: growSlow). Aðeins beinar rásir; í herbergi stýrir
        // samstillingin hraðanum og þá er þessi stilling ekki í notkun.
        SettingRow(
            tr("Automatic buffer fill", "Sjálfvirk bufferuppfylling"),
            tr("Live channels play slightly slower (0.95×) until the buffer is full — so the picture freezes less.", "Bein rás er spiluð aðeins hægar (0,95×) þar til bufferinn er kominn í mark — svo myndin frjósi síður.")
        ) {
            Toggle(draft.growSlow) { draft = draft.copy(growSlow = it) }
        }
        if (editingUa) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                TvField(
                    label = tr("User-agent (empty = VLC)", "User-agent (tómt = VLC)"),
                    value = draft.userAgent,
                    onChange = { draft = draft.copy(userAgent = it) },
                    modifier = Modifier.fillMaxWidth(),
                    hint = tr("e.g. VLC/3.0.20 LibVLC/3.0.20", "t.d. VLC/3.0.20 LibVLC/3.0.20"),
                    requester = uaFocus,
                    onDone = {
                        editingUa = false
                        keyboard?.hide()
                    }
                )
                TvButton(tr("Close", "Loka")) {
                    editingUa = false
                    keyboard?.hide()
                }
            }
        } else {
            SettingRow("User-agent", tr("Some subscriptions require a specific user-agent.", "Sumar áskriftir krefjast ákveðins user-agent.")) {
                Text(
                    draft.userAgent.ifEmpty { tr("Default (VLC)", "Sjálfgefið (VLC)") },
                    style = MaterialTheme.typography.bodyLarge,
                    color = Accent,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 420.dp)
                )
                TvButton(tr("Change", "Breyta"), modifier = Modifier.focusRequester(breytaFocus)) {
                    editedUa = true
                    editingUa = true
                }
            }
        }

        Section(tr("📁 Channel list", "📁 Rásalisti"))
        SettingRow(tr("Sort channels A–Z", "Raða rásum A–Ö"), tr("Within each folder.", "Innan hvers flokks.")) {
            Toggle(draft.sortAZ) { draft = draft.copy(sortAZ = it) }
        }
        SettingRow(tr("Merge HD / FHD / 4K", "Sameina HD / FHD / 4K"), tr("Same channel on one row, not three.", "Sama rás í einni línu, ekki þremur.")) {
            Toggle(draft.mergeVariants) { draft = draft.copy(mergeVariants = it) }
        }

        // Parun: nýr listi er settur inn með kóða á thverhaus.com/tengja (sama og
        // „Tengja úr vafra“ á forsíðunni) — enginn opinn vefþjónn er í appinu.
        if (update != null) {
            Section(tr("🔄 Updates", "🔄 Uppfærsla"))
            val avail = update.available
            SettingRow(
                if (avail != null) tr("New version: ${avail.versionName}", "Ný útgáfa: ${avail.versionName}") else tr("Version ${update.currentName}", "Útgáfa ${update.currentName}"),
                update.message ?: when {
                    update.progress != null -> tr("Downloading… ${update.progress}%", "Sæki… ${update.progress}%")
                    update.checking -> tr("Checking…", "Athuga…")
                    avail != null -> tr("Downloads and opens the installer. Your channel list and settings are kept.", "Sækir og opnar uppsetninguna. Rásalistinn og stillingarnar haldast.")
                    else -> tr("Checks automatically once a day in the background.", "Athugar sjálft einu sinni á dag í bakgrunni.")
                }
            ) {
                if (avail != null && onInstallUpdate != null) {
                    TvButton(tr("Download and install", "Sækja og setja upp"), primary = true, onClick = onInstallUpdate)
                } else if (onCheckUpdate != null) {
                    TvButton(tr("Check for updates", "Leita að uppfærslu"), onClick = onCheckUpdate)
                }
            }
        }

        Section(tr("📱 New list", "📱 Nýr listi"))
        SettingRow(
            tr("Connect from a browser", "Tengja úr vafra"),
            tr("The TV shows a code that you enter at thverhaus.com/tengja along with an M3U link or Xtream details.", "Sjónvarpið sýnir kóða sem þú slærð inn á thverhaus.com/tengja ásamt M3U-slóð eða Xtream-upplýsingum.")
        ) {
            if (onPair != null) TvButton(tr("Show code", "Sýna kóða"), onClick = onPair)
            Text(
                "thverhaus.com/tengja",
                style = MaterialTheme.typography.bodyLarge,
                color = Accent,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 300.dp)
            )
        }

        if (onEditM3u != null) {
            SettingRow(tr("Enter M3U", "Slá inn M3U"), tr("M3U link and EPG link typed with the remote.", "M3U-slóð og dagskrárslóð slegnar inn með fjarstýringunni.")) {
                TvButton(tr("Enter M3U", "Slá inn M3U"), onClick = onEditM3u)
            }
        }
        if (onRefresh != null) {
            SettingRow(tr("Refresh list", "Endurnýja lista"), tr("Loads the channel list and EPG now (otherwise automatic).", "Sækir rásalistann og dagskrána strax (annars sjálfkrafa).")) {
                TvButton(tr("Refresh now", "Endurnýja núna"), onClick = onRefresh)
            }
        }

        if (onHideGroups != null) {
            SettingRow(tr("Hide folders", "Fela möppur"), tr("Unticked folders are hidden from the folder list, “All” and search.", "Möppur sem þú hakar úr sjást hvorki í flokkunum, „Allt“ né leitinni.")) {
                TvButton(tr("Choose folders", "Velja möppur"), onClick = onHideGroups)
            }
        }

        Section(tr("📺 EPG and refresh", "📺 Dagskrá og uppfærslur"))
        SettingRow(tr("Auto refresh", "Uppfæra sjálfkrafa"), tr("How often the list and EPG are loaded.", "Hversu oft listinn og dagskráin eru sótt.")) {
            SettingsRules.REFRESH_CHOICES.forEach { h ->
                Choice(SettingsRules.refreshLabel(h), selected = draft.refreshHours == h) {
                    draft = draft.copy(refreshHours = h)
                }
            }
        }
        SettingRow(tr("Shift EPG", "Hliðra dagskrá"), tr("If the EPG is off by half an hour or an hour.", "Ef dagskráin er skekkt um hálfa eða heila klukkustund.")) {
            TvButton(tr("− ${SettingsRules.OFFSET_STEP} min", "− ${SettingsRules.OFFSET_STEP} mín")) {
                draft = draft.copy(
                    epgOffsetMin = SettingsRules.stepOffset(draft.epgOffsetMin, -SettingsRules.OFFSET_STEP)
                )
            }
            Value(SettingsRules.offsetLabel(draft.epgOffsetMin), bad = draft.epgOffsetMin != 0)
            TvButton(tr("+ ${SettingsRules.OFFSET_STEP} min", "+ ${SettingsRules.OFFSET_STEP} mín")) {
                draft = draft.copy(
                    epgOffsetMin = SettingsRules.stepOffset(draft.epgOffsetMin, SettingsRules.OFFSET_STEP)
                )
            }
            if (draft.epgOffsetMin != 0) TvButton(tr("Reset", "Núll")) { draft = draft.copy(epgOffsetMin = 0) }
        }

        Spacer(Modifier.height(30.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            TvButton(tr("Save", "Vista"), primary = true) { onSave(draft) }
            TvButton(tr("Back", "Til baka"), onClick = onCancel)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            tr("Defaults: 60 s buffer, VLC user-agent, refresh every 12 h, no EPG shift.", "Sjálfgefið: buffer 60 sek, VLC user-agent, sókn á 12 klst fresti, engin hliðrun."),
            style = MaterialTheme.typography.bodySmall,
            color = Text2
        )
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleMedium,
        color = Text1,
        modifier = Modifier.padding(top = 24.dp, bottom = 6.dp)
    )
}

// Heiti og skýring vinstra megin, stýringarnar hægra megin.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun SettingRow(
    title: String,
    hint: String? = null,
    content: @Composable RowScope.() -> Unit
) {
    // Línan sem fókusinn er í fær ljósan bakgrunn og bláa rönd vinstra megin, svo sjáist
    // hvaða stilling er verið að breyta (ekki bara hvaða hnappur).
    var active by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth()
            .onFocusChanged { active = it.hasFocus }
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
            .background(if (active) Accent.copy(alpha = 0.12f) else androidx.compose.ui.graphics.Color.Transparent)
            .padding(vertical = 6.dp, horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        androidx.compose.foundation.layout.Box(
            Modifier.width(4.dp).height(36.dp)
                .background(if (active) Accent else androidx.compose.ui.graphics.Color.Transparent)
        )
        androidx.compose.foundation.layout.Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = if (active) Text1 else Text1.copy(alpha = 0.85f))
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.labelMedium, color = Text2)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content
        )
    }
}

// Gildið sem verið er að stilla (t.d. „60 sek“ eða „+30 mín“).
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Value(text: String, bad: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = if (bad) Bad else Accent,
        textAlign = TextAlign.Center,
        modifier = Modifier.widthIn(min = 96.dp)
    )
}

// Á/Af-rofi sem virkar með fjarlægðarstýringunni.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) {
    TvButton(if (on) tr("On", "Á") else tr("Off", "Af"), primary = on, onClick = { onChange(!on) })
}

// Einn valkostur í hópi (t.d. 6 klst / 12 klst …); sá valdi er litaður.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    TvButton(label, primary = selected, onClick = onClick)
}
