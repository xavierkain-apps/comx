package com.soarxvoice.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

object Palette {
    val Talk = Color(0xFF1E88E5)
    val Recording = Color(0xFFE53935)
    val Sos = Color(0xFFD50000)
    val Speaking = Color(0xFF43A047)
    val Stale = Color(0xFF757575)
    val Text = Color.White
}

/**
 * Arrow pointing [angle] degrees clockwise from 12 o'clock; a hollow circle
 * when the direction is unknown.
 */
@Composable
fun Arrow(angle: Double?, color: Color, size: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        if (angle == null) {
            drawCircle(color, radius = w * 0.25f, style = Stroke(width = w * 0.08f))
            return@Canvas
        }
        rotate(angle.toFloat(), pivot = Offset(w / 2, h / 2)) {
            val p = Path().apply {
                moveTo(w * 0.5f, h * 0.04f)       // tip
                lineTo(w * 0.86f, h * 0.92f)      // right wing
                lineTo(w * 0.5f, h * 0.70f)       // notch
                lineTo(w * 0.14f, h * 0.92f)      // left wing
                close()
            }
            drawPath(p, color)
        }
    }
}
