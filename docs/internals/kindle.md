# The Kindle

The Kindle is the user's daily reader: a Paperwhite 3 (armv7, BusyBox 1.34 ash, 512MB RAM) jailbroken on firmware 5.16.2.1.1 and kept on the stock reader. `kindle/dropcap/` is the one KUAL extension it runs, and the `kindle-device` skill covers working on it.

## One extension, separate processes

- `dropcap.sh` is the only entry point. `lib/mailbox.sh` delivers books, runs the app's commands and reports; `lib/tailscale.sh` gives SSH and Taildrop when the static Tailscale binaries are in `tailscale/`; `lib/wifi.sh` holds recovery tools; `lib/boot.sh` holds the boot job.
- Delivery and Tailscale run as separate processes with separate start and stop, so restarting one never takes down the other. Restarting Tailscale ends SSH sessions; delivery does not depend on it at all.
- One upstart job on the root filesystem runs `dropcap.sh supervise` every minute. The userstore (`/mnt/us`, where the scripts live) disappears while USB storage is mounted, so the job restarts whatever died once it returns. Modules are sourced once at startup and every process `cd /`, so nothing pins the userstore.
- Each long-running process holds a `flock` in `/var/run/dropcap/`, so a second copy exits, and "running" means "the lock is held". Long-lived children close the lock's fd so they never keep it after their parent dies.

## Traps

- **Never let it take an OTA update.** The jailbreak depends on 5.16.2.1.1. The OTA binaries are renamed to `/usr/bin/otaupd.bck` and `otav3.bck`; leave them that way.
- **Don't tag the Kindle in Tailscale.** Taildrop refuses tagged nodes, and SSH only allows the user's own untagged devices.
- **`tailscale/state/` is the Kindle's tailnet enrollment.** Moving it is fine; deleting it means a new login approved from the device.
- **The firmware indexes non-books as PDOC.** KUAL, Run Hotfix, `My Clippings.txt` and crash dumps all appear in `cc.db` as PDOC, so `books()` matches reader extensions and leaves those out. The app offers Delete on anything listed.
- **BusyBox differs from a laptop shell.** `kill -0 ""` succeeds, a failed `< file` redirect reports before a later `2>/dev/null` applies, and `ps` hides arguments unless asked for `ps -o pid,args`. The tests run everything under `busybox sh` and ShellCheck's busybox mode for this reason.
- **A shell defers its TERM trap until the foreground command returns.** The loop waits for wake events with a background `lipc-wait-event` and `wait`, so a stop lands at once, except during a download.
- **Process arguments are visible.** `ps -o args` shows every argument, so secrets go through files (curl reads its bearer header with `-H @file`, tailscale its auth key with `file:`), never argv.
- **TLS 1.2 only.** The Kindle's curl links OpenSSL 1.0.2, so the Worker must never require TLS 1.3.
- **Asleep means unreachable.** Wi-Fi turns off when it suspends. Keep it awake while working with `lipc-set-prop com.lab126.powerd preventScreenSaver 1`, and set it back to 0.
- **Its clock is off.** The Kindle reports a broken timezone and drifts by minutes. Trust the Worker's `checkedInAt` and `reportedAt`.
- **Covers:** books are EBOK with an ASIN so the lock screen shows them. The firmware fetches Amazon's "No image" placeholder within seconds for an EBOK book with no thumbnail, so the cover must be installed before the book, and the guard restores it if it is ever replaced.
