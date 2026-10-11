// The single-save report as DOM. Built with textContent only, never innerHTML, so a player
// called `<img onerror=...>` is text like any other name.
import { hms, n } from "./render.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const sumv = (d) => Object.values(d).reduce((a, b) => a + b, 0);

function tiles(items) {
  const w = el("div", "tiles");
  for (const [label, value] of items) { const t = el("div", "tile"); t.append(el("b", null, value), el("span", null, label)); w.append(t); }
  return w;
}

function kv(rows) {
  const dl = el("dl", "kv");
  for (const [k, v] of rows) dl.append(el("dt", null, k), el("dd", null, v));
  return dl;
}

function table(head, rows) {
  const t = el("table"), tr = el("tr");
  head.forEach((h, i) => tr.append(el("th", i === head.length - 1 && typeof rows[0]?.[i] === "number" ? "n" : null, h)));
  t.append(el("thead").appendChild(tr).parentNode);
  const tb = el("tbody");
  for (const r of rows) { const row = el("tr"); r.forEach((c) => row.append(el("td", typeof c === "number" ? "n" : null, n(c)))); tb.append(row); }
  t.append(tb);
  return t;
}

function fold(title, body, open = false) {
  const d = el("details"); d.open = open;
  d.append(el("summary", null, title), body);
  return d;
}

function bars(d) {
  const w = el("div", "bars"), max = Math.max(...Object.values(d), 1);
  for (const [k, v] of Object.entries(d)) {
    const b = el("div", "bar"), i = el("i");
    i.style.width = `${(100 * v) / max}%`;
    b.append(el("span", null, k), i, el("em", null, n(v)));
    w.append(b);
  }
  return w;
}

function chips(list, on = false) {
  const w = el("div", "chips");
  for (const x of list) w.append(el("span", on ? "chip on" : "chip", x));
  return w;
}

const plate = (title, ...kids) => { const p = el("section", "plate"); p.append(el("h2", null, title), ...kids); return p; };
const counted = (d, a = "Item", b = "×") => table([a, b], Object.entries(d));

export function renderSave(m, file) {
  const me = m.meta, pr = m.progression, b = m.buildings, lg = m.logistics, it = m.items;
  const root = el("div", "sat");
  const head = el("div", "head");
  head.append(el("h1", null, me.saveName || me.sessionName), el("span", "sub", `${file} · ${me.saved.slice(0, 19).replace("T", " ")} UTC`));
  root.append(head);
  root.append(tiles([
    ["Play time", hms(m.time.playSeconds)], ["HUB tier", String(pr.highestTier)], ["Phase", pr.gamePhase || "—"],
    ["Buildings", n(b.total)], ["Machines", `${m.machines.producing}/${m.machines.count}`], ["Belts", `${n(lg.beltLengthMeters)} m`],
    ["Items", n(it.total)], ["Players", String(m.players.length)],
  ]));

  const rows = [["Session", me.sessionName], ["Game build", `${me.buildVersion} (save version ${me.saveVersion})`], ["Creative", me.creative ? "Yes" : "No"], ["Modded", me.modded ? "Yes" : "No"]];
  if (m.time.inGameDays !== null) rows.splice(1, 0, ["In-game days", `${m.time.inGameDays} (${m.time.daysSinceLastDeath} since the last death)`]);
  if (m.time.startingPoint) rows.splice(1, 0, ["Starting area", m.time.startingPoint]);
  root.append(plate("Save", kv(rows)));

  const pl = el("div", "players");
  for (const p of m.players) {
    const c = el("div", "plate");
    c.append(el("h3", null, p.name ?? "Unnamed"), kv([["Position (m)", p.position.map((v) => n(Math.round(v / 100))).join(", ")], ["Carrying", `${n(sumv(p.items))} items, ${Object.keys(p.items).length} kinds`]]),
      fold("Inventory", counted(p.items)));
    pl.append(c);
  }
  root.append(plate("Players", pl));

  const prog = [el("p", "sub", `${pr.schematicsPurchased} schematics (${Object.entries(pr.schematicKinds).map(([k, v]) => `${k} ${v}`).join(", ")}), ${pr.recipesAvailable} recipes, ${pr.alternateRecipes.length} alternate.` + (pr.activeSchematic ? ` Active milestone ${pr.activeSchematic}.` : ""))];
  if (pr.targetPhase) prog.push(el("p", "sub", `Working toward ${pr.targetPhase}.`));
  if (Object.keys(pr.milestones).length) prog.push(table(["Tier", "Milestones bought"], Object.entries(pr.milestones).map(([k, v]) => [k, v.join(", ")])));
  if (pr.alternateRecipes.length) prog.push(fold(`Alternate recipes (${pr.alternateRecipes.length})`, chips(pr.alternateRecipes, true)));
  if (pr.researchTrees.length) prog.push(fold("MAM research trees", chips(pr.researchTrees)));
  if (pr.unlocks.length) prog.push(fold("Unlocks", chips(pr.unlocks)));
  const rs = pr.resourceSink;
  if (rs.points && rs.points.length) prog.push(kv([["AWESOME Sink", `${rs.points.map(n).join(" / ")} points, levels ${(rs.levels || []).join(" / ")}`]]));
  root.append(plate("Progression", ...prog));

  const fac = [bars(b.byCategory)];
  for (const cat of Object.keys(b.byCategory)) fac.push(fold(`${cat} (${n(b.byCategory[cat])})`, table(["Building", "Count"], b.rows.filter((r) => r.category === cat).map((r) => [r.name, r.count]))));
  const mc = m.machines;
  fac.push(fold(`Active recipes (${mc.count} machines, ${mc.producing} producing)`, table(["Recipe", "Machine", "Count"], mc.recipes.map((r) => [r.recipe, r.machine, r.count]))));
  root.append(plate("Factory", ...fac));

  const ex = m.extraction, pw = m.power;
  root.append(plate("Extraction and power", kv([
    ["Extractors", Object.entries(ex.extractors).map(([k, v]) => `${k} ${v} (${ex.producing[k] ?? 0} producing)`).join(", ") || "none"],
    ["Generators", Object.entries(pw.generators).map(([k, v]) => `${k} ${v}`).join(", ") || "none"],
    ["Grid", `${pw.circuits} circuits, ${n(pw.poles)} poles and towers, ${n(pw.lines)} power lines`],
    ["Target draw", `${n(pw.targetConsumptionMW)} MW summed over machines (not the live load)`]])));

  root.append(plate("Logistics", kv([
    ["Belts", `${n(lg.belts)} belts, ${n(lg.lifts)} lifts, ${n(lg.chains)} chains, ${n(lg.beltLengthMeters)} m`], ["Riding belts", `${n(lg.itemsOnBelts)} items`],
    ["Pipes", `${n(lg.pipelines)} pipelines in ${lg.pipeNetworks} networks`], ["Trains", `${lg.locomotives} locomotives, ${lg.freightWagons} wagons, ${lg.trainStations} stations, ${n(lg.trackSegments)} track segments`],
    ["Drones", `${lg.droneStations} stations`], ["Vehicles", Object.entries(lg.vehicles).map(([k, v]) => `${k} ${v}`).join(", ") || "none"]])));

  const inv = [el("p", "sub", `${n(it.total)} items counted across inventories, the Dimensional Depot and belts. Fluids are separate.`)];
  for (const [g, c] of Object.entries(it.groups)) inv.push(fold(`${g} (${n(sumv(c))})`, counted(c)));
  if (Object.keys(it.dimensionalDepot).length) inv.push(fold(`Dimensional Depot (${n(sumv(it.dimensionalDepot))})`, counted(it.dimensionalDepot)));
  if (Object.keys(it.onBelts).length) inv.push(fold(`On belts (${n(sumv(it.onBelts))})`, counted(it.onBelts)));
  if (Object.keys(it.fluidsCubicMeters).length) inv.push(fold("Fluids stored (m³)", counted(it.fluidsCubicMeters, "Fluid", "m³")));
  root.append(plate("Items", ...inv));

  const w = m.world, st = m.statistics, stat = [kv([
    ["Drop pods", `${w.dropPodsLooted} of ${w.dropPods} looted`], ["Mercer shrines standing", String(w.mercerShrines)],
    ["Power slugs left", `blue ${w.uncollectedSlugs.blue}, yellow ${w.uncollectedSlugs.yellow}, purple ${w.uncollectedSlugs.purple}`],
    ["Pickups collected", n(w.pickupsCollected)], ["Buildings dismantled", n(st.dismantled)]])];
  for (const [k, t] of [["built", "Built (top 25)"], ["itemsCrafted", "Crafted by hand (top 25)"], ["itemsPickedUp", "Picked up (top 25)"], ["creaturesKilled", "Creatures killed"], ["consumablesConsumed", "Consumed"]])
    if (Object.keys(st[k]).length) stat.push(fold(t, counted(st[k], "Name", "Count")));
  root.append(plate("World and statistics", ...stat));

  const ig = m.integrity, ok = !ig.unreadProperties && !ig.undecodedBytes && !ig.objectErrors;
  const foot = el("p", "integrity");
  foot.append("Read integrity: ", el("b", ok ? "" : "bad", ok ? "complete" : "gaps"), ` — ${n(ig.objects)} objects in ${ig.levels} levels, ${ig.unreadProperties} unreadable properties, ${ig.undecodedBytes} undecoded bytes, ${ig.objectErrors} object errors.`);
  root.append(foot);
  return root;
}
