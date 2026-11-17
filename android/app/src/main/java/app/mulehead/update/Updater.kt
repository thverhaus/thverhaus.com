package app.mulehead.update

import app.mulehead.tr

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import app.mulehead.data.AppUpdate
import app.mulehead.data.UpdateInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Það sem stillingaskjárinn sýnir um uppfærslur.
data class UpdateUi(
    val currentName: String = "",
    val checking: Boolean = false,
    val available: UpdateInfo? = null,
    val progress: Int? = null,          // 0–100 á meðan niðurhal stendur
    val message: String? = null
)

/**
 * „Leita að uppfærslu“: les updates.json á thverhaus.com, sækir nýja APK-skrá, ber
 * fingrafarið (SHA-256) saman og opnar uppsetningarglugga Android. Android leyfir ekki
 * að setja upp í hljóði: notandinn ýtir á „Setja upp“, og í fyrsta sinn þarf að leyfa
 * Mulehead að setja upp öpp.
 *
 * Sjálfvirk athugun gerist í bakgrunni (sjá MainActivity), mest einu sinni á sólarhring,
 * með stuttum tímamörkum, og hún sækir aldrei neitt sjálf.
 */
class Updater(private val ctx: Context) {

    private val prefs = ctx.getSharedPreferences("mulehead", Context.MODE_PRIVATE)
    private val _ui = MutableStateFlow(UpdateUi(currentName = currentName()))
    val ui: StateFlow<UpdateUi> = _ui.asStateFlow()

    fun currentCode(): Long = runCatching {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }.getOrDefault(0L)

    private fun currentName(): String = runCatching {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName.orEmpty()
    }.getOrDefault("")

    /** Athugar hvort ný útgáfa sé til. `force = false`: aðeins ef sólarhringur er liðinn. */
    suspend fun check(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && !AppUpdate.dueForAutoCheck(prefs.getLong(KEY_LAST, 0L), now)) return
        _ui.value = _ui.value.copy(checking = force, message = null)
        val info = withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL(AppUpdate.MANIFEST_URL).openConnection() as HttpURLConnection
                try {
                    conn.connectTimeout = 5_000
                    conn.readTimeout = 5_000
                    conn.useCaches = false
                    if (conn.responseCode !in 200..299) null
                    else AppUpdate.parse(conn.inputStream.use { String(it.readBytes(), Charsets.UTF_8) })
                } finally {
                    conn.disconnect()
                }
            }.getOrNull()
        }
        prefs.edit().putLong(KEY_LAST, now).apply()
        val newer = AppUpdate.isNewer(info, currentCode())
        _ui.value = _ui.value.copy(
            checking = false,
            available = if (newer) info else null,
            message = when {
                !force -> _ui.value.message
                info == null -> tr("Couldn't reach thverhaus.com. Try again later.", "Náði ekki sambandi við thverhaus.com. Reyndu aftur síðar.")
                newer -> null
                else -> tr("You're on the latest version (${currentName()}).", "Þú ert með nýjustu útgáfuna (${currentName()}).")
            }
        )
    }

    /** Sækir nýju útgáfuna, ber fingrafarið saman og opnar uppsetninguna. */
    suspend fun downloadAndInstall() {
        val info = _ui.value.available ?: return
        if (!canInstall()) {
            _ui.value = _ui.value.copy(
                message = tr("Allow Mulehead to install apps (opening now), then press the button again.", "Leyfðu Mulehead að setja upp öpp (opnast núna) og ýttu svo aftur á hnappinn.")
            )
            openInstallPermission()
            return
        }
        _ui.value = _ui.value.copy(progress = 0, message = null)
        val file = withContext(Dispatchers.IO) { runCatching { download(info) } }
        file.exceptionOrNull()?.let {
            Log.w(TAG, "update download failed: ${it.javaClass.simpleName}")
            _ui.value = _ui.value.copy(progress = null, message = it.message ?: tr("Download failed", "Niðurhal mistókst"))
            return
        }
        _ui.value = _ui.value.copy(progress = null, message = tr("Press “Install” in the window that opens.", "Ýttu á „Setja upp“ í glugganum sem opnast."))
        install(file.getOrThrow())
    }

    private fun download(info: UpdateInfo): File {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }   // gamlar útgáfur
        val tmp = File(dir, "mulehead.apk.tmp")
        val out = File(dir, "mulehead-${info.versionCode}.apk")
        val md = MessageDigest.getInstance("SHA-256")
        val conn = URL(info.url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = true
            if (conn.responseCode !in 200..299) throw IllegalStateException(tr("Download failed (HTTP ${conn.responseCode})", "Niðurhal mistókst (HTTP ${conn.responseCode})"))
            val total = conn.contentLengthLong
            var done = 0L
            var lastPct = -1
            conn.inputStream.use { inp ->
                tmp.outputStream().use { o ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        md.update(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != lastPct) {
                                lastPct = pct
                                _ui.value = _ui.value.copy(progress = pct)
                            }
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        val sha = md.digest().joinToString("") { "%02x".format(it) }
        if (sha != info.sha256) {
            tmp.delete()
            throw IllegalStateException(tr("The file doesn't match its fingerprint – not installed", "Skráin passar ekki við fingrafarið – ekki sett upp"))
        }
        if (!tmp.renameTo(out)) throw IllegalStateException(tr("Couldn't save the file", "Gat ekki vistað skrána"))
        return out
    }

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    private fun openInstallPermission() {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(i)
        } catch (e: ActivityNotFoundException) {
            _ui.value = _ui.value.copy(
                message = tr("Allow Mulehead to install apps: Settings → Apps → Security & restrictions → Unknown sources.", "Leyfðu Mulehead að setja upp öpp: Settings → Apps → Security & restrictions → Unknown sources.")
            )
        }
    }

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(i)
        } catch (e: ActivityNotFoundException) {
            _ui.value = _ui.value.copy(message = tr("Couldn't find an installer on the device.", "Fann ekki uppsetningarforrit á tækinu."))
        }
    }

    private companion object {
        const val TAG = "Mulehead"
        const val KEY_LAST = "update.lastCheck"
    }
}
