# Book delivery: on every wake, install queued items from the Worker, run the app's commands, report the
# device and upload the log. Sourced by dropcap.sh; the Worker contract is apps/worker/src/Api.ts.

DOCS=$ROOT/documents
THUMBS=$ROOT/system/thumbnails
COVERS=$ROOT/amazon-cover-bug
CCDB=${CCDB:-/var/local/cc.db}
LOOP_LOCK=$RUN/loop.lock
LOOP_PID=$RUN/loop.pid
# stop creates this, and pull_once checks it between items: a shell runs its TERM trap only once the
# foreground command (here the whole download batch) returns, so a restart would otherwise wait it out.
STOPPING=$RUN/stopping
AUTH=$RUN/auth
TAB=$(printf '\t')

# The Worker's root URL from mailbox.url. Older installs wrote it with a trailing /items.
worker_url() {
	local url
	url=$(tr -d '\r\n' 2>/dev/null < "$DIR/mailbox.url") || return 1
	url=${url%/}
	url=${url%/items}
	case "$url" in https://*) echo "$url" ;; *) return 1 ;; esac
}

# curl against the Worker. The bearer header goes through a root-only file, so the token never
# appears in `ps` output. Usage: api <timeout-seconds> <curl args...>
api() {
	local timeout=$1 token
	shift
	token=$(tr -d '\r\n' 2>/dev/null < "$DIR/mailbox.token") || return 1
	[ -n "$token" ] || return 1
	(umask 077 && printf 'Authorization: Bearer %s\n' "$token" > "$AUTH") || return 1
	curl -sf --max-time "$timeout" -H "@$AUTH" "$@"
}

# Upload the end of the log as reports/dropcap.log, so a wake can be debugged without SSH or USB.
report_log() {
	local w
	w=$(worker_url) || return 0
	tail -n 200 "$LOG" 2>/dev/null | api 20 -X PUT --data-binary @- "$w/reports/dropcap.log" >/dev/null
}

# Run each run-once.d/*.sh once, renamed to .ran first. One copied in over USB runs on the next wake,
# which reaches a Kindle whose SSH is broken. Its output goes to the log, which report_log uploads.
run_once() {
	local f
	for f in "$DIR"/run-once.d/*.sh; do
		[ -e "$f" ] || continue
		mv "$f" "$f.ran" || continue
		log "run-once ${f##*/}"
		nohup sh "$f.ran" >> "$LOG" 2>&1 9>&- &
	done
}

rescan() {
	lipc-set-prop com.lab126.scanner doFullScan 1 >> "$LOG" 2>&1
}

# EBOK books need their thumbnail in system/thumbnails/ for lock-screen covers, and the firmware can
# replace it with Amazon's placeholder. amazon-cover-bug/ keeps our copies; put back any that differ.
guard_covers() {
	local f t
	# While USB storage is mounted the userstore is gone, and mkdir would litter the root filesystem.
	[ -d "$DOCS" ] || return 0
	mkdir -p "$COVERS" "$THUMBS" || return 1
	for f in "$COVERS"/thumbnail_*_portrait.jpg; do
		[ -e "$f" ] || continue
		t=$THUMBS/${f##*/}
		cmp -s "$f" "$t" || { cp "$f" "$t" && log "restored cover ${f##*/}"; }
	done
}

# Fetch everything queued. Covers go first and are installed at once: the firmware only fetches
# Amazon's placeholder for an EBOK book that has no thumbnail yet. Fails if the Worker is unreachable.
pull_once() {
	local w list got
	w=$(worker_url) || return 0
	list=$(api 20 "$w/items/") || return 1
	got=$(printf '%s\n' "$list" | while IFS=$TAB read -r id name; do
		[ -n "$id" ] || continue
		[ -e "$STOPPING" ] && break
		name=$(printf '%s' "$name" | tr '/' '_')
		case "$name" in
			thumbnail_*_portrait.jpg) dest=$COVERS/$name ;;
			*) [ -e "$DOCS/$name" ] && name="$(date +%s) $name"; dest=$DOCS/$name ;;
		esac
		tmp=${dest%/*}/.$name.part
		if api 300 -o "$tmp" "$w/items/$id" && mv "$tmp" "$dest"; then
			case "$name" in thumbnail_*) guard_covers ;; esac
			api 20 -X DELETE "$w/items/$id" >/dev/null || log "could not remove $name from the mailbox"
			log "received $name"
			echo "$dest"
		else
			rm -f "$tmp"
			log "download failed: $name"
		fi
	done)
	[ -n "$got" ] && rescan
	guard_covers
	return 0
}

is_count() {
	case "$1" in '' | *[!0-9]*) return 1 ;; esac
}

# Remove a book, its reading position (.sdr) and its covers. The Worker only queues paths inside
# documents/, and this checks again. A book that is already gone counts as deleted.
delete_book() {
	local path=$1 base sdr key
	case "$path" in "$DOCS"/?*) ;; *) echo "not in documents/: $path"; return 1 ;; esac
	case "$path/" in */../* | */./* | *//*) echo "refusing $path"; return 1 ;; esac
	base=${path##*/}
	case "$base" in ?*.*) sdr=${path%.*}.sdr ;; *) sdr=$path.sdr ;; esac
	key=$(sqlite3 "$CCDB" "select p_cdeKey from Entries where p_location = '$(printf '%s' "$path" | sed "s/'/''/g")'" </dev/null 2>/dev/null)
	rm -f -- "$path" || return 1
	rm -rf -- "$sdr"
	case "$key" in
		'' | */* | *..*) ;;
		*) rm -f "$COVERS/thumbnail_${key}_EBOK_portrait.jpg" "$THUMBS/thumbnail_${key}_EBOK_portrait.jpg" ;;
	esac
	return 0
}

# Run the app's queued commands, oldest first, and settle each with the Worker. A lost settle runs the
# command again on the next wake, so every verb must be safe to repeat.
run_commands() {
	local w cmds scan='' id verb arg msg ok
	w=$(worker_url) || return 0
	cmds=$(api 20 "$w/commands/") || return 0
	while IFS=$TAB read -r id verb arg; do
		[ -n "$id" ] || continue
		ok=1
		case "$verb" in
			delete) msg=$(delete_book "$arg" 2>&1) || ok='' ;;
			rescan) msg='' ;;
			*) msg="unknown command $verb"; ok='' ;;
		esac
		if [ -n "$ok" ]; then
			scan=1
			log "ran $verb $arg"
			api 20 -X PUT --data-urlencode outcome=ok "$w/commands/$id" >/dev/null || log "could not settle $id"
		else
			log "failed $verb: $msg"
			api 20 -X PUT --data-urlencode outcome=failed --data-urlencode "message=$msg" "$w/commands/$id" >/dev/null ||
				log "could not settle $id"
		fi
	done <<EOF
$cmds
EOF
	[ -n "$scan" ] && rescan
	return 0
}

# One "<path>\t<title>" line per book in documents/, from the library DB. The firmware indexes KUAL,
# hotfix runners, My Clippings.txt and its *_crash_*.txt dumps as PDOC too, so books are matched by
# extension and those two .txt files are left out. A tab or newline in a title would split the line.
books() {
	sqlite3 -separator "$TAB" "$CCDB" "select p_location, replace(replace(coalesce(p_titles_0_nominal, ''), char(9), ' '), char(10), ' ') from Entries where p_cdeType in ('EBOK', 'PDOC') and p_location like '$DOCS/%' and (p_location like '%.azw3' or p_location like '%.azw' or p_location like '%.mobi' or p_location like '%.kfx' or p_location like '%.pdf' or p_location like '%.epub' or p_location like '%.txt') and p_location != '$DOCS/My Clippings.txt' and p_location not like '%\_crash\_%.txt' escape '\' and instr(p_location, char(9)) = 0 and instr(p_location, char(10)) = 0 order by p_location" </dev/null 2>/dev/null
}

# Tell the Worker the battery, free space, firmware and library for the app's Kindle screen. A value
# that can't be read is left out. Runs after run_commands, so the library already shows deletions.
report_device() {
	local w v book
	w=$(worker_url) || return 0
	set --
	v=$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null) && is_count "$v" && set -- "$@" --data-urlencode "battery=$v"
	v=$(lipc-get-prop com.lab126.powerd isCharging 2>/dev/null) && case "$v" in 0 | 1) set -- "$@" --data-urlencode "charging=$v" ;; esac
	v=$(df -kP "$ROOT" 2>/dev/null | awk 'NR == 2 { print $4 }') && is_count "$v" && set -- "$@" --data-urlencode "freeKb=$v"
	v=$(df -kP "$ROOT" 2>/dev/null | awk 'NR == 2 { print $2 }') && is_count "$v" && set -- "$@" --data-urlencode "totalKb=$v"
	v=$(grep -o '[0-9][0-9.]*[0-9]' /etc/prettyversion.txt 2>/dev/null | head -1) && [ -n "$v" ] && set -- "$@" --data-urlencode "firmware=$v"
	while IFS= read -r book; do
		[ -n "$book" ] && set -- "$@" --data-urlencode "books=$book"
	done <<EOF
$(books)
EOF
	api 20 -X PUT "$@" "$w/device" >/dev/null || log "device report rejected"
}

# True while a delivery loop holds the lock. Probing takes the lock for an instant, which a starting
# loop waits out.
running() {
	! flock -n "$LOOP_LOCK" true 2>/dev/null
}

# The delivery loop: check the mailbox on every wake (Wi-Fi needs a few seconds to come back, so retry
# for a minute), then every 10 minutes while awake. Frozen, and free, while the Kindle sleeps. The lock
# on fd 9 makes a second loop exit; long-lived children close fd 9 so they never hold it.
loop() {
	local i wait_pid=
	exec 9> "$LOOP_LOCK" || exit 1
	lock_within 5 9 || { log "a delivery loop is already running"; exit 0; }
	rm -f "$STOPPING"
	echo $$ > "$LOOP_PID"
	trap '[ -n "$wait_pid" ] && kill "$wait_pid" 2>/dev/null; exit 0' TERM INT
	while :; do
		run_once
		guard_covers
		i=0
		until pull_once; do
			i=$((i + 1))
			[ $i -ge 12 ] && break
			sleep 5
		done
		[ $i -lt 12 ] && { run_commands; report_device; report_log; }
		# Exits non-zero on its own timeout too; the short sleep only guards against a failing lipc spinning.
		lipc-wait-event -s 600 com.lab126.powerd outOfScreenSaver,wakeupFromSuspend >/dev/null 2>&1 9>&- &
		wait_pid=$!
		wait "$wait_pid" || sleep 5
		wait_pid=
	done
}

# Start the delivery loop, replacing a running one, and return once it holds the lock.
start() {
	local i=0
	stop || { say "Dropcap is busy downloading, try again"; return 1; }
	tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
	nohup sh "$SELF" loop >> "$LOG" 2>&1 &
	until running; do
		i=$((i + 1))
		[ $i -gt 50 ] && { say "Dropcap did not start, see dropcap.log"; return 1; }
		usleep 100000
	done
	say "Dropcap started"
}

# Stop the delivery loop and wait for it to let go of the lock. A loop busy downloading finishes the
# current item first (curl allows it 300 seconds), so this waits up to 330.
stop() {
	local pid
	running || return 0
	: > "$STOPPING"
	pid=$(cat "$LOOP_PID" 2>/dev/null)
	is_count "$pid" && kill "$pid" 2>/dev/null
	lock_within 330 "$LOOP_LOCK" true
}
