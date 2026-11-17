package app.mulehead.data

import app.mulehead.tr

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException

/**
 * Tvöfaldar skyndimyndir (snapshot) af því sem þegar hefur verið þáttað:
 * rásalistanum og dagskránni.
 *
 * Ástæðan: XMLTV-skrá getur verið hundruð megabæta. Að þátta hana upp á nýtt
 * í hverri ræsingu tekur langan tíma og getur klárað minnið á litlum boxum.
 * Þess vegna vistum við niðurstöðuna (aðeins það sem við þurfum) og lesum hana
 * aftur á brot af tímanum.
 *
 * Skyndimyndin er alltaf bundin við ákveðna útgáfu af annarri skránni
 * (`sourceAt` = tíminn sem sú skrá var sótt) og dagskráin líka við rásalistann
 * og tímagluggann (`sig`, `from`, `to`). Ef eitthvað af þessu breytist er henni
 * einfaldlega hent og skráin lesin/þáttuð á ný.
 *
 * Villur við skrif eða lestur eru hljóðar: skyndimynd er aukaatriði, aldrei má
 * láta hana koma í veg fyrir að appið virki.
 */
internal object Snapshots {

    private const val PL_MAGIC = 0x4D48504C   // "MHPL"
    private const val EPG_MAGIC = 0x4D484550  // "MHEP"

    // Útgáfa rásalistans: 2 bætti við flokkaröð þjónustunnar (Xtream).
    // Gamlar skyndimyndir (1) eru enn lesnar, bara án flokkaradar.
    private const val PL_VERSION = 2
    private const val PL_VERSION_MIN = 1

    // Dagskráin hefur ekki breyst og heldur sinni útgáfu svo uppfærsla appsins
    // þurfi ekki að þátta hundruð megabæta aftur.
    private const val VERSION = 1

    private const val MAX_STR = 1 shl 20
    private const val MAX_ITEMS = 2_000_000

    // Dagskráin er geymd í glugganum [now - 6 klst, now + 48 klst]. Við notum
    // hana aðeins á meðan minnst 12 klst eru eftir af glugganum, svo hún
    // gildist aldrei út undir nefinu á notandanum.
    const val EPG_MIN_LEFT_MS = 12L * 60 * 60 * 1000

    data class Channels(
        val epgUrl: String,
        val channels: List<Channel>,
        // Röð flokka hjá þjónustunni (Xtream). Tómt fyrir M3U — þá gildir röð
        // fyrstu birtingar.
        val groupOrder: List<String> = emptyList()
    )

    data class Epg(
        val sourceAt: Long,
        val from: Long,
        val to: Long,
        val sig: Long,
        val programmes: Map<String, List<Programme>>,
        val nameToId: Map<String, String>,
        val nameToIdLoose: Map<String, String>
    )

    /**
     * Fingerprent af rásalistanum. Dagskráin er aðeins gild fyrir þann lista
     * sem hún var þáttuð fyrir; bætist við rás eða nafn breytist verður
     * fingerprentið annað og skyndimyndin er ekki notuð.
     */
    fun signature(channels: List<Channel>): Long {
        var h = -0x340d631b7bdddcdbL // FNV-1a 64 bita offset
        h = mix(h, channels.size.toLong())
        for (c in channels) {
            h = mixStr(h, c.tvgId)
            h = mixStr(h, c.name)
            h = mixStr(h, c.tvgName)
        }
        return h
    }

    private fun mixStr(h: Long, s: String): Long {
        var x = mix(h, s.length.toLong())
        for (ch in s) x = (x xor ch.code.toLong()) * 0x100000001b3L
        return x
    }

    private fun mix(h: Long, v: Long): Long = (h xor v) * 0x100000001b3L

    // ---- rásalisti ---------------------------------------------------------

    fun writeChannels(f: File, sourceAt: Long, data: Channels) {
        writeAtomically(f) { out ->
            out.writeInt(PL_MAGIC)
            out.writeByte(PL_VERSION)
            out.writeLong(sourceAt)
            writeStr(out, data.epgUrl)
            out.writeInt(data.groupOrder.size)
            for (g in data.groupOrder) writeStr(out, g)
            out.writeInt(data.channels.size)
            for (c in data.channels) {
                writeStr(out, c.name)
                writeStr(out, c.url)
                writeStr(out, c.tvgId)
                writeStr(out, c.tvgName)
                writeStr(out, c.logo)
                writeStr(out, c.group)
                out.writeByte(c.kind.ordinal)
                writeStr(out, c.catchup)
                writeStr(out, c.catchupDays)
                writeStr(out, c.userAgent)
            }
        }
    }

    fun readChannels(f: File, sourceAt: Long): Channels? = read(f) { inp ->
        if (inp.readInt() != PL_MAGIC) return@read null
        val ver = inp.readUnsignedByte()
        if (ver < PL_VERSION_MIN || ver > PL_VERSION) return@read null
        if (inp.readLong() != sourceAt) return@read null
        val epgUrl = readStr(inp)
        val order = if (ver >= 2) {
            val g = inp.readInt()
            if (g < 0 || g > MAX_ITEMS) return@read null
            ArrayList<String>(minOf(g, 1024)).also { list -> repeat(g) { list.add(readStr(inp)) } }
        } else {
            emptyList()
        }
        val n = inp.readInt()
        if (n < 0 || n > MAX_ITEMS) return@read null
        val kinds = Channel.Kind.values()
        val list = ArrayList<Channel>(minOf(n, 4096))
        repeat(n) {
            val name = readStr(inp)
            val url = readStr(inp)
            val tvgId = readStr(inp)
            val tvgName = readStr(inp)
            val logo = readStr(inp)
            val group = readStr(inp)
            val kind = kinds.getOrElse(inp.readUnsignedByte()) { Channel.Kind.LIVE }
            val catchup = readStr(inp)
            val catchupDays = readStr(inp)
            val userAgent = readStr(inp)
            list.add(
                Channel(
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
            )
        }
        Channels(epgUrl, list, order)
    }

    // ---- dagskrá -----------------------------------------------------------

    fun writeEpg(f: File, e: Epg) {
        writeAtomically(f) { out ->
            out.writeInt(EPG_MAGIC)
            out.writeByte(VERSION)
            out.writeLong(e.sourceAt)
            out.writeLong(e.from)
            out.writeLong(e.to)
            out.writeLong(e.sig)
            out.writeInt(e.programmes.size)
            for ((id, list) in e.programmes) {
                writeStr(out, id)
                out.writeInt(list.size)
                for (p in list) {
                    out.writeLong(p.start)
                    out.writeLong(p.stop)
                    writeStr(out, p.title)
                    writeStr(out, p.desc)
                }
            }
            writeMap(out, e.nameToId)
            writeMap(out, e.nameToIdLoose)
        }
    }

    /** Skilar skyndimyndinni ef hún passar við skrána, rásalistann og gluggann. */
    fun readEpg(f: File, sourceAt: Long, sig: Long, now: Long): Epg? {
        val e = read(f) { inp ->
            if (inp.readInt() != EPG_MAGIC) return@read null
            if (inp.readUnsignedByte() != VERSION) return@read null
            val at = inp.readLong()
            val from = inp.readLong()
            val to = inp.readLong()
            val s = inp.readLong()
            val n = inp.readInt()
            if (n < 0 || n > MAX_ITEMS) return@read null
            val progs = HashMap<String, List<Programme>>(n * 2)
            repeat(n) {
                val id = readStr(inp)
                val m = inp.readInt()
                if (m < 0 || m > MAX_ITEMS) throw IOException(tr("too many episodes", "of margir þættir"))
                val list = ArrayList<Programme>(m)
                repeat(m) {
                    val start = inp.readLong()
                    val stop = inp.readLong()
                    val title = readStr(inp)
                    val desc = readStr(inp)
                    list.add(Programme(start, stop, title, desc))
                }
                progs[id] = list
            }
            Epg(at, from, to, s, progs, readMap(inp), readMap(inp))
        } ?: return null
        if (e.sourceAt != sourceAt || e.sig != sig) return null
        if (e.programmes.isEmpty()) return null
        // Glugginn sem var þáttaður þarf enn að ná vel yfir núið.
        if (now < e.from || now > e.to - EPG_MIN_LEFT_MS) return null
        return e
    }

    private fun writeMap(out: DataOutputStream, m: Map<String, String>) {
        out.writeInt(m.size)
        for ((k, v) in m) {
            writeStr(out, k)
            writeStr(out, v)
        }
    }

    private fun readMap(inp: DataInputStream): Map<String, String> {
        val n = inp.readInt()
        if (n < 0 || n > MAX_ITEMS) throw IOException(tr("table too large", "of stór tafla"))
        val m = HashMap<String, String>(n * 2)
        repeat(n) { m[readStr(inp)] = readStr(inp) }
        return m
    }

    // ---- sameiginlegt ------------------------------------------------------

    private fun writeStr(out: DataOutputStream, s: String) {
        val b = s.toByteArray(Charsets.UTF_8)
        out.writeInt(b.size)
        out.write(b)
    }

    private fun readStr(inp: DataInputStream): String {
        val n = inp.readInt()
        if (n < 0 || n > MAX_STR) throw IOException(tr("string too long", "of langur strengur"))
        val b = ByteArray(n)
        inp.readFully(b)
        return String(b, Charsets.UTF_8)
    }

    private fun <T> read(f: File, body: (DataInputStream) -> T?): T? {
        if (!f.isFile) return null
        return try {
            DataInputStream(BufferedInputStream(f.inputStream(), 64 * 1024)).use(body)
        } catch (e: Exception) {
            null
        } catch (e: OutOfMemoryError) {
            null
        }
    }

    private fun writeAtomically(f: File, body: (DataOutputStream) -> Unit) {
        try {
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            try {
                DataOutputStream(BufferedOutputStream(tmp.outputStream(), 64 * 1024)).use(body)
            } catch (e: Exception) {
                tmp.delete()
                return
            }
            if (!tmp.renameTo(f)) {
                f.delete()
                if (!tmp.renameTo(f)) tmp.delete()
            }
        } catch (e: Exception) {
            // Skyndimynd er aukaatriði; mistakist hún er bara þáttað á ný.
        }
    }
}
