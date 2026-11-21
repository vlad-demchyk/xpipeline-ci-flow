// The agent hooks: what they ask, what they remind, and that they stay silent elsewhere.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { answer, pastQueue, skipsHooks } from "../hooks/bash-guard.mjs";
import { ROOT } from "../scripts/check.mjs";

const hook = (file, event) => spawnSync("node", [join(ROOT, "hooks", file)], { input: JSON.stringify(event), encoding: "utf8" });

test("--no-verify and git commit -n skip the hooks; a message that mentions them does not", () => {
  assert.ok(skipsHooks("git commit --no-verify -m x"));
  assert.ok(skipsHooks("git -C repo push --no-verify origin main"));
  assert.ok(skipsHooks("git add a && git commit -nm x"));
  assert.ok(!skipsHooks('git commit -m "explain --no-verify and -n"'));
  assert.ok(!skipsHooks("npm run build --no-verify"));
  assert.ok(!skipsHooks("git log -n 3"));
});

test("a heavy command past the queue is told; one through the queue or the runner is not", () => {
  assert.ok(pastQueue("cargo test -p core"));
  assert.ok(pastQueue("npx vitest run apps/web"));
  assert.ok(pastQueue("npm test"));
  assert.ok(!pastQueue("scripts/pipeline/heavy.sh --light cargo test -p core"));
  assert.ok(!pastQueue("node scripts/pipeline/run.mjs push"));
  assert.ok(!pastQueue("npx vitest related --run a.ts"));
  assert.ok(!pastQueue('git commit -m "run cargo test later"'));
});

test("the guard asks on --no-verify and only reminds, never denies", () => {
  assert.equal(answer({ tool_input: { command: "git push --no-verify" } }, false).hookSpecificOutput.permissionDecision, "ask");
  const remind = answer({ tool_input: { command: "cargo test" } }, true).hookSpecificOutput;
  assert.equal(remind.permissionDecision, undefined);
  assert.match(remind.additionalContext, /heavy\.sh/);
  assert.equal(answer({ tool_input: { command: "cargo test" } }, false), null, "no policy, no reminder");
  assert.equal(answer({ tool_input: {} }, true), null);
});

test("the session hook speaks only in a project with a policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-hook-"));
  assert.equal(hook("session-start.mjs", { cwd: dir }).stdout, "");
  writeFileSync(join(dir, "pipeline.config.json"), "{}");
  const out = JSON.parse(hook("session-start.mjs", { cwd: dir }).stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /pipeline\.config\.json/);
});

test("a hook given garbage stays silent and exits 0", () => {
  for (const file of ["session-start.mjs", "bash-guard.mjs"]) {
    const out = spawnSync("node", [join(ROOT, "hooks", file)], { input: "not json", encoding: "utf8" });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, "");
  }
});
