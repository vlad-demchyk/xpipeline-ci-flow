---
name: pipeline-linux-ci
description: Running a project's Linux CI locally on a Mac before a push, in a light Ubuntu VM (Lima, Apple virtualization, no Docker) with the `linux-ci` command and the project's `.linux-ci.sh`, the same steps as the CI job. Use it before a push or release of a project whose CI runs on Linux (GitHub `ubuntu-*` runners), after a CI failure to reproduce and prove the fix, and on «прогнати в Linux», «перевір як у CI», «linux-ci», «симулюй CI», «чому впав CI», «reproduce CI locally».
---

# Linux CI on a Mac

CI runs on Linux; the work is done on macOS. What differs (GNU and BSD tools, fonts, system
libraries, case-sensitive paths, `/tmp`) is found after a push, when a release already failed.
`linux-ci` closes the gap: an Ubuntu VM that matches the CI image runs the project's CI steps on a
copy of the tree, before anything leaves the machine.

## Setup, once per machine

1. `brew install lima`.
2. Install the command: `install -m 755 <plugin>/scripts/linux-ci ~/.local/bin/linux-ci` (the plugin
   ships it; `~/.local/bin` on `PATH`).
3. The first run creates VM `linux-ci`: Ubuntu 24.04 (what `ubuntu-latest` runs; check a CI log's image
   line when the label moves), `vz`, 4 CPU, 6 GiB, 40 GiB, plain: no shared folders, no containers,
   no port forwarding. It provisions apt basics, `xvfb` and `uv` once.

The project is copied (rsync, without `node_modules`, venvs, `dist`, `build`, caches), never mounted:
the VM cannot change the person's files. The VM persists, so packages and toolchains are paid for once.

## Adding a project

1. Read the CI's test job (`.github/workflows/*.yml`, the job on `ubuntu-*`).
2. Write `.linux-ci.sh` in the repository root (`scripts/init.mjs --linux-ci` puts a starter there):
   the same steps in the same order. System packages once, behind a marker in `/var/lib/linux-ci/`;
   the toolchain at the CI's versions; toolchain caches and venvs outside the synced tree (rsync
   deletes what is not in the source); lint; then tests. Name the workflow and job in its header and
   keep the two in step: a step the script skips is a failure CI finds after the push.
3. Commit it.

## Use

| Command | What it does |
|---|---|
| `linux-ci` | the current project's `.linux-ci.sh` in the VM |
| `linux-ci DIR -- ARGS` | another folder; ARGS go to the script |
| `linux-ci --shell [DIR]` | a shell in the synced copy, to debug a failure |
| `linux-ci --status` / `--stop` | the VM's state / stop it (disk and caches kept) |
| `linux-ci --reset` | delete and recreate the VM |

A Linux CI run is heavy: from an agent, `scripts/pipeline/heavy.sh linux-ci`.

## When

- Before a push that triggers a release, and before a push to a branch whose CI runs on Linux: the
  whole script, not only the changed files' tests. A project can make this a gate of `push-main`.
- After a CI failure: reproduce it with `linux-ci` first, fix, prove the fix the same way, then push.
  Never push a guess and wait for CI.
- A test that passes on macOS and fails in the VM is a real Linux defect or a test that assumes macOS.
  Mark a test macOS-only only when the code it tests is macOS-only, with the reason (pipeline-tests).

## Limits

- The VM is arm64; GitHub's `ubuntu-latest` is x86_64. OS differences are caught; an
  architecture-specific wheel or binary is not: CI stays the judge for that.
- Not a GitHub Actions emulator: it runs the script, not the YAML. Secrets and release jobs stay in CI.
- The first run of a project is slow; later runs reuse the VM's packages and caches.
