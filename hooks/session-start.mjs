#!/usr/bin/env node
// SessionStart: one line, only in a project that has a checks' policy, so the agent runs its checks
// through it instead of guessing. Elsewhere it says nothing.
import { hasPolicy, input, rootOf } from "./lib.mjs";

try {
  const event = input();
  const root = rootOf(event.cwd || process.cwd());
  if (hasPolicy(root)) {
    const text =
      "This project declares its checks in pipeline.config.json (xpipeline-ci-flow): `node scripts/pipeline/run.mjs <action> --dry-run` " +
      "prints what an action (commit, merge, push, push-main, release, qa, session-end) runs and skips and why; heavy runs go through " +
      "scripts/pipeline/heavy.sh. The skill pipeline-start has the order.";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
  }
} catch {
  // A hook never fails the session.
}
