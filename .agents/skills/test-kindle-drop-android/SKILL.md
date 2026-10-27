---
name: test-kindle-drop-android
description: Install and drive kindle-drop's Android dev client on an emulator or device, then capture screenshots as evidence. Use for verifying a user-visible change on a real Android surface.
---

# Test kindle-drop on Android

Ask before driving a device unless the task already authorizes it. Only touch the `com.listlessbird.kindledrop.dev` package.

## Get a device

If T3 Code's device tools are available, call `device_list`, then `device_open` with the chosen host and device, and use the returned command and target arguments for every operation.

Otherwise use `adb` directly. `adb devices` lists what is connected. To boot an emulator without touching its saved state, run this in the background and keep the PID it prints:

```bash
~/Android/Sdk/emulator/emulator -avd <name> -no-window -no-audio -no-snapshot-save & echo $!
```

Wait until `adb shell getprop sys.boot_completed` prints `1`.

If neither works, report the blocker and stop. Do not install another automation system.

## Install the dev client

From the repository root:

```bash
pnpm vp run mobile:install android [serial]
```

It prints one JSON line. `compatible` means the installed client already matches this checkout's native fingerprint. `installed` with `"source":"cache"` took seconds. A first build for a new fingerprint takes 10 to 25 minutes and logs to `~/.cache/kindle-drop/build.log`. On failure it names the next step.

## Run the app

Start Metro from `apps/mobile` in the background and keep its PID:

```bash
pnpm vp run dev:client & echo $!
```

Then forward the port and open the dev client at it:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "kindledrop-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableAutoLaunch=1&disableFab=1"
```

## Drive and capture

- Screenshot: `adb exec-out screencap -p > <file>.png`.
- Tap: `adb shell input tap <x> <y>` in device pixels. Read coordinates from a screenshot or `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml`.
- Text: `adb shell input text '<text>'`. Back: `adb shell input keyevent KEYCODE_BACK`.
- Reload JS: `adb shell input keyevent 82` opens the dev menu.
- Errors: `adb logcat -d | grep -E 'ReactNativeJS|FATAL'` and the Metro output.

Exercise the affected flow, compare light and dark when the change is visual, and save the screenshots that prove it.

## Teardown

Leave the app and Metro running while ril is still iterating. When done, stop only the Metro and emulator PIDs you started, and run `adb reverse --remove tcp:8081`.
