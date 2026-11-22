<img src="apps/mobile/assets/icon-production.png" width="64" height="64" alt="">

# kindle-drop

**Dropcap** sends books (`EPUB`, `AZW3`, `PDF`, `TXT`) and web articles from Android to a jailbroken stock-reader Kindle over Wi-Fi, with lock-screen covers and no Send to Kindle or USB.

`EPUB` files and shared links convert on-device in Rust (`kindling-mobi` + Readability) to KF8 `.azw3` (`EBOK`) plus their cover thumbnail, upload to a private Cloudflare Worker + R2 mailbox (30-day retention), and land on the Kindle the next time it wakes. The app also shows battery, free storage, and the Kindle's library, and queues deletes and rescans.

## Setup

### 1. Deploy the mailbox

Needs a Cloudflare account (Workers + R2), Node `>= 24.15`, and `pnpm` 10.

Create `~/.config/kindle-mailbox/secrets.env` with two random tokens:

```env
APP_TOKEN=<32-byte-random-token>
KINDLE_TOKEN=<32-byte-random-token>
```

Deploy the Worker and R2 bucket (`kindle-mailbox`):

```bash
pnpm install
pnpm vp run --filter @kindle-drop/worker deploy
```

### 2. Set up the Kindle

Needs a jailbroken Kindle on stock firmware (tested on PW3, FW `5.16.2.1.1`) with SSH or USB access.

Copy [`kindle/dropcap/`](kindle/dropcap) to `/mnt/us/extensions/dropcap/`, then write two config files next to `dropcap.sh`:

- `mailbox.url`: `https://<your-worker>.workers.dev`
- `mailbox.token`: the `KINDLE_TOKEN` from step 1

Enable boot persistence and start it over SSH, or from KUAL → Dropcap:

```sh
chmod +x /mnt/us/extensions/dropcap/dropcap.sh
/mnt/us/extensions/dropcap/dropcap.sh install-boot
/mnt/us/extensions/dropcap/dropcap.sh start
```

On every wake (`lipc-wait-event com.lab126.powerd outOfScreenSaver,wakeupFromSuspend`), the script pulls queued items, installs `thumbnail_*_portrait.jpg` covers into `/mnt/us/system/thumbnails/` (keeping copies in `/mnt/us/amazon-cover-bug/` to guard against Amazon placeholders), moves books into `/mnt/us/documents/`, rescans the library, runs queued commands, reports status from `/var/local/cc.db`, and uploads its log. See [`apps/worker/src/Api.ts`](apps/worker/src/Api.ts) for the wire contract.

For SSH and Taildrop, put the static `arm` Tailscale binaries (`tailscale`, `tailscaled`) in `/mnt/us/extensions/dropcap/tailscale/` and tap KUAL → Dropcap → Start Tailscale once to log in; the boot job keeps it running. KUAL → Dropcap also has Wi-Fi join and diagnostics. With SSH working, `kindle/kd` reads the Kindle's status and log from the Worker, opens a shell, and deploys changes.

### 3. Install and pair the Android app

Download the latest `dropcap-*.apk` from [Releases](https://github.com/listlessbird/kindle-drop/releases) (or build with `pnpm vp run --filter @kindle-drop/mobile eas:android:prod`).

Print a pairing QR code on your computer and scan it in Dropcap:

```bash
pnpm vp run --filter @kindle-drop/worker pair --server https://<your-worker>.workers.dev
```

## Development

JS-only changes and CI need Node `>= 24.15` and `pnpm` 10 (UniFFI bindings are committed). Native Android builds and Rust edits also need `ANDROID_HOME`, `cargo`, `cargo-ndk`, and the `aarch64-linux-android` + `x86_64-linux-android` targets.

```bash
# Local Worker
APP_TOKEN=dev-app KINDLE_TOKEN=dev-kindle pnpm vp run --filter @kindle-drop/worker dev

# Android dev client (fingerprint-cached APK) + Metro
pnpm vp run mobile:install android
pnpm vp run --filter @kindle-drop/mobile dev:client

# Pair dev client on an emulator
pnpm vp run --filter @kindle-drop/worker pair --server http://10.0.2.2:1337 --key dev-app --scheme kindledrop-dev

# Format, lint, typecheck, and affected tests
pnpm vp run check:changed
```

Regenerate bindings after changing `apps/mobile/modules/kindle-core/rust` (from `apps/mobile/modules/kindle-core`):

```bash
cargo build --release --manifest-path rust/Cargo.toml
pnpm exec ubrn generate all --config ubrn.config.yaml rust/target/release/libkindle_core.so
```
