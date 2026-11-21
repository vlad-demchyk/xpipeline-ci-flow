// The template goes into a project without overwriting it, with zones told from its manifests, and
// the installed runner decides in that project as the skills describe.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { detect, init } from "../scripts/init.mjs";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-init-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "bench@example.com");
  git("config", "user.name", "bench");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }));
  for (const [name, deps] of [["core", {}], ["web", { "@x/core": "*" }]]) {
    mkdirSync(join(dir, "packages", name, "src"), { recursive: true });
    writeFileSync(join(dir, "packages", name, "package.json"), JSON.stringify({ name: `@x/${name}`, dependencies: deps, scripts: { test: "node --test" } }));
    writeFileSync(join(dir, "packages", name, "src", "index.mjs"), "export const x = 1;\n");
  }
  writeFileSync(join(dir, "README.md"), "# x\n");
  return { dir, git };
}

test("zones come from npm workspaces with their dependencies", () => {
  const { dir } = project();
  const { zones } = detect(dir);
  assert.deepEqual(Object.keys(zones).sort(), ["core", "web"]);
  assert.deepEqual(zones.web.dependsOn, ["core"]);
  assert.deepEqual(zones.core.test, ["npm", "test", "-w", "packages/core"]);
});

test("init writes the template, sets the hooks path, and keeps what is there", () => {
  const { dir, git } = project();
  mkdirSync(join(dir, ".githooks"));
  writeFileSync(join(dir, ".githooks", "pre-push"), "#!/bin/sh\necho own\n");
  const result = init(dir);
  assert.ok(result.wrote.includes("scripts/pipeline/policy.mjs"));
  assert.ok(result.wrote.includes("pipeline.config.json"));
  assert.ok(result.kept.includes(".githooks/pre-push"));
  assert.equal(readFileSync(join(dir, ".githooks", "pre-push"), "utf8"), "#!/bin/sh\necho own\n");
  assert.equal(git("config", "--get", "core.hooksPath").trim(), ".githooks");
  const again = init(dir);
  assert.equal(again.wrote.length, 0, "a second run overwrites nothing");
});

test("a dry run writes nothing", () => {
  const { dir } = project();
  const result = init(dir, { dryRun: true });
  assert.ok(result.wrote.length > 0);
  assert.ok(!existsSync(join(dir, "scripts", "pipeline")));
});

test("in the project: docs are light, a library change reaches its dependent, the commit hook prints the decision", () => {
  const { dir, git } = project();
  init(dir);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const run = (...args) => spawnSync("node", ["scripts/pipeline/run.mjs", ...args], { cwd: dir, encoding: "utf8" });

  writeFileSync(join(dir, "README.md"), "# x\n\nmore\n");
  let out = run("push", "--since", "HEAD", "--dry-run");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /checks push: light \(kinds: docs\)/);

  writeFileSync(join(dir, "README.md"), "# x\n");
  writeFileSync(join(dir, "packages", "core", "src", "index.mjs"), "export const x = 2;\n");
  out = run("push", "--since", "HEAD", "--dry-run");
  assert.match(out.stdout, /runs  core tests: the zone changed/);
  assert.match(out.stdout, /runs  web tests: built on core/);

  git("add", "packages/core/src/index.mjs");
  const commit = spawnSync("git", ["commit", "-m", "change core"], { cwd: dir, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stdout + commit.stderr, /checks commit: light/);
});
