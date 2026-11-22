# The upstart job that keeps Dropcap (and Tailscale, when installed) running across reboots and USB
# sessions. Sourced by dropcap.sh.

JOB=${DROPCAP_JOB:-/etc/upstart/dropcap.conf}

# One tick of the boot job: start whatever is not running. Always succeeds, because the job's body runs
# under sh -e and a failure would end the job until wifid restarts.
supervise() {
	running || start || log "supervise: delivery did not start"
	if ssh_installed && [ ! -e "$NEEDS_LOGIN" ] && ! ssh_running; then
		ssh_start || log "supervise: Tailscale did not start"
	fi
	return 0
}

shutdown() {
	stop
	ssh_installed && ssh_stop
	return 0
}

# The job lives on the root filesystem because the userstore, and this script, vanish while USB storage
# is mounted. Its loop brings everything back within a minute of the userstore returning.
install_boot() {
	mntroot rw >/dev/null 2>&1
	if ! cat > "$JOB" <<JOB; then
# Dropcap for the stock reader. Installed by $SELF install-boot.
start on started wifid
stop on stopping wifid

script
	while :; do
		[ -x $SELF ] && QUIET=1 $SELF supervise || true
		sleep 60
	done
end script

post-stop exec $SELF shutdown
JOB
		say "Could not write $JOB"
		return 1
	fi
	# The root filesystem stays writable on this device; remounting it read-only usually fails as busy.
	mntroot ro >/dev/null 2>&1
	say "Dropcap will start on boot"
}

uninstall_boot() {
	mntroot rw >/dev/null 2>&1
	rm -f "$JOB" || { say "Could not remove $JOB"; return 1; }
	mntroot ro >/dev/null 2>&1
	say "Dropcap boot start removed"
}
