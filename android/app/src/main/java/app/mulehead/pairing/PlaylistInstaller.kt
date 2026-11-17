package app.mulehead.pairing

import app.mulehead.tr

import app.mulehead.data.EpgRepository
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistException
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.PlaylistSettings
import app.mulehead.data.SettingsStore
import app.mulehead.data.Xtream
import app.mulehead.data.hostOf

// Útkoma innsetningar: fjöldi rása og/eða villa sem má birta.
data class InstallResult(val count: Int = 0, val error: String? = null) {
    val ok: Boolean get() = error == null
}

/**
 * Setur lista inn í appið: vistar hlekkinn í stillingarnar og sækir hann strax —
 * sama ferli og „Vista og sækja“ á skjánum. Blokkerandi (kallaðu úr Dispatchers.IO).
 *
 * Vefurinn á thverhaus.com/tengja sendir annað hvort M3U-slóð ([saveUrl]) eða
 * Xtream-innskráningu ([saveXtream]); Xtream-innskráningin verður að venjulegri
 * M3U-slóð svo spilarinn, dagskráin og myndirnar virki eins og venjulegur listi.
 */
class PlaylistInstaller(
    private val settings: PlaylistSettings,
    private val playlists: PlaylistRepository,
    private val epg: EpgRepository? = null
) {

    fun install(payload: PairPayload): InstallResult = when (payload) {
        is PairPayload.Link -> saveUrl(payload.name, payload.url, payload.epgUrl)

        is PairPayload.XtreamAccount -> saveXtream(
            name = payload.name,
            server = payload.server,
            username = payload.username,
            password = payload.password,
            epgUrl = payload.epgUrl
        )
    }

    /** Venjuleg M3U-slóð (`name` og `epgUrl` mega vera tóm). */
    fun saveUrl(name: String, url: String, epgUrl: String = ""): InstallResult =
        save(name, url.trim(), epgUrl)

    /** Xtream-innskráning: verður að `…/get.php?username=…&type=m3u_plus` slóð. */
    fun saveXtream(
        name: String,
        server: String,
        username: String,
        password: String,
        epgUrl: String = ""
    ): InstallResult = save(
        name.ifBlank { username },
        xtreamUrl(server, username, password),
        epgUrl
    )

    // Xtream-innskráning verður að venjulegri M3U-slóð (sama og Mac-útgáfan gerir).
    fun xtreamUrl(server: String, username: String, password: String): String {
        val base = Xtream.cleanServer(server)
        return "$base/get.php?username=${Xtream.enc(username)}" +
            "&password=${Xtream.enc(password)}&type=m3u_plus"
    }

    private fun save(name: String, url: String, epgUrl: String): InstallResult {
        val previous = settings.playlist?.url
        val pl = Playlist(
            id = SettingsStore.ID,
            name = name.trim().ifEmpty { hostOf(url) },
            url = url,
            epgUrl = epgUrl.trim()
        )
        settings.playlist = pl
        // Ný þjónusta: gömul dagskrá (xmltv) á ekki við og er hreinsuð.
        if (previous != url) epg?.clear(SettingsStore.ID)
        return fetch(pl)
    }

    private fun fetch(pl: Playlist): InstallResult = try {
        val data = playlists.load(
            pl,
            force = true,
            refreshHours = settings.refreshHours,
            userAgent = settings.userAgent
        )
        InstallResult(count = data.channels.size)
    } catch (e: PlaylistException) {
        InstallResult(error = e.message)
    } catch (e: Exception) {
        InstallResult(error = tr("Unexpected error: ${e.message ?: e.javaClass.simpleName}", "Óvænt villa: ${e.message ?: e.javaClass.simpleName}"))
    }
}
