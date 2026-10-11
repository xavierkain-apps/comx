package com.soarxvoice.wear

import com.soarxvoice.watchshared.WatchLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The shared Data Layer codec, compiled into both :app and :wear. */
class WatchLinkTest {
    @Test fun clipPathRoundTripsMetadata() {
        val meta = """{"v":1,"kind":"clip","uid":12345,"from":"Carlos, José & Ana/2","durationMs":4200}"""
        val path = WatchLink.clipPath(WatchLink.CLIP_DOWN, "ab12cd34", meta)
        // Metadata may contain '/', but the encoded path must keep exactly 3 segments after the prefix.
        assertEquals(1, path.removePrefix(WatchLink.CLIP_DOWN).count { it == '/' })
        val parsed = WatchLink.parseClipPath(path)!!
        assertEquals(WatchLink.CLIP_DOWN, parsed.prefix)
        assertEquals("ab12cd34", parsed.transferId)
        assertEquals(meta, parsed.metaJson)
    }

    @Test fun upAndDownPrefixesDoNotOverlap() {
        val up = WatchLink.clipPath(WatchLink.CLIP_UP, "x", "{}")
        assertEquals(WatchLink.CLIP_UP, WatchLink.parseClipPath(up)!!.prefix)
        val down = WatchLink.clipPath(WatchLink.CLIP_DOWN, "x", "{}")
        assertEquals(WatchLink.CLIP_DOWN, WatchLink.parseClipPath(down)!!.prefix)
    }

    @Test fun rejectsForeignPaths() {
        assertNull(WatchLink.parseClipPath("/soarx/state"))
        assertNull(WatchLink.parseClipPath("/soarx/clip/"))
        assertNull(WatchLink.parseClipPath("/soarx/clip//{}"))
    }
}
