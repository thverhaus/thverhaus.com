package app.mulehead.sync

import app.mulehead.tr

import app.mulehead.data.Json
import java.text.Normalizer
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.random.Random

/**
 * „Horfa saman“ — sama hugmynd og í Mac (sync.js): hver app sendir stöðu sína einu
 * sinni á sekúndu í ókeypis MQTT-herbergi og það sem er á undan hinum seinkar aðeins
 * þar til allir eru í takt. Ekkert er sent nema herbergiskóðinn, nafnið, rásin og tíminn.
 *
 * Allt í þessari skrá er „hreint“ (engar Android-klasar) svo hægt sé að prófa það.
 */

// Einn gestur í herberginu (sama snið og í renderer/sync.js: id, n, ch, ck, cat, k, t, w, p, bank, bm).
data class Status(
    val id: String,
    val name: String = GESTUR,
    val channel: String = "",
    val key: String = "",
    // Afbrigði rásarinnar (t.d. "HD", "FHD P50", "Main"). Ólík afbrigði eru ólíkir straumar
    // með ólíka tímatölu, svo herbergið verður að vera á sama afbrigði til að vera í takt.
    // Eldri útgáfur senda þetta ekki (tómt) og hunsa það.
    val variant: String = "",
    val cat: Long = 0,
    // „pts“ = alger straumtími úr MPEG-TS (sama tala í Mac), „pdt“ = HLS-dagsetning,
    // „clock“ = rauntími. Aðeins má bera saman tíma með sama `kind`.
    val kind: String? = null,
    val t: Double? = null,
    val w: Long = 0,
    val playing: Boolean = false,
    val bank: Long = 0,
    val bm: Int = 0,
    val bye: Boolean = false
) {

    fun toJson(): String {
        val parts = ArrayList<String>(12)
        parts += "\"id\":" + quote(id)
        if (bye) {
            parts += "\"bye\":true"
            return "{" + parts.joinToString(",") + "}"
        }
        parts += "\"n\":" + quote(name)
        parts += "\"ch\":" + quote(channel)
        parts += "\"ck\":" + quote(key)
        if (variant.isNotEmpty()) parts += "\"cv\":" + quote(variant)
        parts += "\"cat\":" + cat
        if (kind != null && t != null) {
            parts += "\"k\":" + quote(kind)
            parts += "\"t\":" + Json.numText(t)
        }
        parts += "\"w\":" + w
        parts += "\"p\":" + if (playing) "true" else "false"
        parts += "\"bank\":" + bank
        parts += "\"bm\":" + bm
        return "{" + parts.joinToString(",") + "}"
    }

    companion object {
        fun parse(text: String): Status? {
            // Skilaboð koma frá ókunnugum: skemmd skilaboð mega aldrei kasta villu.
            val o = runCatching { Json.parse(text) }.getOrNull() as? Map<*, *> ?: return null
            val id = Json.str(o["id"])
            if (id.isEmpty()) return null
            return Status(
                id = id,
                name = Json.str(o["n"]).ifEmpty { GESTUR },
                channel = Json.str(o["ch"]),
                key = Json.str(o["ck"]),
                variant = Json.str(o["cv"]),
                cat = Json.long(o["cat"]),
                kind = Json.str(o["k"]).ifEmpty { null },
                t = Json.num(o["t"]),
                w = Json.long(o["w"]),
                playing = Json.bool(o["p"]),
                bank = Json.long(o["bank"]),
                bm = Json.long(o["bm"]).toInt(),
                bye = Json.bool(o["bye"])
            )
        }

        private fun quote(s: String): String {
            val sb = StringBuilder(s.length + 2).append('"')
            for (c in s) {
                when {
                    c == '"' -> sb.append("\\\"")
                    c == '\\' -> sb.append("\\\\")
                    c == '\n' -> sb.append("\\n")
                    c == '\r' -> sb.append("\\r")
                    c == '\t' -> sb.append("\\t")
                    c < ' ' -> sb.append(String.format(Locale.US, "\\u%04x", c.code))
                    else -> sb.append(c)
                }
            }
            return sb.append('"').toString()
        }
    }
}

val GESTUR: String get() = tr("Guest", "Gestur")


// Það sem gerist í herberginu (sent til skjásins/notandans).
sealed interface SyncEvent {
    data class FollowChannel(
        val key: String,
        val name: String,
        val by: String,
        val at: Long,
        val variant: String = ""
    ) : SyncEvent
    data class PeerBank(val sec: Int, val mark: Int, val by: String, val until: Long) : SyncEvent
}

// Ein röð í lista yfir gesti.
data class PeerView(
    val id: String,
    val name: String,
    val channel: String,
    val sameChannel: Boolean,
    val diff: Double?,
    val mismatch: Boolean,
    val otherKind: Boolean,
    val playing: Boolean
) {
    val inSync: Boolean get() = diff != null && abs(diff) < 0.25
}

// Það sem spilarinn á að gera („Free“ = hafa sinn eigin hraða).
sealed interface Command {
    data object Free : Command
    data class Rate(val rate: Float) : Command
    data class Hold(val sec: Double) : Command
}

data class Decision(val command: Command, val action: String = "")

/**
 * Staða herbergis: gestir, hvenær rás var síðast valin og hvenær einhver hlóð buffer.
 * Enginn þræðir hér — SyncManager kallar á þetta einu sinni á sekúndu.
 */
class SyncRoom {

    var room: String = ""
        private set

    private class Entry(val status: Status, val rx: Long)

    private val peers = LinkedHashMap<String, Entry>()

    var auto: Boolean = true
    var myKey: String = ""           // rásin sem ég er á (svo ég fylgi mér ekki sjálfur)
    var myVariant: String = ""       // afbrigðið sem ég er á
    var chAt: Long = 0              // hvenær ÉG breytti rás
    var followAt: Long = 0          // hvenær ég fylgdi öðrum (ekki endur-útsenda)
    var bankUntil: Long = 0         // hvenær hléinu á að ljúka (herbergis-hleðsla)
    var bankMark: Int = 0           // hversu mikill buffer allir eiga að enda með
    var cooldownUntil: Long = 0     // eftir viljandi hlé: ekki stýra hraðanum strax

    val peerCount: Int get() = peers.size

    fun clear() {
        room = ""
        peers.clear()
        myKey = ""
        myVariant = ""
        chAt = 0
        followAt = 0
        bankUntil = 0
        bankMark = 0
        cooldownUntil = 0
    }

    fun enter(code: String) {
        clear()
        room = code.uppercase().filter { it.isLetterOrDigit() }
    }

    fun prune(now: Long) {
        peers.entries.removeAll { now - it.value.rx > PEER_TIMEOUT }
    }

    fun onMessage(s: Status, now: Long): List<SyncEvent> {
        if (s.bye) {
            peers.remove(s.id)
            return emptyList()
        }
        peers[s.id] = Entry(s, now)
        val events = ArrayList<SyncEvent>(2)
        // Rásin sem síðast var valin vinnur (eins og í Mac) — nema ég sé þegar á henni.
        // Annað afbrigði sömu rásar telst líka breyting (ólíkir straumar eru ekki í takt).
        val otherVariant = s.variant.isNotEmpty() && myVariant.isNotEmpty() && s.variant != myVariant
        if (s.key.isNotEmpty() && (s.key != myKey || otherVariant) && s.cat > max(chAt, followAt) + 300) {
            followAt = s.cat
            events += SyncEvent.FollowChannel(s.key, s.channel, s.name, s.cat, s.variant)
        }
        // Einhver hlóð buffer: allir gera hlé á sama tíma.
        if (s.bank > now + 400 && s.bank > bankUntil) {
            bankUntil = s.bank
            bankMark = s.bm
            events += SyncEvent.PeerBank(((s.bank - now + 999) / 1000).toInt(), s.bm, s.name, s.bank)
        }
        return events
    }

    // Listi yfir gesti með mun (sekúndur) hvers og eins.
    fun views(me: Status, now: Long): List<PeerView> = peers.values.map { e ->
        val p = e.status
        val same = sameChannel(me, p)
        val otherKind = p.kind != null && me.kind != null && p.kind != me.kind
        val d = if (same && !otherKind) diff(me, p, now) else null
        PeerView(
            id = p.id,
            name = p.name,
            channel = p.channel,
            sameChannel = same,
            diff = d?.takeIf { abs(it) <= MISMATCH_SEC },
            mismatch = d != null && abs(d) > MISMATCH_SEC,
            otherKind = otherKind,
            playing = p.playing
        )
    }

    /**
     * Ákvörðun um hraða/hlé: sá sem er á undan hinum seinkar (eins og í Mac).
     * Annar hvor getur ekki „hoppað“ í beinni rás, svo aðeins er hægt að hægja á.
     */
    fun decision(me: Status, now: Long): Decision {
        if (!auto) return Decision(Command.Free)
        var worst: Double? = null
        if (me.playing && me.t != null) {
            for (e in peers.values) {
                val p = e.status
                // Aðeins gestur sem er í spilun getur dregið mig til baka (eins og í Mac):
                // sá sem er í pásu/hleðslu er ekki viðmið.
                if (!p.playing || !sameChannel(me, p)) continue
                if (p.kind != null && me.kind != null && p.kind != me.kind) continue
                val d = diff(me, p, now) ?: continue
                if (abs(d) > MISMATCH_SEC) continue
                if (worst == null || d > worst) worst = d
            }
        }
        val w = worst ?: return Decision(Command.Free)
        if (now < cooldownUntil) return Decision(Command.Rate(1f))
        return when {
            w > 1.0 -> Decision(Command.Hold(w - 0.05), tr("Delayed by ${oneDecimal(w)} s", "Seinkaði um ${oneDecimal(w)} sek"))
            w > 0.15 -> Decision(Command.Rate(0.92f))
            else -> Decision(Command.Rate(1f))
        }
    }

    // Munur minn og gesta: jákvæður = ég er á undan. Núll ef ekki samanburðarhæft.
    private fun diff(me: Status, p: Status, now: Long): Double? {
        val mine = me.t ?: return null
        val theirs = p.t ?: return null
        val peerNow = theirs + if (p.playing) (now - p.w) / 1000.0 else 0.0
        return wrapDiff(mine - peerNow, me.kind)
    }

    // PTS er 33-bita tala sem hringar á ~26,5 klst: skekkjan á að vera stysta leiðin
    // (sama og wrapDiff í renderer/sync.js).
    private fun wrapDiff(d: Double, kind: String?): Double {
        if (kind != "pts") return d
        var x = d
        if (x > TsSniffer.PTS_WRAP / 2) x -= TsSniffer.PTS_WRAP
        if (x < -TsSniffer.PTS_WRAP / 2) x += TsSniffer.PTS_WRAP
        return x
    }

    private fun sameChannel(a: Status, b: Status): Boolean {
        val mine = a.key.ifEmpty { a.channel }
        val theirs = b.key.ifEmpty { b.channel }
        if (mine.isEmpty() || mine != theirs) return false
        // Ólík afbrigði (FHD á móti HD) eru ólíkir straumar með ólíka tímatölu: þá er ekki
        // hægt að bera tímana saman (prófað 11. nóv.: FHD P50 á móti Main = aldrei í takt).
        if (a.variant.isNotEmpty() && b.variant.isNotEmpty() && a.variant != b.variant) return false
        return true
    }

    companion object {
        const val PEER_TIMEOUT = 6_000L      // gestur sem þegir lengur en 6 sek er farinn
        const val MISMATCH_SEC = 60.0        // meira en þetta er ekki skekkja heldur annar tími

        // Nýr herbergiskóði (6 stafir; engir ruglandi stafir eins og 0/O og 1/I). Kóðinn er
        // líka lykill dulkóðunarinnar, svo 6 stafir (milljarður möguleika) frekar en 5.
        fun newCode(random: Random = Random.Default): String {
            val letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            return (1..6).map { letters[random.nextInt(letters.length)] }.joinToString("")
        }

        // Sami lykill og í Mac (renderer/app.js: splitName → sortKey → normWords).
        // Gæðaorð („HD“, „4K“, „(B)“), landsforskeyti („UK: “) og fleirtala skipta ekki
        // máli, og orð eru borin saman hvert fyrir sig. Lykillinn þarf að vera NÁKVÆMLEGA
        // sá sami og Mac sendir (`ck`) — annars þekkja tækin ekki sömu rás í herberginu og
        // samstilling milli Macs og Android-tækis kemst aldrei af stað.
        // Dæmi: „Stöð 2 HD“ → „sto 2“ (Mac hunsar ð/þ/æ eins og önnur tákn).
        fun channelKey(name: String): String {
            if (name.isEmpty()) return ""
            return mergeKey(sortKey(baseName(name)))
        }

        // Gæðaorð aftan á nafni (sama regla og QUAL_RE í Mac).
        private val QUAL_RE = Regex(
            "(?:\\s+|^)(?:F?HD|UHD|SD|4K|8K|HDR|HEVC|H\\.?265|RAW|B|BACKUP|ALT|P\\d{2}|" +
                "\\d{3,4}[PI]|\\d{2}FPS|ᴴᴰ|ᶠᴴᴰ|ᵁᴴᴰ|[\\(\\[][^\\)\\]]{1,14}[\\)\\]])$",
            RegexOption.IGNORE_CASE
        )

        // Landsforskeyti fremst: „UK: Sky Sports“ → „Sky Sports“ (COUNTRY_RE í Mac).
        private val COUNTRY_RE = Regex("^[A-Z]{2,4}\\s*[:|]\\s*")
        private val MARKS_RE = Regex("[\\u0300-\\u036f]")
        private val OTHER_RE = Regex("[^a-z0-9: ]+")
        private val SPACE_RE = Regex("\\s+")

        // „Stöð 2 HD B“ → „Stöð 2“ (allt að sex gæðaorðum strippað).
        private fun baseName(name: String): String {
            var base = name.trim()
            var i = 0
            while (i < 6) {
                i++
                val m = QUAL_RE.find(base) ?: break
                if (m.range.first == 0) break
                val rest = base.substring(0, m.range.first).trim()
                if (COUNTRY_RE.replace(rest, "").length < 2) break   // éta ekki allt nafnið
                base = rest
            }
            return base
        }

        private fun sortKey(base: String): String = COUNTRY_RE.replace(base, "")

        // Lágstafir, engir broddar, aðeins a-z 0-9 : og bil; fleirtölu-s sleppt
        // („Sky Sports“ = „Sky Sport“), eins og normWords í Mac.
        private fun normWords(base: String): List<String> {
            val flat = MARKS_RE.replace(
                Normalizer.normalize(base.lowercase(Locale.ROOT), Normalizer.Form.NFKD),
                ""
            )
            return SPACE_RE.split(OTHER_RE.replace(flat, " "))
                .filter { it.isNotEmpty() }
                .map { if (it.length > 3 && it.endsWith("s")) it.dropLast(1) else it }
        }

        private fun mergeKey(base: String): String = normWords(base).joinToString(" ")

        // „1,4“ (íslensk tala með einum aukastaf).
        fun oneDecimal(v: Double): String = String.format(Locale.US, "%.1f", v).replace('.', ',')

        // Texti sem notandinn sér: „✅ Í takt“ / „Þú ert 1,4 sek á eftir“.
        fun diffText(d: Double): String = when {
            abs(d) < 0.25 -> tr("✅ In sync", "✅ Í takt")
            d > 0 -> tr("You are ${oneDecimal(d)} s ahead", "Þú ert ${oneDecimal(d)} sek á undan")
            else -> tr("You are ${oneDecimal(-d)} s behind", "Þú ert ${oneDecimal(-d)} sek á eftir")
        }
    }
}

