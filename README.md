# XPipeline CI Flow

Checks that run where the change is. A plugin for Claude Code and Codex that teaches agents a
project's checks' policy, and a template that puts the policy into a project:

- **Levels by action.** A commit runs light checks (seconds); a merge and a push run the tests of the
  zones the change reaches and of every zone built on them; the whole suite and the gates run once,
  at the end of a session. A release and documentation-only changes stay light.
- **Kinds raise checks where they apply.** A data or security change brings the gates and the whole
  suite of the zones it touches; a UI change does when the task names it.
- **Every skip has a reason**, printed in the decision. A skip the policy does not make is proposed to
  the person and recorded when they agree; a required gate cannot be skipped.
- **Tests that can fail.** A failing test before a bug fix, the code broken on purpose once to see a
  new test red, guard tests for architecture findings, skipped tests with a reason and a platform.
- **A heavy-run queue** so several agents and the person share one machine: two lanes, half the
  cores a run, low priority.
- **Linux CI on a Mac** before a push, in a light Ubuntu VM (`linux-ci`), and **live checks on an
  isolated bench** that never touch the person's data or agent configs.

It is the generalised form of the checks XBrain uses on itself; XBrain offers it in its library as
an optional plugin. It works without XBrain.

Start with the `pipeline-start` skill.

## Skills

| Skill | What it does |
|---|---|
| `pipeline-start` | The rules every agent keeps, the commands of each moment, which skill does what |
| `pipeline-policy` | `pipeline.config.json`: actions and levels, light steps, zones' commands, kinds, gates; reading a decision |
| `pipeline-zones` | Drawing zones, `dependsOn`, shared files, files no zone claims, commands per stack |
| `pipeline-tests` | Where a test goes, proving it red, mutation by hand, guard tests, skips with reasons, flaky tests |
| `pipeline-heavy-queue` | `heavy.sh`: lanes, the machine's share, nested runs, several agents at once |
| `pipeline-bench` | Live checks with their own HOME, config dirs, port and mocked secrets, stopped by PID |
| `pipeline-linux-ci` | `linux-ci` and `.linux-ci.sh`: the CI job's steps in an Ubuntu VM before a push |
| `pipeline-skip-proposal` | Judging a light change and asking the person which checks to skip, with options |
| `pipeline-team` | Workers, coordinator, one tree or worktrees; personal and team installation |

## Agents

`pipeline-setup` installs the template into a project and fits the config to its real zones and
tests, proving it with dry runs. `test-auditor` reads a change and its tests, read-only, and says
whether each test can fail, sits in the right zone and is reached by the policy.

## Hooks

- **SessionStart**: in a project with `pipeline.config.json`, one line telling the agent the policy
  is there and how to read it. Elsewhere nothing.
- **PreToolUse on Bash**: `--no-verify` (or `git commit -n`) asks the person, since a skip is theirs;
  in a project with a policy, a heavy command started past the queue gets a reminder. Nothing is
  blocked.

Claude Code runs them once the plugin is installed. Codex runs a plugin's hooks only after the person
trusts them in its terminal (and again after each plugin update); the skills work without them.

## The project template

`templates/pipeline/`, installed by `node scripts/init.mjs <project>`:

| File | In the project | What it is |
|---|---|---|
| `policy.mjs` | `scripts/pipeline/` | the pure decision: action, changed files, kinds → runs and skips with reasons |
| `run.mjs` | `scripts/pipeline/` | finds the change, prints the decision, runs it |
| `heavy.sh` | `scripts/pipeline/` | the heavy-run queue |
| `*.test.mjs` | `scripts/pipeline/` | the template's tests: `node --test scripts/pipeline/*.test.mjs` |
| `githooks/*` | `.githooks/` | pre-commit (commit), pre-push (push, push-main), post-merge (merge) |
| `pipeline.config.json` | root | an example; `init.mjs` writes a starter with the zones it can tell from npm workspaces, a Cargo workspace, Python and Go folders |
| `linux-ci.sh` | `.linux-ci.sh` | a starter for Linux CI (`--linux-ci`) |

`init.mjs` never overwrites: a file the project has stays, and the report says what to merge by hand.
It sets `core.hooksPath` to `.githooks` only when nothing else is set. Node 20 or newer and `sh`; no
dependencies.

```sh
node scripts/pipeline/run.mjs commit|merge|push|push-main|release|qa|session-end \
  [--kind ui,data] [--since <ref>] [--skip "<step>=<reason>"] [--dry-run] [--json]
```

## Install

For yourself:

- Claude Code: `claude plugin marketplace add vlad-demchyk/xpipeline-ci-flow`, then
  `claude plugin install xpipeline-ci-flow@xpipeline-ci-flow --scope user`.
- Codex: `codex plugin marketplace add vlad-demchyk/xpipeline-ci-flow`, then
  `codex plugin add xpipeline-ci-flow@xpipeline-ci-flow`. Codex reads the Claude manifests as they are.
- XBrain: the switch in the library's ecosystem plugins installs it in both and keeps it current.
- Claude Desktop: `scripts/build-zip.sh`, then Customize → Plugins → Add → Upload plugin with
  `dist/xpipeline-ci-flow-<version>.zip`.

For a team, in the repository: `claude plugin marketplace add vlad-demchyk/xpipeline-ci-flow --scope project`
and `claude plugin install xpipeline-ci-flow@xpipeline-ci-flow --scope project`, then commit
`.claude/settings.json`. The policy, the runner and the hooks are committed files, so the whole team
follows the same checks.

## Developing the plugin

`npm run check`: the manifests, skills, agents and hooks (`scripts/check.mjs`) and every test. A
version bump changes `plugin.json` and `marketplace.json` together. Agents get the version pushed to
GitHub.

## License

MIT.
