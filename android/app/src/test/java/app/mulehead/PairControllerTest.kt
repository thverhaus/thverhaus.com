package app.mulehead

import app.mulehead.pairing.InstallResult
import app.mulehead.pairing.PairController
import app.mulehead.pairing.PairPayload
import app.mulehead.pairing.PairStatus
import app.mulehead.pairing.PairingClient
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairControllerTest {

    private val payloadJson =
        """{"type":"m3u","name":"Frá síma","url":"http://prov.example/list.m3u","epgUrl":""}"""

    private val requests = mutableListOf<PairingClient.Request>()

    @Volatile
    private var createCalls = 0

    @Volatile
    private var pollCalls = 0

    private var onCreate: () -> PairingClient.Response = { created() }
    private var onPoll: () -> PairingClient.Response = { PairingClient.Response(204, "") }

    private val codes = ArrayDeque(listOf("AAAA2222", "BBBB3333", "CCCC4444"))

    private fun created(code: String = codes.removeFirst()) = PairingClient.Response(
        201,
        """{"code":"$code","secret":"0123456789abcdef0123456789abcdef","expiresInSeconds":600}"""
    )

    private val client = PairingClient(
        baseUrl = "https://thverhaus.com",
        transport = object : PairingClient.Transport {
            override fun request(req: PairingClient.Request): PairingClient.Response {
                requests.add(req)
                return when (req.method) {
                    "POST" -> {
                        createCalls++
                        onCreate()
                    }
                    "GET" -> {
                        pollCalls++
                        onPoll()
                    }
                    else -> PairingClient.Response(405, "")
                }
            }
        }
    )

    // Klukka prófsins: hún gengur aðeins þegar stýringin sefur (engin raunbið).
    private var now = 1_000_000L
    private val installed = mutableListOf<PairPayload>()
    private var installResult = InstallResult(count = 7)

    private fun controller() = PairController(
        client = client,
        installer = { payload ->
            installed.add(payload)
            installResult
        },
        clock = { now },
        sleep = { ms -> now += ms }
    )

    @Test
    fun spurtErAFimmSekundnaFresti() {
        assertEquals(5_000L, PairController.POLL_MS)
    }

    @Test
    fun listinnKemurOgErSeturInn() = runBlocking {
        var answered = 0
        onPoll = {
            answered++
            if (answered < 3) {
                PairingClient.Response(204, "")
            } else {
                PairingClient.Response(200, payloadJson)
            }
        }
        val c = controller()
        c.run()

        val s = c.state.value
        assertEquals(PairStatus.DONE, s.status)
        assertEquals(7, s.count)
        assertEquals("AAAA2222", s.code)
        assertNull(s.message)

        assertEquals(1, installed.size)
        assertTrue(installed[0] is PairPayload.Link)
        assertEquals("Frá síma", installed[0].name)

        // Aðeins eitt POST + þrjár GET-beiðnir; engin gögn með POST-inu.
        assertEquals(1, createCalls)
        assertNull(requests[0].body)
    }

    @Test
    fun xtreamInnskraningErSetInn() = runBlocking {
        onPoll = {
            PairingClient.Response(
                200,
                """{"type":"xtream","name":"","server":"http://host:8080","username":"jon",
                   "password":"p","epgUrl":""}""".trimIndent()
            )
        }
        val c = controller()
        c.run()

        assertEquals(PairStatus.DONE, c.state.value.status)
        val p = installed.single() as PairPayload.XtreamAccount
        assertEquals("jon", p.username)
    }

    @Test
    fun utrunninnKodiFaerNyrnKodaOgBirtist() = runBlocking {
        // Kóðinn rennur út (klukkan gengur í svefninum) og nýr kemur í staðinn;
        // þriðja tilraunin að fá kóða mistekst svo prófið endi.
        onCreate = { if (createCalls <= 2) created() else PairingClient.Response(500, "") }
        val c = controller()
        c.run()

        // Eitt upphafstillvik + eitt endurnýjun; þriðja tilraunin mistókst.
        assertEquals(3, createCalls)
        assertEquals(PairStatus.ERROR, c.state.value.status)
        assertTrue(c.state.value.message!!.contains("HTTP 500"))
        // Nýi kóðinn var notaður í næstu beiðni.
        assertTrue(requests.any { it.url.endsWith("/BBBB3333") })
        assertTrue(installed.isEmpty())
    }

    @Test
    fun svar404GefurNyrnKodaOgListinnKemur() = runBlocking {
        onPoll = {
            if (pollCalls == 1) {
                PairingClient.Response(404, """{"error":"not_found"}""")
            } else {
                PairingClient.Response(200, payloadJson)
            }
        }
        val c = controller()
        c.run()

        assertEquals(2, createCalls)
        assertEquals(PairStatus.DONE, c.state.value.status)
        assertEquals("BBBB3333", c.state.value.code)
        assertEquals(1, installed.size)
    }

    @Test
    fun svar403StodvarOgBirtirVillu() = runBlocking {
        onPoll = { PairingClient.Response(403, "") }
        val c = controller()
        c.run()

        assertEquals(PairStatus.ERROR, c.state.value.status)
        assertTrue(c.state.value.message!!.contains("hafnaði"))
        assertEquals(1, pollCalls)
        assertEquals(1, createCalls)
        assertTrue(installed.isEmpty())
    }

    @Test
    fun villaFrarVefnumBirtistBeint() = runBlocking {
        onCreate = { PairingClient.Response(500, "") }
        val c = controller()
        c.run()

        assertEquals(PairStatus.ERROR, c.state.value.status)
        assertTrue(c.state.value.message!!.contains("HTTP 500"))
        assertEquals(0, pollCalls)
        assertTrue(installed.isEmpty())
    }

    @Test
    fun netvillaErReyndAfturOgGefistSvoUpp() = runBlocking {
        onPoll = { throw IOException("no net") }
        val c = controller()
        c.run()

        assertEquals(PairStatus.ERROR, c.state.value.status)
        assertTrue(c.state.value.message!!.contains("Náði ekki"))
        assertEquals(PairController.MAX_FAILURES, pollCalls)
    }

    @Test
    fun villaVidInnsetninguBirtist() = runBlocking {
        onPoll = { PairingClient.Response(200, payloadJson) }
        installResult = InstallResult(error = "Náði ekki í prov.example")
        val c = controller()
        c.run()

        assertEquals(PairStatus.ERROR, c.state.value.status)
        assertEquals("Náði ekki í prov.example", c.state.value.message)
        assertEquals(1, installed.size)
    }

    @Test
    fun haettirAdSpyrjaThegarSkjarinnLokast() = runBlocking {
        // Raunbið í stað svefns: skjárinn lokast = coroutine-ið er afturkallað.
        val c = PairController(
            client = client,
            installer = { InstallResult(count = 1) },
            sleep = { delay(20) }
        )
        val job = launch(Dispatchers.Default) { c.run() }
        withTimeout(5_000) {
            while (pollCalls < 3) delay(10)
        }
        job.cancelAndJoin()
        val after = pollCalls
        delay(150)
        assertEquals("engar beiðnir eftir að skjárinn lokast", after, pollCalls)
    }
}
