#!/bin/bash
# Installs workspace dependencies in Claude Code cloud sessions so tests,
# typecheck and the playground build work immediately.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
corepack enable >/dev/null 2>&1 || true
pnpm install --prefer-offline
