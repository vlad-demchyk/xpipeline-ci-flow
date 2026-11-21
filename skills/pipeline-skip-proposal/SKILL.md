---
name: pipeline-skip-proposal
description: How an agent proposes skipping checks a light change does not need - judging the change's complexity, importance and the areas it touches (API, users, billing, notifications, compatibility, data, security), offering the skips as a question with options (AskUserQuestion in Claude Code, a plain question elsewhere, the coordinator in its session), never skipping on its own what the policy requires, and recording the agreed skip with its reason. Use it when a change is small and the policy's level seems more than it needs, before using --no-verify, and on «пропусти перевірки», «можна без тестів?», «не ганяй усе», «skip the tests», «this is a tiny change».
---

# Proposing to skip checks

The policy decides by files and action; the agent sees the task. A one-word copy fix in a zone with a
ten-minute suite does not need that suite. But a skip is the person's call: the agent proposes, the
person agrees, and the skip is recorded with its reason.

## What the agent never skips by itself

- A step the decision marks required (a gate the project marks `required`, every gate when a data or
  security kind is present): the runner refuses such a skip anyway.
- Anything in a change that touches money, users' data, auth, permissions, notifications sent to
  people, a public API or a stored format, whatever its size.
- The end-of-session suite, when the agent is the one who runs it.
- A hook, with `--no-verify`. The plugin's Bash hook asks the person when it sees one.

## Judging the change

Answer each before proposing anything:

| Question | A skip is possible when |
|---|---|
| Complexity | the diff is small and its effect is local (copy, a comment, a style value, a rename inside one file) |
| Importance | nothing a person relies on changes behaviour |
| Areas touched | none of: API, users and accounts, billing, notifications, compatibility (formats, migrations, versions), data, security |
| Tests near the code | the zone's fast tests ran or will run, only its whole suite is in question |
| Reversibility | a mistake is cheap to find later and cheap to undo |

If any answer is no, run the policy's level and say why in one line.

## Asking

Run `node scripts/pipeline/run.mjs <action> --dry-run` first and base the question on its decision:
the steps it would run, how long they usually take, and which of them the change does not need.

- **Claude Code**: AskUserQuestion with one question and options, for example: "Run everything the
  policy asks (web suite, ~6 min)", "Skip the web suite: copy change only, the related tests still
  run (recommended)", "Skip all tests for this commit". Put the recommended option first and say
  why in its description.
- **Other agents**: the same question as plain text with numbered options; wait for the answer.
- **A worker under a coordinator**: the question goes to the coordinator in its report or message,
  not to the person directly; the coordinator asks the person or decides by the person's standing rules.
- **The person's standing rule** (in the project's rules or the policy's config) answers the question
  in advance; cite it instead of asking.

## Doing the agreed skip

```sh
node scripts/pipeline/run.mjs push --skip "web tests=copy change only, agreed by the person 2026-11-21"
```

The runner prints the skip with its reason, refuses a required step, and appends the skip to
`.git/pipeline/skips.log` (date, action, step, reason). The report of the task says what was skipped,
why, and who agreed. A skip agreed for one change is not a rule: the next change asks again, unless
the person makes it a rule in the config.
