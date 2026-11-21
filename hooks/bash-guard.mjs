#!/usr/bin/env node
// PreToolUse on Bash. Blocks nothing:
// - a git command with --no-verify (or `git commit -n`) skips the project's hooks: the person is
//   asked, since a skip is theirs to agree to (skill pipeline-skip-proposal);
// - in a project with a checks' policy, a heavy command (a whole test suite, a build) started past
//   the heavy queue gets a reminder that the queue exists (skill pipeline-heavy-queue).
import { pathToFileURL } from "node:url";

import { hasPolicy, input, rootOf } from "./lib.mjs";

/** The command without its quoted parts, so a message that mentions a flag is not the flag. */
export function unquoted(command) {
  return command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** Whether a command skips git's hooks. */
export function skipsHooks(command) {
  const text = unquoted(command);
  return text.split(/&&|\|\||;|\|/).some((part) => {
    if (!/\bgit\b/.test(part)) return false;
    if (/\s--no-verify\b/.test(part) && /\b(commit|push|merge|rebase|am|cherry-pick|revert)\b/.test(part)) return true;
    return /\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(part) && /\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(part);
  });
}

const HEAVY = [
  /\bcargo\s+(test|nextest|clippy|build)\b/,
  /\bvitest\s+run\b/,
  /\bnpx\s+vitest\b(?!\s+related)/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bnpm\s+(test|run\s+test|run\s+build)\b/,
  /\b(pnpm|yarn)\s+(test|build)\b/,
  /\b(gradle|gradlew|mvn)\b.*\b(test|build|verify)\b/,
];

/** Whether a command is a heavy run started past the queue. */
export function pastQueue(command) {
  const text = unquoted(command);
  if (/heavy\.sh\b|scripts\/pipeline\/run\.mjs|PIPELINE_HEAVY_HELD/.test(text)) return false;
  return HEAVY.some((pattern) => pattern.test(text));
}

/** The hook's answer for an event, or null. */
export function answer(event, policy) {
  const command = event?.tool_input?.command;
  if (typeof command !== "string") return null;
  if (skipsHooks(command)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "--no-verify skips this project's checks' hooks. A skip is the person's to agree to; the policy's own way is `node scripts/pipeline/run.mjs <action> --skip \"<step>=<reason>\"` (skill pipeline-skip-proposal).",
      },
    };
  }
  if (policy && pastQueue(command)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "This project runs heavy commands through its queue: `scripts/pipeline/heavy.sh --light <command>` for a zone's run, `scripts/pipeline/heavy.sh <command>` for a whole suite; `node scripts/pipeline/run.mjs <action>` does it by itself (skill pipeline-heavy-queue).",
      },
    };
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const event = input();
    const out = answer(event, hasPolicy(rootOf(event.cwd || process.cwd())));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // A hook never fails the agent.
  }
}
