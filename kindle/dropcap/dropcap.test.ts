import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, expect, it } from "vite-plus/test";

const here = import.meta.dirname;
const script = NodePath.join(here, "dropcap.sh");

const which = (name: string) =>
  NodeChildProcess.execFileSync("which", [name], { encoding: "utf8" }).trim();

const busybox = which("busybox");
const flockPath = which("flock");

// Every external command the scripts use runs as a BusyBox applet, as on the Kindle. This BusyBox
// lacks flock and nohup, so those two come from the laptop.
const applets = NodeChildProcess.execFileSync(busybox, ["--list"], { encoding: "utf8" }).split(
  "\n",
);

let cleanup: (() => void) | undefined;

const executable = (path: string, body: string) =>
  NodeFS.writeFileSync(path, body, { mode: 0o755 });

// A fake Kindle in a temp dir, with `sh` pointing at busybox so every script runs under ash.
const kindle = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dropcap-"));
  const bin = NodePath.join(root, "bin");
  const ext = NodePath.join(root, "extensions", "dropcap");
  const run = NodePath.join(root, "run");
  const responses = NodePath.join(root, "responses");
  const key = (url: string) => NodePath.join(responses, url.replaceAll("/", "_"));

  NodeFS.mkdirSync(bin);
  NodeFS.mkdirSync(NodePath.join(root, "documents"));
  NodeFS.mkdirSync(ext, { recursive: true });
  NodeFS.mkdirSync(responses);

  for (const applet of [
    "sh",
    "cat",
    "tr",
    "sed",
    "grep",
    "awk",
    "df",
    "tail",
    "head",
    "cmp",
    "mkdir",
    "mv",
    "cp",
    "rm",
    "date",
    "sleep",
    "usleep",
    "printf",
    "timeout",
    "kill",
    "touch",
    "dirname",
  ]) {
    if (applets.includes(applet)) NodeFS.symlinkSync(busybox, NodePath.join(bin, applet));
  }

  // The laptop's util-linux flock takes options the Kindle's BusyBox 1.34 flock lacks, like -w.
  executable(
    NodePath.join(bin, "flock"),
    `#!/bin/sh\ncase "$1" in -*[!sxun]*) echo "flock: invalid option $1" >&2; exit 1 ;; esac\nexec ${flockPath} "$@"\n`,
  );
  NodeFS.writeFileSync(NodePath.join(ext, "mailbox.url"), "https://mailbox.invalid\n");
  NodeFS.writeFileSync(NodePath.join(ext, "mailbox.token"), "test-token\n");
  NodeChildProcess.execFileSync("mkfifo", [NodePath.join(root, "pass")]);

  // The Worker: GETs answer with what `respond` stored, -o writes the body, every call lands in
  // curl.log, and a URL given to `hold` blocks until its file exists, like a download in flight.
  executable(
    NodePath.join(bin, "curl"),
    `#!/bin/sh
method=GET url= out= fields=
while [ $# -gt 0 ]; do
	case "$1" in
		-X) method=$2; shift ;;
		-o) out=$2; shift ;;
		--data-urlencode) fields="$fields $2"; shift ;;
		https://*) url=$1 ;;
	esac
	shift
done
echo "$method $url$fields" >> "${root}/curl.log"
k="${responses}/$(echo "$url" | tr / _)"
if [ -f "$k.hold" ]; then
	until [ -e "$(cat "$k.hold")" ]; do usleep 10000; done
fi
[ "$method" = GET ] || exit 0
if [ -n "$out" ]; then cat "$k" > "$out" 2>/dev/null || : > "$out"; else cat "$k" 2>/dev/null; fi
exit 0
`,
  );
  // Marks the end of a loop pass on the `pass` FIFO, then blocks like the real wake wait.
  executable(
    NodePath.join(bin, "lipc-wait-event"),
    `#!/bin/sh\necho done > "${root}/pass"\nexec sleep 600\n`,
  );

  const env = {
    ...process.env,
    DROPCAP_ROOT: root,
    DROPCAP_RUN: run,
    CCDB: NodePath.join(root, "cc.db"),
    PATH: `${bin}:${process.env.PATH}`,
  };

  const dropcap = (command: string, extra: Record<string, string> = {}) =>
    NodeChildProcess.spawnSync(NodePath.join(bin, "sh"), [script, command], {
      env: { ...env, ...extra },
    }).status === 0;

  cleanup = () => {
    dropcap("shutdown");
    NodeFS.rmSync(root, { recursive: true, force: true });
  };

  return {
    root,
    ext,
    run,
    dropcap,
    // GET <url> answers with body from now on.
    respond: (url: string, body: string) => NodeFS.writeFileSync(key(url), body),
    // Calls to <url> block until path exists.
    hold: (url: string, path: string) => NodeFS.writeFileSync(`${key(url)}.hold`, path),
    awaitPass: () => NodeFS.readFileSync(NodePath.join(root, "pass"), "utf8"),
    curlLog: () =>
      NodeFS.readFileSync(NodePath.join(root, "curl.log"), "utf8").trimEnd().split("\n"),
    installTailscale: () => {
      const ts = NodePath.join(ext, "tailscale");

      NodeFS.mkdirSync(ts);
      // Serves a unix socket until TERM. `up` logs in with a non-empty auth-key file, `status`
      // succeeds once logged in, and `file get` waits until tailscaled goes away.
      executable(
        NodePath.join(ts, "tailscaled"),
        `#!/bin/sh
for a; do case "$a" in --socket=*) sock=\${a#--socket=} ;; esac; done
python3 -c 'import socket, sys, time; socket.socket(socket.AF_UNIX).bind(sys.argv[1]); time.sleep(600)' "$sock" &
child=$!
trap 'kill $child; rm -f "$sock"; exit 0' TERM
wait $child
`,
      );
      executable(
        NodePath.join(ts, "tailscale"),
        `#!/bin/sh
for a; do case "$a" in --socket=*) sock=\${a#--socket=} ;; esac; done
shift
echo "$*" >> "${root}/tailscale.log"
case "$1" in
	up)
		for a; do
			case "$a" in --auth-key=file:*) [ -s "\${a#--auth-key=file:}" ] && : > "${root}/logged-in" ;; esac
		done
		;;
	status) [ -e "${root}/logged-in" ] ;;
	ip) echo 100.64.0.1 ;;
	file) while [ -S "$sock" ]; do usleep 50000; done; exit 1 ;;
esac
`,
      );

      return ts;
    },
    tailscaleLog: () => NodeFS.readFileSync(NodePath.join(root, "tailscale.log"), "utf8"),
  };
};

/** Live processes running this checkout's dropcap.sh with the given subcommand. */
const processes = (command: string) =>
  NodeFS.readdirSync("/proc")
    .filter((pid) => /^\d+$/.test(pid))
    .filter((pid) => {
      try {
        const args = NodeFS.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");

        return args.includes(script) && args.includes(command);
      } catch {
        return false;
      }
    });

const alive = (pidFile: string) => {
  try {
    return NodeFS.existsSync(`/proc/${NodeFS.readFileSync(pidFile, "utf8").trim()}`);
  } catch {
    return false;
  }
};

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

// Types match a real PW3 on 5.16.2.1.1, which indexes KUAL, hotfix runners and its own text files as PDOC.
it("reports only books in documents/", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dropcap-db-"));
  const ccdb = NodePath.join(dir, "cc.db");
  const db = new NodeSqlite.DatabaseSync(ccdb);

  cleanup = () => NodeFS.rmSync(dir, { recursive: true, force: true });
  db.exec("create table Entries (p_location text, p_cdeType text, p_titles_0_nominal text)");

  const insert = db.prepare("insert into Entries values (?, ?, ?)");

  for (const row of [
    ["/mnt/us/documents/Dune.azw3", "EBOK", "Dune"],
    ["/mnt/us/documents/old/Emma.azw3", "PDOC", "Emma\tAusten"],
    ["/mnt/us/documents/Notes.PDF", "PDOC", "Notes"],
    ["/mnt/us/documents/Meditations.txt", "PDOC", "Meditations"],
    ["/mnt/us/documents/KUAL.kual", "PDOC", "KUAL"],
    ["/mnt/us/documents/Run Hotfix.run_hotfix", "PDOC", "Run Hotfix"],
    ["/mnt/us/documents/My Clippings.txt", "PDOC", "Your Clippings"],
    ["/mnt/us/documents/KPPMainAppV2_crash_Oct_27.txt", "PDOC", "KPPMainAppV2_crash_Oct_27"],
    ["/mnt/us/documents/Untyped.azw3", null, "Untyped"],
    ["/mnt/us/system/Elsewhere.azw3", "EBOK", "Elsewhere"],
  ]) {
    insert.run(...row);
  }

  db.close();

  const books = NodeChildProcess.execFileSync(busybox, ["sh", script, "books"], {
    env: { ...process.env, DROPCAP_ROOT: "/mnt/us", DROPCAP_RUN: dir, CCDB: ccdb },
    encoding: "utf8",
  });

  expect(books.trimEnd().split("\n")).toEqual([
    "/mnt/us/documents/Dune.azw3\tDune",
    "/mnt/us/documents/Meditations.txt\tMeditations",
    "/mnt/us/documents/Notes.PDF\tNotes",
    "/mnt/us/documents/old/Emma.azw3\tEmma Austen",
  ]);
});

// The boot job runs supervise every minute: it must start a stopped loop and leave a running one alone.
it("supervise keeps exactly one delivery loop running", () => {
  const { run, dropcap } = kindle();

  expect(dropcap("running")).toBe(false);
  expect(dropcap("supervise")).toBe(true);
  expect(dropcap("running")).toBe(true);

  const pid = NodeFS.readFileSync(NodePath.join(run, "loop.pid"), "utf8");

  expect(dropcap("supervise")).toBe(true);
  expect(NodeFS.readFileSync(NodePath.join(run, "loop.pid"), "utf8")).toBe(pid);
  expect(processes("loop")).toHaveLength(1);
});

it("restarting leaves one delivery loop, and stop leaves none", () => {
  const { dropcap, awaitPass } = kindle();

  expect(dropcap("start")).toBe(true);
  awaitPass();
  expect(dropcap("start")).toBe(true);
  expect(dropcap("start")).toBe(true);
  expect(processes("loop")).toHaveLength(1);
  expect(dropcap("stop")).toBe(true);
  expect(processes("loop")).toHaveLength(0);
  expect(dropcap("running")).toBe(false);
});

// A shell only runs its TERM trap once the whole download batch returns, so stop must end the batch.
it("stopping mid-download finishes that item and skips the rest of the queue", () => {
  const { root, run, dropcap, respond, hold, curlLog } = kindle();
  const worker = "https://mailbox.invalid";

  respond(`${worker}/items/`, "001\tone.azw3\n002\ttwo.azw3\n");
  respond(`${worker}/items/001`, "one");
  respond(`${worker}/items/002`, "two");
  hold(`${worker}/items/001`, NodePath.join(run, "stopping"));

  expect(dropcap("start")).toBe(true);
  expect(dropcap("stop")).toBe(true);

  expect(processes("loop")).toHaveLength(0);
  expect(NodeFS.readFileSync(NodePath.join(root, "documents", "one.azw3"), "utf8")).toBe("one");
  expect(NodeFS.existsSync(NodePath.join(root, "documents", "two.azw3"))).toBe(false);
  expect(curlLog()).not.toContain(`GET ${worker}/items/002`);
});

it("runs the app's commands, deleting only inside documents/, and settles each one", () => {
  const { root, dropcap, respond, awaitPass, curlLog } = kindle();
  const docs = (path: string) => NodePath.join(root, "documents", path);
  const outside = NodePath.join(root, "outside.azw3");

  NodeFS.mkdirSync(docs("a.b/book.sdr"), { recursive: true });
  NodeFS.writeFileSync(docs("a.b/book"), "");
  NodeFS.mkdirSync(docs("a.sdr"));
  NodeFS.writeFileSync(docs("Dune.azw3"), "");
  NodeFS.mkdirSync(docs("Dune.sdr"));
  NodeFS.writeFileSync(outside, "");
  respond(
    "https://mailbox.invalid/commands/",
    [
      `001\tdelete\t${docs("a.b/book")}`,
      `002\tdelete\t${docs("Dune.azw3")}`,
      `003\tdelete\t${outside}`,
      `004\tdelete\t${root}/documents/../outside.azw3`,
      `005\trescan`,
      `006\treboot`,
    ].join("\n"),
  );

  expect(dropcap("start")).toBe(true);
  awaitPass();

  expect(NodeFS.existsSync(docs("a.b/book"))).toBe(false);
  expect(NodeFS.existsSync(docs("a.b/book.sdr"))).toBe(false);
  expect(NodeFS.existsSync(docs("a.sdr"))).toBe(true);
  expect(NodeFS.existsSync(docs("Dune.azw3"))).toBe(false);
  expect(NodeFS.existsSync(docs("Dune.sdr"))).toBe(false);
  expect(NodeFS.existsSync(outside)).toBe(true);
  expect(
    curlLog()
      .filter((line) => line.startsWith("PUT https://mailbox.invalid/commands/"))
      .map((line) => line.replace("PUT https://mailbox.invalid/commands/", "")),
  ).toEqual([
    "001 outcome=ok",
    "002 outcome=ok",
    `003 outcome=failed message=not in documents/: ${outside}`,
    `004 outcome=failed message=refusing ${root}/documents/../outside.azw3`,
    "005 outcome=ok",
    "006 outcome=failed message=unknown command reboot",
  ]);
});

it("starts Tailscale with the auth key from its file, then stops it and the receiver", () => {
  const { run, dropcap, installTailscale, tailscaleLog } = kindle();
  const authKey = NodePath.join(installTailscale(), "auth.key");

  NodeFS.writeFileSync(authKey, "tskey-test");

  expect(dropcap("ssh-start")).toBe(true);
  expect(tailscaleLog()).toContain(`up --ssh --hostname=kindle --auth-key=file:${authKey}`);
  expect(NodeFS.readFileSync(authKey, "utf8")).toBe("");
  expect(alive(NodePath.join(run, "tailscaled.pid"))).toBe(true);
  expect(processes("receive")).toHaveLength(1);

  expect(dropcap("ssh-stop")).toBe(true);
  expect(alive(NodePath.join(run, "tailscaled.pid"))).toBe(false);
  expect(processes("receive")).toHaveLength(0);
});

// At boot nobody can see a login link, so a missing login must park Tailscale instead of retrying.
it("a boot-time Tailscale start with no login leaves it stopped until a manual start", () => {
  const { run, dropcap, installTailscale } = kindle();
  const ts = installTailscale();

  expect(dropcap("ssh-start", { QUIET: "1" })).toBe(false);
  expect(NodeFS.existsSync(NodePath.join(ts, "needs-login"))).toBe(true);
  expect(alive(NodePath.join(run, "tailscaled.pid"))).toBe(false);
  expect(processes("receive")).toHaveLength(0);

  expect(dropcap("supervise", { QUIET: "1" })).toBe(true);
  expect(dropcap("running")).toBe(true);
  expect(NodeFS.existsSync(NodePath.join(run, "tailscaled.pid"))).toBe(false);
});

it("passes ShellCheck as busybox sh", () => {
  const files = [
    "dropcap.sh",
    "lib/mailbox.sh",
    "lib/tailscale.sh",
    "lib/wifi.sh",
    "lib/boot.sh",
    "../kd",
  ];

  // Pinned and fetched on demand into the pnpm store, so the linter adds nothing to the lockfile.
  const result = NodeChildProcess.spawnSync(
    "pnpm",
    ["dlx", "shellcheck@4.1.0", "-s", "busybox", "-x", ...files],
    { cwd: here, encoding: "utf8" },
  );

  // The npm wrapper prints a note while it downloads the binary on first use, so match findings only.
  expect(result.stdout.match(/SC\d{4}.*/g) ?? []).toEqual([]);
  expect(result.status).toBe(0);
});
