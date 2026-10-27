// CI's fast checks for this branch's changes (format, lint, typecheck, affected tests).
// Compares against the merge base with origin/main, or with the ref passed as the first argument.
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

type Step = readonly [name: string, args: ReadonlyArray<string>];

const steps: Array<Step> = [
  ["format", ["fmt", "--check", "--no-error-on-unmatched-pattern", ...files]],
];

if (code.length > 0) {
  steps.push(
    ["lint", ["lint", "--report-unused-disable-directives", ...code]],
    ["typecheck", ["run", "-r", "--cache", "typecheck"]],
    ["test", ["test", "run", "--changed", base, "--passWithNoTests"]],
  );
}

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
