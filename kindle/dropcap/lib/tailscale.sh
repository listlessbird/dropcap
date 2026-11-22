# Optional Tailscale for SSH and Taildrop, from the static arm binaries in tailscale/ (not in git).
# Delivery never depends on it: restarting Tailscale ends SSH sessions but leaves the loop alone.
# Sourced by dropcap.sh.

TS_DIR=$DIR/tailscale
TS_LOG=$TS_DIR/tailscaled.log
TS_SOCK=$RUN/tailscaled.sock
TS_HOSTNAME=${DROPCAP_TS_HOSTNAME:-kindle}
TS_PID=$RUN/tailscaled.pid
SSH_LOCK=$RUN/ssh.lock
RECEIVE_LOCK=$RUN/receive.lock
RECEIVE_PID=$RUN/receive.pid
# Written when a boot-time start finds no login. The boot job then leaves Tailscale alone until a start
# from KUAL, which can show the login link, clears it.
NEEDS_LOGIN=$TS_DIR/needs-login

# The tailscale CLI on our socket. `timeout` and `nohup` can't run a function, so they call
# "$TS_DIR/tailscale" --socket="$TS_SOCK" directly.
ts() {
	"$TS_DIR/tailscale" --socket="$TS_SOCK" "$@"
}

ssh_installed() {
	[ -x "$TS_DIR/tailscaled" ] && [ -x "$TS_DIR/tailscale" ]
}

receiving() {
	! flock -n "$RECEIVE_LOCK" true 2>/dev/null
}

# The tailscaled we started, by its pidfile; never by name, which would match other tailscaleds.
tailscaled_pid() {
	local pid
	pid=$(cat "$TS_PID" 2>/dev/null)
	is_count "$pid" && grep -q tailscaled "/proc/$pid/cmdline" 2>/dev/null && echo "$pid"
}

ssh_running() {
	tailscaled_pid >/dev/null && receiving
}

ssh_stop() {
	local pid i=0
	pid=$(cat "$RECEIVE_PID" 2>/dev/null)
	receiving && is_count "$pid" && kill "$pid" 2>/dev/null
	if pid=$(tailscaled_pid); then
		kill "$pid" 2>/dev/null
		while [ -d "/proc/$pid" ] && [ $i -lt 10 ]; do
			sleep 1
			i=$((i + 1))
		done
		[ -d "/proc/$pid" ] && kill -9 "$pid" 2>/dev/null
	fi
	rm -f "$TS_SOCK" "$TS_PID"
}

# Show the approval link on screen and wait up to 5 minutes for it. Only from KUAL: the boot job is
# QUIET and nobody would see the link.
ssh_login() {
	local url i=0
	nohup timeout 300 "$TS_DIR/tailscale" --socket="$TS_SOCK" up --ssh --hostname="$TS_HOSTNAME" --force-reauth \
		> "$TS_DIR/login.txt" 2>&1 7>&- &
	until url=$(grep -o 'https://login.tailscale.com/[^ ]*' "$TS_DIR/login.txt" | head -1) && [ -n "$url" ]; do
		i=$((i + 1))
		[ $i -gt 30 ] && { say "No login link, see tailscale/tailscaled.log"; return 1; }
		sleep 1
	done
	say "Open on your phone to approve:"
	eips 0 24 "$url" >/dev/null 2>&1
	i=0
	until ts status >/dev/null 2>&1; do
		i=$((i + 1))
		[ $i -gt 300 ] && { say "Login not approved in time, start Tailscale again"; return 1; }
		sleep 1
	done
	eips 0 24 "$(printf '%-50s' '')" >/dev/null 2>&1
}

# Start tailscaled and join the tailnet with tailscale/auth.key if present (wiped once used), else the
# saved login, else an on-screen login link. Leaves nothing running when it fails. The lock on fd 7
# keeps a boot-job tick from restarting a start that is still in progress.
ssh_start() {
	local ok
	ssh_installed || { say "Tailscale is not installed in $TS_DIR"; return 1; }
	exec 7> "$SSH_LOCK" || return 1
	if ! flock -n 7; then
		exec 7>&-
		log "Tailscale is already starting"
		return 1
	fi
	ssh_start_locked
	ok=$?
	exec 7>&-
	return $ok
}

ssh_start_locked() {
	local i=0
	ssh_stop
	mkdir -p "$TS_DIR/state" || return 1
	: > "$TS_LOG"
	say "Starting Tailscale..."
	nohup "$TS_DIR/tailscaled" --statedir="$TS_DIR/state" --socket="$TS_SOCK" -tun userspace-networking \
		>> "$TS_LOG" 2>&1 7>&- &
	echo $! > "$TS_PID"
	until [ -S "$TS_SOCK" ]; do
		i=$((i + 1))
		[ $i -gt 30 ] && { say "tailscaled did not start, see tailscale/tailscaled.log"; ssh_stop; return 1; }
		sleep 1
	done
	if [ -s "$TS_DIR/auth.key" ]; then
		if timeout 60 "$TS_DIR/tailscale" --socket="$TS_SOCK" up --ssh --hostname="$TS_HOSTNAME" \
			--auth-key="file:$TS_DIR/auth.key" >> "$TS_LOG" 2>&1 7>&-; then
			: > "$TS_DIR/auth.key"
		else
			say "Auth key rejected"
		fi
	else
		timeout 15 "$TS_DIR/tailscale" --socket="$TS_SOCK" up --ssh --hostname="$TS_HOSTNAME" >> "$TS_LOG" 2>&1 7>&-
	fi
	if ! ts status >/dev/null 2>&1; then
		if [ -n "${QUIET:-}" ]; then
			: > "$NEEDS_LOGIN"
			log "Tailscale needs a login: KUAL > Dropcap > Start Tailscale (dropcap.sh ssh-start)"
			ssh_stop
			return 1
		fi
		ssh_login || { ssh_stop; return 1; }
	fi
	rm -f "$NEEDS_LOGIN"
	nohup sh "$SELF" receive >/dev/null 2>&1 7>&- &
	say "Tailscale up: $(ts ip -4 2>/dev/null)"
}

ssh_status() {
	ssh_installed || { say "Tailscale is not installed"; return 1; }
	say "$(ts status --peers=false 2>&1 | head -1)"
}

# Taildrop receiver: move files sent to the Kindle into documents/ and rescan. The lock on fd 8 makes a
# second receiver exit.
receive() {
	exec 8> "$RECEIVE_LOCK" || exit 1
	lock_within 5 8 || exit 0
	echo $$ > "$RECEIVE_PID"
	while :; do
		if ts file get --wait --conflict=rename "$DOCS/" >> "$TS_LOG" 2>&1 8>&-; then
			log "received a Taildrop file"
			rescan
		else
			sleep 15 8>&-
		fi
	done
}
