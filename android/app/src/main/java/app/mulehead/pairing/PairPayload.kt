package app.mulehead.pairing

import app.mulehead.tr

import app.mulehead.data.Json
import app.mulehead.data.JsonException
import app.mulehead.data.hostOf

// Villa í parun sem má birta notandanum beint (textinn er á íslensku).
class PairingException(message: String) : Exception(message)

/**
 * Það sem notandinn sendir á thverhaus.com/tengja og sjónvarpið tekur við.
 *
 * Vefurinn sendir JSON-hlut með `type` (sjá docs/PAIRING.md):
 *  - `{"type":"m3u","name":"…","url":"https://…","epgUrl":"…"}`
 *  - `{"type":"xtream","name":"…","server":"http://host:port","username":"…","password":"…","epgUrl":"…"}`
 *
 * `name` og `epgUrl` mega vera tómir. Slóðir og lykilorð eru í líkamanum en ekki
 * í vefslóð — þau eiga ekki að enda í netlögum eða logs.
 */
sealed interface PairPayload {

    val name: String
    val epgUrl: String

    // Venjulegur M3U-hlekkur (oftast með notandanafni/lykilorði inni í slóðinni).
    data class Link(
        override val name: String,
        val url: String,
        override val epgUrl: String = ""
    ) : PairPayload

    // Xtream-innskráning: netþjónn + notandi + lykilorð (verður að M3U-slóð hér).
    data class XtreamAccount(
        override val name: String,
        val server: String,
        val username: String,
        val password: String,
        override val epgUrl: String = ""
    ) : PairPayload

    companion object {

        private val HTTP_RE = Regex("^https?://", RegexOption.IGNORE_CASE)

        /**
         * Les svar frá vefnum. Skilar [PairingException] með íslenskum texta ef
         * eitthvað vantar eða er ógilt (sá texti fer beint á skjáinn).
         */
        fun parse(json: String): PairPayload {
            val root = try {
                Json.parse(json)
            } catch (e: JsonException) {
                throw PairingException(tr("Invalid response from the site", "Ógilt svar frá vefnum"))
            }
            val o = Json.obj(root)
            if (o.isEmpty()) throw PairingException(tr("Invalid response from the site", "Ógilt svar frá vefnum"))

            val name = Json.str(o["name"]).trim()
            val epgUrl = Json.str(o["epgUrl"]).trim()
            val type = Json.str(o["type"]).trim().lowercase().ifEmpty { infer(o) }

            return when (type) {
                "m3u", "url", "link" -> {
                    val url = Json.str(o["url"]).trim()
                    if (!HTTP_RE.containsMatchIn(url)) {
                        throw PairingException(tr("The link must start with http:// or https://", "Slóðin þarf að byrja á http:// eða https://"))
                    }
                    Link(name = name.ifEmpty { hostOf(url) }, url = url, epgUrl = epgUrl)
                }

                "xtream" -> {
                    val server = Json.str(o["server"]).trim()
                    val user = Json.str(o["username"]).trim()
                    if (server.isEmpty() || user.isEmpty()) {
                        throw PairingException(tr("Server or username missing", "Netþjónn eða notandanafn vantar"))
                    }
                    XtreamAccount(
                        name = name.ifEmpty { user },
                        server = server,
                        username = user,
                        password = Json.str(o["password"]),
                        epgUrl = epgUrl
                    )
                }

                else -> throw PairingException(tr("Unknown list type: $type", "Óþekkt tegund lista: $type"))
            }
        }

        // Eldri/afbrigði svara án "type": ákvarðað út frá því sem fylgir.
        private fun infer(o: Map<String, Any?>): String = when {
            Json.str(o["server"]).isNotBlank() -> "xtream"
            Json.str(o["url"]).isNotBlank() -> "m3u"
            else -> ""
        }
    }
}
