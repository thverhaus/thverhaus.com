package app.mulehead.data

import app.mulehead.tr

import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.io.PushbackInputStream
import java.util.zip.GZIPInputStream

// Þýðing á reference/mac-electron/m3u.js. Hegðunin á að vera nákvæmlega sú sama.
object M3uParser {

    val NO_NAME: String get() = tr("No name", "Án nafns")
    val NO_GROUP: String get() = tr("Uncategorized", "Án flokks")

    // key="value", key='value' eða key=value (ógilt)
    private val ATTR_RE = Regex("([a-zA-Z0-9_-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s,\"']+))")
    private val MOVIE_RE = Regex("/movie/", RegexOption.IGNORE_CASE)
    private val SERIES_RE = Regex("/series/", RegexOption.IGNORE_CASE)

    fun parse(text: String): M3uPlaylist =
        parse(BufferedReader(java.io.StringReader(text)))

    /**
     * Les listann línu fyrir línu úr streymi, svo allt verði ekki í minni í einu.
     * Skráin getur verið gzip-þjöppuð (eins og margir þjónar senda hana).
     */
    fun parse(input: InputStream): M3uPlaylist {
        val pin = PushbackInputStream(BufferedInputStream(input, 64 * 1024), 2)
        val b0 = pin.read()
        val b1 = pin.read()
        if (b1 >= 0) pin.unread(b1)
        if (b0 >= 0) pin.unread(b0)
        val stream: InputStream =
            if (b0 == 0x1f && b1 == 0x8b) GZIPInputStream(pin, 64 * 1024) else pin
        return InputStreamReader(stream, Charsets.UTF_8).use { parse(BufferedReader(it)) }
    }

    fun parseFile(f: File): M3uPlaylist = f.inputStream().use { parse(it) }

    fun parse(reader: BufferedReader): M3uPlaylist {
        var epgUrl = ""
        val channels = ArrayList<Channel>()
        var cur: Pending? = null
        var pendingGroup = ""
        var hasExtinf = false
        var hasUrlLine = false
        var first = true

        while (true) {
            var line = reader.readLine() ?: break
            if (first) {
                first = false
                if (line.startsWith("\uFEFF")) line = line.substring(1)
            }
            line = line.trim()
            if (line.isEmpty()) continue

            if (line.startsWith("#EXTM3U")) {
                val a = parseAttrs(line)
                epgUrl = a["url-tvg"] ?: a["x-tvg-url"] ?: a["tvg-url"] ?: ""
                if (epgUrl.contains(',')) epgUrl = epgUrl.split(',')[0].trim()
                continue
            }

            if (line.startsWith("#EXTINF")) {
                hasExtinf = true
                val a = parseAttrs(line)
                cur = Pending(
                    name = extractName(line).ifEmpty { a["tvg-name"] ?: "" }.ifEmpty { NO_NAME },
                    tvgId = a["tvg-id"] ?: "",
                    tvgName = a["tvg-name"] ?: "",
                    logo = a["tvg-logo"] ?: a["logo"] ?: "",
                    group = a["group-title"] ?: a["tvg-group"] ?: a["group"] ?: a["category"] ?: "",
                    catchup = a["catchup"] ?: a["catchup-type"] ?: "",
                    catchupDays = a["catchup-days"] ?: a["timeshift"] ?: "",
                    userAgent = a["user-agent"] ?: ""
                )
                continue
            }

            if (line.startsWith("#EXTGRP:")) {
                pendingGroup = line.substring(8).trim()
                continue
            }

            if (line.startsWith("#EXTVLCOPT:")) {
                val opt = line.substring(11)
                val c = cur
                if (c != null && opt.startsWith("http-user-agent=", ignoreCase = true)) {
                    c.userAgent = opt.split('=').drop(1).joinToString("=")
                }
                continue
            }

            if (line.startsWith("#")) continue

            // Lína með slóð.
            if (line.startsWith("http://") || line.startsWith("https://")) hasUrlLine = true
            val p = cur ?: Pending(name = line.substringAfterLast('/').ifEmpty { tr("Channel", "Rás") })
            if (p.group.isEmpty()) p.group = pendingGroup.ifEmpty { NO_GROUP }
            p.url = line
            p.kind = guessKind(line)
            channels.add(p.toChannel())
            cur = null
            pendingGroup = ""
        }

        return M3uPlaylist(
            epgUrl = epgUrl,
            channels = channels,
            hasExtinf = hasExtinf,
            hasUrlLine = hasUrlLine
        )
    }

    // Öll gildi framan við nafnið (það sem er fyrir fyrstu kommuna utan gæsalappa).
    fun parseAttrs(str: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        val head = str.substring(0, attrEnd(str))
        for (m in ATTR_RE.findAll(head)) {
            val v = m.groupValues[2].ifEmpty { m.groupValues[3].ifEmpty { m.groupValues[4] } }
            out[m.groupValues[1].lowercase().replace('_', '-')] = v.trim()
        }
        return out
    }

    // Nafnið er textinn eftir kommuna sem kemur á eftir attribute-listunum.
    fun extractName(line: String): String {
        val i = attrEnd(line)
        return if (i < line.length) line.substring(i + 1).trim() else ""
    }

    // Staða kommunnar sem aðskilur attribute-lista frá nafni.
    fun attrEnd(line: String): Int {
        var q: Char? = null
        for (i in line.indices) {
            val c = line[i]
            if (q != null) {
                if (c == q) q = null
            } else if (c == '"' || c == '\'') {
                if (endsWithEquals(line.substring(0, i))) q = c
            } else if (c == ',') {
                return i
            }
        }
        return line.length
    }

    fun guessKind(url: String): Channel.Kind = when {
        MOVIE_RE.containsMatchIn(url) -> Channel.Kind.MOVIE
        SERIES_RE.containsMatchIn(url) -> Channel.Kind.SERIES
        else -> Channel.Kind.LIVE
    }

    // Sama og /=\\s*$/ í JS.
    private fun endsWithEquals(s: String): Boolean {
        var j = s.length - 1
        while (j >= 0 && s[j].isWhitespace()) j--
        return j >= 0 && s[j] == '='
    }

    private class Pending(
        var name: String,
        var tvgId: String = "",
        var tvgName: String = "",
        var logo: String = "",
        var group: String = "",
        var catchup: String = "",
        var catchupDays: String = "",
        var userAgent: String = "",
        var url: String = "",
        var kind: Channel.Kind = Channel.Kind.LIVE
    ) {
        fun toChannel() = Channel(
            name = name,
            url = url,
            tvgId = tvgId,
            tvgName = tvgName,
            logo = logo,
            group = group,
            kind = kind,
            catchup = catchup,
            catchupDays = catchupDays,
            userAgent = userAgent
        )
    }
}
