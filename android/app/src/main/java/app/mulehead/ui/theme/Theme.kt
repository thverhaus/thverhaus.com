package app.mulehead.ui.theme

import androidx.compose.runtime.Composable
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

// Appið er alltaf dökkt — IPTV er horft í myrkri.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MuleheadTheme(content: @Composable () -> Unit) {
    val colorScheme = darkColorScheme(
        primary = Accent,
        onPrimary = Ink,
        background = Ink,
        onBackground = Text1,
        surface = Ink2,
        onSurface = Text1,
        error = Bad
    )
    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
