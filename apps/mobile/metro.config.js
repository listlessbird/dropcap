const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

config.resolver = {
  ...config.resolver,
  // Worktree state and reference sources are never app code.
  blockList: [
    ...[config.resolver?.blockList ?? []].flat(),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.(t3|repos)[/\\\\].*`),
  ],
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
  polyfills: { rem: 14 },
});
