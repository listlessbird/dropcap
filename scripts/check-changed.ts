// Runs CI's fast checks for this branch's changes: format and lint of the changed files,
// typecheck, and the tests affected by the changes. CI still runs the full suites.
//
//   vp run check:changed          compare against the merge base with origin/main
//   vp run check:changed <ref>    compare against the merge base with <ref>
//
// Uncommitted and untracked files count.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.[cm]?[jt]sx?$/;

const git = (...args: Array<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

const ref = process.argv[2] ?? "origin/main";
const base = git("merge-base", "HEAD", ref)[0];
if (!base) {
  console.error(
    `check:changed: no merge base with ${ref}. Run \`git fetch origin\` or pass a ref.`,
  );
  process.exit(1);
}

const files = [
  ...new Set([
    ...git("diff", "--name-only", "--no-renames", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
]
  .filter((file) => NodeFS.existsSync(NodePath.join(root, file)))
  .sort();

if (files.length === 0) {
  console.log(`check:changed: no changes since ${base.slice(0, 12)}.`);
  process.exit(0);
}
console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`);

const code = files.filter((file) => CODE.test(file));
const steps: Array<[name: string, args: Array<string>]> = [
  ["format", ["fmt", "--check", "--no-error-on-unmatched-pattern", ...files]],
  ...(code.length > 0
    ? [
        ["lint", ["lint", "--report-unused-disable-directives", ...code]] as [string, string[]],
        ["typecheck", ["run", "-r", "--cache", "typecheck"]] as [string, string[]],
        ["test", ["test", "run", "--changed", base, "--passWithNoTests"]] as [string, string[]],
      ]
    : []),
];

const results = await Promise.all(
  steps.map(
    ([name, args]) =>
      new Promise<[string, boolean]>((resolve) => {
        const child = NodeChildProcess.spawn("vp", args, { cwd: root, shell: false });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (status) => {
          console.log(`\n── ${name} ${status === 0 ? "passed" : "FAILED"}\n${output.trimEnd()}`);
          resolve([name, status === 0]);
        });
      }),
  ),
);

const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
console.log(failed.length === 0 ? "\ncheck:changed: all passed" : `\nFAILED: ${failed.join(", ")}`);
process.exit(failed.length === 0 ? 0 : 1);
