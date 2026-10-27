// Shallow-clones read-only reference sources into the gitignored .repos/ at the version we install.
// Rerun after bumping the matching dependency in pnpm-workspace.yaml.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");

const REFERENCE_REPOS = [
  {
    dir: ".repos/effect-smol",
    repository: "https://github.com/Effect-TS/effect.git",
    catalogKey: "effect",
    tagPrefix: "effect@",
  },
] as const;

const catalog = NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8");

for (const repo of REFERENCE_REPOS) {
  const version = new RegExp(`^  "?${repo.catalogKey}"?: (\\S+)$`, "m").exec(catalog)?.[1];

  if (!version)
    throw new Error(`No catalog version for ${repo.catalogKey} in pnpm-workspace.yaml.`);

  const tag = `${repo.tagPrefix}${version}`;
  const dir = NodePath.join(root, repo.dir);

  NodeFS.rmSync(dir, { recursive: true, force: true });
  NodeChildProcess.execFileSync(
    "git",
    [
      "-c",
      "advice.detachedHead=false",
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--branch",
      tag,
      repo.repository,
      dir,
    ],
    { stdio: "inherit" },
  );
  console.log(`${repo.dir} at ${tag}`);
}
