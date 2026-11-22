---
name: kindle-device
description: Work on and debug the user's jailbroken Kindle that Dropcap delivers to. Use when changing anything under kindle/, deploying it, checking whether the Kindle is delivering, reporting or running commands, reading its logs, reaching it over SSH or USB, or rotating its token.
---

# Working on the Kindle

Read `docs/internals/kindle.md` first. The Kindle is the user's daily reader, so deploying to it is outward-facing like deploying the Worker: do it when the task asks for it, and verify it afterwards.

Everything on the device lives in `/mnt/us/extensions/dropcap/`: the scripts from `kindle/dropcap/`, plus device-only files that are never in git (`mailbox.url`, `mailbox.token`, `tailscale/` binaries and `state/`, `dropcap.log`, `run-once.d/`).

## Look before you touch

These read the Worker and never wake or change the Kindle:

```sh
kindle/kd status   # last check-in, battery, storage, firmware, book titles, queued commands
kindle/kd logs     # the end of dropcap.log, uploaded on every wake
```

`checkedInAt` moves on every wake that reaches the Worker. If it is recent and `kd logs` shows no errors, delivery is healthy.

## Reach it

1. `tailscale ping -c 1 kindle`. No reply means it is asleep, or its Wi-Fi is down. Ask the user to wake it; nothing below works until then.
2. `kindle/kd ssh '<command>'` runs as root over Tailscale SSH. There is no scp: copy with `kindle/kd ssh 'cat > /path' < file`.
3. Keep it awake while you work: `kindle/kd ssh 'lipc-set-prop com.lab126.powerd preventScreenSaver 1'`. Set it back to `0` when you are done, every time.

Health over SSH:

```sh
kindle/kd ssh 'D=/mnt/us/extensions/dropcap; initctl status dropcap; $D/dropcap.sh running && echo delivering; ps -o pid,ppid,args | grep -E "[d]ropcap.sh (loop|receive)|[t]ailscaled --state"; tail -20 $D/dropcap.log'
```

Expect `dropcap start/running`, one `dropcap.sh loop` (a child with it as parent is a pipeline in flight), one `dropcap.sh receive`, and `tailscaled`.

Kill only a PID you read from `ps -o pid,args` or `/var/run/dropcap/*.pid`. A `pkill -f` pattern also matches your own SSH session's command line, and `ps | grep` output contains your own command too.

## Change and deploy

1. Edit under `kindle/dropcap/`. The device runs BusyBox 1.34 ash: no bashisms, and see the traps in the internals doc.
2. `pnpm vp test run kindle/dropcap` runs the scripts under `busybox sh` against a fake Worker, and runs ShellCheck in busybox mode.
3. `kindle/kd deploy` syntax-checks, pushes the files over SSH, and restarts delivery. Confirm with `kindle/kd ssh 'md5sum /mnt/us/extensions/dropcap/lib/*.sh'` against the repo copies, then wait for a `reportedAt` newer than the deploy.
4. A `lib/tailscale.sh` change takes effect on Tailscale's next start. Restart it by killing it and letting the boot job bring it back, which ends your session and returns SSH in about a minute: `kindle/kd ssh 'kill $(cat /var/run/dropcap/tailscaled.pid)'`. Never run `ssh-start`, or any script that stops Tailscale, from an SSH session: the session's teardown kills it partway, even under `nohup`.
5. Prove the command path with `kindle/kd rescan`, then watch `kindle/kd status` until it settles `ok`. It runs on the next wake, or within 10 minutes while the Kindle is awake. `dropcap.sh start` runs a pass immediately.

## Changing the boot job or the layout on the device

Anything that stops the boot job, replaces it, or moves files Tailscale needs goes in a `run-once.d` script, so it runs from the delivery loop with no SSH session to lose. Install the new supervisor before removing the old one: a Kindle with neither stays down until someone taps KUAL → Dropcap → Start or restarts it.

## Without SSH (USB)

When Tailscale is broken, ask the user to plug the Kindle in. It mounts at `/media/$USER/Kindle` (`udisksctl mount -b /dev/sda1` if it does not).

- `kindle/kd deploy` notices the mount, copies the files, and queues a restart in `extensions/dropcap/run-once.d/`.
- Any `extensions/dropcap/run-once.d/*.sh` runs once on the next wake, then is renamed `.ran`. Its output lands in `dropcap.log`, which reaches `kindle/kd logs`, so you get remote execution and its results with no SSH. A script can also upload a file with `curl -sf -H @/var/run/dropcap/auth -X PUT --data-binary @file "$(cat /mnt/us/extensions/dropcap/mailbox.url)/reports/<name>"`.
- Eject with `sync && udisksctl unmount -b /dev/sda1 && udisksctl power-off -b /dev/sda`. The Kindle is back on Wi-Fi a few minutes later.

## When it stops delivering

- **`checkedInAt` is stale:** wake it and check `lipc-get-prop com.lab126.wifid cmState` (should be `CONNECTED`), then the health command above. The boot job restarts a dead loop within a minute.
- **Checks in, but `device report rejected` in the log:** the Worker's `DeviceReport` schema refused a value. Compare what `report_device` sends with `apps/worker/src/Api.ts`.
- **401s:** `extensions/dropcap/mailbox.token` and `KINDLE_TOKEN` in `~/.config/kindle-mailbox/secrets.env` differ.
- **A book is missing from the library:** query the library DB; logs give false matches. `kindle/kd ssh 'sqlite3 /var/local/cc.db "select p_cdeType, p_location from Entries where p_location like \"%<name>%\""'`.
- **Tailscale says it needs a login:** `extensions/dropcap/tailscale/needs-login` exists and the boot job leaves Tailscale alone. The user taps KUAL → Dropcap → Start Tailscale and approves the on-screen link.
- **Wi-Fi itself is broken:** the user taps KUAL → Dropcap → Wi-Fi diagnostics. It uploads `reports/wifi-diag.txt` when it can, else read `extensions/dropcap/wifi-diag.txt` over USB.

## Rotate KINDLE_TOKEN

Do this whenever the token shows up in a transcript or log. Never print it.

1. Write a new random value into `~/.config/kindle-mailbox/secrets.env` without echoing it.
2. Deploy the Worker (see AGENTS.md); the plan should be `[Mailbox] update` only.
3. `sed -n 's/^KINDLE_TOKEN=//p' ~/.config/kindle-mailbox/secrets.env | tr -d '\n' | kindle/kd ssh 'cat > /mnt/us/extensions/dropcap/mailbox.token'`
4. `kindle/kd ssh /mnt/us/extensions/dropcap/dropcap.sh start` and confirm a fresh `checkedInAt`.

## Recovery

- **Dropcap gone after a reset:** `kindle/kd deploy` over USB, write `mailbox.url` (the Worker's https URL) and `mailbox.token` into `extensions/dropcap/`, then KUAL → Dropcap → Start on boot, and Start.
- **Tailscale binaries missing:** fetch the static `arm` (not arm64) tarball from pkgs.tailscale.com into `extensions/dropcap/tailscale/`.
- **Off the tailnet** (`tailscale/state/` lost): KUAL → Dropcap → Start Tailscale shows a login link to approve. Then disable key expiry for `kindle` in the admin console.
