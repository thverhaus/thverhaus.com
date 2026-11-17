package app.mulehead.pairing

/**
 * Parakóðinn sem sjónvarpið sýnir og notandinn slær inn á thverhaus.com/tengja.
 *
 * Kóðann OG leynilykilinn býr vefþjónninn til (`POST /api/pair`); appið geymir
 * hvorki né skrifar hvorn þeirra í logga. Kóðinn einn og sér er ekki nóg til að
 * sækja listann — aðeins appið þekkir leynilykilinn sem fer í `Authorization:
 * Bearer …` og vefurinn geymir aðeins SHA-256 hak af honum. Sá sem kemst yfir
 * kóðann getur því hvorki lesið né eytt neinu.
 *
 * Stafrófið sleppir 0/O/1/I svo kóðinn sé auðlesinn á sjónvarpsskjá. 8 stafir eru
 * 40 bitar; ásamt 10 mínútna líftíma og takmörkun á beiðnum er hann ágiskunarheldur.
 */
object PairCode {

    // 32 stafir (engin 0, O, 1, I) — hver stafur er nákvæmlega 5 bitar.
    const val ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

    const val LENGTH = 8

    // Kóðinn er sýndur í tveimur hópum: ABCD-EFGH.
    const val GROUP = 4

    // "abcd-efgh" / "ABCD EFGH" -> "ABCDEFGH"; null ef stafur er utan stafrófsins eða ekkert er eftir.
    fun normalize(input: String): String? {
        val s = StringBuilder()
        for (ch in input.uppercase()) {
            if (ch == '-' || ch == ' ' || ch == '\t') continue
            if (ALPHABET.indexOf(ch) < 0) return null
            s.append(ch)
        }
        return if (s.isEmpty()) null else s.toString()
    }

    fun isComplete(code: String): Boolean = normalize(code)?.length == LENGTH

    // ABCD-EFGH: auðlesið á skjá (villur úr inntaki eru hreinsaðar burt).
    fun format(code: String): String {
        val s = code.uppercase().filter { ALPHABET.indexOf(it) >= 0 }
        return s.chunked(GROUP).joinToString("-")
    }
}

/**
 * Eitt paratilvik: kóðinn sem notandinn sér og leynilykillinn sem aðeins appið þekkir.
 *
 * Bæði koma úr svarinu við `POST /api/pair` ásamt líftíma (`expiresInSeconds`).
 * Vefurinn eyðir tilvikinu um leið og listinn hefur verið sóttur (einnota lestur)
 * og að öðru ómarki þegar [expiresAt] er liðinn.
 */
data class PairSession(
    val code: String,
    val secret: String,
    val createdAt: Long,
    val expiresAt: Long
) {

    fun isExpired(now: Long): Boolean = now >= expiresAt

    companion object {

        // Notað ef vefurinn sendir enga tímalengd (sama gildi og Worker-inn notar).
        const val TTL_MS = 10 * 60_000L
    }
}
