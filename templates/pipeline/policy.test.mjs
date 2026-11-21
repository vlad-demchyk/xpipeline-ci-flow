// The policy's own guard: each rule of `policy.mjs` with the case that breaks it. Run with
// `node --test scripts/pipeline/*.test.mjs`. A project that changes the policy changes these cases with it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { decide, expand, explain, globToRegExp, kindsOf, normalize, pushAction, zonesOf } from "./policy.mjs";

const config = normalize({
  shared: ["package.json", ".githooks/"],
  zones: {
    core: { paths: ["packages/core/"], test: ["npm", "test", "-w", "core"], suite: ["npm", "test", "-w", "core", "--", "--all"] },
    web: { paths: ["apps/web/"], dependsOn: ["core"], test: ["npx", "vitest", "related", "--run", "{files}"], suite: ["npx", "vitest", "run", "apps/web"] },
    tool: { paths: ["tools/"] },
  },
  light: [
    { step: "format", command: ["prettier", "--check", "{files}"], docs: true },
    { step: "typecheck", command: "npm run typecheck", zones: ["core", "web"] },
  ],
  kinds: {
    ui: { paths: ["apps/web/src/"], auto: false, raise: ["suite"], zones: ["web"] },
    data: { paths: ["packages/core/migrations/"], raise: ["gates"] },
  },
  gates: [{ step: "migrations", command: "npm run gates" }],
  related: ["npx", "vitest", "related", "--run", "{files}"],
});

const steps = (decision) => decision.runs.map((run) => run.step);
const skipped = (decision) => decision.skipped.map((skip) => skip.step);

test("globs: a folder, a name part, any depth", () => {
  assert.ok(globToRegExp("apps/web/").test("apps/web/src/a.ts"));
  assert.ok(!globToRegExp("apps/web/").test("apps/webapp/a.ts"));
  assert.ok(globToRegExp("**/*.md").test("README.md"));
  assert.ok(globToRegExp("**/*.md").test("docs/a/b.md"));
  assert.ok(globToRegExp("tsconfig*.json").test("tsconfig.base.json"));
  assert.ok(!globToRegExp("*.json").test("a/b.json"));
});

test("a commit is light: the light checks of the zones it touches, no tests", () => {
  const d = decide({ action: "commit", changed: ["tools/x.mjs"], config });
  assert.equal(d.level, "light");
  assert.deepEqual(steps(d), ["format"]);
  assert.ok(skipped(d).includes("typecheck"), "typecheck belongs to core and web only");
  assert.ok(skipped(d).includes("tests"));
});

test("documentation alone is light at any action but the end of a session", () => {
  const d = decide({ action: "push-main", changed: ["README.md", "docs/a.md"], config });
  assert.equal(d.level, "light");
  assert.deepEqual(d.kinds, ["docs"]);
  assert.deepEqual(steps(d), ["format"], "a step marked docs still runs on documentation");
  assert.ok(skipped(d).includes("migrations"));
  assert.equal(decide({ action: "session-end", changed: ["README.md"], config }).level, "heavy");
});

test("a push runs the zones it touches and every zone built on them", () => {
  const d = decide({ action: "push", changed: ["packages/core/src/a.ts"], config });
  assert.equal(d.level, "medium");
  assert.deepEqual(d.zones.reached, ["core", "web"]);
  assert.deepEqual(steps(d), ["format", "typecheck", "core tests", "web tests"]);
  const web = d.runs.find((run) => run.step === "web tests");
  assert.match(web.why, /built on core/);
  assert.ok(web.command.includes("packages/core/src/a.ts"), "a dependent zone's {files} names the files it imports");
  assert.equal(web.command[1], "--light", "a zone's run takes the light lane of the heavy queue");
});

test("a merge skips the light checks: each commit ran them", () => {
  const d = decide({ action: "merge", changed: ["apps/web/a.ts"], config });
  assert.deepEqual(steps(d), ["web tests"]);
  assert.ok(skipped(d).includes("format"));
});

test("what every zone shares runs the related tests and leaves the whole suite to session-end", () => {
  const d = decide({ action: "push", changed: ["package.json", "apps/web/a.ts"], config });
  assert.deepEqual(steps(d).filter((s) => s.includes("tests")), ["related tests"]);
  const only = decide({ action: "push", changed: ["package.json"], config: { ...config, related: null } });
  assert.ok(skipped(only).includes("zone tests"));
  assert.match(only.skipped.find((s) => s.step === "zone tests").why, /session-end/);
});

test("a kind named by the task raises its zones to the whole suite; ui is never guessed from files", () => {
  assert.deepEqual(kindsOf(["apps/web/src/a.tsx"], [], config), []);
  const d = decide({ action: "push", changed: ["apps/web/src/a.tsx"], kinds: ["ui"], config });
  const web = d.runs.find((run) => run.step === "web tests");
  assert.ok(web.command.includes("run"), "the suite, not the related tests");
  assert.match(web.why, /kind ui/);
});

test("a data change brings the gates, and they cannot be skipped", () => {
  const d = decide({ action: "push", changed: ["packages/core/migrations/002.sql"], skip: { migrations: "small change" }, config });
  assert.deepEqual(d.kinds, ["data"]);
  assert.ok(steps(d).includes("migrations"));
  assert.deepEqual(d.refused.map((r) => r.step), ["migrations"]);
});

test("a push to main brings the gates when it carries code", () => {
  assert.ok(steps(decide({ action: "push-main", changed: ["tools/x.mjs"], config })).includes("migrations"));
  assert.ok(skipped(decide({ action: "push", changed: ["tools/x.mjs"], config })).includes("migrations"));
});

test("a skip the person agreed to leaves the run and says why", () => {
  const d = decide({ action: "push", changed: ["apps/web/a.ts"], skip: { "web tests": "a comment change" }, config });
  assert.ok(!steps(d).includes("web tests"));
  assert.match(d.skipped.find((s) => s.step === "web tests").why, /on request: a comment change/);
});

test("the end of a session runs every suite and the gates on the full lane", () => {
  const d = decide({ action: "session-end", changed: ["a"], config });
  assert.deepEqual(steps(d), ["format", "typecheck", "core suite", "web suite", "migrations"]);
  assert.ok(skipped(d).includes("tool suite"), "a zone without tests says so");
  assert.equal(d.runs.find((r) => r.step === "core suite").command[1], "npm", "no --light on the full lane");
});

test("a deleted file reaches its zone but is never handed to a command", () => {
  const d = decide({ action: "push", changed: ["apps/web/gone.ts"], present: [], config });
  assert.deepEqual(d.zones.touched, ["web"]);
  assert.ok(skipped(d).includes("web tests"));
  assert.ok(skipped(d).includes("format"));
});

test("files no zone claims are named, not silently passed", () => {
  const d = decide({ action: "push", changed: ["stray/file.ts"], config });
  assert.deepEqual(d.zones.unzoned, ["stray/file.ts"]);
  assert.match(explain(d), /no zone claims 1 file/);
});

test("a string command runs in sh with the files quoted", () => {
  assert.deepEqual(expand("lint {files}", ["a b.ts", "c.ts"]), ["sh", "-c", "lint 'a b.ts' c.ts"]);
  assert.deepEqual(expand(["lint", "{files}"], ["a", "b"]), ["lint", "a", "b"]);
});

test("a push to a main branch or a tag is push-main", () => {
  assert.equal(pushAction("refs/heads/main", ["main"]), "push-main");
  assert.equal(pushAction("refs/tags/v1.0.0", ["main"]), "push-main");
  assert.equal(pushAction("refs/heads/feature", ["main"]), "push");
});

test("the config's mistakes are told, not passed in silence", () => {
  assert.throws(() => normalize({ zones: { a: { paths: ["a/"], dependsOn: ["b"] } } }), /no zone b/);
  assert.throws(() => normalize({ actions: { commit: { level: "medium-ish" } } }), /level/);
  assert.throws(() => normalize({ zones: { a: {} } }), /paths/);
  assert.throws(() => normalize({ kinds: { x: { raise: ["everything"] } } }), /suite or gates/);
  assert.throws(() => decide({ action: "deploy", changed: [], config }), /unknown action/);
});

test("zonesOf: shared files mark the change shared and reach no zone of their own", () => {
  assert.deepEqual(zonesOf([".githooks/pre-commit"], config), { touched: [], reached: [], shared: true, unzoned: [] });
});
