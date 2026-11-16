package com.radiflow.player

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

/** RadiFlow's Android front end (Jetpack Compose); NetEase runs in the embedded Node service. */
class ComposeActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent { RadiFlowTheme { RadiFlowApp(model) } }
    }

    override fun onStart() {
        super.onStart()
        model.onForeground(true)
    }

    override fun onStop() {
        model.onForeground(false)
        super.onStop()
    }
}
