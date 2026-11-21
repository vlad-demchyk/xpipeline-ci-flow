// What the plugin's agent hooks share: the hook's input, the project's root and whether it has a
// checks' policy. A hook never fails the agent: any error is no answer.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The hook's input from stdin, or an empty object. */
export function input() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/** The repository's top for a folder, else the folder. */
export function rootOf(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || cwd;
  } catch {
    return cwd;
  }
}

/** Whether the project at `root` has the template's policy. */
export function hasPolicy(root) {
  return existsSync(join(root, "pipeline.config.json"));
}
