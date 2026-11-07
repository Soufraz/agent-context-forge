#!/usr/bin/env bash
# Rust Token Killer (RTK) Pre-Flight Check (Pillar 3)
# Checks if `rtk` is available to compress terminal and test outputs before entering context.

set -euo pipefail

if command -v rtk >/dev/null 2>&1; then
  printf '✓ [Observation Masking]: Active (`rtk` installed). Test/build stdout compression enabled.\n'
  exit 0
else
  printf '⚠️  [Observation Masking Notice]: `rtk` (Rust Token Killer) is not found on PATH.\n'
  printf '   Running raw test suites can dump hundreds of passing tests into working context.\n'
  printf '   To enable smart test output compression (collapsing passing suites and keeping only failure diffs):\n'
  printf '   → Install: brew install rtk (macOS/Linux), winget install rtk-ai.rtk (Windows),\n'
  printf '     or see https://github.com/rtk-ai/rtk. Confirm with `rtk gain`: a different crate named "rtk" exists on crates.io.\n'
  exit 0
fi
