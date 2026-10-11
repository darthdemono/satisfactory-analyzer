// Port of sav/render.py: summary -> Markdown, byte for byte.
import { pyRound } from "./model.js";

const REPO_NOTE = "_Made by satisfactory-analyzer. Figures worked out from the save rather than stored in it say so where they appear._";

const grp = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true });

/** Whole numbers print whole, whether the source held 200 or 200.0. */
export function n(v) {
  if (typeof v === "number") return Number.isInteger(v) ? grp(v) : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v === null || v === undefined) return "None";
  return String(v);
}

export function hms(sec) {
  sec = Math.trunc(sec || 0);
  return `${Math.trunc(sec / 3600)}:${String(Math.trunc((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export const table = (head, rows) => [
  "| " + head.join(" | ") + " |",
  "|" + "---|".repeat(head.length),
  ...rows.map((r) => "| " + r.map(n).join(" | ") + " |"),
];

const counts = (d, head = ["Name", "Count"], limit) => {
  const rows = Object.entries(d).slice(0, limit);
  return rows.length ? table(head, rows) : ["_none_"];
};

const fmt0 = (x) => { const r = pyRound(x); return r === 0 && (x < 0 || Object.is(x, -0)) ? "-0" : grp(r); };

export function md(m, source = null, heading = "#") {
  const me = m.meta, t = m.time, pr = m.progression;
  const h2 = heading + "#", h3 = heading + "##";
  let L = [`${heading} Satisfactory save: ${me.saveName || me.sessionName}`, ""];
  if (source) L.push(`_Source: \`${source}\`_`, "");
  L.push(REPO_NOTE, "");
  L.push(`- **Session:** ${me.sessionName}`, `- **Saved:** ${me.saved}`, `- **Play time:** ${hms(t.playSeconds)}`);
  if (t.inGameDays !== null) L.push(`- **In-game days passed:** ${t.inGameDays} (${t.daysSinceLastDeath === null ? "None" : t.daysSinceLastDeath} since the last death)`);
  if (t.startingPoint) L.push(`- **Starting area:** ${t.startingPoint}`);
  L.push(`- **Game build:** ${me.buildVersion} (save version ${me.saveVersion})`, `- **Creative mode:** ${me.creative ? "Yes" : "No"}  ·  **Modded:** ${me.modded ? "Yes" : "No"}`, "");
  const ig = m.integrity;
  L.push(`- **Read integrity:** ${n(ig.objects)} objects in ${ig.levels} levels, ${ig.unreadProperties} unreadable properties, ${ig.undecodedBytes} undecoded bytes, ${ig.objectErrors} object errors`, "");

  L.push(`${h2} Players`, "");
  for (const p of m.players) {
    const pos = p.position.map((v) => fmt0(v / 100)).join(", ");
    L.push(`${h3} ${p.name || "(unnamed)"}`, "", `- **Position:** ${pos} (metres, x / y / z)`,
      `- **Carrying:** ${n(Object.values(p.items).reduce((a, b) => a + b, 0))} items in ${Object.keys(p.items).length} kinds`, "");
    L.push(...counts(p.items, ["Item", "×"]), "");
  }

  L.push(`${h2} Progression`, "");
  if (pr.gamePhase) L.push(`- **Game phase:** ${pr.gamePhase}` + (pr.targetPhase ? ` (working toward ${pr.targetPhase})` : ""));
  L.push(`- **Highest HUB tier:** ${pr.highestTier}` + (pr.activeSchematic ? ` (active milestone ${pr.activeSchematic})` : ""),
    `- **Schematics purchased:** ${pr.schematicsPurchased} — ` + Object.entries(pr.schematicKinds).map(([k, v]) => `${k} ${v}`).join(", "),
    `- **Recipes available:** ${pr.recipesAvailable}, of which ${pr.alternateRecipes.length} alternate`);
  if (pr.hardDrivesUsed !== null) L.push(`- **Hard drive research id (last used):** ${pr.hardDrivesUsed}`);
  if (pr.inventorySlots) L.push(`- **Inventory slots:** ${pr.inventorySlots}  ·  **Arm slots:** ${pr.armSlots}`);
  const rs = pr.resourceSink;
  if (rs.points && rs.points.length) L.push(`- **AWESOME Sink:** ${rs.points.map(n).join(" / ")} points, levels ${(rs.levels || []).map(String).join(" / ")}`);
  L.push(`- **Drop pods looted (scannable list):** ${pr.dropPodsLooted}`, "");
  if (Object.keys(pr.milestones).length) L.push("#### Milestones", "", ...table(["Tier", "Milestones bought"], Object.entries(pr.milestones).map(([k, v]) => [k, v.join(", ")])), "");
  if (pr.alternateRecipes.length) L.push("#### Alternate recipes", "", ...pr.alternateRecipes.map((r) => `- ${r}`), "");
  if (pr.researchTrees.length) L.push("#### MAM research trees", "", ...pr.researchTrees.map((r) => `- ${r}`), "");
  if (pr.unlocks.length) L.push("#### Unlocks", "", pr.unlocks.join(", "), "");

  const b = m.buildings;
  L.push(`${h2} Factory`, "", `- **Buildings:** ${n(b.total)} — ` + Object.entries(b.byCategory).map(([k, v]) => `${k} ${n(v)}`).join(", "), "");
  for (const cat of Object.keys(b.byCategory)) {
    const rows = b.rows.filter((r) => r.category === cat).map((r) => [r.name, r.count]);
    L.push(`${h3} ${cat}`, "", ...table(["Building", "Count"], rows.slice(0, 40)), ...(rows.length > 40 ? [`_… and ${rows.length - 40} more kinds_`] : []), "");
  }
  const mc = m.machines;
  L.push(`${h3} Active recipes`, "", `${mc.count} machines set to a recipe, ${mc.producing} producing when saved.`, "");
  L.push(...table(["Recipe", "Machine", "Count"], mc.recipes.map((r) => [r.recipe, r.machine, r.count])), "");
  const ex = m.extraction, pw = m.power;
  L.push(`${h3} Extraction and power`, "");
  L.push("- **Extractors:** " + (Object.entries(ex.extractors).map(([k, v]) => `${k} ${v} (${ex.producing[k] ?? 0} producing)`).join(", ") || "none"));
  L.push("- **Generators:** " + (Object.entries(pw.generators).map(([k, v]) => `${k} ${v}`).join(", ") || "none"),
    `- **Power grid:** ${pw.circuits} circuits, ${n(pw.poles)} poles/towers, ${n(pw.lines)} power lines; summed target consumption ${n(pw.targetConsumptionMW)} MW _(sum of every machine's target draw, not the grid's live load)_`, "");
  const lg = m.logistics;
  L.push(`${h2} Logistics`, "", `- **Conveyor belts:** ${n(lg.belts)}, **lifts:** ${n(lg.lifts)}, in ${n(lg.chains)} chains totalling ${n(lg.beltLengthMeters)} m`,
    `- **Items riding belts:** ${n(lg.itemsOnBelts)}`, `- **Pipelines:** ${n(lg.pipelines)} in ${lg.pipeNetworks} networks`,
    `- **Trains:** ${lg.locomotives} locomotives, ${lg.freightWagons} freight wagons, ${lg.trainStations} stations, ${n(lg.trackSegments)} track segments`,
    `- **Drone stations:** ${lg.droneStations}`, "- **Vehicles:** " + (Object.entries(lg.vehicles).map(([k, v]) => `${k} ${v}`).join(", ") || "none"), "");

  const it = m.items, sumv = (d) => Object.values(d).reduce((a, c) => a + c, 0);
  L.push(`${h2} Items`, "", `${n(it.total)} items counted across inventories, the Dimensional Depot and belts. Fluids are listed separately.`, "");
  for (const [g, c] of Object.entries(it.groups)) L.push(`${h3} ${g} (${n(sumv(c))})`, "", ...counts(c, ["Item", "×"], 60), "");
  if (Object.keys(it.dimensionalDepot).length) L.push(`${h3} Dimensional Depot (${n(sumv(it.dimensionalDepot))})`, "", ...counts(it.dimensionalDepot, ["Item", "×"]), "");
  if (Object.keys(it.onBelts).length) L.push(`${h3} On belts (${n(sumv(it.onBelts))})`, "", ...counts(it.onBelts, ["Item", "×"], 40), "");
  if (Object.keys(it.fluidsCubicMeters).length) L.push(`${h3} Fluids stored (m³)`, "", ...counts(it.fluidsCubicMeters, ["Fluid", "m³"]), "");

  const w = m.world, st = m.statistics;
  L.push(`${h2} World`, "", `- **Drop pods:** ${w.dropPodsLooted} of ${w.dropPods} looted`, `- **Mercer shrines (standing):** ${w.mercerShrines}`,
    `- **Power slugs still in the world:** blue ${w.uncollectedSlugs.blue}, yellow ${w.uncollectedSlugs.yellow}, purple ${w.uncollectedSlugs.purple}`,
    `- **Pickups collected:** ${w.pickupsCollected}  ·  **Collected references (sublevels):** ${n(w.collectedRefs)}`, "");
  L.push(`${h2} Statistics`, "", `- **Buildings dismantled:** ${n(st.dismantled)}`, "");
  for (const [key, title] of [["built", "Built (top 25)"], ["itemsCrafted", "Crafted by hand (top 25)"], ["itemsPickedUp", "Picked up (top 25)"], ["creaturesKilled", "Creatures killed"], ["consumablesConsumed", "Consumed"]])
    if (Object.keys(st[key]).length) L.push(`${h3} ${title}`, "", ...counts(st[key]), "");
  return L.join("\n").trimEnd() + "\n";
}
