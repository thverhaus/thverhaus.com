package app.mulehead

import app.mulehead.data.EpgRepository
import app.mulehead.data.LoadStep
import app.mulehead.data.Playlist
import app.mulehead.data.PlaylistRepository
import app.mulehead.data.PlaylistSettings
import app.mulehead.ui.HomeState
import app.mulehead.ui.HomeViewModel
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Próf fyrir röðina í ræsingu: rásir eiga að birtast án þess að bíða eftir
 * dagskránni, dagskráin kemur svo í sér coroutine, og villa í annarri hvorri
 * hleðslunni má ekki taka hina með sér.
 */
class HomeViewModelTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 1_700_000_000_000L

    private val pl = Playlist(id = "main", name = "Test", url = "http://prov.example/a.m3u")
    private val plB = Playlist(id = "annar", name = "Annar", url = "http://prov.example/b.m3u")

    private companion object {
        val m3uA = """
            #EXTM3U url-tvg="http://prov.example/guide.xml"
            #EXTINF:-1 tvg-id="ruv.is" group-title="Íslenskar",RÚV
            http://prov.example/ruv
            #EXTINF:-1 tvg-id="stod2.is" group-title="Íslenskar",Stöð 2
            http://prov.example/stod2
        """.trimIndent()

        val m3uB = """
            #EXTM3U url-tvg="http://prov.example/guide.xml"
            #EXTINF:-1 group-title="Annar",Rás B
            http://prov.example/b
        """.trimIndent()
    }

    private fun ts(ms: Long): String =
        Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC)
            .format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + " +0000"

    private fun guide(title: String): String = """
        <?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="ruv.is"><display-name>RÚV</display-name></channel>
          <channel id="stod2.is"><display-name>Stöð 2</display-name></channel>
          <programme start="${ts(now - 1_800_000)}" stop="${ts(now + 1_800_000)}" channel="ruv.is">
            <title>$title</title>
          </programme>
        </tv>
    """.trimIndent()

    private class FakeSettings(override var playlist: Playlist?) : PlaylistSettings {
        override val refreshHours: Int = 12
        override val userAgent: String = ""
    }

    // Sækir A eða B eftir slóðinni; hægt að tefja svarið með latches.
    private class ListTransport(private val block: CountDownLatch? = null) : PlaylistRepository.Transport {
        var calls = 0
        override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
            calls++
            block?.await(10, TimeUnit.SECONDS)
            return if (url.contains("b.m3u")) m3uB.toByteArray() else m3uA.toByteArray()
        }
    }

    // Svarar dagskránni; með latches er hægt að láta hana „hangaI“ eins og hægur þjónn.
    private class EpgTransport(private val body: () -> ByteArray) : PlaylistRepository.Transport {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        var calls = 0

        override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
            calls++
            started.countDown()
            release.await(10, TimeUnit.SECONDS)
            return body()
        }
    }

    private fun immediate(body: () -> ByteArray) = EpgTransport(body).also { it.release.countDown() }

    private fun vm(
        settings: PlaylistSettings,
        list: PlaylistRepository.Transport,
        epgTransport: PlaylistRepository.Transport
    ) = HomeViewModel(
        settings = settings,
        playlists = PlaylistRepository(tmp.root, list, { now }),
        epg = EpgRepository(tmp.root, epgTransport, { now }),
        clock = { now }
    )

    private fun awaitState(vm: HomeViewModel, ms: Long = 5000, cond: (HomeState) -> Boolean): Boolean {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) {
            if (cond(vm.state.value)) return true
            Thread.sleep(10)
        }
        return cond(vm.state.value)
    }

    // Rásirnar eiga að birtast þótt dagskráin hangi.
    @Test
    fun rasirBirtastMedanDagskraHangir() {
        val settings = FakeSettings(pl)
        val epgT = EpgTransport { guide("Kastljós").toByteArray() }
        val vm = vm(settings, ListTransport(), epgT)

        runBlocking { vm.load() }
        val afterList = vm.state.value
        assertEquals(2, afterList.rows.size)
        assertFalse(afterList.loading)
        assertNull(afterList.error)
        assertNull(afterList.notice)
        assertTrue(afterList.rows.all { it.now == null })

        val job = thread { runBlocking { vm.loadEpg() } }
        assertTrue(epgT.started.await(5, TimeUnit.SECONDS))
        assertTrue(awaitState(vm) { it.epgLoading })

        // Meðan dagskráin hægir sér eru rásirnar sýnilegar og tick() virkar.
        val during = vm.state.value
        assertEquals(2, during.rows.size)
        assertEquals(LoadStep.EPG_FETCH, during.step)
        runBlocking { vm.tick() }
        assertEquals(2, vm.state.value.rows.size)

        epgT.release.countDown()
        job.join(5000)
        assertTrue(awaitState(vm) { !it.epgLoading })
        val done = vm.state.value
        assertEquals("Kastljós", done.rows.first { it.name == "RÚV" }.now?.title)
        assertEquals(2, done.rows.size)
    }

    // Villa í dagskránni má ekki fela rásirnar.
    @Test
    fun dagskraVillaHeldurRasum() {
        val epgT = immediate { throw IOException("Connection reset") }
        val vm = vm(FakeSettings(pl), ListTransport(), epgT)

        runBlocking {
            vm.load()
            vm.loadEpg()
        }
        val s = vm.state.value
        assertEquals(2, s.rows.size)
        assertNull(s.error)
        assertNotNull(s.notice)
        assertTrue(s.notice!!.contains("Náði ekki í dagskrá"))
        assertFalse(s.epgLoading)
        assertEquals(LoadStep.IDLE, s.step)
    }

    // OutOfMemoryError í dagskránni (t.d. gzippuð skrá sem þenst út) á að verða
    // skýr villa en ekki hrun — og rásirnar haldast.
    @Test
    fun ofMinniIDagskraSleppirRasum() {
        val epgT = immediate { throw OutOfMemoryError("Failed to allocate") }
        val vm = vm(FakeSettings(pl), ListTransport(), epgT)

        runBlocking {
            vm.load()
            vm.loadEpg()
        }
        val s = vm.state.value
        assertEquals(2, s.rows.size)
        assertNull(s.error)
        assertNotNull(s.notice)
        assertTrue(s.notice!!.contains("Minnið"))
    }

    // Sama í listanum: skýr villa í stað hruns.
    @Test
    fun ofMinniIListaSynirVillu() {
        val listT = object : PlaylistRepository.Transport {
            override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray =
                throw OutOfMemoryError("of stór skrá")
        }
        val vm = vm(FakeSettings(pl), listT, immediate { ByteArray(0) })
        runBlocking { vm.load() }
        val s = vm.state.value
        assertNotNull(s.error)
        assertTrue(s.error!!.contains("Minnið"))
        assertFalse(s.loading)
        assertTrue(s.rows.isEmpty())
        assertEquals(LoadStep.IDLE, s.step)
    }

    // Dagskrá sem kemur fyrir gamlan lista má ekki skrifa yfir nýjan lista.
    @Test
    fun eldriDagskraYfirskrifarEkkiNyja() {
        val settings = FakeSettings(pl)
        val epgT = EpgTransport { guide("GÖMUL DAGSKRÁ").toByteArray() }
        val vm = vm(settings, ListTransport(), epgT)

        runBlocking { vm.load() }
        val job = thread { runBlocking { vm.loadEpg() } }
        assertTrue(epgT.started.await(5, TimeUnit.SECONDS))

        // Skipt um lista á meðan dagskráin er enn í sókn.
        settings.playlist = plB
        runBlocking { vm.load() }
        assertEquals(listOf("Rás B"), vm.state.value.rows.map { it.name })

        epgT.release.countDown()
        job.join(5000)
        val s = vm.state.value
        assertEquals(listOf("Rás B"), s.rows.map { it.name })
        assertTrue(s.rows.all { it.now == null })
        assertNull(s.notice)
        assertFalse(s.epgLoading)
    }

    // Skrefin sjást á skjánum meðan listinn er sóttur.
    @Test
    fun skrefBirtistMedanListiErSottur() {
        val gate = CountDownLatch(1)
        val listT = object : PlaylistRepository.Transport {
            override fun get(url: String, userAgent: String, timeoutMs: Int): ByteArray {
                gate.await(10, TimeUnit.SECONDS)
                return m3uA.toByteArray()
            }
        }
        val vm = vm(FakeSettings(pl), listT, immediate { guide("X").toByteArray() })
        val job = thread { runBlocking { vm.load() } }
        assertTrue(awaitState(vm) { it.step == LoadStep.LIST_FETCH })
        assertTrue(vm.state.value.loading)
        gate.countDown()
        job.join(5000)
        assertEquals(LoadStep.IDLE, vm.state.value.step)
        assertEquals(2, vm.state.value.rows.size)
    }

    // Önnur ræsing: bæði rásir og dagskrá koma strax úr skyndimynd.
    @Test
    fun skyndimyndBirtistStraxVidNaestaRaesingu() {
        val settings = FakeSettings(pl)
        val epgT = immediate { guide("Kastljós").toByteArray() }
        val first = vm(settings, ListTransport(), epgT)
        runBlocking {
            first.load()
            first.loadEpg()
        }
        assertEquals("Kastljós", first.state.value.rows.first { it.name == "RÚV" }.now?.title)

        val second = vm(settings, ListTransport(), epgT)
        runBlocking { second.load() }
        val s = second.state.value
        assertEquals(2, s.rows.size)
        assertEquals("Kastljós", s.rows.first { it.name == "RÚV" }.now?.title)
        assertEquals(1, epgT.calls)
    }

    // tick() á að virka þótt engin dagskrá sé komin.
    @Test
    fun tickVirkarAnDagskrar() {
        val vm = vm(FakeSettings(pl), ListTransport(), immediate { guide("X").toByteArray() })
        runBlocking { vm.load() }
        assertEquals(2, vm.state.value.rows.size)
        runBlocking { vm.tick() }
        assertEquals(2, vm.state.value.rows.size)
        assertTrue(vm.state.value.rows.all { it.now == null })
        assertNull(vm.state.value.error)
    }
}
