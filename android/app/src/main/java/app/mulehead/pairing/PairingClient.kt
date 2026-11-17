package app.mulehead.pairing

import app.mulehead.tr

import app.mulehead.data.Json
import app.mulehead.data.JsonException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/**
 * Samskipti við vefinn á thverhaus.com (forskrift í docs/PAIRING.md):
 *
 *  - `POST /api/pair` (engin gögn) -> 201 `{"code","secret","expiresInSeconds"}`
 *  - `GET /api/pair/{kóði}` með `Authorization: Bearer {secret}`
 *      204 = bíður, 200 = listinn (aðeins einu sinni), 404 = útrunninn, 403 = villa
 *
 * Appið sækir listann sjálft; það opnar ekkert port út á netið og leynilykillinn
 * fer í haus, aldrei í vefslóð. Ekkert í þessari skrá skrifar lykil, slóð eða
 * lykilorð í logga.
 *
 * Allt er blokkerandi — kallaðu úr bakgrunnsþræði (Dispatchers.IO).
 */
class PairingClient(
    private val baseUrl: String = BASE_URL,
    private val transport: Transport = HttpTransport(),
    private val userAgent: String = USER_AGENT
) {

    // Sækjari sem hægt er að skipta út í prófum (engar nettengingar í JUnit).
    interface Transport {
        fun request(req: Request): Response
    }

    data class Request(
        val method: String,
        val url: String,
        val headers: Map<String, String> = emptyMap(),
        val body: ByteArray? = null,
        val timeoutMs: Int = TIMEOUT_MS
    )

    data class Response(val code: Int, val body: String)

    sealed interface CreateResult {
        data class Ok(val session: PairSession) : CreateResult
        data class Failed(val message: String) : CreateResult
    }

    sealed interface PollResult {
        object Waiting : PollResult
        data class Ready(val payload: PairPayload) : PollResult

        // Kóðinn er útrunninn eða þegar sóttur — appið sækir nýjan og heldur áfram.
        object Expired : PollResult

        // Vefurinn þekkir ekki leynilykilinn (eða kóðann) — hætta og biðja um nýjan.
        object Forbidden : PollResult
        data class Failed(val message: String) : PollResult
    }

    /** Biður vefinn um nýtt paratilvik (kóði + leynilykill + líftími). */
    fun create(now: Long = System.currentTimeMillis()): CreateResult {
        val res = try {
            transport.request(
                Request(method = "POST", url = "$baseUrl/api/pair", headers = headers())
            )
        } catch (e: IOException) {
            return CreateResult.Failed(offline(e))
        }
        return when {
            res.code == 429 -> CreateResult.Failed(TOO_MANY)
            res.code in 200..299 -> {
                val session = parseSession(res.body, now)
                if (session == null) CreateResult.Failed(OGILDUR_KODI)
                else CreateResult.Ok(session)
            }
            else -> CreateResult.Failed(httpError(res.code))
        }
    }

    /** Spyr hvort notandinn hafi sent listann. 204 = bíðum enn. */
    fun poll(session: PairSession): PollResult {
        val res = try {
            transport.request(
                Request(
                    method = "GET",
                    url = "$baseUrl/api/pair/${session.code}",
                    headers = headers(bearer = session.secret)
                )
            )
        } catch (e: IOException) {
            return PollResult.Failed(offline(e))
        }
        return when (res.code) {
            204 -> PollResult.Waiting
            200 -> {
                if (res.body.isBlank()) return PollResult.Failed(tr("The site sent an empty response", "Vefurinn sendi tómt svar"))
                try {
                    PollResult.Ready(PairPayload.parse(res.body))
                } catch (e: PairingException) {
                    // Textinn er íslenskur og má fara beint á skjáinn.
                    PollResult.Failed(e.message ?: tr("Invalid response from the site", "Ógilt svar frá vefnum"))
                }
            }
            403 -> PollResult.Forbidden
            404, 410 -> PollResult.Expired
            429 -> PollResult.Failed(TOO_MANY)
            else -> PollResult.Failed(httpError(res.code))
        }
    }

    // Svar við POST /api/pair: {"code":"ABCDEFGH","secret":"<hex>","expiresInSeconds":600}
    private fun parseSession(body: String, now: Long): PairSession? {
        val o = try {
            Json.obj(Json.parse(body))
        } catch (e: JsonException) {
            return null
        }
        val code = PairCode.normalize(Json.str(o["code"])) ?: return null
        if (code.length != PairCode.LENGTH) return null
        val secret = Json.str(o["secret"]).trim()
        if (secret.length < MIN_SECRET) return null
        val ttlSec = Json.long(o["expiresInSeconds"], 0)
        val ttl = if (ttlSec in MIN_TTL_SEC..MAX_TTL_SEC) ttlSec * 1_000 else PairSession.TTL_MS
        return PairSession(code = code, secret = secret, createdAt = now, expiresAt = now + ttl)
    }

    private fun headers(bearer: String? = null): Map<String, String> {
        val h = LinkedHashMap<String, String>()
        h["Accept"] = "application/json"
        h["User-Agent"] = userAgent
        h["Cache-Control"] = "no-store"
        if (bearer != null) h["Authorization"] = "Bearer $bearer"
        return h
    }

    companion object {

        // Eini staðurinn þar sem slóðin á vefinn er skilgreind.
        const val BASE_URL = "https://thverhaus.com"

        const val USER_AGENT = "Mulehead-Android"

        const val TIMEOUT_MS = 15_000

        val TOO_MANY: String get() = tr("Too many attempts — wait a moment and try again", "Of margar tilraunir — bíddu augnablik og reyndu aftur")

        val OGILDUR_KODI: String get() = tr("The site sent an invalid code", "Vefurinn sendi ógildan kóða")

        // Leynilykillinn er 64 stafir (32 bæti í hex); kröfum að minnsta kosti 16.
        private const val MIN_SECRET = 16

        private const val MIN_TTL_SEC = 30L
        private const val MAX_TTL_SEC = 24 * 60 * 60L

        private fun offline(e: IOException): String =
            tr("Couldn't reach thverhaus.com — check the network connection (${e.message ?: e.javaClass.simpleName})", "Náði ekki í thverhaus.com — athugaðu nettenginguna (${e.message ?: e.javaClass.simpleName})")

        private fun httpError(code: Int): String = when {
            code == 400 -> tr("The site rejected the request", "Vefurinn hafnaði beiðninni")
            code == 403 -> tr("The site rejected the code", "Vefurinn hafnaði kóðanum")
            code == 413 -> tr("The list is too large for the site", "Listinn er of stór fyrir vefinn")
            code in 500..599 -> tr("The server at thverhaus.com is not responding (HTTP $code)", "Vefþjónninn á thverhaus.com er ekki að svara (HTTP $code)")
            else -> tr("Unexpected response from the site (HTTP $code)", "Óvænt svar frá vefnum (HTTP $code)")
        }
    }
}

// Sækir yfir https (sama mynstur og HttpTransport í PlaylistRepository).
class HttpTransport : PairingClient.Transport {

    override fun request(req: PairingClient.Request): PairingClient.Response {
        val u = try {
            URI(req.url).toURL()
        } catch (e: Exception) {
            throw IOException(tr("invalid link", "ógild slóð"), e)
        }
        val conn = u.openConnection() as? HttpURLConnection
            ?: throw IOException(tr("only http:// and https:// can be used", "aðeins er hægt að nota http:// og https://"))
        try {
            conn.requestMethod = req.method
            conn.connectTimeout = req.timeoutMs
            conn.readTimeout = req.timeoutMs
            conn.instanceFollowRedirects = true
            conn.useCaches = false
            for ((k, v) in req.headers) conn.setRequestProperty(k, v)
            val body = req.body
            if (body != null) {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            } else if (req.method != "GET") {
                // POST án líkama: sendum tóman líkama með Content-Length: 0.
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(0)
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) {
                conn.inputStream
            } else {
                runCatching { conn.errorStream }.getOrNull()
            }
            val text = stream?.use { String(it.readBytes(), Charsets.UTF_8) }.orEmpty()
            return PairingClient.Response(code = code, body = text)
        } finally {
            conn.disconnect()
        }
    }
}
