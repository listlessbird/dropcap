// Prepares a new worktree. Runs from t3.json before dependencies exist, so only Node built-ins.
// .t3/setup-running holds this PID until setup ends with .t3/setup-done or .t3/setup-failed,
// so agents wait for it instead of racing it with their own install.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ENV_FILES = [".env", NodePath.join("apps", "mobile", ".env")];

const worktree = NodePath.dirname(import.meta.dirname);
const markerDir = NodePath.join(worktree, ".t3");
const runningMarker = NodePath.join(markerDir, "setup-running");
const doneMarker = NodePath.join(markerDir, "setup-done");
const failedMarker = NodePath.join(markerDir, "setup-failed");

NodeFS.rmSync(doneMarker, { force: true });

NodeFS.rmSync(failedMarker, { force: true });

NodeFS.mkdirSync(markerDir, { recursive: true });

NodeFS.writeFileSync(runningMarker, `${process.pid}\n`);

let failureDetail = "";

process.on("uncaughtExceptionMonitor", (error) => {
  failureDetail = error.stack ?? String(error);
});

process.on("exit", (code) => {
  if (code === 0) NodeFS.writeFileSync(doneMarker, "");
  else NodeFS.writeFileSync(failedMarker, `Setup exited with code ${code}.\n${failureDetail}\n`);

  NodeFS.rmSync(runningMarker, { force: true });
});

const projectRoot = process.env.T3CODE_PROJECT_ROOT;

if (!projectRoot) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}

// A stale lockfile must fail, not be rewritten. Closed stdin makes any prompt fail.
const install = NodeChildProcess.spawnSync("pnpm", ["install", "--frozen-lockfile"], {
  cwd: worktree,
  stdio: ["ignore", "inherit", "pipe"],
  encoding: "utf8",
});

if (install.status !== 0) {
  failureDetail = install.stderr.trimEnd().split("\n").slice(-30).join("\n");
  process.exit(install.status ?? 1);
}

// Worktrees link the main checkout's env files. Only symlinks are replaced, so real files survive.
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);

  if (!NodeFS.lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;

  const target = NodePath.join(worktree, file);
  const existing = NodeFS.lstatSync(target, { throwIfNoEntry: false });

  if (existing && !existing.isSymbolicLink()) continue;

  if (existing) NodeFS.rmSync(target);

  NodeFS.symlinkSync(source, target);
}

// Reference sources are gitignored, so copy the main checkout's instead of cloning again.
const repos = NodePath.join(projectRoot, ".repos");

if (NodeFS.existsSync(repos) && !NodeFS.existsSync(NodePath.join(worktree, ".repos"))) {
  NodeFS.cpSync(repos, NodePath.join(worktree, ".repos"), { recursive: true });
}
