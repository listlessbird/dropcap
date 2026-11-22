#!/bin/sh
# Dropcap for a jailbroken stock-reader Kindle: book delivery from the Dropcap mailbox, plus optional
# Tailscale SSH/Taildrop and Wi-Fi tools. Runs under busybox ash as root.
#
# Usage: dropcap.sh start|stop|running          the delivery loop
#        dropcap.sh ssh-start|ssh-stop|ssh-status   Tailscale SSH and Taildrop (needs tailscale/ binaries)
#        dropcap.sh wifi-join|wifi-diag          join network.conf's network, or collect Wi-Fi diagnostics
#        dropcap.sh install-boot|uninstall-boot  the boot job that keeps both running
#        dropcap.sh books|guard                  list the library, restore covers
# Subcommands are single words, so they work however KUAL passes a menu item's params.
# QUIET=1 keeps messages off the screen (the boot job sets it).
#
# Functions return non-zero on failure and callers decide what to do; nothing here uses set -e, which
# would kill a long-running loop on the first failed curl.

ROOT=${DROPCAP_ROOT:-/mnt/us}
DIR=$ROOT/extensions/dropcap
RUN=${DROPCAP_RUN:-/var/run/dropcap}
LOG=$DIR/dropcap.log
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 1
SELF=$HERE/${0##*/}

log() {
	echo "[$(date '+%F %T')] $1" >> "$LOG"
}

# Log, and show on the Kindle's screen unless QUIET. Never fails: the screen is best effort.
say() {
	log "$1"
	[ -n "${QUIET:-}" ] || eips 0 22 "$(printf '%-50s' "$1")" >/dev/null 2>&1
	return 0
}

# Take a lock, retrying for up to $1 seconds: BusyBox 1.34's flock has no -w. The rest of the
# arguments go to `flock -n`: an fd, or a file and a command to run while holding it.
lock_within() {
	local tenths=$(($1 * 10))
	shift
	until flock -n "$@"; do
		tenths=$((tenths - 1))
		[ "$tenths" -gt 0 ] || return 1
		usleep 100000
	done
}

usage() {
	sed -n '5,10p' "$SELF" >&2
	exit 2
}

# Modules load once, up front: the userstore holding them vanishes while USB storage is mounted.
# shellcheck source=SCRIPTDIR/lib/mailbox.sh
. "$HERE/lib/mailbox.sh"
# shellcheck source=SCRIPTDIR/lib/tailscale.sh
. "$HERE/lib/tailscale.sh"
# shellcheck source=SCRIPTDIR/lib/wifi.sh
. "$HERE/lib/wifi.sh"
# shellcheck source=SCRIPTDIR/lib/boot.sh
. "$HERE/lib/boot.sh"

# A working directory on the userstore would keep it busy and block USB mode.
cd / || exit 1
mkdir -p "$RUN" || exit 1

case "${1:-}" in
	start) start ;;
	stop) stop ;;
	running) running ;;
	loop) loop ;;
	ssh-start) ssh_start ;;
	ssh-stop) ssh_stop && say "Tailscale stopped" ;;
	ssh-status) ssh_status ;;
	receive) receive ;;
	wifi-join) wifi_join ;;
	wifi-diag) wifi_diag ;;
	supervise) supervise ;;
	shutdown) shutdown ;;
	install-boot) install_boot ;;
	uninstall-boot) uninstall_boot ;;
	books) books ;;
	guard) guard_covers ;;
	*) usage ;;
esac
