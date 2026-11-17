package app.mulehead.data

import android.content.Context
import java.util.Locale

/**
 * Hvar var verið að horfa (sama hugmynd og `mh.resume` í Mac): staða í mynd/þætti er
 * geymd eftir slóð svo hægt sé að halda áfram næst. Aðeins [Resume.MAX] nýjustu eru
 * geymdar svo listinn stækki ekki endalaust.
 */
class ResumeStore(context: Context) {

    private val sp = context.applicationContext
        .getSharedPreferences("mulehead-resume", Context.MODE_PRIVATE)

    fun position(url: String): Long = all()[url]?.pos ?: 0L

    fun save(url: String, pos: Long, dur: Long) {
        if (url.isEmpty() || pos < MIN_MS) return
        val map = Resume.put(all(), url, Resume.Entry(pos, dur, System.currentTimeMillis()))
        sp.edit().putString(KEY, Resume.encode(map)).apply()
    }

    fun clear(url: String) {
        val map = all().toMutableMap()
        if (map.remove(url) != null) sp.edit().putString(KEY, Resume.encode(map)).apply()
    }

    private fun all(): Map<String, Resume.Entry> = Resume.decode(sp.getString(KEY, "").orEmpty())

    companion object {
        private const val KEY = "resume"
        private const val MIN_MS = 5_000L      // styttra en 5 sek er ekki þess virði
    }
}

// Hrein vinnsla á listanum (prófuð í ResumeStoreTest).
object Resume {

    data class Entry(val pos: Long, val dur: Long, val at: Long)

    const val MAX = 200

    // Nýjasta færslan fyrst; sama slóð kemur ekki tvisvar.
    fun put(map: Map<String, Entry>, url: String, entry: Entry, max: Int = MAX): Map<String, Entry> {
        if (url.isEmpty()) return map
        val out = LinkedHashMap<String, Entry>(map.size + 1)
        out[url] = entry
        for ((k, v) in map) {
            if (k == url) continue
            if (out.size >= max) break
            out[k] = v
        }
        return out
    }

    fun encode(map: Map<String, Entry>): String {
        if (map.isEmpty()) return ""
        return map.entries.joinToString(",", "[", "]") { (url, e) ->
            "{\"u\":${quote(url)},\"p\":${e.pos},\"d\":${e.dur},\"a\":${e.at}}"
        }
    }

    fun decode(text: String): Map<String, Entry> {
        // Skjalið gæti verið skemmt (t.d. eftir aflestur) — þá byrjum við bara tómt.
        val list = runCatching { Json.parse(text) }.getOrNull() as? List<*> ?: return emptyMap()
        val out = LinkedHashMap<String, Entry>(list.size)
        for (raw in list) {
            val o = raw as? Map<*, *> ?: continue
            val url = Json.str(o["u"])
            if (url.isEmpty()) continue
            out[url] = Entry(Json.long(o["p"]), Json.long(o["d"]), Json.long(o["a"]))
        }
        return out
    }

    // „12:34“ eða „1:02:03“ — tími sem notandinn sér.
    fun clock(ms: Long): String {
        val total = (ms.coerceAtLeast(0) / 1000).toInt()
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
        else String.format(Locale.US, "%d:%02d", m, s)
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
