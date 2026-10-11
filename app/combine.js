// Port of sav/combine.py: a folder of saves -> one history document.
import { hms, md, n, table } from "./render.js";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const key = (m) => `${m.meta.sessionName}|${m.meta.saveIdentifier || ""}`;
const progress = (m) => new Set([...m.progression.schematicNames, ...m.progression.alternateRecipes.map((a) => "alt:" + a), ...m.progression.researchTrees.map((t) => "tree:" + t)]);
const subset = (a, b) => [...a].every((x) => b.has(x));
const sig = (m) => JSON.stringify([m.progression.highestTier, m.progression.gamePhase, m.progression.schematicsPurchased, m.progression.alternateRecipes.length,
  m.buildings.total, m.machines.count, m.logistics.beltLengthMeters, m.items.total, m.players.length]);

function dedupe(snaps) {
  const best = new Map();
  for (const m of snaps) {
    const k = JSON.stringify([key(m), m.meta.playSeconds, m.buildings.total, m.items.total]);
    if (!best.has(k) || (best.get(k).file.includes("autosave") && !m.file.includes("autosave"))) best.set(k, m);
  }
  return [...best.values()].sort((a, b) => cmp(key(a), key(b)) || a.meta.playSeconds - b.meta.playSeconds || cmp(a.meta.saved, b.meta.saved));
}

function runsOf(snaps) {
  const g = new Map();
  for (const m of snaps) { if (!g.has(key(m))) g.set(key(m), []); g.get(key(m)).push(m); }
  return [...g.values()].sort((a, b) => cmp(a[0].meta.saved, b[0].meta.saved));
}

function parents(run) {
  const prog = run.map(progress);
  return run.map((_, i) => { for (let j = i - 1; j >= 0; j--) if (subset(prog[j], prog[i])) return j; return null; });
}

function branches(run) {
  const par = parents(run), kids = new Map();
  par.forEach((p, i) => { if (p !== null) kids.set(p, [...(kids.get(p) || []), i]); });
  const nodes = [], cur = {};
  par.forEach((p, i) => {
    if (p !== null && kids.get(p).length === 1 && cur[p] !== undefined) { cur[i] = cur[p]; nodes[cur[i]].push(i); }
    else { cur[i] = nodes.length; nodes.push([i]); }
  });
  const seen = new Set(), edges = [];
  par.forEach((p, i) => { if (p !== null && cur[p] !== cur[i]) { const e = `${cur[p]},${cur[i]}`; if (!seen.has(e)) { seen.add(e); edges.push([cur[p], cur[i]]); } } });
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [nodes, edges];
}

function firstSeen(run, getter) {
  const seen = new Map();
  for (const m of run) for (const x of getter(m)) if (!seen.has(x)) seen.set(x, m);
  return seen;
}

function grouped(seen, label) {
  const by = new Map();
  for (const [x, m] of seen) { const k = `${String(m.meta.playSeconds).padStart(12, "0")}\u0000${m.file}`; if (!by.has(k)) by.set(k, [m, []]); by.get(k)[1].push(x); }
  const L = [];
  for (const k of [...by.keys()].sort()) {
    const [m, xs] = by.get(k);
    L.push(`#### ${hms(m.meta.playSeconds)}  _(${m.file})_`, "", ...xs.sort().map((x) => `- ${x}`), "");
  }
  return L.length ? L : [`_no ${label}_`, ""];
}

function chart(run) {
  const lab = run.map((m) => hms(m.meta.playSeconds).slice(0, -3));
  const series = (name, vals) => ["```mermaid", "xychart-beta", `  title "${name}"`, "  x-axis [" + lab.map((x) => `"${x}"`).join(", ") + "]",
    `  y-axis "${name}" 0 --> ${Math.max(...vals) || 1}`, "  line [" + vals.join(", ") + "]", "```", ""];
  return [...series("Buildings", run.map((m) => m.buildings.total)), ...series("Belt length (m)", run.map((m) => m.logistics.beltLengthMeters)),
    ...series("Schematics purchased", run.map((m) => m.progression.schematicsPurchased))];
}

/** @param {{summary:object|null,name:string,size:number}[]} entries @returns {string} */
export function combined(entries) {
  const skipped = entries.filter((e) => !e.summary).map((e) => e.name);
  const snaps = dedupe(entries.filter((e) => e.summary).map((e) => ({ ...e.summary, file: e.name, bytes: e.size })));
  if (!snaps.length) throw new Error("no readable world saves found");
  const runs = runsOf(snaps);
  const newest = snaps.reduce((a, b) => (b.meta.saved > a.meta.saved ? b : a));
  const secs = snaps.map((m) => m.meta.playSeconds);
  const L = ["# Satisfactory — Combined Playthrough Timeline", "",
    `_Reconstructed from ${snaps.length} snapshots in ${runs.length} run${runs.length !== 1 ? "s" : ""}. Timestamps are the in-game play time of the FIRST snapshot in which each milestone, recipe, research tree or building appears: an upper bound on when it happened, never a lower one._`, "",
    `_Span: ${hms(Math.min(...secs))} → ${hms(Math.max(...secs))} of play across the runs. Newest save: ${newest.file} (${hms(newest.meta.playSeconds)})._`, "", "---", "",
    `# Part 1 — Current State (newest save: ${hms(newest.meta.playSeconds)})`, "", md(newest, newest.file, "##").split("\n").slice(2).join("\n"), "", "---", "", "# Part 2 — Timeline", ""];
  for (const run of runs) {
    const me = run[run.length - 1].meta;
    L.push(`## Run: ${me.sessionName}  (${run.length} snapshots, ${hms(run[0].meta.playSeconds)} → ${hms(run[run.length - 1].meta.playSeconds)})`, "", "### Branches", "",
      "_Saves sorted by play time look like one line, but reloading an earlier save and playing on forks the run. A snapshot's parent is the latest earlier one whose progress (schematics, alternate recipes, research trees) it still entirely contains._", "");
    const [nodes, edges] = branches(run);
    L.push("```mermaid", "flowchart TD");
    nodes.forEach((ch, i) => {
      const a = run[ch[0]], z = run[ch[ch.length - 1]];
      const span = hms(a.meta.playSeconds) + (a !== z ? ` → ${hms(z.meta.playSeconds)}` : "");
      L.push(`  n${i}["${span}<br/>${ch.length} snapshot${ch.length !== 1 ? "s" : ""} · tier ${z.progression.highestTier}<br/>${n(z.buildings.total)} buildings"]`);
    });
    L.push(...edges.map(([a, b]) => `  n${a} --> n${b}`), "```", "");
    L.push("### Journey", "", ...chart(run));
    L.push("### Snapshots", "", "_Runs of consecutive snapshots where nothing tracked moved are collapsed to one row._", "");
    const rows = [];
    let prev = null;
    for (const m of run) { const s = sig(m); if (s === prev) rows[rows.length - 1].push(m); else { rows.push([m]); prev = s; } }
    const out = rows.map((ms) => {
      const m = ms[0], pr = m.progression;
      const t = hms(m.meta.playSeconds) + (ms.length > 1 ? ` – ${hms(ms[ms.length - 1].meta.playSeconds)} (${ms.length} snapshots, no change)` : "");
      return [t, pr.highestTier, pr.gamePhase || "—", pr.schematicsPurchased, pr.alternateRecipes.length, m.buildings.total, m.machines.count, m.logistics.beltLengthMeters, m.items.total, m.players.length];
    });
    L.push(...table(["Play time", "Tier", "Phase", "Schematics", "Alt. recipes", "Buildings", "Machines", "Belt m", "Items", "Players"], out), "");
    L.push("### Schematics — first bought", "", ...grouped(firstSeen(run, (m) => m.progression.schematicNames), "schematics"));
    L.push("### Alternate recipes — first unlocked", "", ...grouped(firstSeen(run, (m) => m.progression.alternateRecipes), "alternate recipes"));
    L.push("### MAM research trees — first unlocked", "", ...grouped(firstSeen(run, (m) => m.progression.researchTrees), "research trees"));
    L.push("### Building kinds — first built", "", ...grouped(firstSeen(run, (m) => m.buildings.rows.map((r) => r.name)), "buildings"));
    L.push("### Game phases — first reached", "", ...grouped(firstSeen(run, (m) => (m.progression.gamePhase ? [m.progression.gamePhase] : [])), "phases"));
  }
  L.push("---", "", "## Reference list", "");
  [...snaps].sort((a, b) => cmp(key(a), key(b)) || a.meta.playSeconds - b.meta.playSeconds).forEach((m, i) => {
    L.push(`${i + 1}. \`${m.file}\` — ${m.meta.sessionName}, ${hms(m.meta.playSeconds)}, saved ${m.meta.saved.slice(0, 19)}, build ${m.meta.buildVersion}, ${m.bytes.toLocaleString("en-US")} bytes`);
  });
  if (skipped.length) L.push("", "_Skipped (not world saves):_ " + skipped.map((f) => `\`${f}\``).join(", "));
  return L.join("\n") + "\n";
}
