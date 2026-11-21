---
name: pipeline-tests
description: Where a test goes and how it is proved - a test beside the code it checks, a failing test before a bug fix, breaking the code or a gate on purpose to see it red (mutation), guard tests that keep an architecture finding from coming back, rewriting tests for a new architecture instead of bending code to old ones, skipping a test with a reason and a platform, flaky tests as load findings. Use it on «додай тест», «де має бути тест», «тест не ловить», «пропустити тест», «нестабільний тест», «add a test», «flaky test», «regression test», and before reporting that a change is tested.
---

# Tests: where they go and how they are proved

## Where a test goes

- **Beside the code it checks**, in the zone of that code, in the project's own test layout
  (`foo.test.ts` next to `foo.ts`, `#[cfg(test)]` in the module, `tests/` for integration). A test in
  another zone runs only when that zone is reached, and the change it guards slips through.
- **At the lowest level that can fail for the bug**: a pure function's unit test before an API test,
  an API test before a browser test. The higher level is added only for what only it can see
  (wiring, layout, a real browser).
- **One behaviour a test**, named by the behaviour ("a merge skips the light checks"), so a red
  test says what broke.

## How a test is proved

A test that cannot fail proves nothing. Before a test counts:

1. **A bug fix starts with a test that fails** on the unfixed code, for the reason of the bug. Run it,
   see it red, then fix, then see it green.
2. **A new test or gate is broken on purpose once**: change the code it guards (flip a condition,
   drop a step, return early) and see the test red; put the code back. This is mutation by hand; a
   gate that stays green with its check removed is decoration. Say in the report what was broken and
   that it went red.
3. **The test runs in the zone's command.** A test file the zone's `test` never reaches (a wrong
   glob, a skipped folder) is no test; check it appears in the run's output.

## Guard tests

An architecture finding (a module that must not import another, a write that must go through one
function, a size limit, a file that must stay in English) becomes a test that reads the source and
fails when the finding comes back. Keep each guard small, name the finding and the reason in it, and
give it an allowlist with a reason per entry rather than an exception in the code. Guards are light:
they read files, so they belong to the light steps or the zone's fast tests.

## When architecture changes

When a refactor breaks tests or docs, rewrite them for the new architecture. Never bend the new code
to keep an old test green: the old test describes a design that no longer exists.

## Skipping a test

- A test is skipped only with a reason in the code, and, when the reason is a platform, the platform:
  `it.skipIf(process.platform !== "darwin")("...")  // osascript is macOS-only`.
- A test is marked platform-only only when the code it tests is platform-only. A test that fails on
  Linux and passes on macOS is a Linux defect or a test that assumes macOS: fix it (pipeline-linux-ci).
- `skip`, `only`, `todo` and `#[ignore]` never land without that reason; a guard test may forbid a
  bare one.

## Flaky tests

A test that fails sometimes is a finding. Before raising a timeout:

1. Run it alone, then under load. If it passes alone and fails under load, the machine is
   oversubscribed: the heavy queue's share (pipeline-heavy-queue), not a longer timeout.
2. Look for shared state: a port, a temp folder, a global, an order between tests.
3. A timeout is raised only with the measured reason in a comment.

## Green is not repeated

The same code with the same green result is not run again: a merge skips what each commit ran, a
push skips what its merge ran (`run.mjs` does this by action). Re-running a green suite "to be sure"
costs the machine and every other agent on it.

## Reporting

A report names what ran (zones, suites, gates) and what was skipped with the reason the runner
printed, the tests added and how each was proved red. "All tests pass" without the scope is not a
report.
