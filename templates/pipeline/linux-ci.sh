#!/usr/bin/env bash
# The CI test job (.github/workflows/ci.yml, job `test`), run locally in Ubuntu by `linux-ci`
# (skill pipeline-linux-ci). Keep the two in step: a step this skips is a failure CI finds only
# after the push. Copied into the repository root as `.linux-ci.sh`; replace the steps below with
# the job's own, in the same order and at the same versions.
set -euo pipefail

NODE_MAJOR=22

# System packages, once per VM: behind a marker, so later runs skip them.
if [ ! -f /var/lib/linux-ci/example-node-$NODE_MAJOR ]; then
  curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | sudo -E bash - >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  sudo touch /var/lib/linux-ci/example-node-$NODE_MAJOR
fi

node --version
npm ci --no-audit --no-fund
npm run lint --if-present
npm test --if-present -- "$@"
