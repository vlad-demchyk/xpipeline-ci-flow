---
name: pipeline-heavy-queue
description: The heavy-run queue that keeps several agents and the person from overloading one machine - `scripts/pipeline/heavy.sh` with a full lane and a light lane, half the cores a run, low priority, nested runs that do not wait on themselves, and when a run is heavy. Use it before running a whole test suite, a build, clippy over a workspace or a browser bench, when tests time out under load, when several agents work at once, and on «машина тормозить», «тести зависають», «черга прогонів», «heavy run», «too many test processes».
---

# The heavy-run queue

Test runners and compilers take every core by default. Two agents running suites at once, plus a
build, start three processes a core: tests of half a second take five and time out, different ones
each run, and the person's own work stalls. The queue fixes that on the machine, not in each test.

```
scripts/pipeline/heavy.sh [--light] <command...>
```

- **Two lanes.** The full lane holds whole-suite runs (session-end, a release build, the gates). The
  light lane holds a zone's run (one package's tests, the related tests). One run a lane at a time:
  the machine carries two heavy runs at most, and a run of a minute does not wait an hour behind a
  full suite.
- **Half the cores a run.** It sets `VITEST_MAX_WORKERS`, `CARGO_BUILD_JOBS`, `RUST_TEST_THREADS`
  and `GOMAXPROCS` to half the cores unless the caller set them; `PIPELINE_HEAVY_SHARE` overrides
  the share. Other runners take the share from `$PIPELINE_HEAVY_SHARE` in their command
  (`pytest -n $PIPELINE_HEAVY_SHARE`, `jest --maxWorkers=$PIPELINE_HEAVY_SHARE`).
- **Low priority** (`nice -n 10`): it takes what is idle.
- **A nested run does not wait on itself**: a heavy run that starts another (a suite whose script
  runs a second suite) holds the queue, and the inner run starts at once.
- **The lock is the machine's**, in `$TMPDIR`, shared by every project: two projects' suites queue too.
  `PIPELINE_HEAVY_LOCK` and `PIPELINE_HEAVY_LIGHT_LOCK` move the locks.
- Uses `lockf` (macOS) or `flock` (Linux); without either it runs unqueued and says so.

## What is heavy

Heavy: a whole suite, `cargo test|clippy|build` of more than one small crate, a production build, a
browser bench, a linter over the whole tree, a Linux CI run. Not heavy: one test file, a formatter
on the changed files, a typecheck of one package that takes seconds.

`run.mjs` routes the zones' runs through the light lane and the suites and gates through the full
lane by itself. By hand, wrap the command:

```sh
scripts/pipeline/heavy.sh --light npx vitest run apps/web/src/feature
scripts/pipeline/heavy.sh cargo test --workspace
```

The plugin's Bash hook reminds an agent when a heavy command starts past the queue in a project with a
policy; it never blocks.

## Several agents at once

- A worker runs its own zone, light lane. The whole suite is the coordinator's, once, at the end
  (pipeline-team).
- An agent waiting in the queue is not stuck: `lockf` waits. Do not kill a queued run to start yours.
- Stop a run by its exact PID, never by a pattern: a pattern kills other agents' runs and the
  person's processes.
- Build caches are shared, not copied: a worktree reuses the main tree's dependencies (a link to
  `node_modules`, a shared cargo target or one per worktree on purpose), since a fresh install or a
  from-scratch build is the heaviest run of all.
