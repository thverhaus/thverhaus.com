package app.mulehead.data

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Xtream-innskráning: vefþjónn + notandi + lykilorð. Fæst úr M3U-hlekk sem lítur
 * út eins og `http://host:port/get.php?username=…&password=…` (sama og í Mac).
 */
data class XtreamCreds(val server: String, val username: String, val password: String) {

    private val base: String = Xtream.cleanServer(server)

    private val u: String get() = Xtream.enc(username)

    private val p: String get() = Xtream.enc(password)

    // Dagskrá Xtream-þjónustunnar (ef notandinn hefur ekki sett aðra slóð).
    val liveEpgUrl: String get() = "$base/xmltv.php?username=$u&password=$p"

    fun apiUrl(action: String = "", extra: String = ""): String {
        val sb = StringBuilder("$base/player_api.php?username=$u&password=$p")
        if (action.isNotEmpty()) sb.append("&action=").append(action)
        if (extra.isNotEmpty()) sb.append('&').append(extra)
        return sb.toString()
    }

    fun movieUrl(id: String, ext: String = ""): String =
        "$base/movie/$u/$p/$id.${ext.ifEmpty { "mp4" }}"

    fun seriesUrl(id: String, ext: String = ""): String =
        "$base/series/$u/$p/$id.${ext.ifEmpty { "mp4" }}"

    // Bein rás: /live/{notandi}/{lykilorð}/{stream_id}.ts (sama og í Mac).
    fun liveUrl(id: String, ext: String = "ts"): String = "$base/live/$u/$p/$id.$ext"
}

// Þekkir Xtream-hlekki og býr til slóðir þeirra. Hreint (engar Android-klasar) svo prófa megi.
object Xtream {

    private val API_PATH_RE = Regex("/(get|player_api)\\.php$", RegexOption.IGNORE_CASE)
    private val TAIL_RE = Regex("/(player_api\\.php|get\\.php).*$", RegexOption.IGNORE_CASE)
    private val SCHEME_RE = Regex("^https?://", RegexOption.IGNORE_CASE)

    /**
     * Skilar innskráningu ef hlekkurinn er Xtream-hlekkur (get.php eða player_api.php
     * með username og password), annars null.
     */
    fun fromUrl(url: String): XtreamCreds? {
        val u = try {
            URI(url.trim())
        } catch (e: Exception) {
            return null
        }
        val path = u.path.orEmpty()
        if (!API_PATH_RE.containsMatchIn(path)) return null
        val q = query(u.rawQuery.orEmpty())
        val user = q["username"].orEmpty().trim()
        val pass = q["password"].orEmpty().trim()
        if (user.isEmpty() || pass.isEmpty()) return null
        val host = u.host ?: return null
        val scheme = u.scheme?.lowercase() ?: "http"
        val port = if (u.port > 0) ":${u.port}" else ""
        val server = "$scheme://$host$port" + path.replace(API_PATH_RE, "")
        return XtreamCreds(server, user, pass)
    }

    // Sama og cleanServer() í Mac: bætir http:// ef vantar og fjarlægir /player_api.php.
    fun cleanServer(server: String): String {
        var s = server.trim()
        if (!SCHEME_RE.containsMatchIn(s)) s = "http://$s"
        return s.replace(Regex("/+$"), "").replace(TAIL_RE, "")
    }

    /**
     * Er innskráningin gild? `player_api.php` (án action) skilar
     * `{"user_info":{"auth":1,…}}`; `auth` = 0 eða "0" þýðir að notandi eða
     * lykilorð sé rangt (sama og Mac-útgáfan gerir).
     */
    fun authOk(info: Any?): Boolean {
        // user_info má vanta (þá tókst innskráningin ekki) en auth = 0 þýðir rangt.
        val user = Json.obj(Json.obj(info)["user_info"] ?: return false)
        val auth = user["auth"] ?: return true
        return !(Json.num(auth) == 0.0 || Json.str(auth).trim() == "0")
    }

    // JS-sannleiksgildi: null/0/""/false = ósatt, allt annað satt (tv_archive).
    fun truthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is Double -> v != 0.0
        is String -> v.isNotEmpty()
        else -> true
    }

    // encodeURIComponent: bil verður %20 en ekki +.
    internal fun enc(s: String): String =
        try {
            URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        } catch (e: Exception) {
            s
        }

    // ?a=1&b=2 -> kort (bæði nöfn og gildi afkóðuð).
    internal fun query(raw: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (kv in raw.split('&')) {
            if (kv.isEmpty()) continue
            val k = kv.substringBefore('=')
            val v = kv.substringAfter('=', "")
            out[decode(k)] = decode(v)
        }
        return out
    }

    private fun decode(s: String): String = try {
        URLDecoder.decode(s, "UTF-8")
    } catch (e: Exception) {
        s
    }
}
