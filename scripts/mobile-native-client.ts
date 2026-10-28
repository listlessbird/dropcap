// Installs the Android dev client that matches this checkout's native fingerprint, then prints one
// JSON line. A cached APK is reused when native inputs are unchanged; otherwise it builds once.
//
//   vp run mobile:install android [serial] [--rebuild]
//   vp run mobile:install android --abi x86_64     fill the cache without a connected device
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const mobile = NodePath.join(root, "apps", "mobile");
const DEV_PACKAGE = "com.listlessbird.kindledrop.dev";
const cacheRoot = NodePath.join(NodeOS.homedir(), ".cache", "kindle-drop");
const apkCache = NodePath.join(cacheRoot, "apks");
const recordCache = NodePath.join(cacheRoot, "installed");
const logPath = NodePath.join(cacheRoot, "build.log");

const sdk = process.env.ANDROID_HOME ?? NodePath.join(NodeOS.homedir(), "Android", "Sdk");
const env = { ...process.env, ANDROID_HOME: sdk, APP_VARIANT: "development" };
const adbPath = NodePath.join(sdk, "platform-tools", "adb");

const [platform, ...rest] = process.argv.slice(2);
const rebuild = rest.includes("--rebuild");
const abiFlag = rest.indexOf("--abi");
const requestedAbi = abiFlag === -1 ? undefined : rest[abiFlag + 1];
const requestedSerial = rest.find((arg, index) => !arg.startsWith("--") && index !== abiFlag + 1);

const finish = (result: Record<string, string | boolean>, code = 0): never => {
  console.log(JSON.stringify(result));
  process.exit(code);
};

const fail = (error: string, next: string) => finish({ status: "failed", error, next }, 1);

const run = (command: string, args: ReadonlyArray<string>, cwd = root) =>
  NodeChildProcess.execFileSync(command, args, { cwd, env, encoding: "utf8" }).trim();

const adb = (serial: string, ...args: ReadonlyArray<string>) =>
  run(adbPath, ["-s", serial, ...args]);

if (platform !== "android") fail(`Unsupported platform "${platform}".`, "Pass android.");

const devices = run(adbPath, ["devices"])
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .flatMap(([id, state]) => (id && state === "device" ? [id] : []));

const candidate = requestedSerial ?? (devices.length === 1 ? devices[0] : undefined);
const serial = candidate && devices.includes(candidate) ? candidate : undefined;

if (!serial && !requestedAbi) {
  fail(
    devices.length === 0
      ? "No Android device is connected."
      : `Pick one of: ${devices.join(", ")}.`,
    devices.length === 0 ? "Start one with `emulator -avd <name>`." : "Pass the serial.",
  );
}

// Fingerprint the same inputs EAS and expo-updates use, ignoring the generated native project.
const fingerprint = (): string => {
  const requireFromMobile = NodeModule.createRequire(NodePath.join(mobile, "package.json"));

  const script = `require(${JSON.stringify(requireFromMobile.resolve("expo/fingerprint"))})
    .createFingerprintAsync(${JSON.stringify(mobile)}, { platforms: ["android"], silent: true, ignorePaths: ["android/**"] })
    .then((fp) => console.log(fp.hash))`;

  return run(process.execPath, ["-e", script], mobile);
};

const hash = fingerprint();
const abi = requestedAbi ?? (serial ? adb(serial, "shell", "getprop", "ro.product.cpu.abi") : "");
const apk = NodePath.join(apkCache, `${hash}-${abi}.apk`);

const recordPath = NodePath.join(recordCache, `${serial}.json`);

if (serial && !rebuild) {
  // `pm path` exits non-zero when the package is missing.
  const installed = NodeChildProcess.spawnSync(
    adbPath,
    ["-s", serial, "shell", "pm", "path", DEV_PACKAGE],
    { encoding: "utf8" },
  ).stdout.startsWith("package:");

  const record = NodeFS.existsSync(recordPath)
    ? NodeFS.readFileSync(recordPath, "utf8").trim()
    : "";

  if (installed && record === hash) {
    finish({ status: "compatible", installed: false, fingerprint: hash, serial });
  }
}

// Prebuild deletes android/, which would throw away Gradle and CMake caches keyed by their inputs.
const preserveNativeCaches = (build: () => void) => {
  const saved = NodePath.join(mobile, ".android-cache");
  const caches = [".gradle", NodePath.join("app", ".cxx")];

  for (const cache of caches) {
    const from = NodePath.join(mobile, "android", cache);

    if (!NodeFS.existsSync(from)) continue;

    NodeFS.rmSync(NodePath.join(saved, cache), { recursive: true, force: true });
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(saved, cache)), { recursive: true });
    NodeFS.renameSync(from, NodePath.join(saved, cache));
  }

  build();

  for (const cache of caches) {
    const from = NodePath.join(saved, cache);
    const to = NodePath.join(mobile, "android", cache);

    if (NodeFS.existsSync(from) && !NodeFS.existsSync(to)) {
      NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
      NodeFS.renameSync(from, to);
    }
  }
};

let source = "cache";

if (rebuild || !NodeFS.existsSync(apk)) {
  source = "build";
  NodeFS.mkdirSync(apkCache, { recursive: true });

  const log = NodeFS.openSync(logPath, "w");

  const step = (command: string, args: ReadonlyArray<string>, cwd: string) => {
    const result = NodeChildProcess.spawnSync(command, args, {
      cwd,
      env: { ...env, EXPO_NO_GIT_STATUS: "1", CI: "1" },
      stdio: ["ignore", log, log],
    });

    if (result.status !== 0) {
      fail(`${command} ${args.join(" ")} failed.`, `Read ${logPath}.`);
    }
  };

  preserveNativeCaches(() =>
    step("npx", ["expo", "prebuild", "--clean", "--platform", "android", "--no-install"], mobile),
  );
  step(
    "./gradlew",
    [":app:assembleDebug", `-PreactNativeArchitectures=${abi}`],
    NodePath.join(mobile, "android"),
  );
  NodeFS.copyFileSync(
    NodePath.join(mobile, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    apk,
  );
}

if (!serial) finish({ status: "built", installed: false, source, fingerprint: hash, abi, apk });

adb(serial, "install", "-r", apk);

NodeFS.mkdirSync(recordCache, { recursive: true });

NodeFS.writeFileSync(recordPath, `${hash}\n`);

finish({ status: "installed", installed: true, source, fingerprint: hash, serial, apk });
