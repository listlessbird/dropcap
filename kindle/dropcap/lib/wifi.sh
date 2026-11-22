# Wi-Fi recovery tools, run from KUAL. Sourced by dropcap.sh.

WIFI_CONF=$DIR/network.conf
WIFI_DIAG=$DIR/wifi-diag.txt

# Save network.conf (ESSID= and PSK=, the PSK as the 64-hex key from wpa_passphrase, never the plain
# password) as a Wi-Fi profile, connect, then start Tailscale. network.conf is deleted once connected.
# Refuses while OTA updates are still possible, so going online can't wipe the jailbreak.
wifi_join() {
	local essid psk i=0
	if [ -e /usr/bin/otaupd ] || [ -e /usr/bin/otav3 ]; then
		say "Block OTA first: KUAL > Rename OTA Binaries"
		return 1
	fi
	[ -s "$WIFI_CONF" ] || { say "No network.conf in $DIR"; return 1; }
	essid=$(sed -n 's/^ESSID=//p' "$WIFI_CONF" | head -1)
	psk=$(sed -n 's/^PSK=//p' "$WIFI_CONF" | head -1)
	[ -n "$essid" ] && [ -n "$psk" ] || { say "network.conf needs ESSID= and PSK="; return 1; }
	lipc-set-prop com.lab126.cmd wirelessEnable 1
	lipc-set-prop com.lab126.wifid enable 1
	sleep 3
	printf '{essid="%s", smethod="wpa2", secured="yes", psk="%s"}\n' "$essid" "$psk" |
		lipc-hash-prop com.lab126.wifid createProfile >> "$LOG" 2>&1
	lipc-set-prop com.lab126.wifid cmConnect "$essid" >> "$LOG" 2>&1
	say "Connecting to $essid..."
	until [ "$(lipc-get-prop com.lab126.wifid cmState)" = CONNECTED ]; do
		i=$((i + 1))
		[ $i -gt 45 ] && { say "Wi-Fi failed: $(lipc-get-prop com.lab126.wifid cmState)"; return 1; }
		sleep 1
	done
	rm -f "$WIFI_CONF"
	say "Wi-Fi connected"
	if ssh_installed; then ssh_start; fi
}

# Dump driver, supplicant and wifid state to wifi-diag.txt (about 30s), and upload it to the Worker as
# reports/wifi-diag.txt when it is reachable.
wifi_diag() {
	local p w
	say "Collecting Wi-Fi diagnostics..."
	{
		echo "== $(date)"
		echo "== props (before)"
		for p in cmState currentEssid enable profileCount signalStrength scanState; do
			echo "$p=$(lipc-get-prop com.lab126.wifid "$p" 2>&1)"
		done
		echo "wirelessEnable=$(lipc-get-prop com.lab126.cmd wirelessEnable 2>&1)"
		echo "== enabling wireless + scan"
		lipc-set-prop com.lab126.cmd wirelessEnable 1 2>&1
		lipc-set-prop com.lab126.wifid enable 1 2>&1
		sleep 10
		lipc-set-prop com.lab126.wifid scan "" 2>&1
		sleep 15
		echo "== props (after)"
		for p in cmState currentEssid enable profileCount scanState; do
			echo "$p=$(lipc-get-prop com.lab126.wifid "$p" 2>&1)"
		done
		echo "== scanList"
		echo "" | lipc-hash-prop com.lab126.wifid scanList 2>&1
		echo "== profileData"
		echo "" | lipc-hash-prop com.lab126.wifid profileData 2>&1 | sed 's/psk *= *"[^"]*"/psk="<redacted>"/'
		echo "== upstart"
		initctl list 2>&1 | grep -iE "wifi|wpa|net"
		echo "== processes"
		# shellcheck disable=SC2009 # busybox pgrep can't print arguments, and this is a diagnostic dump.
		ps -o pid,args 2>&1 | grep -iE "[w]pa|[w]ifi|[d]hcp"
		echo "== modules"
		lsmod 2>&1
		echo "== interfaces"
		ifconfig -a 2>&1
		echo "== rfkill"
		cat /sys/class/rfkill/*/name /sys/class/rfkill/*/state 2>&1
		echo "== dmesg"
		dmesg 2>&1 | grep -iE "ath|wlan|wifi|sdio|mmc|firmware" | tail -60
		echo "== messages"
		grep -aiE "wifid|wpa_supp|wlan|ath6|wifis|cmd\[" /var/log/messages 2>&1 | tail -150
		echo "== wpa log"
		tail -80 /var/log/wpa_supplicant 2>&1
	} > "$WIFI_DIAG" 2>&1
	if w=$(worker_url) && api 20 -X PUT --data-binary "@$WIFI_DIAG" "$w/reports/wifi-diag.txt" >/dev/null; then
		say "Diagnostics uploaded as reports/wifi-diag.txt"
	else
		say "Diagnostics saved to wifi-diag.txt. Plug into the computer."
	fi
}
