package app.mulehead.sync

import app.mulehead.tr

import app.mulehead.data.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.random.Random

// Það sem skjárinn sýnir af herberginu.
data class SyncUi(
    val room: String = "",
    val connected: Boolean = false,
    val auto: Boolean = true,
    val peers: List<PeerView> = emptyList(),
    val lastAction: String = "",
    val nickname: String = "",
    val channelName: String = "",
    val bankBy: String = ""
) {
    val joined: Boolean get() = room.isNotEmpty()
}

/**
 * Heldur sambandinu við herbergið: sendir stöðuna mína einu sinni á sekúndu, tekur við
 * stöðu hinna og stýrir spilaranum (hægja á / hlé) svo allir haldist í takt.
 *
 * Spilarinn skráir sig með [setViewer] meðan hann er á skjánum; án hans er herberginu
 * samt haldið (þá er bara verið að bíða eftir að einhver fari á rás).
 */
class SyncManager(private val settings: SettingsStore) {

    // Alger straumtími (sama og `player.streamTime()` í Mac): „pts“ úr MPEG-TS-streymi,
    // „pdt“ úr HLS með dagsetningu eða „clock“ (rauntími). Hann fer í herbergið sem `k`/`t`
    // og aðeins er hægt að bera saman tvo tíma með sama `kind` — þess vegna verður Android
    // að senda „pts“ þegar Mac gerir það, annars sleppa þeir hvort öðru.
    data class StreamTime(val kind: String, val t: Double)

    // Það sem spilarinn getur gert fyrir herbergið.
    interface Viewer {
        fun channel(): Pair<String, String>        // nafn, lykill
        fun variant(): String = ""                 // afbrigðið sem er í spilun (t.d. "HD")
        fun playing(): Boolean
        fun streamTime(): StreamTime?              // alger straumtími, eða null (ekkert myndskeið)
        fun hold(sec: Double)                      // hlé í `sec` sekúndur
        fun setRate(rate: Float)                   // 1.0 = eðlilegt, 0.92 = safnar í buffer
        fun bank(mark: Int, sec: Int)              // hlaða buffer upp að `mark` sek (eða `sec`)
        fun endBank()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val room = SyncRoom()
    private val id = (1..8).map { ALPHA[Random.nextInt(ALPHA.length)] }.joinToString("")
    private val _ui = MutableStateFlow(SyncUi(nickname = settings.syncNickname))
    val ui: StateFlow<SyncUi> = _ui.asStateFlow()

    @Volatile private var mqtt: MqttClient? = null
    @Volatile private var connected = false
    @Volatile private var viewer: Viewer? = null
    @Volatile private var rateLocked = false
    // Herbergið stýrir hraðanum þessa sekúndu (einhver annar spilar sömu rás). Spilarinn
    // má þá ekki hreyfa við hraðanum — annars tognast growSlow og samstillingin á.
    // Sama merking og `steer` í sync.js.
    @Volatile private var steering = false
    @Volatile private var lastAction = ""
    @Volatile private var bankBy = ""

    // Rásarskipti sem eiga eftir að berast herberginu (sjá notifyChannelChanged).
    @Volatile private var rekey = false
    @Volatile private var lastKey = ""
    @Volatile private var lastVariant = ""

    // Einhver bað um buffer-hleðslu á meðan við vorum ekki að spila: geymum og reynum aftur.
    @Volatile private var pending: SyncEvent.PeerBank? = null
    @Volatile private var pendingUntil = 0L

    // Beiðni úr herberginu um að skipta á rás (MainActivity bregst við henni á aðalþræði).
    private val _follow = MutableStateFlow<FollowRequest?>(null)
    val follow: StateFlow<FollowRequest?> = _follow.asStateFlow()

    fun consumeFollow() {
        _follow.value = null
    }

    init {
        scope.launch { tickLoop() }
    }

    val joined: Boolean get() = room.room.isNotEmpty()

    // Spyr hvort herbergið eigi hraðann (þá lætur spilarinn growSlow óátalið).
    fun rateOwned(): Boolean = joined && connected && steering

    fun setViewer(v: Viewer?) {
        val was = viewer
        viewer = v
        // Nýr spilari (t.d. önnur rás) á ekki að erfa gamalt hraða-hlustur.
        if (was !== v && !rateLocked) v?.setRate(1f)
        push()
    }

    fun nickname(): String = settings.syncNickname.ifEmpty { GESTUR }

    fun setNickname(name: String) {
        settings.syncNickname = name.trim()
        push()
    }

    // Kóðinn sem síðast var notaður (svo hægt sé að taka þátt aftur með einum hnappi).
    fun savedRoom(): String = settings.syncRoom

    // Búa til nýtt herbergi (þá fylgja hinir rásinni minni þegar þeir koma inn).
    fun create() = join(SyncRoom.newCode(), announce = true)

    fun join(code: String, announce: Boolean = false) {
        val clean = code.uppercase().filter { it.isLetterOrDigit() }
        if (clean.isEmpty()) return
        mqtt?.close()
        room.enter(clean)
        settings.syncRoom = clean
        bankBy = ""
        pending = null
        lastAction = ""
        lastKey = ""
        rekey = false
        if (announce) room.chAt = System.currentTimeMillis()
        val client = MqttClient(
            brokers = brokers(),
            clientId = "mulehead-$id-${System.currentTimeMillis().toString(36)}",
            makeCrypto = { RoomCrypto.forRoom(clean) },
            onState = { up ->
                connected = up
                scope.launch { push() }
            },
            onMessage = { text -> onMessage(text) }
        )
        mqtt = client
        client.start()
        publishNow()
        push()
    }

    fun leave() {
        mqtt?.publish(Status(id = id, bye = true).toJson())
        mqtt?.close()
        mqtt = null
        connected = false
        room.clear()
        bankBy = ""
        pending = null
        lastAction = ""
        lastKey = ""
        rekey = false
        rateLocked = false
        steering = false
        viewer?.setRate(1f)
        push()
    }

    fun setAuto(on: Boolean) {
        room.auto = on
        if (!on) {
            rateLocked = false
            steering = false
            viewer?.setRate(1f)
        }
        push()
    }

    // Handvirkt: seinka mér (það lækkar tímann minn á við hina).
    fun delay(sec: Double) {
        if (sec <= 0) return
        viewer?.hold(sec)
        room.cooldownUntil = System.currentTimeMillis() + (sec * 1000).toLong() + 3_000
        lastAction = tr("Delayed by ${SyncRoom.oneDecimal(sec)} s", "Seinkaði um ${SyncRoom.oneDecimal(sec)} sek")
        push()
    }

    // Ég byrjaði buffer-hleðslu: segja herberginu svo allir geri það sama.
    fun announceBank(sec: Int, mark: Int) {
        bankBy = ""
        if (room.room.isEmpty() || sec < 2) return
        room.bankUntil = System.currentTimeMillis() + sec * 1_000L
        room.bankMark = mark
        publishNow()
        push()
    }

    // Ég valdi nýja rás: herbergið fylgir. Boðið fer út á næstu sekúndu (þegar spilarinn
    // er kominn á rásina) svo aldrei sé boðið gömul rás.
    fun notifyChannelChanged() {
        if (room.room.isEmpty()) return
        rekey = true
    }

    // Handvirkt: fara á rás eins og gestur er á (MainActivity opnar hana).
    fun requestChannel(key: String, name: String) {
        if (key.isEmpty() || name.isEmpty()) return
        _follow.value = FollowRequest(key, name, tr("you", "þú"), System.currentTimeMillis())
    }

    // ---------------- innri vinna ----------------

    private suspend fun tickLoop() {
        while (true) {
            delay(1_000)
            if (room.room.isEmpty()) {
                // Ekki í herbergi: enginn stýrir hraðanum (growSlow má spila sér).
                steering = false
                continue
            }
            val now = System.currentTimeMillis()
            room.prune(now)
            room.myKey = viewer?.channel()?.second.orEmpty()
            room.myVariant = viewer?.variant().orEmpty()
            var me = myStatus(now)
            // Rásarskipti eru boðuð þegar spilarinn er farinn á nýju rásina (aldrei fyrr),
            // svo hinir fylgi réttri rás en ekki þeirri gömlu.
            if (rekey && (me.key != lastKey || me.variant != lastVariant)) {
                rekey = false
                room.chAt = now
                me = myStatus(now)
            }
            lastKey = me.key
            lastVariant = me.variant
            publish(me)
            tryPendingBank(now)
            apply(room.decision(me, now))
            push(me, now)
        }
    }

    // Skilaboð frá MQTT-þræði: aðeins hrein Vinna — skjárinn sér StateFlow.
    private fun onMessage(text: String) {
        val s = Status.parse(text) ?: return
        if (s.id == id) return
        val now = System.currentTimeMillis()
        for (ev in room.onMessage(s, now)) {
            when (ev) {
                is SyncEvent.FollowChannel -> {
                    lastAction = tr("${ev.by} switched to ${ev.name}", "${ev.by} setti á ${ev.name}")
                    _follow.value = FollowRequest(ev.key, ev.name, ev.by, ev.at, ev.variant)
                }
                is SyncEvent.PeerBank -> {
                    val v = viewer
                    if (v != null && v.playing()) {
                        v.bank(ev.mark, ev.sec)
                        bankBy = ev.by
                        lastAction = tr("🤝 ${ev.by} is filling the buffer", "🤝 ${ev.by} hleður buffer")
                    } else if (v == null || !v.playing()) {
                        // Ekki að spila núna: pásum um leið og spilun hefst (eins og í Mac).
                        pending = ev
                        pendingUntil = now + 45_000
                    }
                }
            }
        }
        push()
    }

    private fun tryPendingBank(now: Long) {
        val p = pending ?: return
        val v = viewer
        if (now > pendingUntil || v == null || !v.playing()) {
            if (now > pendingUntil) pending = null
            return
        }
        v.bank(p.mark, p.sec)
        pending = null
        bankBy = p.by
        lastAction = tr("🤝 ${p.by} is filling the buffer", "🤝 ${p.by} hleður buffer")
    }

    private fun apply(d: Decision) {
        val v = viewer
        // Stýrir herbergið hraðanum núna? (Mac: steer = auto && ég spila && einhver á sömu rás)
        steering = v != null && d.command !is Command.Free
        if (v == null) return
        when (val c = d.command) {
            is Command.Free -> if (rateLocked) {
                v.setRate(1f)
                rateLocked = false
            }
            is Command.Rate -> {
                v.setRate(c.rate)
                rateLocked = c.rate != 1f
            }
            is Command.Hold -> {
                v.setRate(1f)
                rateLocked = false
                v.hold(c.sec)
                room.cooldownUntil = System.currentTimeMillis() + (c.sec * 1000).toLong() + 3_000
                if (d.action.isNotEmpty()) lastAction = d.action
            }
        }
    }

    private fun myStatus(now: Long): Status {
        val v = viewer
        val ch = v?.channel()
        val st = v?.streamTime()
        val bankOn = room.bankUntil > now
        return Status(
            id = id,
            name = nickname(),
            channel = ch?.first.orEmpty(),
            key = ch?.second.orEmpty(),
            variant = v?.variant().orEmpty(),
            cat = max(room.chAt, room.followAt),
            kind = st?.kind,
            t = st?.t,
            w = now,
            playing = v?.playing() ?: false,
            bank = if (bankOn) room.bankUntil else 0,
            bm = if (bankOn) room.bankMark else 0
        )
    }

    private fun publish(s: Status) {
        mqtt?.publish(s.toJson())
    }

    private fun publishNow() {
        if (room.room.isEmpty()) return
        publish(myStatus(System.currentTimeMillis()))
    }

    private fun push() {
        push(myStatus(System.currentTimeMillis()), System.currentTimeMillis())
    }

    private fun push(me: Status, now: Long) {
        _ui.value = SyncUi(
            room = room.room,
            connected = connected,
            auto = room.auto,
            peers = room.views(me, now),
            lastAction = lastAction,
            nickname = nickname(),
            channelName = me.channel,
            bankBy = bankBy
        )
    }

    // Almennir þjónar (eins og í Mac) — eða sá sem stilltur er í stillingum (t.d. í prófun).
    // Tenging við almennu þjónana er dulkóðuð (TLS); skilaboðin sjálf eru líka dulkóðuð (RoomCrypto).
    private fun brokers(): List<Broker> {
        val out = ArrayList<Broker>(3)
        val custom = settings.syncBroker.trim()
        if (custom.isNotEmpty()) {
            val tls = custom.startsWith("ssl://") || custom.startsWith("mqtts://")
            val clean = custom.substringAfter("://").trimEnd('/')
            val host = clean.substringBefore(':')
            val port = clean.substringAfter(':', if (tls) "8883" else "1883").toIntOrNull() ?: 1883
            if (host.isNotEmpty()) out += Broker(host, port, tls)
        }
        out += Broker("broker.hivemq.com", 8883, true)
        out += Broker("test.mosquitto.org", 8886, true)
        return out
    }

    private companion object {
        const val ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789"
    }
    fun close() {
        scope.cancel()
        mqtt?.close()
        mqtt = null
        room.clear()
    }
}

// Beiðni úr herberginu um að skipta á rás (MainActivity bregst við henni).
data class FollowRequest(
    val key: String,
    val name: String,
    val by: String,
    val at: Long,
    val variant: String = ""
)
