package app.mulehead

import app.mulehead.player.StreamKind
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamKindTest {

    @Test
    fun `flokkun straums er sama og í Mac`() {
        // Sama regla og streamType() í renderer/player.js.
        assertEquals(StreamKind.Ts, StreamKind.of("http://h:8098/live/u/p/1.ts"))
        assertEquals(StreamKind.Ts, StreamKind.of("http://h:8098/live/u/p/1234"))
        assertEquals(StreamKind.Ts, StreamKind.of("http://h:8098/live/u/p/1.ts?token=abc"))
        assertEquals(StreamKind.Hls, StreamKind.of("http://h:8098/live/u/p/1.m3u8"))
        assertEquals(StreamKind.Hls, StreamKind.of("http://h:8098/hls/1/index.html?x=1"))
        assertEquals(StreamKind.Native, StreamKind.of("http://h/film/movie.mp4?token=abc"))
        assertEquals(StreamKind.Native, StreamKind.of("http://h/film/MOVIE.MKV"))
    }
}
