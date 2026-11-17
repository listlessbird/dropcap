package com.listlessbird.kindledrop.sharesheet

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * Receives one shared file and renders the JS `share` root over the app that shared it. It runs in
 * the sender's task, so finishing it returns there. It skips Expo's ReactActivityDelegateWrapper on
 * purpose: the dev launcher would adopt it as the app's main activity.
 */
class ShareActivity : ReactActivity() {
  override fun getMainComponentName() = "share"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName) {
      override fun getLaunchOptions() = sharedFile(intent)
    }

  // `uri`, `mimeType`, `name` and `bytes`, each only when the sender provides it.
  private fun sharedFile(intent: Intent): Bundle {
    val props = Bundle()
    val uri = streamOf(intent) ?: return props

    props.putString("uri", uri.toString())
    (intent.type ?: contentResolver.getType(uri))?.let { props.putString("mimeType", it) }

    runCatching {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { row ->
        if (!row.moveToFirst()) return@use
        row.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 && !row.isNull(it) }
          ?.let { props.putString("name", row.getString(it)) }
        row.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !row.isNull(it) }
          ?.let { props.putDouble("bytes", row.getLong(it).toDouble()) }
      }
    }

    return props
  }

  private fun streamOf(intent: Intent): Uri? {
    val stream = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

    return stream ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri
  }
}
