// The runner's own guard: which files an action counts, and how its command line is read.
import assert from "node:assert/strict";
import { test } from "node:test";

import { changeOf, parseArgs } from "./run.mjs";

/** A git that answers from a table of `args joined by space` to output; anything else fails. */
const fakeGit = (table) => (args) => (args.join(" ") in table ? table[args.join(" ")] : null);

test("a commit counts the staged files", () => {
  const git = fakeGit({ "diff --cached --name-only --diff-filter=ACMRD": "a.ts\nb.md\n" });
  assert.deepEqual(changeOf({ action: "commit", base: "origin/main" }, git), { files: ["a.ts", "b.md"], from: "the staged files" });
});

test("a push counts from the remote's own commit when the clone has it", () => {
  const git = fakeGit({ "cat-file -e abc^{commit}": "", "diff --name-only abc def": "x.ts" });
  const change = changeOf({ action: "push", push: { ref: "refs/heads/feat", remoteSha: "abc", source: "def" }, base: "origin/main" }, git);
  assert.deepEqual(change, { files: ["x.ts"], from: "abc (the remote's commit)" });
});

test("a new branch counts from its merge base with origin/<branch>, then the config's base", () => {
  const git = fakeGit({ "merge-base def origin/main": "f0", "diff --name-only f0 def": "y.ts" });
  const change = changeOf({ action: "push", push: { ref: "refs/heads/new", remoteSha: "0000", source: "def" }, base: "origin/main" }, git);
  assert.deepEqual(change, { files: ["y.ts"], from: "f0 (the merge base with origin/main)" });
});

test("a merge counts what it brought", () => {
  const git = fakeGit({ "rev-parse -q --verify HEAD^2": "m2", "diff --name-only HEAD^1 HEAD": "z.ts" });
  assert.deepEqual(changeOf({ action: "merge", base: "origin/main" }, git), { files: ["z.ts"], from: "HEAD^1 (the merge at HEAD)" });
});

test("without a base the runner says so instead of guessing", () => {
  const change = changeOf({ action: "push", base: "origin/main" }, fakeGit({}));
  assert.ok("error" in change);
  assert.match(change.error, /--since/);
  assert.equal(changeOf({ action: "release", base: "origin/main" }, fakeGit({ "ls-files": "a" })).from, "the whole tree (no base to diff from)");
});

test("the command line: kinds, skips with a reason, unknown flags", () => {
  const args = parseArgs(["push", "--kind", "ui,data", "--skip", "web tests=a comment change", "--skip", "bad", "--dry-run", "--nope"]);
  assert.equal(args.action, "push");
  assert.deepEqual(args.kinds, ["ui", "data"]);
  assert.deepEqual(args.skip, { "web tests": "a comment change" });
  assert.equal(args.dryRun, true);
  assert.equal(args.unknown.length, 2, "a skip without a reason and an unknown flag are both told");
});
