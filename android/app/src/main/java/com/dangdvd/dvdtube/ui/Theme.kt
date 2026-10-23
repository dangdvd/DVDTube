package com.dangdvd.dvdtube.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.AppTheme

val Brand = Color(0xFFFF3D5A)

private val DarkColors = darkColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    secondary = Brand,
    background = Color(0xFF0F0F0F),
    surface = Color(0xFF0F0F0F),
    surfaceVariant = Color(0xFF272727),
    surfaceContainer = Color(0xFF1A1A1A),
    surfaceContainerHigh = Color(0xFF212121),
    surfaceContainerHighest = Color(0xFF2A2A2A),
    onSurfaceVariant = Color(0xFFAAAAAA),
)

private val LightColors = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    secondary = Brand,
    background = Color.White,
    surface = Color.White,
    surfaceVariant = Color(0xFFF2F2F2),
    surfaceContainer = Color(0xFFF7F7F7),
    surfaceContainerHigh = Color(0xFFF0F0F0),
    surfaceContainerHighest = Color(0xFFE8E8E8),
    onSurfaceVariant = Color(0xFF606060),
)

@Composable
fun isDarkTheme(): Boolean = when (AppSettings.theme) {
    AppTheme.SYSTEM -> isSystemInDarkTheme()
    AppTheme.LIGHT -> false
    AppTheme.DARK -> true
}

@Composable
fun DVDTubeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isDarkTheme()) DarkColors else LightColors, content = content)
}
