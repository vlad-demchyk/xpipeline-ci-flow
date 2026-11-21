// The heavy queue's guard: one run a lane, a share of the cores, a nested run that does not wait on
// itself.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HEAVY = join(dirname(fileURLToPath(import.meta.url)), "heavy.sh");
const dir = mkdtempSync(join(tmpdir(), "pipeline-heavy-"));
const env = {
  ...process.env,
  PIPELINE_HEAVY_HELD: "",
  PIPELINE_HEAVY_LOCK: join(dir, "full.lock"),
  PIPELINE_HEAVY_LIGHT_LOCK: join(dir, "light.lock"),
  VITEST_MAX_WORKERS: "",
};
delete env.VITEST_MAX_WORKERS;
delete env.PIPELINE_HEAVY_HELD;

test("without a command it says how it is used", () => {
  const out = spawnSync("sh", [HEAVY], { env, encoding: "utf8" });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage/);
});

test("a run takes half the cores and holds the queue for what it starts", () => {
  const out = spawnSync("sh", [HEAVY, "--light", "sh", "-c", 'echo "$VITEST_MAX_WORKERS $PIPELINE_HEAVY_HELD $PIPELINE_HEAVY_SHARE"'], { env, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const [workers, held, share] = out.stdout.trim().split(" ");
  assert.equal(held, "1");
  assert.equal(workers, share);
  assert.ok(Number(share) >= 1);
});

test("a nested run does not wait on itself", () => {
  const out = spawnSync("sh", [HEAVY, "sh", HEAVY, "echo", "inner"], { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), "inner");
});

test("two runs of one lane go one after the other", async () => {
  const log = join(dir, "order.log");
  const one = (name) =>
    new Promise((resolve) => {
      const child = spawn("sh", [HEAVY, "--light", "sh", "-c", `echo start ${name} >> ${log}; sleep 0.4; echo end ${name} >> ${log}`], { env, stdio: "ignore" });
      child.on("exit", resolve);
    });
  await Promise.all([one("a"), one("b")]);
  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0].split(" ")[1], lines[1].split(" ")[1], `a run started inside another: ${lines.join(" | ")}`);
});
