package app.mulehead.data

import android.content.Context

/**
 * Allar stillingar sem notandinn getur breytt, í einu skjali — auðvelt að senda
 * á milli skjásins og geymslunnar.
 */
data class SettingsDraft(
    val bufferSec: Int = 60,
    val growSlow: Boolean = true,
    val userAgent: String = "",
    val refreshHours: Int = 12,
    val epgOffsetMin: Int = 0,
    val mergeVariants: Boolean = true,
    val sortAZ: Boolean = true
)

/**
 * Sá hluti stillinganna sem [app.mulehead.pairing.PlaylistInstaller] þarf.
 * Viðmót (ekki klasi) svo hægt sé að prófa innsetningu lista án Android-tækis.
 */
interface PlaylistSettings {
    var playlist: Playlist?
    val refreshHours: Int
    val userAgent: String

    // Notað til að setja saman raðirnar (HomeViewModel). Sjálfgefin gildi svo
    // próf og aðrir notendur þurfi ekki að skilgreina þau.
    val epgOffsetMin: Int get() = 0
    val mergeVariants: Boolean get() = true
    val sortAZ: Boolean get() = true
    // Röð flokka sem notandinn hefur raðað sjálfur (tómt = röð þjónustunnar).
    val customGroupOrder: List<String> get() = emptyList()
    // Möppur sem notandinn hefur falið (Stillingar → Fela möppur).
    val hiddenGroups: Set<String> get() = emptySet()
}

/**
 * Stillingar appins í SharedPreferences (Mac notar config.json). Í bili er aðeins
 * einn playlisti — id er alltaf "main" svo skyndiminnið haldist.
 */
class SettingsStore(context: Context) : PlaylistSettings {

    private val sp = context.applicationContext.getSharedPreferences("mulehead", Context.MODE_PRIVATE)

    // Vistaður playlisti, eða null ef ekkert hefur verið sett upp.
    override var playlist: Playlist?
        get() {
            val url = sp.getString(KEY_URL, "").orEmpty().trim()
            if (url.isEmpty()) return null
            val name = sp.getString(KEY_NAME, "").orEmpty().trim()
            return Playlist(
                id = ID,
                name = name.ifEmpty { hostOf(url) },
                url = url,
                epgUrl = sp.getString(KEY_EPG, "").orEmpty().trim()
            )
        }
        set(v) {
            sp.edit()
                .putString(KEY_URL, v?.url.orEmpty())
                .putString(KEY_NAME, v?.name.orEmpty())
                .putString(KEY_EPG, v?.epgUrl.orEmpty())
                .apply()
        }

    // Hversu oft á að endurnýja listann og dagskrána (klst).
    override var refreshHours: Int
        get() = sp.getInt(KEY_REFRESH, 12)
        set(v) = sp.edit().putInt(KEY_REFRESH, v.coerceIn(1, 168)).apply()

    // Hliðrun dagskrár í mínútum (ef dagskráin er skekkt).
    override var epgOffsetMin: Int
        get() = sp.getInt(KEY_OFFSET, 0)
        set(v) = sp.edit().putInt(KEY_OFFSET, v.coerceIn(-720, 720)).apply()

    // Tómur strengur = sjálfgefið (VLC).
    override var userAgent: String
        get() = sp.getString(KEY_UA, "").orEmpty()
        set(v) = sp.edit().putString(KEY_UA, v.trim()).apply()

    // Það User-Agent sem spilarinn sendir (tómt = VLC, sama og í Mac).
    val effectiveUserAgent: String
        get() = userAgent.ifEmpty { DEFAULT_UA }

    // Buffer í sekúndum: hversu mikið má safna áður en spilað er.
    var bufferSec: Int
        get() = sp.getInt(KEY_BUFFER, 60)
        set(v) = sp.edit().putInt(KEY_BUFFER, v.coerceIn(2, 120)).apply()

    // Sjálfvirk bufferuppfylling (Mac: growSlow): bein rás sem er undir buffer-markinu er
    // spiluð aðeins hægar (0,95×) þar til markinu er náð — þannig safnast varasjóðurinn
    // af sjálfu sér og myndin frýs síður. Sjálfgefið á, eins og í Mac.
    var growSlow: Boolean
        get() = sp.getBoolean(KEY_GROW, true)
        set(v) = sp.edit().putBoolean(KEY_GROW, v).apply()

    // „Horfa saman“: nafnið sem aðrir sjá í herberginu.
    var syncNickname: String
        get() = sp.getString(KEY_NICK, "").orEmpty()
        set(v) = sp.edit().putString(KEY_NICK, v.trim()).apply()

    // Geymdur herbergiskóði (appið tengist honum aldrei sjálft, aðeins með ýtingu).
    var syncRoom: String
        get() = sp.getString(KEY_ROOM, "").orEmpty().uppercase().filter { it.isLetterOrDigit() }
        set(v) = sp.edit().putString(KEY_ROOM, v.uppercase().filter { it.isLetterOrDigit() }).apply()

    // Valfrjáls MQTT-þjónn (tómt = sjálfgefið: broker.hivemq.com).
    var syncBroker: String
        get() = sp.getString(KEY_BROKER, "").orEmpty()
        set(v) = sp.edit().putString(KEY_BROKER, v.trim()).apply()

    // Sameina HD/FHD/4K í eina línu.
    override var mergeVariants: Boolean
        get() = sp.getBoolean(KEY_MERGE, true)
        set(v) = sp.edit().putBoolean(KEY_MERGE, v).apply()

    // Tungumál appsins: "en" (sjálfgefið) eða "is".
    var language: String
        get() = sp.getString(KEY_LANG, app.mulehead.Lang.EN) ?: app.mulehead.Lang.EN
        set(v) = sp.edit().putString(KEY_LANG, v).apply()

    // Textar: "" = eins og skráin segir, "off" = slökkt, annars tungumál síðasta vals.
    var subtitlePref: String
        get() = sp.getString(KEY_SUBS, "") ?: ""
        set(v) = sp.edit().putString(KEY_SUBS, v).apply()

    // Hljóð: "" = eins og skráin segir, annars tungumál/lykill síðasta vals.
    var audioPref: String
        get() = sp.getString(KEY_AUDIO, "") ?: ""
        set(v) = sp.edit().putString(KEY_AUDIO, v).apply()

    // Röðun mynda og þátta (sjá data/VodSort.kt).
    var vodSort: String
        get() = sp.getString(KEY_VOD_SORT, "az") ?: "az"
        set(v) = sp.edit().putString(KEY_VOD_SORT, v).apply()

    // Raða rásum í stafrófsröð innan flokka.
    override var sortAZ: Boolean
        get() = sp.getBoolean(KEY_SORT, true)
        set(v) = sp.edit().putBoolean(KEY_SORT, v).apply()

    // Allt í einu: skjárinn les þetta þegar hann opnast og skrifar það sem notandinn
    // breytti (sama gildi og er þegar í geymslunni ef hann ýtir á „Til baka“).
    fun readDraft(): SettingsDraft = SettingsDraft(
        bufferSec = bufferSec,
        growSlow = growSlow,
        userAgent = userAgent,
        refreshHours = refreshHours,
        epgOffsetMin = epgOffsetMin,
        mergeVariants = mergeVariants,
        sortAZ = sortAZ
    )

    fun write(draft: SettingsDraft) {
        sp.edit()
            .putInt(KEY_BUFFER, draft.bufferSec.coerceIn(2, 120))
            .putBoolean(KEY_GROW, draft.growSlow)
            .putString(KEY_UA, draft.userAgent.trim())
            .putInt(KEY_REFRESH, draft.refreshHours.coerceIn(1, 168))
            .putInt(KEY_OFFSET, draft.epgOffsetMin.coerceIn(-720, 720))
            .putBoolean(KEY_MERGE, draft.mergeVariants)
            .putBoolean(KEY_SORT, draft.sortAZ)
            .apply()
    }

    fun clearPlaylist() {
        playlist = null
    }

    // Faldar möppur í myndum og þáttum (aðskilið fyrir hvort), eitt nafn í línu.
    fun vodHidden(movies: Boolean): Set<String> =
        lines(if (movies) KEY_VOD_HIDDEN_MOVIES else KEY_VOD_HIDDEN_SERIES).toSet()
    fun setVodHidden(movies: Boolean, v: Set<String>) =
        putLines(if (movies) KEY_VOD_HIDDEN_MOVIES else KEY_VOD_HIDDEN_SERIES, v.sorted())

    // Faldar möppur, eitt nafn í línu (tómt = allar sýnilegar).
    override var hiddenGroups: Set<String>
        get() = sp.getString(KEY_HIDDEN, "").orEmpty().split('\n').filter { it.isNotEmpty() }.toSet()
        set(v) = sp.edit().putString(KEY_HIDDEN, v.sorted().joinToString("\n")).apply()

    // Röð flokkanna sjálfra (vinstri dálkurinn), eitt nafn í línu.
    // Persónulegt (eins og S.per í Mac): uppáhalds í þremur aðskildum listum, nýlegar rásir
    // og heilsa rása. Eitt atriði í línu; röðin er röð notandans.
    var favChannels: List<String>
        get() = lines(KEY_FAV_CH)
        set(v) = putLines(KEY_FAV_CH, v)
    var favMovies: List<String>
        get() = lines(KEY_FAV_MOV)
        set(v) = putLines(KEY_FAV_MOV, v)
    var favSeries: List<String>
        get() = lines(KEY_FAV_SER)
        set(v) = putLines(KEY_FAV_SER, v)
    var recentChannels: List<String>
        get() = lines(KEY_RECENT)
        set(v) = putLines(KEY_RECENT, v)
    var chanHealth: String
        get() = sp.getString(KEY_HEALTH, "").orEmpty()
        set(v) = sp.edit().putString(KEY_HEALTH, v).apply()

    private fun lines(key: String): List<String> =
        sp.getString(key, "").orEmpty().split('\n').filter { it.isNotEmpty() }
    private fun putLines(key: String, v: List<String>) =
        sp.edit().putString(key, v.joinToString("\n")).apply()

    override var customGroupOrder: List<String>
        get() = sp.getString(KEY_GROUP_ORDER, "").orEmpty().split('\n').filter { it.isNotEmpty() }
        set(v) = sp.edit().putString(KEY_GROUP_ORDER, v.joinToString("\n")).apply()

    // Röðun innan möppu (Mac: folderSort/folderOrder). null = sjálfgefið.
    fun folderSort(group: String): String? = sp.getString(KEY_FOLDER_SORT + group, null)

    fun setFolderSort(group: String, mode: String) {
        sp.edit().putString(KEY_FOLDER_SORT + group, mode).apply()
    }

    // „Mín röð“: nöfn rása í möppunni, eitt í línu.
    fun folderOrder(group: String): List<String> =
        sp.getString(KEY_FOLDER_ORDER + group, "").orEmpty().split('\n').filter { it.isNotEmpty() }

    fun setFolderOrder(group: String, names: List<String>) {
        sp.edit()
            .putString(KEY_FOLDER_ORDER + group, names.joinToString("\n"))
            .putString(KEY_FOLDER_SORT + group, FolderOrder.CUSTOM)
            .apply()
    }

    companion object {
        const val ID = "main"

        // Sama sjálfgefið og í Mac-útgáfunni; sumar áskriftir krefjast þess.
        const val DEFAULT_UA = "VLC/3.0.20 LibVLC/3.0.20"

        private const val KEY_GROUP_ORDER = "groups.order"
        private const val KEY_HIDDEN = "groups.hidden"
        private const val KEY_FAV_CH = "fav.channels"
        private const val KEY_FAV_MOV = "fav.movies"
        private const val KEY_FAV_SER = "fav.series"
        private const val KEY_RECENT = "recent.channels"
        private const val KEY_HEALTH = "chan.health"
        private const val KEY_FOLDER_SORT = "folder.sort."
        private const val KEY_FOLDER_ORDER = "folder.order."
        private const val KEY_URL = "playlist.url"
        private const val KEY_NAME = "playlist.name"
        private const val KEY_EPG = "playlist.epg"
        private const val KEY_REFRESH = "settings.refreshHours"
        private const val KEY_OFFSET = "settings.epgOffsetMin"
        private const val KEY_UA = "settings.userAgent"
        private const val KEY_BUFFER = "settings.bufferSec"
        private const val KEY_GROW = "settings.growSlow"
        private const val KEY_MERGE = "settings.mergeVariants"
        private const val KEY_SORT = "settings.sortAZ"
        private const val KEY_LANG = "settings.language"
        private const val KEY_VOD_SORT = "vod.sort"
        private const val KEY_SUBS = "player.subtitles"
        private const val KEY_AUDIO = "player.audio"
        private const val KEY_VOD_HIDDEN_MOVIES = "vod.hidden.movies"
        private const val KEY_VOD_HIDDEN_SERIES = "vod.hidden.series"
        private const val KEY_NICK = "sync.nickname"
        private const val KEY_ROOM = "sync.room"
        private const val KEY_BROKER = "sync.broker"
    }
}
