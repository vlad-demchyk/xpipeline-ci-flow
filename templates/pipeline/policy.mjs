// The checks' policy of a project in one place: for each action (a commit, a merge, a push, a push to
// the main branch, a release, a QA pass, the end of a session) the level it runs, light, medium or
// heavy, what it skips and why, and how the kind of a change (docs, ui, data, security, or the
// project's own kinds) raises it in the zones the change touches. Heavy runs only where the change
// is; the whole suite runs once, at the end of a session.
//
// Pure: no git, no processes. The project describes itself in `pipeline.config.json` (zones with
// their test commands, shared files, kinds, gates); `run.mjs` finds the changed files, asks `decide`
// and runs what it decided. Node 20 or newer, no dependencies.

/** The levels, cheapest first. */
export const LEVELS = ["light", "medium", "heavy"];

/** Each action's level and why it stops there. A project overrides them in `actions`. */
export const DEFAULT_ACTIONS = {
  commit: { level: "light", why: "a commit keeps the work; a push or a merge proves it" },
  merge: { level: "medium", why: "each commit ran the light checks; a merge runs the zones it brought" },
  push: { level: "medium", why: "the zones the pushed commits reach; what every zone shares waits for the end of the session" },
  "push-main": { level: "medium", gates: true, why: "the pushed zones and the gates; the whole suite waits for the end of the session" },
  release: { level: "light", why: "the merge of the same zones ran their tests; a release builds and ships" },
  qa: { level: "medium", why: "the zones under check; the live bench is the QA pass's own" },
  "session-end": { level: "heavy", why: "once at the end of a session: every zone's whole suite and the gates" },
};

/** What a change of documentation alone is, unless the project says otherwise. */
export const DEFAULT_DOCS = ["**/*.md", "docs/**", "LICENSE*"];

/**
 * A glob as a regular expression: `**` any path, `*` any name part, `?` one character; a pattern
 * ending in `/` is a folder and everything in it.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  const source = glob.endsWith("/") ? `${glob}**` : glob;
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "*" && source[i + 1] === "*") {
      // `**/` matches no folder too: `**/*.md` takes `README.md`.
      if (source[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Whether a file matches any of the globs. */
export function matches(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asStep(raw, at) {
  if (!raw || typeof raw !== "object") throw new Error(`${at}: a step is an object with step and command`);
  if (!raw.step || !raw.command) throw new Error(`${at}: a step needs step and command`);
  return {
    step: String(raw.step),
    command: raw.command,
    why: raw.why ? String(raw.why) : "",
    zones: raw.zones ? asList(raw.zones) : null,
    docs: raw.docs === true,
    required: raw.required === true,
  };
}

/**
 * The project's configuration with every default filled in, checked for the mistakes that would
 * otherwise pass in silence (a zone depending on a zone that does not exist, an unknown level).
 * @param {Record<string, any>} raw  the parsed `pipeline.config.json`
 */
export function normalize(raw = {}) {
  const actions = {};
  for (const [name, rule] of Object.entries({ ...DEFAULT_ACTIONS, ...(raw.actions ?? {}) })) {
    const base = DEFAULT_ACTIONS[name] ?? {};
    const merged = { ...base, ...rule };
    if (!LEVELS.includes(merged.level)) throw new Error(`actions.${name}: level is one of ${LEVELS.join(", ")}`);
    actions[name] = { level: merged.level, why: merged.why ?? "", gates: merged.gates === true };
  }
  const zones = {};
  for (const [name, zone] of Object.entries(raw.zones ?? {})) {
    if (!zone.paths || asList(zone.paths).length === 0) throw new Error(`zones.${name}: paths are required`);
    zones[name] = {
      paths: asList(zone.paths),
      dependsOn: asList(zone.dependsOn),
      test: zone.test ?? null,
      suite: zone.suite ?? zone.test ?? null,
    };
  }
  for (const [name, zone] of Object.entries(zones)) {
    for (const dep of zone.dependsOn) if (!(dep in zones)) throw new Error(`zones.${name}.dependsOn: no zone ${dep}`);
  }
  const kinds = {};
  for (const [name, kind] of Object.entries(raw.kinds ?? {})) {
    const raise = asList(kind.raise);
    for (const r of raise) if (r !== "suite" && r !== "gates") throw new Error(`kinds.${name}.raise: suite or gates, not ${r}`);
    for (const z of asList(kind.zones)) if (!(z in zones)) throw new Error(`kinds.${name}.zones: no zone ${z}`);
    kinds[name] = { paths: asList(kind.paths), auto: kind.auto !== false, raise, zones: kind.zones ? asList(kind.zones) : null };
  }
  return {
    actions,
    zones,
    kinds,
    shared: asList(raw.shared),
    docs: raw.docs ? asList(raw.docs) : DEFAULT_DOCS,
    light: asList(raw.light).map((step, i) => asStep(step, `light[${i}]`)),
    gates: asList(raw.gates).map((step, i) => asStep(step, `gates[${i}]`)),
    related: raw.related ?? null,
    base: raw.base ?? "origin/main",
    mainBranches: raw.mainBranches ? asList(raw.mainBranches) : ["main", "master"],
    heavy: raw.heavy ?? "scripts/pipeline/heavy.sh",
  };
}

/**
 * The zones a change touches, those it reaches through `dependsOn`, whether it touches what every
 * zone shares, and the files no zone claims.
 * @param {readonly string[]} changed
 * @param {ReturnType<typeof normalize>} config
 */
export function zonesOf(changed, config) {
  const touched = new Set();
  const unzoned = [];
  let shared = false;
  for (const file of changed) {
    if (matches(file, config.shared)) {
      shared = true;
      continue;
    }
    let found = false;
    for (const [name, zone] of Object.entries(config.zones)) {
      if (matches(file, zone.paths)) {
        touched.add(name);
        found = true;
      }
    }
    if (!found && !matches(file, config.docs)) unzoned.push(file);
  }
  const reached = new Set(touched);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, zone] of Object.entries(config.zones)) {
      if (!reached.has(name) && zone.dependsOn.some((dep) => reached.has(dep))) {
        reached.add(name);
        grew = true;
      }
    }
  }
  return { touched: [...touched].sort(), reached: [...reached].sort(), shared, unzoned };
}

/**
 * The kinds a change has: `docs` when every file is documentation; a kind with `auto` (the default)
 * when any file matches its paths; any kind the task names. A kind the project marks `auto: false`
 * (ui, as a rule: nearly every change touches the interface) comes only when the task names it.
 * @param {readonly string[]} changed
 * @param {readonly string[]} named
 * @param {ReturnType<typeof normalize>} config
 */
export function kindsOf(changed, named, config) {
  const kinds = new Set(named.filter((kind) => kind === "docs" || kind in config.kinds));
  if (changed.length && changed.every((file) => matches(file, config.docs))) kinds.add("docs");
  for (const [name, kind] of Object.entries(config.kinds)) {
    if (kind.auto && kind.paths.length && changed.some((file) => matches(file, kind.paths))) kinds.add(name);
  }
  return [...kinds].sort();
}

/** Single quotes for the shell. */
function quote(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * A command as argv: an array is kept and its `{files}` element becomes the files; a string runs in
 * `sh -c` with `{files}` quoted in.
 * @param {string | string[]} command
 * @param {readonly string[]} files
 */
export function expand(command, files) {
  if (Array.isArray(command)) return command.flatMap((word) => (word === "{files}" ? files : [word]));
  return ["sh", "-c", command.replaceAll("{files}", files.map(quote).join(" "))];
}

/** A command through the heavy queue: the light lane for a zone's run, the full lane for a whole one. */
function queued(config, lane, argv) {
  if (!argv) return null;
  return lane === "light" ? [config.heavy, "--light", ...argv] : [config.heavy, ...argv];
}

/**
 * The decision for one action.
 * @param {{ action: string, changed: readonly string[], kinds?: readonly string[],
 *   skip?: Readonly<Record<string, string>>, present?: readonly string[],
 *   config: ReturnType<typeof normalize> }} input
 *   `skip`: steps the person agreed to skip for this run, each with its reason; `present`: the
 *   changed files still on disk (a deleted file reaches its zone but is never handed to a command)
 * @returns {{ action: string, level: string, why: string, kinds: string[],
 *   zones: ReturnType<typeof zonesOf>,
 *   runs: { step: string, command: string[], why: string, required: boolean }[],
 *   skipped: { step: string, why: string }[], refused: { step: string, why: string }[] }}
 */
export function decide({ action, changed, kinds = [], skip = {}, present, config }) {
  const onDisk = new Set(present ?? changed);
  // A command that names `{files}` and has none left on disk has nothing to run on.
  const exp = (command, files) => {
    const kept = files.filter((file) => onDisk.has(file));
    const named = Array.isArray(command) ? command.includes("{files}") : command.includes("{files}");
    return named && kept.length === 0 ? null : expand(command, kept);
  };
  const rule = config.actions[action];
  if (!rule) throw new Error(`unknown action ${action}: ${Object.keys(config.actions).join(", ")}`);
  const all = kindsOf(changed, kinds, config);
  const docsOnly = all.includes("docs") && action !== "session-end";
  const level = docsOnly ? "light" : rule.level;
  const zones = zonesOf(changed, config);
  const runs = [];
  const skipped = [];
  const run = (step, command, why, required = false) => {
    if (command) runs.push({ step, command, why, required });
    else skipped.push({ step, why: "no changed file on disk for it" });
  };
  const pass = (step, why) => skipped.push({ step, why });
  const filesOf = (name) => {
    // A zone's files and those of every zone it is built on: `{files}` of a dependent zone names
    // the changed files its tests import.
    const inside = new Set([name]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const zone of [...inside]) {
        for (const dep of config.zones[zone].dependsOn) {
          if (!inside.has(dep)) {
            inside.add(dep);
            grew = true;
          }
        }
      }
    }
    return changed.filter((file) => [...inside].some((zone) => matches(file, config.zones[zone].paths)));
  };

  if (level === "heavy") {
    for (const step of config.light) run(step.step, exp(step.command, changed), step.why || "a light check, on the whole tree");
    for (const [name, zone] of Object.entries(config.zones)) {
      if (zone.suite) run(`${name} suite`, queued(config, "full", exp(zone.suite, filesOf(name))), `the whole suite of ${name}`);
      else pass(`${name} suite`, "the zone declares no tests");
    }
    for (const gate of config.gates) run(gate.step, queued(config, "full", exp(gate.command, changed)), gate.why || "a gate", true);
    return finish();
  }

  // Light: what keeps the source readable, where the change is.
  if (action === "merge") {
    for (const step of config.light) pass(step.step, "each commit ran it on the same files");
  } else {
    for (const step of config.light) {
      if (docsOnly && !step.docs) pass(step.step, "documentation only");
      else if (step.zones && !zones.shared && !step.zones.some((zone) => zones.touched.includes(zone))) pass(step.step, `no change in ${step.zones.join(", ")}`);
      else run(step.step, exp(step.command, changed), step.why || "a light check");
    }
  }
  if (level === "light") {
    pass("tests", docsOnly ? "documentation only: nothing to test" : rule.why);
    for (const gate of config.gates) pass(gate.step, docsOnly ? "documentation only" : rule.why);
    return finish(docsOnly ? "documentation only" : rule.why);
  }

  // Medium: the zones the change reaches, and what its kinds add there.
  const suiteKinds = all.filter((kind) => config.kinds[kind]?.raise.includes("suite"));
  if (zones.shared) {
    const files = changed.filter((file) => !matches(file, config.docs));
    if (config.related && files.length) {
      run("related tests", queued(config, "light", exp(config.related, files)), "what every zone shares changed: the tests related to the changed files; the whole suite waits for session-end");
    } else pass("zone tests", "what every zone shares changed: the whole suite waits for session-end");
  } else if (zones.reached.length === 0) {
    pass("zone tests", zones.unzoned.length ? `no zone claims ${zones.unzoned.join(", ")}` : "no zone changed");
  } else {
    for (const name of zones.reached) {
      const zone = config.zones[name];
      const whole = suiteKinds.filter((kind) => !config.kinds[kind].zones || config.kinds[kind].zones.includes(name));
      const command = whole.length ? zone.suite : zone.test;
      const via = zones.touched.includes(name)
        ? "the zone changed"
        : `built on ${zone.dependsOn.filter((dep) => zones.reached.includes(dep)).join(", ")}`;
      if (!command) pass(`${name} tests`, "the zone declares no tests");
      else if (whole.length) run(`${name} tests`, queued(config, "light", exp(command, filesOf(name))), `${via}; the kind ${whole.join(", ")} takes the whole suite`);
      else run(`${name} tests`, queued(config, "light", exp(command, filesOf(name))), via);
    }
  }
  const gateKinds = all.filter((kind) => config.kinds[kind]?.raise.includes("gates"));
  const code = changed.some((file) => !matches(file, config.docs));
  if (config.gates.length) {
    const why = gateKinds.length ? `the kind ${gateKinds.join(", ")}` : rule.gates && code ? `the action ${action}` : null;
    for (const gate of config.gates) {
      if (why) run(gate.step, queued(config, "full", exp(gate.command, changed)), `${gate.why || "a gate"} (${why})`, gate.required || gateKinds.length > 0);
      else pass(gate.step, `no kind asks for it and ${action} does not: it waits for session-end`);
    }
  }
  return finish();

  function finish(why = rule.why) {
    // The person's skips: a step the policy requires stays, and says so.
    const refused = [];
    for (const [step, reason] of Object.entries(skip)) {
      const at = runs.findIndex((r) => r.step === step);
      if (at < 0) continue;
      if (runs[at].required) {
        refused.push({ step, why: "required here: a data or security kind, or a gate the project marks required" });
        continue;
      }
      runs.splice(at, 1);
      skipped.push({ step, why: `skipped on request: ${reason}` });
    }
    return { action, level, why, kinds: all, zones, runs, skipped, refused };
  }
}

/** The decision as the person and the agent read it. */
export function explain(decision) {
  const kinds = decision.kinds.length ? ` (kinds: ${decision.kinds.join(", ")})` : "";
  const lines = [`checks ${decision.action}: ${decision.level}${kinds}: ${decision.why}`];
  const { touched, reached, shared, unzoned } = decision.zones;
  if (touched.length || shared) {
    const more = reached.filter((zone) => !touched.includes(zone));
    lines.push(`  zones ${touched.join(", ") || "none"}${more.length ? `, and built on them: ${more.join(", ")}` : ""}${shared ? "; what every zone shares changed" : ""}`);
  }
  if (unzoned.length) lines.push(`  no zone claims ${unzoned.length} file(s): ${unzoned.slice(0, 5).join(", ")}${unzoned.length > 5 ? ", ..." : ""}`);
  for (const run of decision.runs) lines.push(`  runs  ${run.step}: ${run.why}`);
  for (const pass of decision.skipped) lines.push(`  skips ${pass.step}: ${pass.why}`);
  for (const refused of decision.refused) lines.push(`  keeps ${refused.step}: the skip was refused, ${refused.why}`);
  return lines.join("\n");
}

/**
 * The action of a push: to a main branch or of a tag it is push-main, otherwise push.
 * @param {string} remoteRef  `refs/heads/main`, `refs/tags/v1.0.0`
 * @param {readonly string[]} mainBranches
 */
export function pushAction(remoteRef, mainBranches) {
  if (remoteRef.startsWith("refs/tags/")) return "push-main";
  const branch = remoteRef.startsWith("refs/heads/") ? remoteRef.slice("refs/heads/".length) : remoteRef;
  return mainBranches.includes(branch) ? "push-main" : "push";
}
