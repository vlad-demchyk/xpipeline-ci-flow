---
name: pipeline-zones
description: Splitting a project into zones for its checks - which files reach which tests, `dependsOn` so a change tests every zone built on it, shared files (manifests, lockfiles, hooks) that defer the whole suite to the end of a session, files no zone claims, and fitting zones to npm workspaces, Cargo crates, Python and Go folders. Use it on «зони перевірок», «які тести зачіпає зміна», «чому не запустились тести пакета», «тести залежних пакетів», «define test zones», and when the runner says a file is claimed by no zone.
---

# Zones

A zone is a part of the project whose tests can run apart: an npm workspace, a crate, a Python
package, an app. The runner maps each changed file to zones by their `paths`, adds every zone built
on them (`dependsOn`, transitively), and runs each reached zone's `test`.

## Drawing them

- **One zone per unit with its own tests.** A workspace, a crate, an app. Not per folder of one
  package whose tests import each other: that zone's tests would miss the other's breakage.
- **`dependsOn` follows real imports.** A change in a library tests the library and every zone that
  imports it, so a push cannot come out green over a broken dependent. Read it from the manifests
  (workspace dependencies, path dependencies), not memory; `scripts/init.mjs` reads them for npm and
  Cargo.
- **A zone that cannot be told is not guessed at.** A file under a folder that is no zone (a fixture,
  a removed package) is listed as "no zone claims"; add it to a zone, to `shared`, or to `docs`.
- **Shared files** reach every zone: the root manifest and lockfile, the toolchain file, the
  hooks and the pipeline itself. Their change runs the light checks and the tests related to the
  changed files (`related`), and leaves the whole suite to session-end, said in the decision. Running
  everything on each lockfile change undoes the zones.
- **The tests related to a changed file still run** when shared files changed too: a measurement in
  XBrain found that dropping them on a shared change let a broken file through to session-end.
- **Contracts read from disk.** A file other zones read at run time (a route contract, a schema JSON)
  is not followed by import-based tools: name its readers in the zone's paths or `dependsOn`.

## Fitting tools

| Stack | Zone `test` | `suite` |
|---|---|---|
| Vitest workspace | `["npx", "vitest", "related", "--run", "{files}"]` | `["npx", "vitest", "run", "apps/web"]` |
| Jest | `["npx", "jest", "--findRelatedTests", "{files}"]` | `["npx", "jest", "apps/web"]` |
| npm workspace with its own script | `"npm test -w apps/web"` | same |
| Cargo crate | `["cargo", "test", "-q", "-p", "core"]` | same, or with `--all-features` |
| Python package | `["python", "-m", "pytest", "-q", "pkg/tests"]` | same |
| Go module | `"cd svc && go test ./..."` | same with `-race` |

Clippy or a linter per crate is a light step with `zones` when it takes seconds, or part of the
zone's `test` when it builds.

## Checking zones

- `node scripts/pipeline/run.mjs push --since <ref> --dry-run` on a few real past commits: does the
  decision name the zones a person would expect?
- A file of each zone in a test case of `policy.test.mjs` when the project's mapping is subtle.
- When a folder moves, change `paths` in the same commit; a stale zone is a zone whose tests never run.
