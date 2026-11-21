---
name: pipeline-team
description: Checks when several agents or people work on one project - a worker commits and tests its own zone, the coordinator merges and runs the merge's zones, the whole suite runs once at the end of a session by the coordinator only; one shared tree or worktrees, staging by file; and installing the plugin personally (user scope) or for a team (project scope in the repository's .claude/settings.json) so every agent of the project follows the same policy. Use it when work is split between agents, on «команда», «кілька агентів», «координатор», «воркер», «встановити для команди», «team plugin», «shared checks policy».
---

# Checks in a team

## Who runs what

| Role | Runs | Never runs |
|---|---|---|
| Worker (one task, one branch or worktree) | `commit` on each commit (the hook), its zone's tests while working (light lane), `merge --dry-run` to see what its merge will cost | the whole suite; another worker's zone |
| Coordinator | `merge` after each merge into the shared branch, `push`, `session-end` once at the end | a worker's commit checks again |
| Person | whatever they choose; their word overrides a level for that run | |

- Green on the same code is not repeated: the coordinator does not re-run a worker's tests on an
  unchanged merge result unless the merge changed the files (a conflict resolution, a dependent zone).
- The whole suite runs once a session, by one agent. Two agents each running it "to be sure" is the
  load that makes tests flaky.
- A worker that finds a red test outside its zone reports it, it does not fix it on the side.

## One tree or worktrees

- Several agents in one working tree: stage files by name (`git add path`), never `git add -A` or a
  folder; never `git stash` (it takes others' work); check `git log` before trusting an empty
  `git status`.
- A worktree per agent is safer for checks: the hooks run on that tree's state. It reuses the main
  tree's installed dependencies (a link to `node_modules`, a shared or per-worktree build cache),
  never a fresh install.
- The template's hooks check the working tree. In a shared tree another agent's unstaged file can
  turn a commit red; the remedy is a worktree, not `--no-verify`.

## Installing the plugin

**For yourself** (every project on your machine, user scope):

- Claude Code: `claude plugin marketplace add vlad-demchyk/xpipeline-ci-flow`, then
  `claude plugin install xpipeline-ci-flow@xpipeline-ci-flow --scope user`.
- Codex: `codex plugin marketplace add vlad-demchyk/xpipeline-ci-flow`, then
  `codex plugin add xpipeline-ci-flow@xpipeline-ci-flow`.
- XBrain: the switch in the library's ecosystem plugins does both, and brings it up to date at each
  start.

**For a team** (everyone who opens the repository, project scope): from the repository root,
`claude plugin marketplace add vlad-demchyk/xpipeline-ci-flow --scope project` and
`claude plugin install xpipeline-ci-flow@xpipeline-ci-flow --scope project`. That writes
`extraKnownMarketplaces` and `enabledPlugins` into `.claude/settings.json`; commit it, and Claude
Code offers the plugin to every member who trusts the folder. Codex has no project scope: each member
installs it personally.

The policy itself (`pipeline.config.json`, `scripts/pipeline/`, `.githooks/`) is committed, so it is
the team's whatever way the plugin came. Each clone runs `git config core.hooksPath .githooks` once
(the README of the project says so; a `prepare` or setup script can do it).

A brain-wide team plugin (every agent of a team brain getting it from the brain) is not there yet;
until then project scope is the team's way.

## Changing the team's policy

The config is shared: a change to it is a change to every agent's checks. It goes in its own commit
with the reason in the `why` of what changed, reviewed like code. A level the person set stays until
the person changes it.
