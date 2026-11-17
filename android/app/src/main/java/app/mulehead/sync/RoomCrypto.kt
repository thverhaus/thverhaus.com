package app.mulehead.sync

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Dulkóðun herbergja (v2), nákvæmlega eins og í Mac (renderer/sync.js):
 * PBKDF2-HMAC-SHA256(herbergiskóði, "mulehead-room-v2", 100.000 umferðir) → 48 bæti;
 * fyrstu 32 eru AES-GCM lykill, næstu 16 (hex) eru nafn rásarinnar á þjóninum.
 * Skilaboð eru „base64(iv).base64(dulmál+merki)“. Þjónninn sér hvorki kóðann né innihaldið.
 */
class RoomCrypto private constructor(private val key: SecretKeySpec, val topic: String) {

    fun seal(text: String, iv: ByteArray = ByteArray(12).also { rnd.nextBytes(it) }): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val ct = c.doFinal(text.toByteArray(Charsets.UTF_8))
        return b64.encodeToString(iv) + "." + b64.encodeToString(ct)
    }

    /** null ef skilaboðin eru ekki frá einhverjum með sama kóða (eða eru skemmd). */
    fun open(text: String): String? = runCatching {
        val dot = text.indexOf('.')
        val iv = unb64.decode(text.substring(0, dot))
        val ct = unb64.decode(text.substring(dot + 1))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        String(c.doFinal(ct), Charsets.UTF_8)
    }.getOrNull()

    companion object {
        private const val SALT = "mulehead-room-v2"
        private const val ITER = 100_000
        private val rnd = SecureRandom()
        private val b64 = Base64.getEncoder()
        private val unb64 = Base64.getDecoder()

        /** Hægt (PBKDF2): kallað á bakgrunnsþræði, einu sinni á hvert herbergi. */
        fun forRoom(code: String): RoomCrypto {
            val spec = PBEKeySpec(code.toCharArray(), SALT.toByteArray(Charsets.UTF_8), ITER, 384)
            val bits = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            val topic = "mulehead/v2/r/" + bits.copyOfRange(32, 48).joinToString("") { "%02x".format(it) }
            return RoomCrypto(SecretKeySpec(bits.copyOfRange(0, 32), "AES"), topic)
        }
    }
}
