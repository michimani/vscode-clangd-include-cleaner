#!/usr/bin/env bash
set -euo pipefail

# Install project dependencies
npm install

# Install Claude Code (native installer)
curl -fsSL https://claude.ai/install.sh | bash
