package app.mulehead.data

import app.mulehead.tr

import kotlin.math.abs
import kotlin.math.floor

// Villa í JSON-texta (skilaboðin eru á íslensku og má birta).
class JsonException(message: String) : Exception(message)

/**
 * Lítill JSON-lestur — engar viðbætur. Xtream-þjónustur skila JSON sem við þurfum
 * aðeins að lesa: hlutir, listar, strengir, tölur, true/false og null.
 *
 * Niðurstaðan er Map<String, Any?>, List<Any?>, String, Double, Boolean eða null.
 * Lesa má gildin með hjálparföllunum hér fyrir neðan (obj/list/str/num/long/bool).
 */
object Json {

    private val TRUE = "true"
    private val FALSE = "false"
    private val NULL = "null"

    fun parse(text: String): Any? = Parser(text).run()

    // Hlutur (tómt kort ef gildið er ekki hlutur).
    fun obj(v: Any?): Map<String, Any?> = v as? Map<String, Any?> ?: emptyMap()

    // Listi (tómur ef gildið er ekki listi).
    fun list(v: Any?): List<Any?> = v as? List<Any?> ?: emptyList()

    // Texti úr gildi; tölur verða „7.5“ og 8 verður „8“ (sama og í JavaScript).
    fun str(v: Any?, def: String = ""): String = when (v) {
        null -> def
        is String -> v
        is Double -> numText(v)
        is Boolean -> if (v) TRUE else FALSE
        else -> def
    }

    fun num(v: Any?): Double? = when (v) {
        is Double -> v
        is String -> v.trim().toDoubleOrNull()
        is Boolean -> if (v) 1.0 else 0.0
        else -> null
    }

    fun long(v: Any?, def: Long = 0): Long = num(v)?.toLong() ?: def

    fun bool(v: Any?): Boolean = when (v) {
        is Boolean -> v
        is String -> v.equals(TRUE, ignoreCase = true) || v == "1"
        is Double -> v != 0.0
        else -> false
    }

    // 8.0 -> "8", 7.6 -> "7.6" (Number#toString í JavaScript).
    fun numText(d: Double): String = when {
        d.isNaN() || d.isInfinite() -> d.toString()
        abs(d) < 1e15 && d == floor(d) -> d.toLong().toString()
        else -> d.toString()
    }

    private class Parser(private val s: String) {

        private var i = 0

        fun run(): Any? {
            val v = value()
            ws()
            if (i < s.length) err(tr("invalid content after JSON", "ógilt efni eftir JSON"))
            return v
        }

        private fun value(): Any? {
            ws()
            if (i >= s.length) err(tr("unexpected end of text", "textinn endar óvænt"))
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> string()
                't' -> literal(TRUE, true)
                'f' -> literal(FALSE, false)
                'n' -> literal(NULL, null)
                else -> if (c == '-' || c.isDigit()) number() else err(tr("invalid character '$c'", "ógilt tákn '$c'"))
            }
        }

        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            i++ // {
            ws()
            if (i < s.length && s[i] == '}') {
                i++
                return out
            }
            while (true) {
                ws()
                if (i >= s.length || s[i] != '"') err(tr("missing key name", "vantar nafn á gildi"))
                val k = string()
                ws()
                if (i >= s.length || s[i] != ':') err(tr("missing ':'", "vantar ':'"))
                i++
                out[k] = value()
                ws()
                if (i >= s.length) err(tr("unexpected end of text", "textinn endar óvænt"))
                when (s[i]) {
                    ',' -> i++
                    '}' -> {
                        i++
                        return out
                    }
                    else -> err(tr("missing ',' or '}'", "vantar ',' eða '}'"))
                }
            }
        }

        private fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            i++ // [
            ws()
            if (i < s.length && s[i] == ']') {
                i++
                return out
            }
            while (true) {
                out.add(value())
                ws()
                if (i >= s.length) err(tr("unexpected end of text", "textinn endar óvænt"))
                when (s[i]) {
                    ',' -> i++
                    ']' -> {
                        i++
                        return out
                    }
                    else -> err(tr("missing ',' or ']'", "vantar ',' eða ']'"))
                }
            }
        }

        private fun string(): String {
            val sb = StringBuilder()
            i++ // "
            while (i < s.length) {
                val c = s[i++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (i >= s.length) err(tr("unexpected end of text", "textinn endar óvænt"))
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) err(tr("invalid \\u", "ógilt \\u"))
                                val code = s.substring(i, i + 4).toIntOrNull(16) ?: err(tr("invalid \\u", "ógilt \\u"))
                                sb.append(code.toChar())
                                i += 4
                            }
                            else -> err(tr("invalid escape '\\$e'", "ógilt escape '\\$e'"))
                        }
                    }
                    else -> sb.append(c)
                }
            }
            err(tr("unterminated string", "strengur endar ekki"))
        }

        private fun literal(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) err(tr("invalid word", "ógilt orð"))
            i += word.length
            return v
        }

        private fun number(): Double {
            val start = i
            if (i < s.length && s[i] == '-') i++
            while (i < s.length && s[i].isDigit()) i++
            if (i < s.length && s[i] == '.') {
                i++
                while (i < s.length && s[i].isDigit()) i++
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                while (i < s.length && s[i].isDigit()) i++
            }
            return s.substring(start, i).toDoubleOrNull() ?: err(tr("invalid number", "ógil tala"))
        }

        private fun ws() {
            while (i < s.length && s[i].isWhitespace()) i++
        }

        private fun err(msg: String): Nothing = throw JsonException("JSON: $msg")
    }
}
