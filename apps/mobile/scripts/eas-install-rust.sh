#!/usr/bin/env bash
# EAS's `eas-build-pre-install` hook. Build images ship the NDK but no Rust, and modules/kindle-core's
# Gradle task runs `cargo ndk` for the ABIs in app.config.ts's buildArchs. `set-env` is how EAS
# carries PATH into the later Gradle step.
set -euo pipefail

[ "${EAS_BUILD_PLATFORM:-}" = android ] || exit 0

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
  sh -s -- -y --profile minimal --target aarch64-linux-android,x86_64-linux-android
export PATH="$HOME/.cargo/bin:$PATH"
cargo install cargo-ndk --version 4.1.2 --locked
set-env PATH "$PATH"
