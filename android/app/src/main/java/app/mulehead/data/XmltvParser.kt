package app.mulehead.data

import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.text.Normalizer
import java.util.GregorianCalendar
import java.util.TimeZone
import java.util.zip.GZIPInputStream
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.helpers.DefaultHandler

/**
 * XMLTV-dagskrá -> XmltvResult. Þýðing á reference/mac-electron/epg.js.
 * Við látum bara rásir sem playlistinn þekkir og atriði í glugga kringum núið.
 */
object XmltvParser {

    const val PAST_MS = 6L * 3_600_000L
    const val FUTURE_MS = 48L * 3_600_000L
    private const val HOUR_MS = 3_600_000L
    private const val DESC_MAX = 400

    // 20240101123000 +0000 o.s.frv.
    private val TIME_RE = Regex("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})?\\s*([+-]\\d{4})?")

    // Staðlar sem eiga að hverfa úr nafni rásar: "RÚV HD" og "RÚV" eru sama rásin.
    private val QUALITY_RE = Regex("\\b(hd|fhd|uhd|4k|sd|hevc|h265|\\+1)\\b")
    private val MARK_RE = Regex("\\p{M}+")
    private val NON_ALNUM_RE = Regex("[^a-z0-9]")
    private val PREFIX_RE = Regex("^[A-Z]{2,4}\\s*[:|]\\s*")
    private val LOOSE_TOKEN_RE = Regex(
        "\\b(backup|alt|raw|b|8k|hdr|4k|uhd|fhd|hd|sd|hevc|h265|\\d{3,4}p)\\b",
        RegexOption.IGNORE_CASE
    )

    // "20240101123000 +0000" -> millisekúndur. 0 ef ekkert er þar.
    fun parseXmltvTime(s: String?): Long {
        if (s.isNullOrEmpty()) return 0
        val m = TIME_RE.find(s.trim()) ?: return 0
        val g = m.groupValues
        val cal = GregorianCalendar(TimeZone.getTimeZone("UTC"))
        cal.isLenient = true
        cal.clear()
        cal.set(
            g[1].toInt(), g[2].toInt() - 1, g[3].toInt(),
            g[4].toInt(), g[5].toInt(), if (g[6].isEmpty()) 0 else g[6].toInt()
        )
        var t = cal.timeInMillis
        val tz = g[7]
        if (tz.isNotEmpty()) {
            val sign = if (tz[0] == '-') -1 else 1
            val off = (tz.substring(1, 3).toInt() * 60 + tz.substring(3, 5).toInt()) * 60_000L
            t -= sign * off
        }
        return t
    }

    // Strangt lykilorð fyrir nafn rásar: lágstafir, án merkinga og án gæðaorða.
    fun norm(s: String?): String {
        val lowered = (s ?: "").lowercase()
        val decomposed = Normalizer.normalize(lowered, Normalizer.Form.NFKD)
        val noMarks = MARK_RE.replace(decomposed, "")
        val noQuality = QUALITY_RE.replace(noMarks, "")
        return NON_ALNUM_RE.replace(noQuality, "")
    }

    // Lausara lykilorð: "UK: Sky Sports Main Event FHD B" og "Sky Sports Main Event"
    // verða bæði "skysportsmainevent".
    fun looseNorm(s: String?): String {
        val noPrefix = PREFIX_RE.replace(s ?: "", " ")
        return norm(LOOSE_TOKEN_RE.replace(noPrefix, " "))
    }

    // Sama atriði tvisvar (sami start, stop og titill) -> aðeins eitt.
    fun sortUniq(list: List<Programme>): List<Programme> {
        val out = ArrayList<Programme>()
        val seen = HashSet<String>()
        for (p in list.sortedBy { it.start }) {
            if (seen.add(p.start.toString() + "|" + p.stop + "|" + p.title)) out.add(p)
        }
        return out
    }

    // Les XMLTV úr streymi (tekur einnig .gz). Villur í XML eru leyfðar.
    fun parse(
        input: InputStream,
        wantIds: Set<String>,
        wantNames: Set<String>,
        wantLoose: Set<String>? = null,
        now: Long = System.currentTimeMillis(),
        pastMs: Long = PAST_MS,
        futureMs: Long = FUTURE_MS
    ): XmltvResult {
        val buffered = if (input is BufferedInputStream) input else BufferedInputStream(input)
        buffered.mark(2)
        val b0 = buffered.read()
        val b1 = buffered.read()
        buffered.reset()
        val stream = if (b0 == 0x1f && b1 == 0x8b) GZIPInputStream(buffered) else buffered
        val handler = Handler(now, pastMs, futureMs, wantIds, wantNames, wantLoose)
        try {
            val factory = SAXParserFactory.newInstance()
            factory.isNamespaceAware = false
            factory.newSAXParser().parse(InputSource(stream), handler)
        } catch (e: java.io.IOException) {
            // Slit a streymi: notum thad sem vid nadum.
        } catch (e: javax.xml.parsers.ParserConfigurationException) {
            // Enginn XML-lestur i bodi.
        } catch (e: SAXException) {
            // Óhreint XML frá veitanda: notum það sem við náðum að lesa.
        }
        return handler.result()
    }

    fun parse(
        text: String,
        wantIds: Set<String>,
        wantNames: Set<String>,
        wantLoose: Set<String>? = null,
        now: Long = System.currentTimeMillis()
    ): XmltvResult = parse(
        ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)),
        wantIds, wantNames, wantLoose, now
    )

    private class Prog(val id: String, val start: Long, val stop: Long) {
        var title: String = ""
        var desc: String = ""
    }

    private class Handler(
        now: Long,
        pastMs: Long,
        futureMs: Long,
        private val wantIds: Set<String>,
        private val wantNames: Set<String>,
        private val wantLoose: Set<String>?
    ) : DefaultHandler() {
        private val from = now - pastMs
        private val to = now + futureMs
        private val programmes = LinkedHashMap<String, MutableList<Programme>>()
        private val nameToId = HashMap<String, String>()
        private val nameToIdLoose = HashMap<String, String>()
        private val matched = HashSet<String>()
        private var chanId: String? = null
        private var prog: Prog? = null
        private var field: String? = null
        private val text = StringBuilder()

        private fun tag(localName: String?, qName: String?): String =
            (if (!localName.isNullOrEmpty()) localName else qName.orEmpty()).lowercase()

        override fun startElement(
            uri: String?,
            localName: String?,
            qName: String?,
            attrs: Attributes?
        ) {
            val name = tag(localName, qName)
            when {
                name == "channel" -> chanId = attrs?.getValue("id") ?: ""
                name == "programme" -> {
                    val start = parseXmltvTime(attrs?.getValue("start"))
                    val stopAttr = parseXmltvTime(attrs?.getValue("stop"))
                    val stop = if (stopAttr != 0L) stopAttr else start + HOUR_MS
                    val id = attrs?.getValue("channel") ?: ""
                    // <channel>-merkingar koma a undan <programme>, svo nafnatenging er kunn her.
                    val ok = (wantIds.contains(id) || wantIds.contains(id.lowercase()) || matched.contains(id))
                    prog = if (stop >= from && start <= to && ok) Prog(id, start, stop) else null
                }
                name == "display-name" && chanId != null -> begin(name)
                (name == "title" || name == "desc") && prog != null -> begin(name)
            }
        }

        private fun begin(name: String) {
            field = name
            text.setLength(0)
        }

        override fun characters(ch: CharArray, start: Int, length: Int) {
            if (field != null) text.append(ch, start, length)
        }

        override fun endElement(uri: String?, localName: String?, qName: String?) {
            val name = tag(localName, qName)
            val f = field
            if (f != null && name == f) {
                val t = text.toString()
                if (f == "display-name") handleDisplayName(t) else handleProgField(f, t)
                field = null
            } else if (name == "channel") {
                chanId = null
            } else if (name == "programme") {
                val p = prog
                if (p != null) {
                    programmes.getOrPut(p.id) { ArrayList() }
                        .add(Programme(p.start, p.stop, p.title, p.desc))
                    prog = null
                }
            }
        }

        private fun handleDisplayName(t: String) {
            val cid = chanId ?: return
            val k = norm(t)
            if (k.isNotEmpty() && wantNames.contains(k) && !nameToId.containsKey(k)) {
                nameToId[k] = cid
                matched.add(cid)
            }
            val loose = wantLoose ?: return
            val lk = looseNorm(t)
            if (lk.isNotEmpty() && loose.contains(lk)) {
                if (!nameToIdLoose.containsKey(lk)) nameToIdLoose[lk] = cid
                matched.add(cid)
            }
        }

        private fun handleProgField(f: String, t: String) {
            val p = prog ?: return
            if (f == "title" && p.title.isEmpty()) p.title = t.trim()
            if (f == "desc" && p.desc.isEmpty()) p.desc = t.trim().take(DESC_MAX)
        }

        fun result(): XmltvResult {
            val keep = HashSet<String>(wantIds)
            keep.addAll(nameToId.values)
            keep.addAll(nameToIdLoose.values)
            val out = LinkedHashMap<String, List<Programme>>()
            for ((id, list) in programmes) {
                if (keep.contains(id) || wantIds.contains(id.lowercase())) out[id] = sortUniq(list)
            }
            return XmltvResult(out, nameToId, nameToIdLoose)
        }
    }
}
