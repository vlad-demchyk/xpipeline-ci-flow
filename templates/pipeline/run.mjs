#!/usr/bin/env node
// The one command of the checks' policy: it finds what changed for an action, asks `policy.mjs`
// which level runs and what is skipped, prints that decision, and runs it, the heavy runs through
// the heavy queue (`heavy.sh`). The git hooks call it; agents and people call it by hand.
//
//   node scripts/pipeline/run.mjs <action> [--kind ui,data] [--since <ref>]
//        [--skip "<step>=<reason>"]... [--dry-run] [--json]
//   node scripts/pipeline/run.mjs push --ref <remote ref> --remote-sha <sha> --source <sha>
//        (what the pre-push hook passes for each pushed ref)
//
// The change: for commit the staged files; for merge the merge at HEAD (or ORIG_HEAD behind it);
// for session-end the whole tree; otherwise the diff from --since, the push's remote commit, or the
// merge base with the config's `base`. A task's kind is --kind, or PIPELINE_KIND for a hook.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { decide, explain, normalize, pushAction } from "./policy.mjs";

/** Runs git in `root`, or answers null. */
export function gitIn(root) {
  return (args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
}

const lines = (text) => (text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
const ZERO = /^0+$/;

/**
 * The changed files of an action and where they were counted from.
 * @param {{ action: string, since?: string, push?: { ref: string, remoteSha: string, source: string },
 *   base: string }} input
 * @param {(args: string[]) => string | null} git
 * @returns {{ files: string[], from: string } | { error: string }}
 */
export function changeOf({ action, since, push, base }, git) {
  if (action === "session-end") return { files: lines(git(["ls-files"])), from: "the whole tree" };
  if (action === "commit" && !since) {
    const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]);
    return staged === null ? { error: "git cannot list the staged files" } : { files: lines(staged), from: "the staged files" };
  }
  const head = push?.source || "HEAD";
  let from = null;
  if (since) from = { ref: since, why: "--since" };
  else if (action === "merge") {
    if (git(["rev-parse", "-q", "--verify", "HEAD^2"])) from = { ref: "HEAD^1", why: "the merge at HEAD" };
    else if (git(["rev-parse", "-q", "--verify", "ORIG_HEAD"])) from = { ref: "ORIG_HEAD", why: "the head before the merge" };
  } else if (push && push.remoteSha && !ZERO.test(push.remoteSha) && git(["cat-file", "-e", `${push.remoteSha}^{commit}`]) !== null) {
    from = { ref: push.remoteSha, why: "the remote's commit" };
  }
  if (!from) {
    const branch = push?.ref?.startsWith("refs/heads/") ? `origin/${push.ref.slice("refs/heads/".length)}` : null;
    for (const ref of [branch, base].filter(Boolean)) {
      const fork = git(["merge-base", head, ref]);
      if (fork) {
        from = { ref: fork, why: `the merge base with ${ref}` };
        break;
      }
    }
  }
  if (!from && action === "release") return { files: lines(git(["ls-files"])), from: "the whole tree (no base to diff from)" };
  if (!from) return { error: `no base to diff from (${base} is not here): pass --since <ref>` };
  // A push and a merge compare commits; by hand, the working tree is compared with the base, and
  // the files git does not track yet are part of it (a new module is a change too).
  const commits = Boolean(push?.source) || action === "merge";
  const diff = git(["diff", "--name-only", from.ref, ...(commits ? [head] : [])]);
  if (diff === null) return { error: `git cannot diff from ${from.ref}` };
  const fresh = commits ? [] : lines(git(["ls-files", "--others", "--exclude-standard"]));
  return { files: [...new Set([...lines(diff), ...fresh])], from: `${from.ref} (${from.why})` };
}

/**
 * The command line, read.
 * @param {string[]} args
 */
export function parseArgs(args) {
  const out = { action: args[0], kinds: [], skip: {}, dryRun: false, json: false, unknown: [] };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const value = () => args[++i] ?? "";
    if (arg === "--kind") out.kinds.push(...value().split(",").filter(Boolean));
    else if (arg === "--since") out.since = value();
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--config") out.config = value();
    else if (arg === "--ref") out.ref = value();
    else if (arg === "--remote-sha") out.remoteSha = value();
    else if (arg === "--source") out.source = value();
    else if (arg === "--skip") {
      const text = value();
      const at = text.indexOf("=");
      if (at <= 0 || !text.slice(at + 1).trim()) out.unknown.push(`--skip ${text} (a skip is "<step>=<reason>")`);
      else out.skip[text.slice(0, at).trim()] = text.slice(at + 1).trim();
    } else out.unknown.push(arg);
  }
  return out;
}

/** Where the project's root is: the repository's top, else here. */
function rootOf() {
  return gitIn(process.cwd())(["rev-parse", "--show-toplevel"]) || process.cwd();
}

/** Each skip the person agreed to, kept beside git's own files so the team's history can be read. */
function logSkips(root, git, decision) {
  const asked = decision.skipped.filter((s) => s.why.startsWith("skipped on request: "));
  if (!asked.length) return;
  const dir = git(["rev-parse", "--git-common-dir"]);
  if (!dir) return;
  const path = join(isAbsolute(dir) ? dir : join(root, dir), "pipeline", "skips.log");
  mkdirSync(dirname(path), { recursive: true });
  const when = new Date().toISOString();
  for (const s of asked) appendFileSync(path, `${when}\t${decision.action}\t${s.step}\t${s.why.slice("skipped on request: ".length)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = rootOf();
  const configPath = args.config ?? join(root, "pipeline.config.json");
  if (!existsSync(configPath)) {
    console.error(`checks: no ${configPath}: the project has no checks' policy yet (skill pipeline-policy)`);
    process.exit(2);
  }
  let config;
  try {
    config = normalize(JSON.parse(readFileSync(configPath, "utf8")));
  } catch (err) {
    console.error(`checks: ${configPath}: ${err.message}`);
    process.exit(2);
  }
  let action = args.action;
  if (action === "push" && args.ref) action = pushAction(args.ref, config.mainBranches);
  if (!action || !(action in config.actions)) {
    console.error(`checks: name the action: ${Object.keys(config.actions).join(", ")}`);
    process.exit(2);
  }
  if (args.unknown.length) console.warn(`checks ${action}: ignored ${args.unknown.join(", ")}`);
  const git = gitIn(root);
  const push = args.ref ? { ref: args.ref, remoteSha: args.remoteSha ?? "", source: args.source ?? "" } : undefined;
  const change = changeOf({ action, since: args.since, push, base: config.base }, git);
  let changed;
  let from;
  if ("error" in change) {
    // Never a silent pass and never the whole suite by default: the light checks of the action on
    // the files at hand (the pushed commit's, else the working tree's), and why.
    console.warn(`checks ${action}: ${change.error}; the zones cannot be told, so only the light checks run and the zones wait for session-end`);
    config.actions[action] = { level: "light", gates: false, why: "no base to tell the zones from: they wait for session-end" };
    changed = push?.source ? lines(git(["show", "--name-only", "--format=", push.source])) : lines(git(["diff", "--name-only", "HEAD"]));
    from = push?.source ? `the pushed commit ${push.source.slice(0, 12)}` : "the working tree";
  } else {
    changed = change.files;
    from = change.from;
  }
  const kinds = [...args.kinds, ...(process.env.PIPELINE_KIND ?? "").split(",").filter(Boolean)];
  const present = changed.filter((file) => existsSync(join(root, file)));
  const decision = decide({ action, changed, kinds, skip: args.skip, present, config });
  if (args.json) console.log(JSON.stringify({ ...decision, from, files: changed.length }, null, 2));
  else {
    console.log(`checks ${action}: ${changed.length} file(s) from ${from}`);
    console.log(explain(decision));
  }
  if (args.dryRun) return;
  logSkips(root, git, decision);
  for (const run of decision.runs) {
    if (!args.json) console.log(`\n$ ${run.command.join(" ")}`);
    const result = spawnSync(run.command[0], run.command.slice(1), { cwd: root, stdio: args.json ? ["ignore", "ignore", "inherit"] : "inherit" });
    if (result.status !== 0) {
      console.error(`\nchecks ${action}: red in ${run.step}${result.error ? ` (${result.error.message})` : ""}`);
      process.exit(1);
    }
  }
  if (!args.json) console.log(`\nchecks ${action}: green`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
