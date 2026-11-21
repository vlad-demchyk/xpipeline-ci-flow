---
name: pipeline-start
description: The entry to a project's checks - which level of checks an action runs (light, medium, heavy), where a test goes, what may be skipped and who decides, the heavy-run queue, the bench and Linux CI - and which skill does each part. Use it before committing, merging, pushing or releasing in a project with `pipeline.config.json`, when setting up checks in a project («налаштуй перевірки», «пайплайн перевірок», «рівні тестів», «set up CI checks», «what tests should run»), and whenever an agent is unsure which tests to run or whether it may skip them.
---

# A project's checks: the order and the rules

The checks of a project are not "run everything every time" and not "run what feels relevant". They
are a policy the project writes down once: each action has a level, each level runs the zones the
change reaches, each skip has a reason, and the whole suite runs once, at the end of a session.

## The rules every agent keeps

1. **Heavy runs only where the change is.** A change in one zone tests that zone and the zones built
   on it, not the whole project. The whole suite runs once, at the end of a session, by one agent.
2. **Every skip has a reason, and it is printed.** A step that does not run says why. A skip the
   policy does not make is the person's to agree to, never the agent's (pipeline-skip-proposal).
3. **Green on the same code is not repeated.** A merge does not re-run the light checks each commit
   ran; a push does not re-run what the merge of the same commits ran.
4. **A test proves something only if it can fail.** A new test or gate is broken on purpose once to
   see it red (pipeline-tests).
5. **One heavy run a lane on the machine.** Agents working at once queue their heavy runs
   (pipeline-heavy-queue) instead of loading the machine together.
6. **A flaky test is a finding, not a timeout to raise.** First look at the load on the machine.
7. **Live checks run on a bench of their own**, never on the person's real data or agent configs
   (pipeline-bench).

## In a project that has a policy

`pipeline.config.json` in the repository root means the template is in place.

| Moment | Command | Level |
|---|---|---|
| Before a commit (the hook does it) | `node scripts/pipeline/run.mjs commit` | light |
| After merging a branch | `node scripts/pipeline/run.mjs merge` | medium |
| Before a push (the hook does it) | `node scripts/pipeline/run.mjs push` | medium; push-main adds the gates |
| A release | `node scripts/pipeline/run.mjs release` | light |
| A QA pass | `node scripts/pipeline/run.mjs qa` | medium |
| The end of a session, once | `node scripts/pipeline/run.mjs session-end` | heavy |

Add `--dry-run` to read the decision without running it, `--kind ui` (or data, security, the
project's own kinds) when the task is of that kind, `--json` for a machine-readable decision. Read
the decision before reporting: "runs" and "skips" with their reasons are what the report says was
checked.

## In a project without one

Offer to set it up; do not write it unasked. With the person's yes: the `pipeline-setup` agent, or
by hand `node <plugin>/scripts/init.mjs <project>` and then pipeline-policy and pipeline-zones to
check what it wrote.

## Which skill

| Need | Skill |
|---|---|
| Levels, actions, kinds, gates; writing or changing `pipeline.config.json` | pipeline-policy |
| Zones: which files reach which tests, shared files, dependents | pipeline-zones |
| Where a test goes, how it is proved, mutation and guard tests, skipped tests | pipeline-tests |
| The heavy-run queue, the machine's share, several agents at once | pipeline-heavy-queue |
| A live check on an isolated bench | pipeline-bench |
| Linux CI on a Mac before a push | pipeline-linux-ci |
| Proposing to skip checks on a light change, asking the person | pipeline-skip-proposal |
| Workers, coordinator, the team's shared policy, installing for a team | pipeline-team |

## Agents

`pipeline-setup` writes the policy into a project and checks it. `test-auditor` reads a change and
its tests and says, read-only, whether each test can fail, sits where it belongs and covers the
change.
