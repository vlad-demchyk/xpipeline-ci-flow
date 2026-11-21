// The plugin's own check finds what it says it finds.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { problems, ROOT } from "../scripts/check.mjs";

const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-check-"));
  for (const part of [".claude-plugin", "skills", "agents", "hooks", "templates", "scripts", "README.md"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  return dir;
};

test("the plugin as it is is clean", () => {
  assert.deepEqual(problems(ROOT), []);
});

test("a skill whose name is not its folder is found", () => {
  const dir = copy();
  const file = join(dir, "skills/pipeline-bench/SKILL.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("name: pipeline-bench", "name: bench"));
  assert.ok(problems(dir).some((p) => p.includes("name bench is not its folder")));
});

test("manifests with different versions are found", () => {
  const dir = copy();
  const file = join(dir, ".claude-plugin/plugin.json");
  writeFileSync(file, readFileSync(file, "utf8").replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
  assert.ok(problems(dir).some((p) => p.includes("versions differ")));
});

test("a hook pointing at a missing file and a named skill that is not there are found", () => {
  const dir = copy();
  writeFileSync(join(dir, "hooks/hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' }] }] } }));
  writeFileSync(join(dir, "skills/pipeline-start/SKILL.md"), `${readFileSync(join(dir, "skills/pipeline-start/SKILL.md"), "utf8")}\nSee pipeline-nowhere.\n`);
  const found = problems(dir);
  assert.ok(found.some((p) => p.includes("hooks/gone.mjs is missing")));
  assert.ok(found.some((p) => p.includes("names pipeline-nowhere")));
});

test("Cyrillic in a skill's body is found", () => {
  const dir = copy();
  writeFileSync(join(dir, "skills/pipeline-team/SKILL.md"), `${readFileSync(join(dir, "skills/pipeline-team/SKILL.md"), "utf8")}\nкоманда\n`);
  assert.ok(problems(dir).some((p) => p.includes("Cyrillic")));
});
