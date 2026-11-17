package app.mulehead

import app.mulehead.sync.RoomCrypto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomCryptoTest {
    // Sömu gildi og Mac-útgáfan (renderer/sync.js) reiknar: annars hittast öppin ekki.
    private val mac = "AAECAwQFBgcICQoL.2TCUvlcoOYZhoI0IHn9W0IO0AP/X/QgVB0E+xEbth/Z9gdMdFRCS"

    @Test fun sameTopicAsMac() {
        assertEquals("mulehead/v2/r/396c71d3e0d69d691fce8a73741eadca", RoomCrypto.forRoom("MY669A").topic)
    }

    @Test fun sameCiphertextAsMac() {
        val iv = ByteArray(12) { it.toByte() }
        assertEquals(mac, RoomCrypto.forRoom("MY669A").seal("{\"id\":\"x\",\"n\":\"Júlli\"}", iv))
    }

    @Test fun opensMacMessage() {
        assertEquals("{\"id\":\"x\",\"n\":\"Júlli\"}", RoomCrypto.forRoom("MY669A").open(mac))
    }

    @Test fun otherRoomCannotRead() {
        assertNull(RoomCrypto.forRoom("ABCDEF").open(mac))
        assertNull(RoomCrypto.forRoom("MY669A").open("rusl"))
    }
}
