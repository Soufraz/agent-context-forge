#!/usr/bin/env bash
# Rust Token Killer (RTK) Pre-Flight Check (Pillar 1c)
# Checks if `rtk` is available to compress terminal and test outputs before entering context.

set -euo pipefail

if command -v rtk >/dev/null 2>&1; then
  printf '✓ [Observation Masking]: Active (`rtk` installed). Test/build stdout compression enabled (~60-90%% token savings).\n'
  exit 0
else
  printf '⚠️  [Observation Masking Notice]: `rtk` (Rust Token Killer) is not found on PATH.\n'
  printf '   Running raw test suites can dump hundreds of passing tests into working context.\n'
  printf '   To enable smart test output compression (collapsing passing suites and keeping only failure diffs):\n'
  printf '   → Install: cargo install rtk-ai (or check https://github.com/rtk-ai/rtk)\n'
  exit 0
fi
