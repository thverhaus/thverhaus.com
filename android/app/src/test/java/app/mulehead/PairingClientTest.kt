package app.mulehead

import app.mulehead.pairing.PairPayload
import app.mulehead.pairing.PairSession
import app.mulehead.pairing.PairingClient
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingClientTest {

    private val session = PairSession(
        code = "ABCD2345",
        secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdAt = 1_000L,
        expiresAt = 601_000L
    )

    private val requests = mutableListOf<PairingClient.Request>()
    private var reply: (PairingClient.Request) -> PairingClient.Response = { ok() }

    private fun ok(body: String = "", code: Int = 200) = PairingClient.Response(code, body)

    private fun client() = PairingClient(
        baseUrl = "https://thverhaus.com",
        transport = object : PairingClient.Transport {
            override fun request(req: PairingClient.Request): PairingClient.Response {
                requests.add(req)
                return reply(req)
            }
        }
    )

    private val sessionJson =
        """{"code":"ABCD2345","secret":"${session.secret}","expiresInSeconds":600}"""

    @Test
    fun createSendirPostAnGagnaOgLesKodann() {
        reply = { ok(sessionJson, 201) }
        val r = client().create(now = 1_000L) as PairingClient.CreateResult.Ok

        assertEquals(1, requests.size)
        val req = requests[0]
        assertEquals("POST", req.method)
        assertEquals("https://thverhaus.com/api/pair", req.url)
        assertNull("engin gögn eiga að fara með", req.body)
        // Leynilykillinn er ekki í vefslóðinni og ekki í beiðninni.
        assertTrue(!req.url.contains(session.secret))
        assertNull(req.headers["Authorization"])

        assertEquals("ABCD2345", r.session.code)
        assertEquals(session.secret, r.session.secret)
        assertEquals(600_000L, r.session.expiresAt - r.session.createdAt)
    }

    @Test
    fun createLesLiftimaUrSvarinu() {
        reply = { ok("""{"code":"abcd-2345","secret":"${session.secret}","expiresInSeconds":120}""") }
        val r = client().create(now = 5_000L) as PairingClient.CreateResult.Ok
        assertEquals("ABCD2345", r.session.code)
        assertEquals(5_000L + 120_000L, r.session.expiresAt)
    }

    @Test
    fun createNotarSjalfgefidTimaEfHannVantar() {
        reply = { ok("""{"code":"ABCD2345","secret":"${session.secret}"}""") }
        val r = client().create(now = 0L) as PairingClient.CreateResult.Ok
        assertEquals(PairSession.TTL_MS, r.session.expiresAt)
    }

    @Test
    fun createHafnarOgildumKoda() {
        val c = client()
        reply = { ok("""{"code":"ABC","secret":"${session.secret}"}""") }
        assertTrue(c.create() is PairingClient.CreateResult.Failed)

        reply = { ok("""{"code":"ABCD2345","secret":"abc"}""") }
        assertTrue(c.create() is PairingClient.CreateResult.Failed)

        reply = { ok("<html>oops</html>") }
        val r = c.create() as PairingClient.CreateResult.Failed
        assertEquals(PairingClient.OGILDUR_KODI, r.message)
    }

    @Test
    fun createSkilurSkylduEfNetidBregst() {
        reply = { throw IOException("timeout") }
        val r = client().create() as PairingClient.CreateResult.Failed
        assertTrue(r.message.contains("thverhaus.com"))
    }

    @Test
    fun createSkilurSkylduEfVefurHafnar() {
        reply = { ok("", 500) }
        val r = client().create() as PairingClient.CreateResult.Failed
        assertTrue(r.message.contains("HTTP 500"))
    }

    @Test
    fun createSkilurSkylduEfOfMargarTilraunir() {
        reply = { ok("", 429) }
        val r = client().create() as PairingClient.CreateResult.Failed
        assertEquals(PairingClient.TOO_MANY, r.message)
    }

    @Test
    fun pollSendirBearerOgFaerEkkertEnn() {
        reply = { ok("", 204) }
        assertEquals(PairingClient.PollResult.Waiting, client().poll(session))

        val req = requests[0]
        assertEquals("GET", req.method)
        assertEquals("https://thverhaus.com/api/pair/ABCD2345", req.url)
        assertEquals("Bearer ${session.secret}", req.headers["Authorization"])
        assertNull(req.body)
        // Kóðinn er í slóðinni en lykillinn aldrei.
        assertTrue(!req.url.contains(session.secret))
    }

    @Test
    fun pollSkilarM3uSlodThegarHunKemur() {
        reply = {
            ok("""{"type":"m3u","name":"Test","url":"https://prov.example/list.m3u","epgUrl":""}""")
        }
        val r = client().poll(session) as PairingClient.PollResult.Ready
        val link = r.payload as PairPayload.Link
        assertEquals("Test", link.name)
        assertEquals("https://prov.example/list.m3u", link.url)
    }

    @Test
    fun pollSkilarXtreamThegarHannKemur() {
        reply = {
            ok(
                """{"type":"xtream","name":"","server":"http://host:8080","username":"jon",
                   "password":"p","epgUrl":""}""".trimIndent()
            )
        }
        val r = client().poll(session) as PairingClient.PollResult.Ready
        assertEquals("jon", (r.payload as PairPayload.XtreamAccount).username)
    }

    @Test
    fun pollSkilarExpiredEf404() {
        reply = { ok("""{"error":"not_found"}""", 404) }
        assertEquals(PairingClient.PollResult.Expired, client().poll(session))
    }

    @Test
    fun pollSkilarForbiddenEf403() {
        reply = { ok("", 403) }
        assertEquals(PairingClient.PollResult.Forbidden, client().poll(session))
    }

    @Test
    fun pollSkilarVilluEfSvaridErRusl() {
        reply = { ok("<html>500</html>") }
        assertTrue(client().poll(session) is PairingClient.PollResult.Failed)
    }

    @Test
    fun pollSkilurSkylduEfNetidBregst() {
        reply = { throw IOException("no net") }
        val r = client().poll(session) as PairingClient.PollResult.Failed
        assertTrue(r.message.contains("Náði ekki"))
    }

    @Test
    fun pollSkilurSkylduEfVefurSvararVillu() {
        reply = { ok("", 502) }
        val r = client().poll(session) as PairingClient.PollResult.Failed
        assertTrue(r.message.contains("HTTP 502"))
    }
}
