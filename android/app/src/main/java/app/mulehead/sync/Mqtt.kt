package app.mulehead.sync

import app.mulehead.tr

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Lítill MQTT 3.1.1 biðlari — aðeins það sem „Horfa saman“ þarf (QoS 0, áskrift á einu
 * þema, ping). Engin viðbót er sett inn; sama hugsun og í Json.kt og M3uParser.kt.
 *
 * Skilaboðin sjálf eru JSON (sjá SyncRoom.kt) og ferðast um ókeypis almennan þjón
 * (broker.hivemq.com) eins og í Mac-útgáfunni.
 */
object MqttPackets {

    // Hversu stór pakki má vera áður en honum er hafnað (vernd gegn rusli).
    private const val MAX_BODY = 1 shl 20

    fun packet(type: Int, body: ByteArray): ByteArray {
        val head = ByteArrayBuilder()
        head.byte(type)
        head.bytes(remainingLength(body.size))
        head.bytes(body)
        return head.build()
    }

    // Lengd pakkans í MQTT-formi (7 bit í einu, hæsta bit = „meira kemur“).
    fun remainingLength(n: Int): ByteArray {
        var v = n
        val out = ByteArrayBuilder()
        do {
            var b = v % 128
            v /= 128
            if (v > 0) b = b or 0x80
            out.byte(b)
        } while (v > 0)
        return out.build()
    }

    // Strengur með 2 bæta lengd fyrir framan (MQTT-venja).
    fun text(s: String): ByteArray {
        val raw = s.toByteArray(Charsets.UTF_8)
        require(raw.size < 65536) { tr("string too long", "strengur of langur") }
        return ByteArrayBuilder().apply {
            byte((raw.size shr 8) and 0xFF)
            byte(raw.size and 0xFF)
            bytes(raw)
        }.build()
    }

    // CONNECT: clean session, keepalive í sekúndum, aðeins client-id.
    fun connect(clientId: String, keepAliveSec: Int = 30): ByteArray {
        val body = ByteArrayBuilder().apply {
            bytes(text("MQTT"))
            byte(4)                              // protocol level 3.1.1
            byte(0x02)                           // clean session
            byte((keepAliveSec shr 8) and 0xFF)
            byte(keepAliveSec and 0xFF)
            bytes(text(clientId))
        }.build()
        return packet(0x10, body)
    }

    // SUBSCRIBE með QoS 0.
    fun subscribe(topic: String, id: Int): ByteArray {
        val body = ByteArrayBuilder().apply {
            byte((id shr 8) and 0xFF)
            byte(id and 0xFF)
            bytes(text(topic))
            byte(0)                              // QoS 0
        }.build()
        return packet(0x82, body)
    }

    // PUBLISH (QoS 0, ekki „retain“).
    fun publish(topic: String, payload: ByteArray): ByteArray {
        val body = ByteArrayBuilder().apply {
            bytes(text(topic))
            bytes(payload)
        }.build()
        return packet(0x30, body)
    }

    fun ping(): ByteArray = byteArrayOf(0xC0.toByte(), 0)

    fun disconnect(): ByteArray = byteArrayOf(0xE0.toByte(), 0)

    /**
     * Les einn pakka úr straumi: (tegund, innihald) eða null ef sambandið er búið.
     * Tegundin er fyrsti bætið óbreyttur (t.d. 0x30 fyrir PUBLISH).
     */
    fun readPacket(input: InputStream): Pair<Int, ByteArray>? {
        val first = input.read()
        if (first < 0) return null
        var mult = 1
        var len = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            len += (b and 0x7F) * mult
            if (len > MAX_BODY) throw IOException(tr("packet too large", "of stór pakki"))
            if (b and 0x80 == 0) break
            mult *= 128
            if (mult > 1 shl 21) throw IOException(tr("invalid length", "ógild lengd"))
        }
        val body = ByteArray(len)
        var off = 0
        while (off < len) {
            val n = input.read(body, off, len - off)
            if (n < 0) return null
            off += n
        }
        return (first and 0xFF) to body
    }

    // Úr innihaldi PUBLISH-pakka: þema og efni.
    fun parsePublish(body: ByteArray): Pair<String, ByteArray>? {
        if (body.size < 2) return null
        val n = ((body[0].toInt() and 0xFF) shl 8) or (body[1].toInt() and 0xFF)
        if (body.size < 2 + n) return null
        val topic = String(body, 2, n, Charsets.UTF_8)
        val payload = if (body.size > 2 + n) body.copyOfRange(2 + n, body.size) else ByteArray(0)
        return topic to payload
    }

    // Lítill smiður fyrir bæti (Kotlin á ekki ótölvulegan ByteArrayBuilder).
    private class ByteArrayBuilder {
        private var buf = ByteArray(64)
        private var size = 0

        fun byte(b: Int) {
            if (size == buf.size) buf = buf.copyOf(buf.size * 2)
            buf[size++] = b.toByte()
        }

        fun bytes(b: ByteArray) {
            while (size + b.size > buf.size) buf = buf.copyOf(buf.size * 2)
            b.copyInto(buf, size)
            size += b.size
        }

        fun build(): ByteArray = buf.copyOf(size)
    }
}


/**
 * MQTT-samband sem heldur sér uppi sjálft: tengist, gerir áskrift, les skilaboð og
 * pingar. Ef sambandið dettur út er reynt aftur; annar þjónn er tekinn ef sá fyrri
 * svarar ekki (sama og í Mac-útgáfunni).
 */
// Þjónn: tls = dulkóðuð tenging (TLS, sama og wss í Mac); án TLS aðeins fyrir prófunarþjón.
data class Broker(val host: String, val port: Int, val tls: Boolean)

class MqttClient(
    private val brokers: List<Broker>,
    private val clientId: String,
    // Lykill og þema herbergisins eru reiknuð á þræði biðlarans (PBKDF2 er hægt).
    private val makeCrypto: () -> RoomCrypto,
    private val onState: (Boolean) -> Unit,
    private val onMessage: (String) -> Unit
) {
    @Volatile private var crypto: RoomCrypto? = null
    private val topic: String get() = crypto?.topic.orEmpty()

    @Volatile private var running = true
    @Volatile private var socket: Socket? = null
    private var out: OutputStream? = null
    private val lock = Any()
    private var packetId = 1
    private var brokerIdx = 0
    private var thread: Thread? = null

    fun start() {
        if (thread != null) return
        thread = Thread({ loop() }, "mulehead-mqtt").apply {
            isDaemon = true
            start()
        }
    }

    fun publish(text: String) {
        val c = crypto ?: return
        val sealed = c.seal(text)
        synchronized(lock) {
            val o = out ?: return
            runCatching {
                o.write(MqttPackets.publish(c.topic, sealed.toByteArray(Charsets.UTF_8)))
                o.flush()
            }
        }
    }

    fun close() {
        running = false
        synchronized(lock) {
            runCatching { out?.write(MqttPackets.disconnect()); out?.flush() }
            runCatching { socket?.close() }
            socket = null
            out = null
        }
        onState(false)
    }

    private fun loop() {
        var attempt = 0
        if (crypto == null) crypto = runCatching { makeCrypto() }.getOrNull() ?: return
        while (running) {
            val b = brokers[brokerIdx % brokers.size]
            try {
                session(b)
                attempt = 0
            } catch (_: Exception) {
                // samband datt út — reynum aftur (og þá gjarnan annan þjón)
            }
            onState(false)
            if (!running) break
            attempt++
            if (attempt % 2 == 0) brokerIdx++
            runCatching { Thread.sleep(minOf(10_000L, 1_000L * attempt)) }
        }
    }

    private fun session(b: Broker) {
        val raw = Socket()
        raw.connect(InetSocketAddress(b.host, b.port), 8_000)
        raw.tcpNoDelay = true
        val s: Socket = if (!b.tls) raw else {
            val ssl = (SSLSocketFactory.getDefault() as SSLSocketFactory)
                .createSocket(raw, b.host, b.port, true) as SSLSocket
            // Sannreyna að skírteinið sé fyrir þennan þjón (ekki sjálfgefið á Android).
            ssl.sslParameters = ssl.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
            ssl.soTimeout = 0
            ssl.startHandshake()
            ssl
        }
        val o = s.getOutputStream().buffered()
        val i = s.getInputStream().buffered()
        synchronized(lock) {
            socket = s
            out = o
        }
        o.write(MqttPackets.connect(clientId))
        o.flush()

        // Ping á 20 sekúndna fresti svo þjónninn loki ekki sambandinu.
        val pinger = Thread({
            while (running && socket === s) {
                if (runCatching { Thread.sleep(20_000) }.isFailure) break
                if (!running || socket !== s) break
                runCatching {
                    synchronized(lock) {
                        out?.write(MqttPackets.ping())
                        out?.flush()
                    }
                }
            }
        }, "mulehead-mqtt-ping").apply { isDaemon = true }
        pinger.start()

        try {
            while (running && socket === s) {
                val packet = MqttPackets.readPacket(i) ?: break
                when (packet.first and 0xF0) {
                    0x20 -> {                       // CONNACK
                        if (packet.second.isNotEmpty() && packet.second[0].toInt() != 0) {
                            throw IOException(tr("the server refused the connection", "þjónninn hafnaði sambandi"))
                        }
                        val id = synchronized(lock) { packetId++ }
                        synchronized(lock) {
                            o.write(MqttPackets.subscribe(topic, id))
                            o.flush()
                        }
                        onState(true)
                    }
                    0x30 -> {                       // PUBLISH
                        val msg = MqttPackets.parsePublish(packet.second) ?: continue
                        if (msg.first == topic) {
                            val text = crypto?.open(String(msg.second, Charsets.UTF_8)) ?: continue
                            onMessage(text)
                        }
                    }
                }
            }
        } finally {
            runCatching { s.close() }
            synchronized(lock) {
                if (socket === s) {
                    socket = null
                    out = null
                }
            }
        }
    }
}
