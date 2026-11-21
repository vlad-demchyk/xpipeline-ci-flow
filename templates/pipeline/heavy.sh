#!/bin/sh
# The heavy-run queue of this machine: a whole test suite, a build, a linter over a workspace. Agents
# and people working at once wait in line here instead of loading the machine together, and each run
# takes its share of the cores at a low priority, so the window, the editor and the other sessions
# keep what they use.
#
#   scripts/pipeline/heavy.sh [--light] <command...>
#
# Two lanes. The full lane holds whole-suite runs: the end of a session, a release build, the gates.
# A zone's run (one package's tests, the tests related to the changed files) goes `--light`: its own
# lane, one at a time beside one full run, so a run of a minute does not wait an hour behind a full
# suite. The machine carries two heavy runs at most.
#
# Each run gets half the cores: test runners and compilers take every core by default, and two of
# them together with a build started three processes a core, where tests of half a second took five
# and timed out, different ones each run. A share the caller set is kept.
#
# A heavy run that starts another (a suite whose script runs a second suite) already holds the
# queue: the inner one runs at once instead of waiting on itself forever.
#
# Environment: PIPELINE_HEAVY_SHARE (cores a run takes), PIPELINE_HEAVY_LOCK and
# PIPELINE_HEAVY_LIGHT_LOCK (the lanes' lock files, shared by every project on the machine by default).
lane=full
if [ "$1" = "--light" ]; then
  lane=light
  shift
fi
if [ $# -eq 0 ]; then
  echo "usage: heavy.sh [--light] <command...>" >&2
  exit 2
fi
if [ -n "$PIPELINE_HEAVY_HELD" ]; then
  exec "$@"
fi
cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)
share="${PIPELINE_HEAVY_SHARE:-$((cores / 2))}"
[ "$share" -ge 1 ] 2>/dev/null || share=1
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-$share}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-$share}"
export RUST_TEST_THREADS="${RUST_TEST_THREADS:-$share}"
export GOMAXPROCS="${GOMAXPROCS:-$share}"
export PIPELINE_HEAVY_SHARE="$share"
if [ "$lane" = light ]; then
  lock="${PIPELINE_HEAVY_LIGHT_LOCK:-${TMPDIR:-/tmp}/pipeline-heavy-light.lock}"
else
  lock="${PIPELINE_HEAVY_LOCK:-${TMPDIR:-/tmp}/pipeline-heavy.lock}"
fi
if command -v lockf >/dev/null 2>&1; then
  exec lockf -k "$lock" env PIPELINE_HEAVY_HELD=1 nice -n 10 "$@"
elif command -v flock >/dev/null 2>&1; then
  exec flock "$lock" env PIPELINE_HEAVY_HELD=1 nice -n 10 "$@"
fi
echo "heavy.sh: neither lockf nor flock is here; running without the queue" >&2
exec env PIPELINE_HEAVY_HELD=1 nice -n 10 "$@"
