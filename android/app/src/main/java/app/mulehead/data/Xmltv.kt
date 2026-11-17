package app.mulehead.data

// Eitt atriði í dagskránni.
data class Programme(
    val start: Long,
    val stop: Long,
    val title: String,
    val desc: String
)

// Útkoma úr dagskrárlestri: dagskrá eftir xmltv-id + nafnatöflur (strangar og lausar).
data class XmltvResult(
    val programmes: Map<String, List<Programme>>,
    val nameToId: Map<String, String>,
    val nameToIdLoose: Map<String, String>
)
