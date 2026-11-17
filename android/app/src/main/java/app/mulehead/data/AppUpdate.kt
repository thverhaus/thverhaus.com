package app.mulehead.data

/**
 * Upplýsingar um nýjustu útgáfu, úr https://thverhaus.com/updates.json:
 * {"android":{"versionCode":8,"versionName":"0.8","url":"https://…/mulehead.apk","sha256":"…"}, "mac":{…}}
 * Hreint Kotlin (engir Android-klasar) svo hægt sé að prófa það.
 */
data class UpdateInfo(
    val versionCode: Long,
    val versionName: String,
    val url: String,
    val sha256: String
)

object AppUpdate {
    const val MANIFEST_URL = "https://thverhaus.com/updates.json"

    // Mest einu sinni á sólarhring sjálfkrafa (hnappurinn í stillingum athugar alltaf).
    const val AUTO_INTERVAL_MS = 24L * 3_600_000L

    private val SHA256_RE = Regex("^[0-9a-f]{64}$")

    fun parse(text: String): UpdateInfo? {
        val root = runCatching { Json.parse(text) }.getOrNull() ?: return null
        val a = Json.obj(Json.obj(root)["android"])
        val code = Json.long(a["versionCode"])
        val url = Json.str(a["url"])
        val sha = Json.str(a["sha256"]).lowercase()
        // Aðeins https og gilt fingrafar: annars er ekkert sett upp.
        if (code <= 0 || !url.startsWith("https://") || !SHA256_RE.matches(sha)) return null
        return UpdateInfo(code, Json.str(a["versionName"]).ifEmpty { code.toString() }, url, sha)
    }

    fun isNewer(info: UpdateInfo?, currentCode: Long): Boolean = info != null && info.versionCode > currentCode

    fun dueForAutoCheck(lastCheck: Long, now: Long): Boolean = now - lastCheck >= AUTO_INTERVAL_MS
}
