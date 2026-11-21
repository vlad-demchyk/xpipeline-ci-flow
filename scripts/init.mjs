#!/usr/bin/env node
// Puts the pipeline template into a project: the policy and its runner in `scripts/pipeline/`, the
// git hooks in `.githooks/`, and a starter `pipeline.config.json` with the zones it can tell from
// the project's manifests (npm workspaces, a Cargo workspace, Python and Go folders). It never
// overwrites: a file that is there stays, and the report says what to merge by hand.
//
//   node <plugin>/scripts/init.mjs [project dir] [--dry-run] [--force] [--no-hooks] [--linux-ci]
//
// --force replaces the template's own files (policy, runner, queue, tests), never the config or a
// hook the project already has. --no-hooks leaves git's hooks alone. --linux-ci adds `.linux-ci.sh`.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(PLUGIN, "templates", "pipeline");
const OWN = ["policy.mjs", "run.mjs", "heavy.sh", "policy.test.mjs", "run.test.mjs", "heavy.test.mjs"];
const HOOKS = ["pre-commit", "pre-push", "post-merge"];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The folders a workspace glob names (`apps/*`, `packages/core`). */
function expandWorkspace(root, pattern) {
  const clean = pattern.replace(/\/$/, "");
  if (!clean.endsWith("/*")) return existsSync(join(root, clean)) ? [clean] : [];
  const parent = clean.slice(0, -2);
  if (!existsSync(join(root, parent))) return [];
  return readdirSync(join(root, parent))
    .filter((name) => !name.startsWith(".") && statSync(join(root, parent, name)).isDirectory())
    .map((name) => `${parent}/${name}`);
}

/**
 * The zones a project's manifests tell, with their tests and what they are built on.
 * @param {string} root
 * @returns {{ zones: Record<string, any>, shared: string[], notes: string[] }}
 */
export function detect(root) {
  const zones = {};
  const shared = [".githooks/", "scripts/pipeline/", "pipeline.config.json"];
  const notes = [];
  const pkg = readJson(join(root, "package.json"));
  if (pkg) {
    shared.push("package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig*.json");
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
    const names = {};
    for (const folder of workspaces.flatMap((w) => expandWorkspace(root, w))) {
      const own = readJson(join(root, folder, "package.json"));
      if (!own) continue;
      const zone = basename(folder);
      names[own.name ?? zone] = zone;
      zones[zone] = { paths: [`${folder}/`], dependsOn: [], test: own.scripts?.test ? ["npm", "test", "-w", folder] : null, _deps: Object.keys({ ...own.dependencies, ...own.devDependencies }) };
    }
    for (const zone of Object.values(zones)) {
      zone.dependsOn = zone._deps.map((dep) => names[dep]).filter(Boolean);
      delete zone._deps;
    }
    if (!workspaces.length) {
      zones.app = { paths: ["src/", "test/", "tests/", "lib/"], test: pkg.scripts?.test ? ["npm", "test"] : null };
      notes.push("one package: one zone `app`; split it by folder when its tests can run apart");
    }
  }
  const cargo = existsSync(join(root, "Cargo.toml")) ? readFileSync(join(root, "Cargo.toml"), "utf8") : null;
  if (cargo) {
    shared.push("Cargo.toml", "Cargo.lock", "rust-toolchain*");
    const members = /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/.exec(cargo)?.[1];
    const folders = members ? [...members.matchAll(/"([^"]+)"/g)].flatMap((m) => expandWorkspace(root, m[1])) : [];
    const crates = {};
    for (const folder of folders) {
      const text = existsSync(join(root, folder, "Cargo.toml")) ? readFileSync(join(root, folder, "Cargo.toml"), "utf8") : "";
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? basename(folder);
      crates[name] = { folder, text };
    }
    for (const [name, { folder, text }] of Object.entries(crates)) {
      const deps = Object.keys(crates).filter((other) => other !== name && new RegExp(`^\\s*${other.replace(/[-]/g, "[-_]")}\\s*=`, "m").test(text));
      zones[name] = { paths: [`${folder}/`], dependsOn: deps, test: ["cargo", "test", "-q", "-p", name] };
    }
    if (!folders.length) zones.crate = { paths: ["src/", "tests/", "benches/"], test: ["cargo", "test", "-q"] };
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".") || entry === "node_modules" || !statSync(join(root, entry)).isDirectory()) continue;
    if (Object.values(zones).some((z) => z.paths.some((p) => p.startsWith(`${entry}/`)))) continue;
    if (existsSync(join(root, entry, "pyproject.toml"))) zones[entry] = { paths: [`${entry}/`], test: ["python", "-m", "pytest", "-q", entry] };
    else if (existsSync(join(root, entry, "go.mod"))) zones[entry] = { paths: [`${entry}/`], test: ["sh", "-c", `cd ${entry} && go test ./...`] };
  }
  if (existsSync(join(root, "pyproject.toml")) && !Object.keys(zones).length) {
    shared.push("pyproject.toml", "uv.lock", "requirements*.txt");
    zones.app = { paths: ["src/", "tests/"], test: ["python", "-m", "pytest", "-q"] };
  }
  if (existsSync(join(root, "go.mod")) && !Object.keys(zones).length) {
    shared.push("go.mod", "go.sum");
    zones.app = { paths: ["**/*.go"], test: ["go", "test", "./..."] };
  }
  for (const [name, zone] of Object.entries(zones)) {
    if (!zone.test) {
      delete zone.test;
      notes.push(`zone ${name} has no test command: add one, or say in the config why it has none`);
    }
    if (zone.dependsOn && !zone.dependsOn.length) delete zone.dependsOn;
  }
  if (!Object.keys(zones).length) notes.push("no manifest told the zones: write them by hand (skill pipeline-zones)");
  return { zones, shared, notes };
}

/** The starter config for a project. */
export function starterConfig(root) {
  const { zones, shared, notes } = detect(root);
  const config = {
    $comment: "This project's checks' policy (xpipeline-ci-flow, skill pipeline-policy). Zones were told from the manifests: check their paths, tests and dependsOn, then add light checks, kinds and gates.",
    base: "origin/main",
    mainBranches: ["main"],
    shared,
    zones,
    light: [],
    kinds: {},
    gates: [],
    heavy: "scripts/pipeline/heavy.sh",
  };
  return { config, notes };
}

/**
 * Installs the template.
 * @param {string} root
 * @param {{ dryRun?: boolean, force?: boolean, hooks?: boolean, linuxCi?: boolean }} options
 * @returns {{ wrote: string[], kept: string[], notes: string[] }}
 */
export function init(root, { dryRun = false, force = false, hooks = true, linuxCi = false } = {}) {
  const wrote = [];
  const kept = [];
  const notes = [];
  const put = (rel, content, { mode, replace = false } = {}) => {
    const path = join(root, rel);
    if (existsSync(path) && !replace) {
      kept.push(rel);
      return;
    }
    wrote.push(rel);
    if (dryRun) return;
    mkdirSync(dirname(path), { recursive: true });
    if (typeof content === "string") writeFileSync(path, content);
    else copyFileSync(content.from, path);
    if (mode) chmodSync(path, mode);
  };
  for (const file of OWN) put(`scripts/pipeline/${file}`, { from: join(TEMPLATE, file) }, { mode: file.endsWith(".sh") ? 0o755 : undefined, replace: force });
  if (existsSync(join(root, "pipeline.config.json"))) kept.push("pipeline.config.json");
  else {
    const starter = starterConfig(root);
    notes.push(...starter.notes);
    put("pipeline.config.json", `${JSON.stringify(starter.config, null, 2)}\n`);
  }
  if (linuxCi) put(".linux-ci.sh", { from: join(TEMPLATE, "linux-ci.sh") }, { mode: 0o755 });
  if (hooks) {
    for (const hook of HOOKS) {
      const before = kept.length;
      put(`.githooks/${hook}`, { from: join(TEMPLATE, "githooks", hook) }, { mode: 0o755 });
      if (kept.length > before) notes.push(`.githooks/${hook} is the project's own: call the template's line from it (see templates/pipeline/githooks/${hook})`);
    }
    let current = "";
    try {
      current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      // Not set.
    }
    if (current === ".githooks") notes.push("core.hooksPath is .githooks already");
    else if (current) notes.push(`core.hooksPath is ${current}: the template's hooks are in .githooks/; call them from there or move them, by the person's word`);
    else if (!dryRun) {
      try {
        execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
        notes.push("set core.hooksPath to .githooks (this clone; every clone sets it once, the README says how)");
      } catch {
        notes.push("not a git repository: set core.hooksPath to .githooks once it is one");
      }
    } else notes.push("would set core.hooksPath to .githooks");
  }
  return { wrote, kept, notes };
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();
  const result = init(dir, {
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    hooks: !args.includes("--no-hooks"),
    linuxCi: args.includes("--linux-ci"),
  });
  const verb = args.includes("--dry-run") ? "would write" : "wrote";
  for (const file of result.wrote) console.log(`${verb} ${file}`);
  for (const file of result.kept) console.log(`kept   ${file} (already there)`);
  for (const note of result.notes) console.log(`note   ${note}`);
  console.log(`\nnext: check the zones in ${relative(process.cwd(), join(dir, "pipeline.config.json")) || "pipeline.config.json"}, then \`node scripts/pipeline/run.mjs push --dry-run\` and \`node --test scripts/pipeline/\``);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
