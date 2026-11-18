package app.mulehead.ui

import app.mulehead.tr

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.os.SystemClock
import android.view.ViewGroup
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.mulehead.data.Programme
import app.mulehead.data.Resume
import app.mulehead.data.ResumeStore
import app.mulehead.player.BufferAlerts
import app.mulehead.player.RetryPolicy
import app.mulehead.player.SniffHolder
import app.mulehead.player.SniffingDataSourceFactory
import app.mulehead.player.StreamKind
import app.mulehead.player.SubOption
import app.mulehead.player.AudioOption
import app.mulehead.player.AudioTracks
import app.mulehead.player.Subtitles
import androidx.media3.common.Tracks
import app.mulehead.sync.SyncManager
import app.mulehead.sync.SyncRoom
import app.mulehead.sync.SyncUi
import app.mulehead.sync.TsSniffer
import app.mulehead.ui.theme.Accent
import app.mulehead.ui.theme.Bad
import app.mulehead.ui.theme.Ok
import app.mulehead.ui.theme.Text1
import app.mulehead.ui.theme.Text2
import app.mulehead.ui.theme.Warn
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow

// Staða spilarans á skjánum (ekki það sama og Player.STATE_*).
private enum class PlayerStatus { Connecting, Reconnecting, Playing, Paused, Buffering, Ended, Failed }

// Klukka fyrir „Horfa saman“ — sama klukka og Mac-útgáfan notar.
//
// Í MPEG-TS-streymi er tíminn PTS úr straumnum sjálfum: „alger“ tími = grunnur + staða
// (grunnurinn er fyrsti PTS, lesinn af [SniffHolder]). Þá er hlé, endurtenging og
// hraðabreyting innifalin í tölunni — og hún er NÁKVÆMLEGA sama tala og Mac sendir, svo
// Mac og Android-tæki geta átt í sama herbergi.
//
// Ef PTS finnst ekki (t.d. HLS eða skrá) er notuð rauntíma-klukka: hvert hlé færir okkur
// aftar, alveg eins og áður.
private class SyncClock {
    @Volatile var behindSec: Double = 0.0
    @Volatile var playing: Boolean = false
    // Hér setur skoðunarlotan (sjá LaunchedEffect) stöðuna; aðrir þræðir lesa hana.
    @Volatile var prepared: Boolean = false
    @Volatile var ptsBase: Double? = null
    @Volatile var posSec: Double = 0.0
    @Volatile var posAt: Long = 0L
    @Volatile var speed: Float = 1f

    // Alger straumtími (eða null á meðan ekkert myndskeið er tilbúið — þá er ekkert að bera
    // saman, sama og `readyState < 2` í Mac).
    fun streamTime(): SyncManager.StreamTime? {
        if (!prepared) return null
        val base = ptsBase
        if (base != null) {
            val dt = (SystemClock.elapsedRealtime() - posAt) / 1000.0
            val pos = posSec + if (playing) dt * speed else 0.0
            return SyncManager.StreamTime("pts", (base + pos) % TsSniffer.PTS_WRAP)
        }
        return SyncManager.StreamTime("clock", System.currentTimeMillis() / 1000.0 - behindSec)
    }
}

// Buffer-hleðsla í gangi: hversu margar sekúndur vantar (want) og hvaðan (from).
private class Bank(val want: Int, val from: Int, val t0: Long)

// Allt sem yfirlagið þarf að sjá fyrir utan nafn/dagskrá.
private data class OverlayExtra(
    val bank: Bank? = null,
    val bankSec: Int = 0,
    val cushion: Int = 0,
    val bufferMark: Int = 60,
    val pos: Long = 0,
    val dur: Long = 0,
    val notice: String? = null,
    val sync: SyncUi? = null
)

// Lágmark sem buffer-hleðsla þarf að bæta við sig (annars er ekkert gagn af henni).
private const val MIN_BANK_SEC = 3

// Ef straumurinn segir frá óeðlilega stórum buffer (gallaðir tímar, t.d. 4.000.000 sek)
// á að hunsa það frekar en að slökkva á öllum vöktum (sama vernd og MAX_AHEAD_SEC í Mac).
private const val MAX_AHEAD_SEC = 600

// Sjálfvirk uppfylling (Mac: Player.GROW_RATE): 0,95× fyllir ~3 sek á mínútu. Eftir slit
// er spilað 0,90× (GROW_RATE_RECOVER) svo bufferinn verði fljótt verndandi aftur.
private const val GROW_RATE = 0.95f
private const val OVERLAY_HIDE_MS = 8_000L

// Um 2 mínútur af 8 Mbit/s straumi; Mi TV box leyfir appinu 256 MB.
private const val TARGET_BUFFER_BYTES = 120 * 1024 * 1024
private const val LOG_TAG = "Mulehead"
private const val GROW_RATE_RECOVER = 0.90f

/**
 * Spilar einni rás með Media3/ExoPlayer. Yfirlagið birtist neðst: nafn rásar,
 * dagskrá og hnappar („Hlaða buffer“, „Horfa saman“ og fleira).
 * Ýttu á OK til að sýna/fela yfirlagið, BACK til að hætta.
 *
 * Ef straumurinn dettur út er endurtengt sjálfkrafa (1, 2, 4, 8, 16, 30 sek …) svo
 * notandinn þurfi ekki að gera neitt — sama hegðun og í Mac-útgáfunni.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PlayerScreen(
    title: String,
    group: String,
    url: String,
    now: Programme?,
    next: Programme?,
    userAgent: String,
    bufferSec: Int,
    // Sjálfvirk bufferuppfylling (Mac: growSlow): bein rás er spiluð aðeins hægar þar til
    // bufferinn er kominn í markið. Í herbergi stýrir samstillingin hraðanum og þá er
    // þessi stilling ekki í notkun (sjá rateOwned()).
    growSlow: Boolean = true,
    // Bein rás endurtengist og byrjar aftur; mynd/þáttur endar bara (pása).
    live: Boolean = true,
    // „Horfa saman“ virkar aðeins fyrir beinar rásir; lykillinn er nafn rásarinnar.
    sync: SyncManager? = null,
    channelKey: String = "",
    // Afbrigði sameinaðrar rásar (Mac: „chips“): heiti hvers og hvert er í spilun.
    variants: List<String> = emptyList(),
    variantIndex: Int = 0,
    onVariant: (Int) -> Unit = {},
    // Rásaskipti með upp/niður örvum (-1 = fyrri, 1 = næsta rás í listanum).
    onZap: ((Int) -> Unit)? = null,
    // Við rásaskipti birtist bara nafnið efst, ekki allt yfirlagið.
    overlayAtStart: Boolean = true,
    // ⭐ í yfirlaginu (null = enginn hnappur, t.d. í myndum).
    fav: Boolean? = null,
    onFav: () -> Unit = {},
    // Heilsa rásarinnar (ChannelHealth): vandi (ástæða, alvarlegt) og hrein spilun (sek).
    onTrouble: (String, Boolean) -> Unit = { _, _ -> },
    onClean: (Int) -> Unit = {},
    onBack: () -> Unit
) {
    val ctx = LocalContext.current
    val troubleNow by rememberUpdatedState(onTrouble)
    val cleanNow by rememberUpdatedState(onClean)
    // Tegund straums ræður klukkunni í herberginu; sniffarinn les PTS beint úr TS-streyminu
    // (sama tala og Mac sendir) svo Mac og Android-tæki geti verið í sama herbergi.
    val streamKind = remember(url) { StreamKind.of(url) }
    val sniff = remember(url) { SniffHolder() }
    val player = remember(url, userAgent, bufferSec) {
        buildPlayer(ctx, userAgent, bufferSec, streamKind, sniff)
    }
    val retry = remember(url) { RetryPolicy() }
    var retryTick by remember(url) { mutableIntStateOf(0) }
    var status by remember(url) { mutableStateOf(PlayerStatus.Connecting) }
    var detail by remember(url) { mutableStateOf<String?>(null) }
    var overlay by remember(url) { mutableStateOf(overlayAtStart) }
    var playingSince by remember(url) { mutableLongStateOf(0L) }

    val clock = remember(url) { SyncClock() }
    val resume = remember { ResumeStore(ctx) }
    val main = remember { Handler(Looper.getMainLooper()) }
    val holdGen = remember(url) { AtomicInteger(0) }
    val savedPos = remember(url) { resume.position(url) }

    var bank by remember(url) { mutableStateOf<Bank?>(null) }
    var bankSec by remember(url) { mutableIntStateOf(0) }
    var cushion by remember(url) { mutableIntStateOf(0) }
    // Áminning neðst í horninu þegar bufferinn lækkar (40/30/20/10 sek), sjá BufferAlerts.
    val alerts = remember(url) { BufferAlerts() }
    var alertLevel by remember(url) { mutableStateOf<Int?>(null) }
    var alertAt by remember(url) { mutableLongStateOf(0L) }
    var viewPos by remember(url) { mutableLongStateOf(0L) }
    var viewDur by remember(url) { mutableLongStateOf(0L) }
    var notice by remember(url) { mutableStateOf<String?>(null) }
    var syncPanel by remember(url) { mutableStateOf(false) }
    var restored by remember(url) { mutableStateOf(false) }
    var finished by remember(url) { mutableStateOf(false) }

    val syncFlow = remember(sync) { sync?.ui ?: MutableStateFlow(SyncUi()) }
    val syncUi by syncFlow.collectAsState()

    // Skjárinn má ekki slokkna meðan verið er að horfa.
    val activity = ctx as? Activity
    DisposableEffect(activity) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    // Textar sem fylgja straumnum (Off + hver texti) og sá sem er valinn.
    val subStore = remember { app.mulehead.data.SettingsStore(ctx) }
    var subOpts by remember(url) { mutableStateOf<List<SubOption>>(emptyList()) }
    var subCur by remember(url) { mutableStateOf<SubOption?>(null) }
    // Hljóðrásir (fleiri en ein = takkinn birtist).
    var audOpts by remember(url) { mutableStateOf<List<AudioOption>>(emptyList()) }
    var audCur by remember(url) { mutableStateOf<AudioOption?>(null) }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                val opts = Subtitles.options(tracks)
                if (opts.map { it.key to it.label } != subOpts.map { it.key to it.label }) {
                    // Nýir textar: síðasta val notandans gildir (t.d. Off eða enska).
                    Subtitles.applyPreference(player, opts, subStore.subtitlePref)
                }
                subOpts = opts
                subCur = Subtitles.current(player, opts)
                val aud = AudioTracks.options(tracks)
                if (aud.map { it.key to it.label } != audOpts.map { it.key to it.label }) {
                    AudioTracks.applyPreference(player, aud, subStore.audioPref)
                }
                audOpts = aud
                audCur = AudioTracks.current(aud)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING ->
                        if (status != PlayerStatus.Failed) status = PlayerStatus.Buffering
                    Player.STATE_READY -> {
                        status = if (player.isPlaying) PlayerStatus.Playing else PlayerStatus.Paused
                        // Mynd/þáttur heldur áfram þar sem frá var horfið (eins og í Mac).
                        if (!live && !restored) {
                            restored = true
                            val dur = player.duration
                            val at = if (dur > 0 && savedPos > dur - 10_000) 0L else savedPos
                            if (at > 5_000) {
                                player.seekTo(at)
                                notice = tr("Resuming from ${Resume.clock(at)}", "Heldur áfram frá ${Resume.clock(at)}")
                            }
                        }
                    }
                    Player.STATE_ENDED -> if (live) {
                        Log.w(LOG_TAG, "live stream ended")
                        troubleNow(tr("the stream dropped", "straumurinn slitnaði"), false)
                        retryTick++
                    } else {
                        // Mynd/þáttur kláraðist: ekki byrja aftur, sýna yfirlagið.
                        status = PlayerStatus.Ended
                        overlay = true
                        finished = true
                        resume.clear(url)
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    playingSince = SystemClock.elapsedRealtime()
                    status = PlayerStatus.Playing
                } else if (status == PlayerStatus.Playing) {
                    status = PlayerStatus.Paused
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                // Aðeins villukóði og tegund, aldrei slóð (hún inniheldur lykilorð).
                Log.w(LOG_TAG, "error=${error.errorCodeName} cause=${error.cause?.javaClass?.simpleName}")
                detail = describe(error)
                status = PlayerStatus.Failed
                // Þriðja villan í röð: rásin er merkt rauð strax (eins og „dauð“ rás í Mac).
                troubleNow(detail ?: "villa", retry.attempt >= 3)
                retryTick++
            }
        }
        player.addListener(listener)
        onDispose {
            if (!live && !finished) {
                resume.save(url, player.currentPosition, player.duration)
            }
            player.removeListener(listener)
            player.release()
        }
    }

    // Þegar farið er úr appinu (heimahnappur, önnur forrit) á spilunin að hætta, eins og
    // í öllum sjónvarpsöppum. Bein rás tengist aftur við endann þegar komið er til baka;
    // mynd/þáttur bíður í pásu á sama stað.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> if (live) {
                    bank = null
                    bankSec = 0
                    player.stop()
                } else {
                    if (!finished) resume.save(url, player.currentPosition, player.duration)
                    player.pause()
                }
                Lifecycle.Event.ON_START -> if (live && player.playbackState == Player.STATE_IDLE) {
                    retry.reset()
                    status = PlayerStatus.Connecting
                    detail = null
                    runCatching {
                        player.prepare()
                        player.playWhenReady = true
                    }
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Opnar strauminn og endurtengir; biðtíminn lengist með hverri misheppnaðri tilraun.
    LaunchedEffect(url, retryTick) {
        alerts.reset()
        alertLevel = null
        if (retryTick == 0) {
            retry.reset()
            status = PlayerStatus.Connecting
            detail = null
        } else {
            status = PlayerStatus.Reconnecting
            var left = retry.nextDelayMs()
            // Niðurtalning svo notandinn sjái að eitthvað sé í gangi.
            while (left > 0) {
                detail = tr("Reconnecting in ${(left + 999) / 1000} seconds…", "Endurtengi eftir ${(left + 999) / 1000} sekúndur…")
                val step = minOf(1_000L, left)
                delay(step)
                left -= step
            }
            detail = null
        }
        runCatching {
            player.setMediaItem(MediaItem.fromUri(url))
            player.prepare()
            player.playWhenReady = true
        }.onFailure {
            detail = it.message ?: it.javaClass.simpleName
            status = PlayerStatus.Failed
        }
    }

    // Ef straumurinn hefur spilast í 20 sekúndur er hann talinn heill og teljarinn
    // byrjar aftur frá byrjun (þannig verður næsta endurtenging fljót).
    LaunchedEffect(player) {
        while (true) {
            delay(5_000)
            if (player.isPlaying && playingSince > 0) {
                retry.onStablePlayback(SystemClock.elapsedRealtime() - playingSince)
            }
        }
    }

    // ---- Buffer-hleðsla („Hlaða buffer“) ----

    // Hversu margar sekúndur eru í buffer: mælt ef hægt, annars hversu lengi hléið hefur staðið.
    // Gildi yfir MAX_AHEAD_SEC eru gallaðir tímar en ekki buffer (sjá Mac) — clamp-ar niður.
    // Raunverulegur buffer (það sem er komið í spilarann). Áður var biðtíminn í hleðslu talinn
    // með: þá sýndi hleðslan 55 sek þó að EKKERT hefði borist (11. nóv., Mi box) og sagði
    // „Buffer fullt“ – og myndin fraus um leið og spilað var aftur.
    fun cushionSec(): Int {
        val buffered = ((player.bufferedPosition - player.currentPosition) / 1_000L).toInt()
        return buffered.coerceIn(0, MAX_AHEAD_SEC)
    }

    // Hversu langt fram ExoPlayer safnar (sama og í buildPlayer).
    val maxAheadSec = maxOf(bufferSec.coerceIn(2, 120) * 1000 + 30_000, 60_000).coerceAtMost(120_000) / 1000

    // Markið er buffer-stillingin (að minnsta kosti 20 sek) — t.d. 60 sek.
    fun bufferMark(): Int = maxOf(20, bufferSec.coerceIn(2, 120))

    fun startBank(mark: Int): Int {
        if (!live || player.playbackState == Player.STATE_IDLE) return 0
        val running = bank
        if (running != null) return running.want
        val from = cushionSec()
        val want = mark - from
        if (want < MIN_BANK_SEC) return 0
        bank = Bank(want, from, SystemClock.elapsedRealtime())
        bankSec = from
        player.pause()
        return want
    }

    fun finishBank() {
        if (bank == null) return
        bank = null
        bankSec = 0
        holdGen.incrementAndGet()
        if (player.playbackState != Player.STATE_IDLE && player.playbackState != Player.STATE_ENDED) {
            player.play()
        }
    }

    // Hleðsla sem herbergið bað um: annað hvort upp að sama marki og við notum eða
    // í `sec` sekúndur (þegar hinir nota annað mark).
    fun syncBank(mark: Int, sec: Int, by: String) {
        val target = if (mark >= 5) mark else maxOf(sec, MIN_BANK_SEC)
        val want = startBank(target)
        if (want > 0) notice = tr("🤝 $by is filling the buffer ($target s)", "🤝 $by hleður buffer ($target sek)")
    }

    fun toggleBank() {
        if (bank != null) {
            finishBank()
            notice = tr("Playing on", "Spilar áfram")
            return
        }
        val mark = bufferMark()
        val want = startBank(mark)
        if (want == 0) {
            notice = tr("Buffer is already big enough (${cushionSec()} s)", "Buffer er þegar nógu stór (${cushionSec()} sek)")
            return
        }
        notice = tr("Filling buffer up to $mark s", "Hleð buffer upp að $mark sek")
        sync?.announceBank(want, mark)
    }

    fun seekBy(deltaMs: Long) {
        val dur = player.duration
        val max = if (dur > 0) dur else Long.MAX_VALUE
        player.seekTo((player.currentPosition + deltaMs).coerceIn(0L, max))
        clock.behindSec = 0.0
    }

    // Hleðsla á buffer, klukkan sem herbergið notar og staða í mynd/þætti (fyrir áframhald).
    LaunchedEffect(player, url, live) {
        var last = SystemClock.elapsedRealtime()
        var lastLog = 0L
        var stallSince = 0L
        var stallMarked = false
        var jamSince = 0L
        var cleanMs = 0L
        var savedAt = 0L
        while (true) {
            delay(500)
            val now = SystemClock.elapsedRealtime()
            val dt = (now - last).coerceIn(0L, 4_000L)
            last = now
            val prepared = player.playbackState != Player.STATE_IDLE &&
                player.playbackState != Player.STATE_ENDED &&
                player.playbackState != Player.STATE_BUFFERING
            clock.playing = player.isPlaying
            // Klukkan sem herbergið notar: grunnur streymsins (fyrsti PTS) + staðan í
            // spilaranum. Skoðað á 0,5 sek fresti en reiknað upp á millisekúndu (sjá
            // SyncClock.streamTime) svo talan sé nákvæmari en 0,2 sek.
            clock.prepared = prepared
            clock.ptsBase = if (live) sniff.base() else null
            clock.posSec = player.currentPosition / 1000.0
            clock.posAt = now
            clock.speed = player.playbackParameters.speed
            // Í beinni rás er hvert hlé (buffer-hleðsla, pása, endurtenging) tími sem við
            // verðum eftir — það er einmitt það sem herbergið þarf að vita.
            if (live && prepared && !player.isPlaying) clock.behindSec += dt / 1000.0
            // Hraðinn: við spilum hraðar/hægar en rauntíminn, en klukkan er reiknuð út frá
            // rauntíma — án þessa myndi hún segja ósatt um stöðuna (Mac les PTS úr straumnum).
            if (live && prepared && player.isPlaying) {
                val speed = player.playbackParameters.speed
                if (speed != 1f) clock.behindSec += dt / 1000.0 * (1.0 - speed)
            }
            if (live) cushion = cushionSec()
            // Myndin stendur og ekkert berst: segja frá því svo ekki sé haldið að appið sé frosið.
            if (live && player.playbackState == Player.STATE_BUFFERING && bank == null) {
                if (stallSince == 0L) stallSince = now
                if (now - stallSince > 15_000 && status == PlayerStatus.Buffering) {
                    detail = tr("The stream is not arriving – the provider is responding too slowly", "Straumurinn berst ekki – þjónustan svarar of hægt")
                    if (!stallMarked) {
                        stallMarked = true
                        troubleNow(tr("the provider is responding too slowly", "þjónustan svarar of hægt"), false)
                    }
                }
            } else {
                if (stallSince != 0L && detail?.startsWith(tr("The stream is not arriving", "Straumurinn berst ekki")) == true) detail = null
                stallSince = 0L
                stallMarked = false
            }
            // Fastur straumur: minni spilarans (TARGET_BUFFER_BYTES) er fullt en innan við 1 sek
            // af mynd í því, svo hann hættir að sækja og myndin frýs eða hikstar (11. nóv.: þúsundir
            // „Target buffer size reached with less than 500ms“). Þetta lagast ekki af sjálfu sér;
            // eina ráðið er að tengjast upp á nýtt (þá tæmist minnið og spilað er frá endanum).
            val state = player.playbackState
            val realBufMs = player.bufferedPosition - player.currentPosition
            if (live && (state == Player.STATE_READY || state == Player.STATE_BUFFERING) &&
                !player.isLoading && realBufMs < 1_000
            ) {
                if (jamSince == 0L) jamSince = now
                if (now - jamSince > 6_000) {
                    Log.w(LOG_TAG, "jammed: not loading, ${realBufMs}ms buffered – reconnecting")
                    jamSince = 0L
                    if (bank != null) finishBank()
                    troubleNow(tr("the stream got stuck", "straumurinn festist"), false)
                    notice = tr("⚠️ The stream got stuck – reconnecting", "⚠️ Straumurinn festist – tengi aftur")
                    retry.reset()
                    retryTick++
                }
            } else {
                jamSince = 0L
            }
            // Hrein spilun (engin endurtenging, hleðsla eða bið): á 10 mín fresti léttir á merki.
            if (live) {
                if (retry.attempt > 0 || status == PlayerStatus.Failed) cleanMs = 0L
                else if (player.isPlaying && bank == null) {
                    val before = cleanMs / 1000 / app.mulehead.data.ChannelHealth.CLEAN_CREDIT_SEC
                    cleanMs += dt
                    if (cleanMs / 1000 / app.mulehead.data.ChannelHealth.CLEAN_CREDIT_SEC > before) cleanNow((cleanMs / 1000).toInt())
                }
            }
            if (live) {
                if (bank != null || !prepared) {
                    // Hleðsla eða tenging í gangi: engar áminningar fyrr en bufferinn er
                    // aftur kominn í öruggt svæði.
                    alerts.reset()
                } else {
                    val lvl = alerts.update(cushion, bufferMark())
                    if (lvl != null && (alertLevel == null || lvl <= alertLevel!!)) {
                        alertLevel = lvl
                        alertAt = now
                        Log.i(LOG_TAG, "alert=${lvl}s buffer=${cushion}s")
                    }
                }
                // Hversu lengi miðinn stendur: 40/30 = 4 sek, 20 = 10 sek, 10 = þar til > 20.
                val shown = alertLevel
                if (shown != null) {
                    val gone = when {
                        shown <= 10 -> cushion > BufferAlerts.ACTION_LEVEL
                        shown <= BufferAlerts.ACTION_LEVEL -> now - alertAt > 10_000
                        else -> now - alertAt > 4_000
                    }
                    if (gone) alertLevel = null
                }
            }
            // Greining á boxinu (adb logcat -s Mulehead): bara tölur, aldrei slóðir.
            if (live && now - lastLog >= 5_000) {
                lastLog = now
                Log.i(
                    LOG_TAG,
                    "buffer=${cushion}s state=${player.playbackState} playing=${player.isPlaying} " +
                        "speed=${player.playbackParameters.speed} loading=${player.isLoading} " +
                        "retry=${retry.attempt}"
                )
            }

            // Sjálfvirk uppfylling: undir markinu er spilað aðeins hægar þar til markinu er
            // náð (hljóðið helst óbreytt). Samstillingin á rásina stýrir hraðanum sjálf
            // þegar hún er virk — annars myndu þær togast á og bufferinn fylltist aldrei.
            // Ef uppfyllingin er ekki í gildi er hraðinn skilað í 1× (svo 0,95 sitji ekki
            // eftir þegar slökkt er á henni eða herbergi tekur við).
            val owned = sync?.rateOwned() == true
            val grow = live && growSlow && !owned && bank == null && cushion < bufferMark() - 1
            val want = if (grow) {
                if (retry.attempt > 0) GROW_RATE_RECOVER else GROW_RATE
            } else {
                1f
            }
            if (!owned && player.playbackParameters.speed != want) {
                runCatching { player.setPlaybackSpeed(want) }
            }

            val b = bank
            if (b != null) {
                val got = cushionSec()
                bankSec = got
                when {
                    got >= b.from + b.want - 1 -> {
                        finishBank()
                        notice = tr("Buffer full — playing on", "Buffer fullt — spila áfram")
                    }
                    // Eftir 20 sek hlé hafa bæst við innan við 3 sek: straumurinn berst ekki
                    // nógu hratt (prófað 11. nóv.: 8 sek á 45 sek). Bið gerir þá ekkert gagn.
                    now - b.t0 > 20_000 && got - b.from < 3 -> {
                        finishBank()
                        notice = tr("⚠️ The stream is not loading – the provider is sending too slowly", "⚠️ Straumurinn hleðst ekki – þjónustan sendir of hægt")
                        Log.w(LOG_TAG, "bank stalled: ${got}s after ${(now - b.t0) / 1000}s")
                    }
                    now - b.t0 > (b.want + 20) * 1_000L -> {
                        finishBank()
                        notice = tr("Stopped loading — it took too long", "Hleðslu hætt — tók of langan tíma")
                    }
                }
            }

            if (!live) {
                viewPos = player.currentPosition.coerceAtLeast(0L)
                val d = player.duration
                viewDur = if (d > 0) d else 0L
                if (prepared && viewPos > 5_000 && now - savedAt > 5_000) {
                    savedAt = now
                    resume.save(url, viewPos, viewDur)
                }
            }
        }
    }

    // Skilaboð hverfa af sjálfu sér eftir nokkrar sekúndur.
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(6_000)
            notice = null
        }
    }

    // Skráir spilarann hjá herberginu á meðan hann er á skjánum.
    DisposableEffect(player, sync, live, channelKey) {
        val s = sync
        if (s != null && live) {
            s.setViewer(object : SyncManager.Viewer {
                override fun channel(): Pair<String, String> =
                    title to channelKey.ifEmpty { SyncRoom.channelKey(title) }

                override fun variant(): String = variants.getOrElse(variantIndex) { "" }

                override fun playing(): Boolean = clock.playing

                override fun streamTime(): SyncManager.StreamTime? = clock.streamTime()

                override fun hold(sec: Double) {
                    if (sec <= 0) return
                    // Bein rás heldur áfram að koma á meðan beðið er; bufferinn rúmar bara
                    // maxAheadSec. Lengri bið myndi stöðva sóknina og þjónninn gæti slitið
                    // tengingunni, svo beðið er aðeins það sem rúmast (og sagt frá því).
                    val room = (maxAheadSec - cushion - 10).coerceAtLeast(0)
                    val wait = if (live) minOf(sec, room.toDouble()) else sec
                    if (wait < sec - 1) {
                        main.post { notice = tr("🤝 The other viewer is ${sec.toInt()} s behind – the buffer here only allows a ${wait.toInt()} s wait", "🤝 Hinn er ${sec.toInt()} sek á eftir – bufferinn hér rúmar bara ${wait.toInt()} sek bið") }
                    }
                    if (wait <= 0.5) return
                    val gen = holdGen.incrementAndGet()
                    main.post {
                        if (bank != null) finishBank()
                        if (player.playbackState != Player.STATE_IDLE) player.pause()
                    }
                    main.postDelayed({
                        if (holdGen.get() == gen && player.playbackState != Player.STATE_IDLE) {
                            player.play()
                        }
                    }, (wait * 1_000).toLong())
                }

                override fun setRate(rate: Float) {
                    main.post { runCatching { player.setPlaybackSpeed(rate) } }
                }

                override fun bank(mark: Int, sec: Int) {
                    main.post {
                        if (!player.isPlaying && player.playbackState != Player.STATE_IDLE) player.play()
                        syncBank(mark, sec, by = tr("the room", "herbergið"))
                    }
                }

                override fun endBank() {
                    main.post { finishBank() }
                }
            })
        }
        onDispose { s?.setViewer(null) }
    }


    // Stutt skilaboð ofan á myndinni (t.d. hvaða afbrigði er valið) þegar yfirlagið er falið.
    var toast by remember { mutableStateOf<String?>(null) }
    // Yfirlagið hverfur sjálft eftir smá stund þegar myndin spilast (eins og í
    // sjónvarpsöppum); hver takki á fjarstýringunni lengir tímann.
    var lastKeyAt by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(overlay, status, lastKeyAt) {
        if (overlay && status == PlayerStatus.Playing && !syncPanel) {
            delay(OVERLAY_HIDE_MS)
            if (SystemClock.elapsedRealtime() - lastKeyAt >= OVERLAY_HIDE_MS - 50) {
                overlay = false
            }
        }
    }
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(2_500)
            toast = null
        }
    }
    LaunchedEffect(url) {
        toast = if (variants.size > 1) {
            "$title · ${variants.getOrElse(variantIndex) { "" }} (${variantIndex + 1}/${variants.size})"
        } else {
            title
        }
    }
    fun stepVariant(dir: Int) {
        if (variants.size < 2) return
        onVariant((variantIndex + dir + variants.size) % variants.size)
    }

    // Örvar þegar yfirlagið er falið: upp/niður skipta um rás (eins og CH+/CH- í
    // sjónvarpi) og vinstri/hægri fletta á milli afbrigða rásarinnar.
    fun arrowWithoutOverlay(k: Key): Boolean = when (k) {
        Key.DirectionUp -> {
            if (onZap != null) onZap(-1) else overlay = true
            true
        }
        Key.DirectionDown -> {
            onZap?.invoke(1)
            onZap != null
        }
        Key.DirectionLeft -> {
            stepVariant(-1)
            variants.size > 1
        }
        Key.DirectionRight -> {
            stepVariant(1)
            variants.size > 1
        }
        else -> false
    }

    val focus = remember { FocusRequester() }
    val playFocus = remember { FocusRequester() }
    var boxFocused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { focus.requestFocus() }
    // Þegar yfirlagið hverfur (sjálft eða með takka) fer fókus aftur á myndina, svo
    // örvarnar haldi áfram að skipta um rás og afbrigði.
    LaunchedEffect(overlay) {
        if (!overlay && !syncPanel) runCatching { focus.requestFocus() }
    }

    BackHandler {
        if (overlay) overlay = false else onBack()
    }

    fun reconnect() {
        retry.reset()
        retryTick++
    }

    fun togglePlay() {
        // Ef mynd/þáttur er búinn byrjar „Spila“ hana aftur frá byrjun.
        if (status == PlayerStatus.Ended) {
            player.seekTo(0)
            player.play()
        } else if (player.isPlaying) {
            player.pause()
        } else {
            player.play()
        }
    }



    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focus)
            .onFocusChanged { boxFocused = it.isFocused }
            .focusable()
            .onPreviewKeyEvent { e ->
                if (e.type == KeyEventType.KeyDown) lastKeyAt = SystemClock.elapsedRealtime()
                false
            }
            .onKeyEvent { e ->
                // Aðeins grípa lykla þegar fókus er á myndinni sjálfri; annars á
                // venjuleg fókusferð milli hnappa að eiga sér stað.
                if (!boxFocused || e.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (e.key) {
                    // OK á myndinni sýnir/felur yfirlagið. Ef fókus er á hnapp kemur
                    // atburðurinn ekki hingað og hnappurinn virkjast venjulega.
                    Key.DirectionCenter, Key.Enter, Key.Spacebar -> {
                        val lvl = alertLevel
                        if (!overlay && lvl != null && lvl <= BufferAlerts.ACTION_LEVEL && bank == null) {
                            // Rauð áminning á skjánum: OK hleður buffer strax.
                            alertLevel = null
                            toggleBank()
                        } else {
                            overlay = !overlay
                        }
                        true
                    }
                    // Yfirlagið sýnilegt: fókus fer ekki sjálfkrafa úr bakgrunninum í
                    // hnappana, svo við beinum honum á „Spila“.
                    Key.DirectionDown, Key.DirectionLeft, Key.DirectionRight, Key.DirectionUp
                        -> if (overlay) {
                        runCatching { playFocus.requestFocus() }
                        true
                    } else arrowWithoutOverlay(e.key)
                    // Yfirlagið falið: upp/niður skipta um rás (eins og CH+/CH- í
                    // sjónvarpi) og vinstri/hægri fletta á milli afbrigða rásarinnar.
                    Key.ChannelUp -> arrowWithoutOverlay(Key.DirectionUp)
                    Key.ChannelDown -> arrowWithoutOverlay(Key.DirectionDown)
                    Key.MediaPlayPause -> {
                        togglePlay()
                        true
                    }
                    else -> false
                }
            }
    ) {
        // Myndin sjálf (Media3 sér um afkóðun og stærðarhlutföll).
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setBackgroundColor(android.graphics.Color.BLACK)
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    this.player = player
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize()
        )

        // Stöðutexti þegar ekkert mynd er (tengist, hleður, villa).
        if (status != PlayerStatus.Playing && status != PlayerStatus.Paused) {
            Text(
                statusText(status, detail),
                style = MaterialTheme.typography.bodyLarge,
                color = if (status == PlayerStatus.Failed) Bad else Text2,
                modifier = Modifier.align(Alignment.Center)
            )
        }

        val lvl = alertLevel
        if (lvl != null && !overlay) {
            val red = lvl <= BufferAlerts.ACTION_LEVEL
            Text(
                if (red) tr("📶 Buffer $cushion s · OK = Fill buffer", "📶 Buffer $cushion sek · OK = Hlaða buffer") else tr("📶 Buffer $cushion s", "📶 Buffer $cushion sek"),
                style = MaterialTheme.typography.titleMedium,
                color = if (red) Bad else Warn,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(32.dp)
                    .background(Color.Black.copy(alpha = 0.7f))
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            )
        }

        val t = toast
        if (t != null && !overlay) {
            Text(
                t,
                style = MaterialTheme.typography.titleMedium,
                color = Text1,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(32.dp)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            )
        }

        if (overlay) {
            Overlay(
                title = title,
                group = group,
                now = now,
                next = next,
                live = live,
                status = status,
                detail = detail,
                isPlaying = status == PlayerStatus.Playing,
                extra = OverlayExtra(
                    bank = bank,
                    bankSec = bankSec,
                    cushion = cushion,
                    bufferMark = bufferMark(),
                    pos = viewPos,
                    dur = viewDur,
                    notice = notice,
                    sync = syncUi
                ),
                playFocus = playFocus,
                variants = variants,
                variantIndex = variantIndex,
                onVariant = onVariant,
                onActivity = { lastKeyAt = SystemClock.elapsedRealtime() },
                onTogglePlay = { togglePlay() },
                onToggleBank = { toggleBank() },
                onSeekBy = { seekBy(it) },
                subLabel = subCur?.label,
                audioLabel = if (audOpts.size > 1) audCur?.label else null,
                onAudio = {
                    if (audOpts.size > 1) {
                        val i = audOpts.indexOf(audCur).coerceAtLeast(0)
                        val next = audOpts[(i + 1) % audOpts.size]
                        AudioTracks.apply(player, next)
                        audCur = next
                        subStore.audioPref = next.key
                    }
                },
                onSubtitles = {
                    // Einn takki: Off -> fyrsti texti -> næsti … -> Off.
                    if (subOpts.isNotEmpty()) {
                        val i = subOpts.indexOf(subCur).coerceAtLeast(0)
                        val next = subOpts[(i + 1) % subOpts.size]
                        Subtitles.apply(player, next)
                        subCur = next
                        subStore.subtitlePref = next.key
                    }
                },
                onReconnect = { reconnect() },
                onSync = {
                    overlay = false
                    syncPanel = true
                },
                onBack = onBack,
                fav = fav,
                onFav = onFav,
                // UPP úr hnapparöðinni felur yfirlagið (eins og venja er í sjónvörpum).
                onDismiss = {
                    overlay = false
                    focus.requestFocus()
                }
            )
        }

        // „Horfa saman“ yfir myndinni (svo spilunin haldist í gangi).
        if (syncPanel && sync != null) {
            SyncPanel(
                sync = sync,
                onFollow = { key, name -> sync.requestChannel(key, name) },
                onClose = {
                    syncPanel = false
                    overlay = true
                    focus.requestFocus()
                }
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun Overlay(
    title: String,
    group: String,
    now: Programme?,
    next: Programme?,
    live: Boolean,
    status: PlayerStatus,
    detail: String?,
    isPlaying: Boolean,
    extra: OverlayExtra,
    playFocus: FocusRequester,
    variants: List<String>,
    variantIndex: Int,
    onVariant: (Int) -> Unit,
    // Hver takki í yfirlaginu: yfirlagið á ekki að hverfa á meðan flett er í því.
    onActivity: () -> Unit,
    onTogglePlay: () -> Unit,
    onToggleBank: () -> Unit,
    onSeekBy: (Long) -> Unit,
    // Textar: null = enginn texti fylgir (takkinn falinn).
    subLabel: String? = null,
    onSubtitles: () -> Unit = {},
    // Hljóð: null = aðeins ein hljóðrás (takkinn falinn).
    audioLabel: String? = null,
    onAudio: () -> Unit = {},
    onReconnect: () -> Unit,
    onSync: () -> Unit,
    onBack: () -> Unit,
    fav: Boolean? = null,
    onFav: () -> Unit = {},
    onDismiss: () -> Unit
) {
    Column(
        Modifier
            .fillMaxSize()
            .onPreviewKeyEvent {
                onActivity()
                false
            }
            .background(Color.Black.copy(alpha = 0.62f))
            .padding(horizontal = 56.dp, vertical = 40.dp),
        verticalArrangement = Arrangement.Bottom
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            color = Text1,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (group.isNotEmpty()) {
            Text(group, style = MaterialTheme.typography.labelMedium, color = Text2)
        }
        Spacer(Modifier.height(18.dp))
        // Dagskrárlínur eiga aðeins við beinar rásir, ekki myndir/þætti.
        if (live) {
            ProgrammeLine(tr("Now", "Nú"), now, Accent)
            Spacer(Modifier.height(6.dp))
            ProgrammeLine(tr("Next", "Næst"), next, Text2)
        } else {
            ProgressLine(extra.pos, extra.dur)
        }
        Spacer(Modifier.height(12.dp))

        // Hversu mikið er í buffer núna (beint streymi).
        if (live) {
            Text(
                tr("📶 Buffer: ${extra.cushion} s", "📶 Buffer: ${extra.cushion} sek"),
                style = MaterialTheme.typography.labelMedium,
                color = Text2
            )
        }
        // Hleðsla í gangi: hversu langt er liðið.
        val b = extra.bank
        if (b != null) {
            Text(
                tr("⏸️ Filling buffer ${extra.bankSec} / ${b.from + b.want} s", "⏸️ Hleð buffer ${extra.bankSec} / ${b.from + b.want} sek"),
                style = MaterialTheme.typography.bodyMedium,
                color = Warn
            )
        }
        if (extra.notice != null) {
            Text(
                extra.notice,
                style = MaterialTheme.typography.bodyMedium,
                color = Accent,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        val s = extra.sync
        if (s != null && s.joined) {
            val n = s.peers.size + 1
            Text(
                tr("🤝 ${s.room} · $n in the room", "🤝 ${s.room} · $n í herberginu") +
                    (if (s.lastAction.isNotEmpty()) " · ${s.lastAction}" else ""),
                style = MaterialTheme.typography.labelMedium,
                color = if (s.connected) Ok else Warn,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(Modifier.height(16.dp))

        Row(
            Modifier.onPreviewKeyEvent { e ->
                if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionUp) {
                    onDismiss()
                    true
                } else false
            },
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TvButton(
                if (isPlaying) tr("Pause", "Pása") else tr("Play", "Spila"),
                modifier = Modifier.focusRequester(playFocus),
                primary = true,
                onClick = onTogglePlay
            )
            if (live) {
                TvButton(
                    if (b != null) tr("Play now", "Spila núna") else tr("Fill buffer", "Hlaða buffer"),
                    onClick = onToggleBank
                )
            } else {
                TvButton(tr("⏪ 30 s", "⏪ 30 sek")) { onSeekBy(-30_000) }
                TvButton(tr("30 s ⏩", "30 sek ⏩")) { onSeekBy(30_000) }
                TvButton(tr("From start", "Frá byrjun")) { onSeekBy(-Long.MAX_VALUE / 2) }
            }
            if (audioLabel != null) {
                TvButton(tr("🔊 Audio: $audioLabel", "🔊 Hljóð: $audioLabel"), onClick = onAudio)
            }
            if (subLabel != null) {
                TvButton(tr("💬 Subtitles: $subLabel", "💬 Texti: $subLabel"), onClick = onSubtitles)
            }
        }
        // Afbrigði rásarinnar (FHD, HD, 50fps …): valið afbrigði er merkt.
        if (variants.size > 1) {
            Spacer(Modifier.height(10.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                variants.forEachIndexed { i, label ->
                    TvButton(
                        if (i == variantIndex) "● $label" else label,
                        primary = i == variantIndex,
                        onClick = { onVariant(i) }
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(tr("Reconnect", "Endurtengja"), onClick = onReconnect)
            TvButton(
                if (s != null && s.joined) "🤝 ${s.room}" else tr("🤝 Watch together", "🤝 Horfa saman"),
                onClick = onSync
            )
            if (fav != null) TvButton(if (fav) tr("⭐ In favourites", "⭐ Í uppáhalds") else tr("☆ Favourite", "☆ Uppáhalds"), onClick = onFav)
            TvButton(tr("Back", "Til baka"), onClick = onBack)
        }
        Spacer(Modifier.height(14.dp))
        Text(
            statusText(status, detail),
            style = MaterialTheme.typography.labelMedium,
            color = if (status == PlayerStatus.Failed) Bad else if (status == PlayerStatus.Buffering) Warn else Text2,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}

// Staða í mynd/þætti: „12:34 / 1:45:00“ og þunn súla.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ProgressLine(pos: Long, dur: Long) {
    Row(
        Modifier.fillMaxWidth(0.6f).height(18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            Resume.clock(pos),
            style = MaterialTheme.typography.labelMedium,
            color = Text1
        )
        Text(
            " / " + if (dur > 0) Resume.clock(dur) else "--:--",
            style = MaterialTheme.typography.labelMedium,
            color = Text2
        )
        Spacer(Modifier.width(14.dp))
        Box(Modifier.weight(1f).height(4.dp).background(Text2.copy(alpha = 0.28f))) {
            val frac = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f
            Box(Modifier.fillMaxWidth(frac).height(4.dp).background(Accent))
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ProgrammeLine(label: String, p: Programme?, labelColor: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = labelColor,
            modifier = Modifier.width(56.dp)
        )
        Text(
            if (p == null) tr("No EPG", "Engin dagskrá") else "${hhmm(p.start)}–${hhmm(p.stop)}  ${p.title}",
            style = MaterialTheme.typography.bodyMedium,
            color = Text1,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

// Styttri skýring á stöðunni fyrir notandann.
private fun statusText(status: PlayerStatus, detail: String?): String = when (status) {
    PlayerStatus.Connecting -> tr("Connecting…", "Tengist…")
    PlayerStatus.Reconnecting -> detail ?: tr("Reconnecting…", "Endurtengi…")
    PlayerStatus.Buffering -> detail ?: tr("Loading…", "Hleð…")
    PlayerStatus.Playing -> tr("Playing", "Spilar")
    PlayerStatus.Paused -> tr("Pause", "Pása")
    PlayerStatus.Ended -> tr("Ended", "Lokið")
    PlayerStatus.Failed -> detail?.let { tr("Error: $it", "Villa: $it") } ?: tr("Stream error", "Villa í streymi")
}

// Skiljanleg skýring úr PlaybackException (notandinn á að sjá íslensku, ekki kóða).
private fun describe(error: PlaybackException): String {
    val cause = error.cause?.message?.takeIf { it.isNotBlank() }
    return when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> tr("Couldn't reach the server", "Náði ekki sambandi við þjóninn")
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> tr("The server didn't respond (HTTP)", "Þjónninn svaraði ekki (HTTP)")
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> tr("Link not found", "Slóðin fannst ekki")
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED -> tr("The stream is corrupt", "Streymisstrengurinn er skemmdur")
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> tr("Format not supported", "Sniðið er ekki stutt")
        else -> cause ?: error.errorCodeName
    }
}

// ExoPlayer með buffer-stillingum og VLC-User-Agent (sumar áskriftir krefjast þess).
private fun buildPlayer(
    context: Context,
    userAgent: String,
    bufferSec: Int,
    kind: StreamKind,
    sniff: SniffHolder
): ExoPlayer {
    val bufferMs = bufferSec.coerceIn(2, 120) * 1000
    // Hámarkið þarf að vera hærra en stillingin svo „Hlaða buffer“ nái markinu
    // (annars stöðvaði ExoPlayer niðurhalið áður en hlaðið væri nóg).
    val maxBufferMs = maxOf(bufferMs + 30_000, 60_000).coerceAtMost(120_000)
    // Lágmark = hámark: ExoPlayer sækir þá samfellt. Með lágt lágmark (áður 5 sek)
    // hætti hann að lesa þegar bufferinn fylltist og byrjaði ekki aftur fyrr en 5 sek
    // voru eftir. Bein rás bíður ekki á meðan: þjónninn sleit tengingunni, og þegar
    // lesið var aftur kom villa, endurtenging við endann og bufferinn fór í 0
    // (Mac-relayið les alltaf, svo þetta gerðist ekki þar).
    // Bætamörkin eru föst svo stór buffer klári ekki minnið á litlu boxi.
    val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(
            maxBufferMs,             // lágmark = hámark -> samfelld sókn
            maxBufferMs,             // hámark: stillingin + varasjóður
            2_500,                   // byrja að spila eftir 2,5 sek
            5_000                    // eftir stutt hlé
        )
        .setTargetBufferBytes(TARGET_BUFFER_BYTES)
        .setPrioritizeTimeOverSizeThresholds(false)
        .build()
    val http = DefaultHttpDataSource.Factory()
        .setUserAgent(userAgent.ifEmpty { "VLC/3.0.20 LibVLC/3.0.20" })
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(20_000)
        .setAllowCrossProtocolRedirects(true)
    // Við lesum PTS úr sömu bætum og ExoPlayer sækir (eins og fetch-patchið í Mac) svo
    // klukkan í herberginu verði sú sama og Mac sendir. Aðeins er hlustað á TS-streymi.
    val factory = SniffingDataSourceFactory(http, sniff, sniff = kind == StreamKind.Ts)
    return ExoPlayer.Builder(context)
        .setLoadControl(loadControl)
        .setMediaSourceFactory(DefaultMediaSourceFactory(factory))
        .build()
        .apply { playWhenReady = true }
}

