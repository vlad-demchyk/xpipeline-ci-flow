#!/usr/bin/env node
// The plugin's own checks, no dependencies: the manifests agree with each other, every skill and
// agent has the frontmatter Claude Code and Codex read (a name equal to its folder or file, a
// description), every hook command points at a file that is there, every skill another file names
// exists, and the text is English (no Cyrillic outside the trigger phrases of a description).
//
//   node scripts/check.mjs        prints the problems and exits 1 when there are any

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The frontmatter of a markdown file as flat key: value pairs, or null. */
export function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && !line.startsWith(" ")) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** The problems of the plugin at `root`. */
export function problems(root = ROOT) {
  const out = [];
  const json = (rel) => {
    try {
      return JSON.parse(readFileSync(join(root, rel), "utf8"));
    } catch (err) {
      out.push(`${rel}: ${err.message}`);
      return null;
    }
  };
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");
  if (plugin && market) {
    const entry = market.plugins?.find((p) => p.name === plugin.name);
    if (!entry) out.push(`marketplace.json lists no plugin ${plugin.name}`);
    else if (entry.version !== plugin.version) out.push(`versions differ: plugin.json ${plugin.version}, marketplace.json ${entry.version}`);
    if (market.name !== plugin.name) out.push(`the marketplace is named ${market.name}, the plugin ${plugin.name}: XBrain's catalog expects one name`);
    if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? "")) out.push(`plugin.json version ${plugin.version} is not x.y.z`);
  }

  const skills = readdirSync(join(root, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const name of skills) {
    const rel = `skills/${name}/SKILL.md`;
    if (!existsSync(join(root, rel))) {
      out.push(`${rel} is missing`);
      continue;
    }
    const text = readFileSync(join(root, rel), "utf8");
    const meta = frontmatter(text);
    if (!meta) out.push(`${rel}: no frontmatter`);
    else {
      if (meta.name !== name) out.push(`${rel}: name ${meta.name} is not its folder ${name}`);
      if (!meta.description || meta.description.length < 80) out.push(`${rel}: the description must say what it does and when to use it`);
      if (meta.description && meta.description.length > 1024) out.push(`${rel}: the description is over 1024 characters`);
    }
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
    if (/[Ѐ-ӿ]/.test(body)) out.push(`${rel}: Cyrillic in the body; the plugin is English (trigger phrases belong in the description)`);
  }

  for (const file of readdirSync(join(root, "agents")).filter((f) => f.endsWith(".md"))) {
    const meta = frontmatter(readFileSync(join(root, "agents", file), "utf8"));
    if (!meta) out.push(`agents/${file}: no frontmatter`);
    else {
      if (meta.name !== file.replace(/\.md$/, "")) out.push(`agents/${file}: name ${meta.name} is not its file`);
      if (!meta.description) out.push(`agents/${file}: no description`);
    }
  }

  const hooks = json("hooks/hooks.json");
  for (const groups of Object.values(hooks?.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        const file = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(hook.command ?? "")?.[1];
        if (!file) out.push(`hooks.json: a command that names no file under \${CLAUDE_PLUGIN_ROOT}: ${hook.command}`);
        else if (!existsSync(join(root, file))) out.push(`hooks.json: ${file} is missing`);
      }
    }
  }

  // A skill named in backticks or as `skill <name>` anywhere must exist.
  const named = new Set();
  const scan = (dir, deep = true) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (deep) scan(rel);
      }
      else if (/\.(md|mjs)$/.test(entry.name)) {
        for (const m of readFileSync(join(root, rel), "utf8").matchAll(/\bpipeline-(start|policy|tests|zones|heavy-queue|bench|linux-ci|skip-proposal|team|[a-z]+(?:-[a-z]+)*)\b/g)) {
          if (!["pipeline-setup", "pipeline-heavy", "pipeline-heavy-light"].includes(m[0])) named.add(`${m[0]}\t${rel}`);
        }
      }
    }
  };
  for (const dir of ["skills", "agents", "hooks", "templates", "scripts"]) scan(dir);
  scan(".", false);
  for (const pair of named) {
    const [name, rel] = pair.split("\t");
    if (!skills.includes(name)) out.push(`${rel} names ${name}, which is no skill`);
  }
  return [...new Set(out)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const found = problems();
  for (const problem of found) console.error(problem);
  console.log(found.length ? `check: ${found.length} problem(s)` : "check: clean");
  process.exit(found.length ? 1 : 0);
}
