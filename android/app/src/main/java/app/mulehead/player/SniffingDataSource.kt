package app.mulehead.player

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import app.mulehead.sync.TsSniffer

/**
 * Heldur utan um [TsSniffer] þeirrar tengingar sem er í gangi hverju sinni.
 *
 * Spilarinn spyr hana um grunn straumsins (upphafs-PTS) og reiknar „algeran“ straumtíma
 * sem grunnur + staða — sama tala og Mac sendir í herbergið. Hver ný tenging (t.d. eftir
 * endurtengingu) fær nýjan sniffara; grunnurinn helst þó sá sami þar til nýr finnst, svo
 * klukkan hoppar ekki til milli tegunda („pts“ ↔ „clock“) í miðri spilun.
 */
class SniffHolder {
    private val lock = Any()
    private var current: TsSniffer? = null
    private var lastBase: Double? = null

    fun begin(sniffer: TsSniffer) {
        synchronized(lock) { current = sniffer }
    }

    fun base(): Double? = synchronized(lock) {
        val b = current?.base()
        if (b != null) lastBase = b
        lastBase
    }

    fun reset() = synchronized(lock) {
        current = null
        lastBase = null
    }
}

/**
 * [DataSource] sem lætur [TsSniffer] sjá bætin sem fara í gegn. Sama hugmynd og
 * `fetch`-patchið í Mac (renderer/player.js): við hlerum niðurhal en breytum engu.
 */
class SniffingDataSource(
    private val inner: DataSource,
    private val holder: SniffHolder,
    private val sniff: Boolean
) : DataSource {

    private var sniffer: TsSniffer? = null

    override fun open(dataSpec: DataSpec): Long {
        val size = inner.open(dataSpec)
        if (sniff) {
            val s = TsSniffer()
            sniffer = s
            holder.begin(s)
        }
        return size
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val n = inner.read(buffer, offset, length)
        val s = sniffer
        if (n > 0 && s != null) {
            runCatching {
                if (offset == 0) s.push(buffer, n)
                else s.push(buffer.copyOfRange(offset, offset + n))
            }
        }
        return n
    }

    override fun getUri(): Uri? = inner.uri

    override fun close() {
        inner.close()
    }

    override fun addTransferListener(transferListener: TransferListener) {
        inner.addTransferListener(transferListener)
    }
}

/** Verksmiðja sem setur [SniffingDataSource] utan um hverja tengingu. */
class SniffingDataSourceFactory(
    private val inner: DataSource.Factory,
    private val holder: SniffHolder,
    private val sniff: Boolean
) : DataSource.Factory {
    override fun createDataSource(): DataSource =
        SniffingDataSource(inner.createDataSource(), holder, sniff)
}
