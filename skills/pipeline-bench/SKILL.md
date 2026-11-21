---
name: pipeline-bench
description: Live checks on an isolated bench - a test environment with its own HOME, data folder, config dirs and a free port, headless, mocked secrets, stopped by exact PID - so a check never touches the person's real data, accounts or agent configs. Use it before running an app, a daemon, a CLI or an installer to see a change work, for QA passes, for installing a plugin or tool to test it, and on «перевір наживо», «запусти стенд», «live check», «test it for real», «run the app».
---

# The bench: live checks that touch nothing real

A unit test proves a function; a live check proves the thing works as a person uses it. A live
check on the person's own setup can also break it: their data, their accounts, their agents'
configs. The bench is a copy of the world for one check.

## The bench's parts

| Part | How |
|---|---|
| Home | `HOME=$(mktemp -d)` or a folder in the session's scratch space; the app's data dir under it |
| Agent configs | `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and the like pointed at copies in the bench; copy what the check needs, never edit the originals |
| Port | a free port found at start (`node -e "s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"`), never a port another session or the person's app uses |
| Secrets | mocks or test keys from the project's test environment; never the person's keychain or real tokens |
| Accounts | the project's test accounts by their documented way; never type the person's credentials |
| UI | headless browser or a window the person does not use |
| Network | the local stack; a check that would reach production says so and stops |

## Running a check

1. Build what is checked from the branch under test (not an installed release).
2. Start it on the bench, note its PID.
3. Drive it as a person would: the command, the page, the API call. Capture evidence: output,
   screenshots at the sizes the project asks, logs.
4. Stop it by that exact PID (`kill <pid>`), never by a name pattern: a pattern stops the person's
   own apps and other agents' runs.
5. Remove the bench folder, or leave it named in the report when the person may want to look.

## What a bench check reports

What was started (version, commit), where (the bench folders, port), what was done, what was seen,
and the evidence. A check that could not run (no account on the bench, a service unreachable) says
so and leaves that check to the person; it is never reported as passed.

## Installing a plugin or tool to test it

Install into the bench's config dirs: `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` all in the bench,
`claude plugin marketplace add <local path>` then `claude plugin install <name>@<market> --scope user`,
`codex plugin marketplace add <local path>` then `codex plugin add <name>@<market>`. List what loaded
from the bench's cache. The person's own installation is not touched.
