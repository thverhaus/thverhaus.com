package app.mulehead

import app.mulehead.sync.Command
import app.mulehead.sync.PeerView
import app.mulehead.sync.Status
import app.mulehead.sync.SyncEvent
import app.mulehead.sync.SyncRoom
import app.mulehead.sync.TsSniffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncRoomTest {

    private val now = 1_700_000_000_000L

    private fun me(t: Double = 100.0, playing: Boolean = true) = Status(
        id = "me",
        name = "Júlli",
        channel = "Stöð 2",
        key = "stod2",
        cat = 0,
        kind = "clock",
        t = t,
        w = now,
        playing = playing
    )

    private fun peer(t: Double = 100.0, playing: Boolean = true, id: String = "p1") = Status(
        id = id,
        name = "Anna",
        channel = "Stöð 2",
        key = "stod2",
        cat = 0,
        kind = "clock",
        t = t,
        w = now,
        playing = playing
    )

    @Test
    fun `staða fer í JSON og aftur`() {
        val s = Status(
            id = "abc",
            name = "Júlli \"Kalli\"",
            channel = "Stöð 2",
            key = "stod2",
            cat = 1_700_000_000_123L,
            kind = "clock",
            t = 1234.5,
            w = 1_700_000_000_999L,
            playing = true,
            bank = 1_700_000_060_000L,
            bm = 60
        )
        assertEquals(s, Status.parse(s.toJson()))
    }

    @Test
    fun `bye-skilað ber aðeins id`() {
        val json = Status(id = "abc", bye = true).toJson()
        assertEquals("""{"id":"abc","bye":true}""", json)
        assertTrue(Status.parse(json)!!.bye)
    }

    @Test
    fun `rusl er hafnað`() {
        assertNull(Status.parse(""))
        assertNull(Status.parse("[]"))
        assertNull(Status.parse("""{"n":"enginn id"}"""))
        assertNotNull(Status.parse("""{"id":"x"}"""))
    }

    @Test
    fun `lykill rásar er sá sami og í Mac`() {
        // Sömu svör og Mac-útgáfan gefur (renderer/app.js: splitName → sortKey → normWords).
        // Lykillinn þarf að vera nákvæmlega sá sami, annars þekkja tækin ekki sömu rás.
        assertEquals("sto 2", SyncRoom.channelKey("Stöð 2"))
        assertEquals("sto 2", SyncRoom.channelKey("Stöð 2 HD"))
        assertEquals("sto 2", SyncRoom.channelKey("Stöð 2 (B)"))
        assertEquals("jo", SyncRoom.channelKey("Þjóð"))
        assertEquals("", SyncRoom.channelKey("Æ"))
        assertEquals("", SyncRoom.channelKey(""))
        assertEquals("ruv 2", SyncRoom.channelKey("RÚV-2"))
        assertEquals("ruv", SyncRoom.channelKey("RÚV [HD]"))
        assertEquals("sky sport", SyncRoom.channelKey("UK: Sky Sports HD"))
        assertEquals("island 24", SyncRoom.channelKey("Ísland 24 HD B"))
        // Sama rás á tvo vegu passar saman.
        assertEquals(SyncRoom.channelKey("Stöð 2"), SyncRoom.channelKey("STÖÐ 2 Hd"))
    }

    @Test
    fun `PTS-hringur er leiðréttur`() {
        val room = SyncRoom()
        room.enter("kvold")
        val wrap = TsSniffer.PTS_WRAP
        // Ég er rétt fyrir hringinn, gesturinn rétt eftir: munurinn er 2 sek, ekki 95.441.
        room.onMessage(peer(t = 1.0).copy(kind = "pts"), now)
        val v = room.views(me(t = wrap - 1.0).copy(kind = "pts"), now).first()
        assertEquals(-2.0, v.diff!!, 0.01)
        assertFalse(v.mismatch)
    }

    @Test
    fun `gestur í pásu dregur mig ekki til baka`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 90.0, playing = false), now)
        assertEquals(Command.Free, room.decision(me(), now).command)
    }

    @Test
    fun `kóði herbergis er fimm stafir`() {
        val code = SyncRoom.newCode()
        assertEquals(6, code.length)
        assertTrue(code.all { it.isLetterOrDigit() })
        assertFalse(code.contains('O'))       // ruglast við núll
        assertFalse(code.contains('I'))       // ruglast við einn
    }

    @Test
    fun `texti fyrir notandann`() {
        assertEquals("✅ Í takt", SyncRoom.diffText(0.1))
        assertEquals("Þú ert 1,4 sek á undan", SyncRoom.diffText(1.4))
        assertEquals("Þú ert 1,4 sek á eftir", SyncRoom.diffText(-1.4))
        assertEquals("2,0", SyncRoom.oneDecimal(2.0))
    }


    @Test
    fun `gestir sjást með mun og rás`() {
        val room = SyncRoom()
        room.enter("kvold")
        assertEquals("KVOLD", room.room)
        room.onMessage(peer(t = 97.5), now)
        val views = room.views(me(), now)
        assertEquals(1, views.size)
        val v = views.first()
        assertEquals("Anna", v.name)
        assertTrue(v.sameChannel)
        assertFalse(v.mismatch)
        assertEquals(2.5, v.diff!!, 0.001)
        assertFalse(v.inSync)
    }

    @Test
    fun `gestur sem er hættur hverfur eftir sex sekúndur`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(), now)
        assertEquals(1, room.peerCount)
        room.prune(now + 5_000)
        assertEquals(1, room.peerCount)
        room.prune(now + SyncRoom.PEER_TIMEOUT + 1)
        assertEquals(0, room.peerCount)
    }

    @Test
    fun `bye fjarlægir gestinn strax`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(), now)
        room.onMessage(Status(id = "p1", bye = true), now)
        assertEquals(0, room.peerCount)
    }

    @Test
    fun `ég fylgi nýrri rás en ekki þeirri sem ég er þegar á`() {
        val room = SyncRoom()
        room.enter("kvold")
        val follow = peer().copy(cat = now, channel = "RÚV", key = "ruv")
        val events = room.onMessage(follow, now)
        assertEquals(1, events.size)
        val ev = events.first() as SyncEvent.FollowChannel
        assertEquals("ruv", ev.key)
        assertEquals("RÚV", ev.name)
        assertEquals("Anna", ev.by)

        // Sama boð kemur ekki aftur næstu sekúndu.
        assertTrue(room.onMessage(follow, now + 1_000).isEmpty())

        // Ef ég er þegar á rásinni þarf ég ekki að fylgja.
        room.myKey = "ruv2"
        val onRuv = follow.copy(cat = now + 60_000, channel = "RÚV 2", key = "ruv2")
        assertTrue(room.onMessage(onRuv, now + 60_000).isEmpty())
    }

    @Test
    fun `annað afbrigði sömu rásar er líka fylgt`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.myKey = "sky sport f1"
        room.myVariant = "FHD P50"
        val main = peer().copy(cat = now, channel = "UK: Sky Sport F1", key = "sky sport f1", variant = "Main")
        val ev = room.onMessage(main, now).single() as SyncEvent.FollowChannel
        assertEquals("Main", ev.variant)

        // Þegar ég er kominn á sama afbrigði gerist ekkert meira.
        room.myVariant = "Main"
        assertTrue(room.onMessage(main.copy(cat = now + 60_000), now + 60_000).isEmpty())
    }

    @Test
    fun `eldri útgáfa án afbrigðis truflar ekki`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.myKey = "sky sport f1"
        room.myVariant = "HD"
        val old = peer().copy(cat = now, channel = "UK: Sky Sport F1", key = "sky sport f1", variant = "")
        assertTrue(room.onMessage(old, now).isEmpty())
    }

    @Test
    fun `afbrigði fer í og úr JSON`() {
        val s = peer().copy(variant = "FHD P50")
        assertTrue(s.toJson().contains("\"cv\":\"FHD P50\""))
        assertEquals("FHD P50", Status.parse(s.toJson())!!.variant)
        assertTrue(!peer().toJson().contains("\"cv\""))
    }

    @Test
    fun `buffer-hleðsla gesta er boðuð`() {
        val room = SyncRoom()
        room.enter("kvold")
        val events = room.onMessage(peer().copy(bank = now + 30_000, bm = 60), now)
        assertEquals(1, events.size)
        val ev = events.first() as SyncEvent.PeerBank
        assertEquals(60, ev.mark)
        assertEquals(30, ev.sec)
        assertEquals(now + 30_000, room.bankUntil)
        assertEquals(60, room.bankMark)
        // Sama hleðsla kemur ekki tvisvar.
        assertTrue(room.onMessage(peer().copy(bank = now + 30_000, bm = 60), now).isEmpty())
    }


    @Test
    fun `sá sem er á undan hægir á sér`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 94.0), now)
        val hold = room.decision(me(), now).command as Command.Hold
        assertEquals(6.0 - 0.05, hold.sec, 0.001)
    }

    @Test
    fun `lítill munur hægir aðeins á og enginn munur er frjáls`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 99.5), now)
        assertEquals(Command.Rate(0.92f), room.decision(me(), now).command)

        room.onMessage(Status(id = "p1", bye = true), now)
        room.onMessage(peer(t = 99.95, id = "p2"), now)
        assertEquals(Command.Rate(1f), room.decision(me(), now).command)

        room.onMessage(Status(id = "p2", bye = true), now)
        assertEquals(Command.Free, room.decision(me(), now).command)
    }

    @Test
    fun `ekki stýrt meðan ég er á pásu eða í bið`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 90.0), now)
        assertEquals(Command.Free, room.decision(me(playing = false), now).command)

        room.cooldownUntil = now + 5_000
        assertEquals(Command.Rate(1f), room.decision(me(), now).command)

        room.auto = false
        assertEquals(Command.Free, room.decision(me(), now).command)
    }

    @Test
    fun `of mikill munur er ekki skekkja heldur annar tími`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 100.0 - SyncRoom.MISMATCH_SEC - 10), now)
        assertEquals(Command.Free, room.decision(me(), now).command)
        assertTrue(room.views(me(), now).first().mismatch)
    }

    @Test
    fun `önnur rás eða önnur tegund er ekki borin saman`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(t = 90.0).copy(key = "ruv", channel = "RÚV"), now)
        val v: PeerView = room.views(me(), now).first()
        assertFalse(v.sameChannel)
        assertNull(v.diff)
        assertEquals(Command.Free, room.decision(me(), now).command)

        room.onMessage(peer(t = 100.0, id = "p2").copy(kind = "pos"), now)
        val v2 = room.views(me(), now).first { it.id == "p2" }
        assertTrue(v2.otherKind)
        assertNull(v2.diff)
    }

    @Test
    fun `nýtt herbergi hreinsar allt`() {
        val room = SyncRoom()
        room.enter("kvold")
        room.onMessage(peer(), now)
        room.myKey = "stod2"
        room.enter("anna")
        assertEquals("ANNA", room.room)
        assertEquals(0, room.peerCount)
        assertEquals("", room.myKey)
        room.clear()
        assertEquals("", room.room)
    }
}
