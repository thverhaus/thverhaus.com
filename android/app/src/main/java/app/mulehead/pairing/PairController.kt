package app.mulehead.pairing

import app.mulehead.tr

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

enum class PairStatus {
    // Verið að fá kóða frá vefnum.
    STARTING,

    // Kóðinn er á skjánum og beðið er eftir listanum.
    WAITING,

    // Listinn kom — verið að vista hann og sækja.
    APPLYING,

    // Búið: listinn er kominn inn í appið.
    DONE,

    // Eitthvað fór úrskeiðis; skilaboðin eru í [PairState.message].
    ERROR
}

data class PairState(
    val code: String = "",
    val expiresAt: Long = 0,
    val status: PairStatus = PairStatus.STARTING,
    val message: String? = null,
    val count: Int = 0
)

/**
 * Stýrir einni parun: biður vefinn um kóða, spyr á 5 sek fresti hvort listinn sé
 * kominn, setur hann inn og hættir.
 *
 * Kóðinn og leynilykillinn koma báðir frá vefnum (`POST /api/pair`). Þegar kóðinn
 * rennur út (eða vefurinn svarar 404) sækir stýringin nýjan og heldur áfram, svo
 * skjárinn er aldrei „dauður“ meðan hann er opinn. Lokatölvan sjálf stöðvar
 * lykkjuna: skjárinn kallar [run] úr `LaunchedEffect` og þegar hann lokast er
 * coroutine-ið afturkallað.
 *
 * Ekkert hér snertir Android — prófin keyra [run] með fölsuðum client og installer.
 */
class PairController(
    private val client: PairingClient,
    private val installer: Installer,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val sleep: suspend (Long) -> Unit = { delay(it) }
) {

    // Setur listann inn í appið (PlaylistInstaller í appinu, falskt í prófum).
    fun interface Installer {
        fun install(payload: PairPayload): InstallResult
    }

    private val _state = MutableStateFlow(PairState())
    val state: StateFlow<PairState> = _state.asStateFlow()

    /**
     * Keyrir parunina þar til listinn kemur, villa verður eða coroutine-ið er
     * afturkallað (skjárinn lokast).
     */
    suspend fun run() {
        _state.value = PairState(status = PairStatus.STARTING)

        var session = withContext(Dispatchers.IO) { open() } ?: return
        show(session, message = null)

        var failures = 0
        while (true) {
            currentCoroutineContext().ensureActive()

            // Kóðinn er útrunninn: sækjum nýjan og sýnum hann í staðinn.
            if (session.isExpired(clock())) {
                session = renew() ?: return
                failures = 0
                sleep(POLL_MS)
                continue
            }

            when (val result = withContext(Dispatchers.IO) { client.poll(session) }) {
                PairingClient.PollResult.Waiting -> {
                    failures = 0
                    sleep(POLL_MS)
                }

                is PairingClient.PollResult.Ready -> {
                    apply(result.payload)
                    return
                }

                PairingClient.PollResult.Expired -> {
                    // Vefurinn hefur eytt kóðanum (sóttur eða útrunninn).
                    session = renew() ?: return
                    failures = 0
                    sleep(POLL_MS)
                }

                PairingClient.PollResult.Forbidden -> {
                    fail(tr("The site rejected the code — press “New code”", "Vefurinn hafnaði kóðanum — ýttu á „Nýr kóði“"))
                    return
                }

                is PairingClient.PollResult.Failed -> {
                    failures++
                    // Netið dettur stundum út í smástund — reynum aftur áður en við gefumst upp.
                    if (failures >= MAX_FAILURES) {
                        fail(result.message)
                        return
                    }
                    _state.value = _state.value.copy(message = result.message)
                    sleep(RETRY_MS)
                }
            }
        }
    }

    // Skráir nýtt tilvik á vefnum; skilar null ef ekki tókst (skilaboð á skjánum).
    private fun open(): PairSession? = when (val r = client.create(clock())) {
        is PairingClient.CreateResult.Ok -> r.session
        is PairingClient.CreateResult.Failed -> {
            fail(r.message)
            null
        }
    }

    // Nýr kóði í stað útrunnins; skjárinn heldur áfram að bíða.
    private suspend fun renew(): PairSession? {
        val s = withContext(Dispatchers.IO) { open() } ?: return null
        show(s, message = EXPIRED_TEXT)
        return s
    }

    private fun show(session: PairSession, message: String?) {
        _state.value = PairState(
            code = session.code,
            expiresAt = session.expiresAt,
            status = PairStatus.WAITING,
            message = message
        )
    }

    private suspend fun apply(payload: PairPayload) {
        _state.value = _state.value.copy(status = PairStatus.APPLYING, message = null)
        val result = withContext(Dispatchers.IO) { installer.install(payload) }
        _state.value = _state.value.copy(
            status = if (result.ok) PairStatus.DONE else PairStatus.ERROR,
            count = result.count,
            message = result.error
        )
    }

    private fun fail(message: String) {
        _state.value = _state.value.copy(status = PairStatus.ERROR, message = message)
    }

    companion object {
        // Hversu oft er spurt hvort listinn sé kominn.
        const val POLL_MS = 5_000L

        // Bið eftir næstu tilraun ef netið datt út.
        const val RETRY_MS = 3_000L

        // Hversu oft má mistakast áður en gefist er upp.
        const val MAX_FAILURES = 6

        val EXPIRED_TEXT: String get() = tr("The code expired — here is a new one", "Kóðinn rann út — hér er nýr kóði")
    }
}
