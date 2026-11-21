---
name: pipeline-policy
description: Writing and changing a project's checks' policy in `pipeline.config.json` - actions and their levels (light, medium, heavy), light checks, zones with their test and suite commands, kinds of a change (docs, ui, data, security, the project's own) that raise checks in the zones they touch, gates, and how to read the runner's decision. Use it on «задай рівні перевірок», «які тести на коміт», «змінити політику перевірок», «додати гейт», «нова зона», «configure check levels», when `run.mjs` reports a config error, and before changing what a hook runs.
---

# The checks' policy

The policy is data (`pipeline.config.json`) and one pure function (`scripts/pipeline/policy.mjs`,
`decide`). The runner (`run.mjs`) finds the changed files, asks the policy and runs its answer.
Change the data for the project; change `policy.mjs` only when the rules themselves change, and its
test (`policy.test.mjs`) with it.

## Actions and levels

| Action | Default level | Why it stops there |
|---|---|---|
| commit | light | a commit keeps the work; a push or a merge proves it |
| merge | medium | each commit ran the light checks; a merge runs the zones it brought |
| push | medium | the zones the pushed commits reach |
| push-main | medium + gates | a push to a main branch (`mainBranches`) or a tag |
| release | light | the merge of the same zones ran their tests |
| qa | medium | the zones under check; the live bench is QA's own |
| session-end | heavy | once: every zone's whole suite, every light check, every gate |

- **light**: the `light` steps (format, lint, typecheck: seconds). A step with `zones` runs only
  when the change touches one of them. A step with `"docs": true` runs on documentation too.
- **medium**: light, then each zone the change reaches runs its `test`; kinds may raise a zone to its
  `suite` and bring the gates. A merge skips the light steps.
- **heavy**: every light step, every zone's `suite`, every gate, on the full lane of the queue.
- **Documentation alone** is light at every action but session-end.

Override an action in `actions` (`{"release": {"level": "medium", "why": "..."}}`); add the
project's own action the same way. Keep the `why`: the runner prints it, and it is what the next agent reads.

## The file

```json
{
  "base": "origin/main",
  "mainBranches": ["main"],
  "shared": ["package.json", "package-lock.json", ".githooks/", "scripts/pipeline/", "pipeline.config.json"],
  "docs": ["**/*.md", "docs/**"],
  "zones": {
    "core": { "paths": ["packages/core/"], "test": ["npx", "vitest", "related", "--run", "{files}"], "suite": ["npx", "vitest", "run", "packages/core"] },
    "web":  { "paths": ["apps/web/"], "dependsOn": ["core"], "test": "npm test -w apps/web" }
  },
  "light": [{ "step": "typecheck", "command": "npm run typecheck", "zones": ["core", "web"] }],
  "kinds": {
    "ui":       { "paths": ["apps/web/src/"], "auto": false, "raise": ["suite"], "zones": ["web"] },
    "data":     { "paths": ["packages/core/migrations/"], "raise": ["gates"] },
    "security": { "paths": ["packages/core/src/auth/"], "raise": ["suite", "gates"] }
  },
  "gates": [{ "step": "migrations", "command": "npm run test:migrations", "required": true }],
  "related": ["npx", "vitest", "related", "--run", "{files}"]
}
```

- Paths are globs: a folder ends in `/`, `*` is a name part, `**` any depth.
- A command is an array (run as is; the element `{files}` becomes the changed files) or a string
  (run in `sh -c`, `{files}` quoted in). Files deleted by the change are never handed to a command;
  a command that needs `{files}` and has none is skipped, and says so.
- `test` is what a push runs for the zone (fast: related tests, the package's unit tests); `suite` is
  its whole suite (session-end, and a kind that raises it). Without `suite`, `test` is used.
- `related` runs when the change touches what every zone shares: the tests related to the changed
  files, while the whole suite waits for session-end.

## Kinds

A kind is what the change is about. It raises checks only in the zones the change touches:

- `raise: ["suite"]`: the touched zones (or only the kind's `zones`) run their whole suite.
- `raise: ["gates"]`: the gates run, and nobody can skip them in that run.
- `auto` (default true): the files tell the kind. Set `auto: false` for a kind nearly every change
  would trigger (ui): the task names it with `--kind ui`, or `PIPELINE_KIND=ui` for a hook.
- `docs` is built in: every file documentation means light.

Choose kinds by cost of a late find: a broken data format or an auth gate found after a release costs
the most, so `data` and `security` come from the files; a layout change is cheap to find, so `ui`
waits for the task to name it.

## Gates

A gate checks a promise across versions (old data stays readable, the public API keeps its shape,
a migration runs both ways). It runs at session-end, at push-main when code changed, and when a
`gates` kind is present. `required: true` makes it un-skippable. Each gate is proved by breaking
what it guards once and seeing it red (pipeline-tests).

## Reading the decision

```
checks push: medium (kinds: data): the zones the pushed commits reach; ...
  zones core, and built on them: web
  runs  core tests: the zone changed
  runs  web tests: built on core
  runs  migrations: old data stays readable (the kind data)
  skips typecheck: no change in ...
  keeps migrations: the skip was refused, required here
```

The report of a task names what ran and what was skipped with these reasons, not "tests pass".

## Changing the policy

1. Change the config, run `node scripts/pipeline/run.mjs <action> --dry-run` on a real change for each
   action it affects, and read the decision.
2. A change to `policy.mjs` comes with its case in `policy.test.mjs`, broken once on purpose to see
   it red. `node --test scripts/pipeline/*.test.mjs`.
3. The config and the template are shared files: their change takes the related tests, and the
   whole suite at session-end.
4. Rules the person sets (a level they want, a check they never want skipped) go into the config
   with their date in the `why`, so the next agent does not undo them.
