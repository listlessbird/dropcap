package com.listlessbird.kindledrop.sharesheet

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ShareSheetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareSheet")

    // Closes the share sheet, which returns to the app that shared.
    AsyncFunction("finish") {
      (appContext.currentActivity as? ShareActivity)?.finish()
    }.runOnQueue(Queues.MAIN)
  }
}
