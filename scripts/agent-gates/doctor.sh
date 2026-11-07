#!/usr/bin/env bash
# Agent Context Forge Environment Doctor
# Runs pre-flight checks for LSP Code Intelligence (Pillar 2) and RTK Observation Masking (Pillar 3).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/check-lsp.sh"
"$SCRIPT_DIR/check-rtk.sh"
