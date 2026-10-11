// Port of sav/model.py: one JSON-able summary of a parsed save. Everything the renderers show
// is computed here, so Markdown, JSON and the page cannot drift.
import { nice, leaf, buildCategory, isFluid, schematic } from "./names.js";

const VEHICLES = ["BP_Tractor", "BP_Truck", "BP_Explorer", "Testa_BP_WB", "BP_Golfcart", "BP_GolfcartGold"];

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x, nd = 0) {
  const m = 10 ** nd, y = x * m, fl = Math.floor(y), d = y - fl;
  const r = d === 0.5 ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(y);
  return r / m;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const add = (c, k, n = 1) => { c[k] = (c[k] ?? 0) + n; };
/** Counter -> object ordered by count descending, then name. */
export function srt(c, limit) {
  const items = Object.entries(c).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  return Object.fromEntries(limit ? items.slice(0, limit) : items);
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pairs = (v) => v || [];

function amounts(v) {
  const c = {};
  for (const [, st] of pairs(v)) for (const [it, n] of (st || {}).ItemAmounts || []) add(c, nice(it[1]), n);
  return c;
}

function* stacks(o) {
  for (const st of (o.props || {}).mInventoryStacks || []) {
    const ref = ((st || {}).Item || {}).item;
    const n = (st || {}).NumItems || 0;
    if (ref && ref[1] && n > 0) yield [ref[1], n];
  }
}

function ownerGroup(cls) {
  const k = leaf(cls);
  if (k.startsWith("Char_Player")) return "Player";
  if (["Storage", "Locker", "Tank"].some((t) => k.includes(t))) return "Storage";
  if (k.startsWith("Build_")) return "Machines and buildings";
  if (VEHICLES.some((v) => k.startsWith(v)) || k.includes("Locomotive") || k.includes("Wagon")) return "Vehicles";
  return "Other";
}

export function summarize(save) {
  const objs = save.levels.flatMap((l) => l.objects);
  const by = new Map(objs.map((o) => [o.name, o]));
  const ents = objs.filter((o) => o.kind === "entity");
  const h = save.header;
  const cls = (o) => leaf(o.class);
  const first = (name) => ents.find((o) => cls(o) === name);
  const props = (name) => (first(name) || {}).props || {};
  const out = { meta: {} };
  for (const k of ["saveName", "sessionName", "saved", "playSeconds", "buildVersion", "saveVersion", "headerType", "mapName", "creative", "modded", "partitioned", "saveIdentifier"])
    out.meta[k] = h[k] ?? null;

  out.integrity = {
    objects: objs.length, levels: save.levels.length,
    unreadProperties: sum(objs.map((o) => (o.unread || []).length)),
    undecodedBytes: sum(objs.map((o) => o.trailing || 0)) + (save.unreadTail || 0),
    objectErrors: objs.filter((o) => "error" in o).length,
  };

  const tod = props("BP_TimeOfDaySubsystem_C"), gm = props("BP_GameMode_C");
  out.time = { playSeconds: h.playSeconds, inGameDays: tod.mNumberOfPassedDays ?? null, daySeconds: tod.mDaySeconds ?? null,
    daysSinceLastDeath: tod.mNumberOfDaysSinceLastDeath ?? null, startingPoint: gm.mStartingPointTagName ?? null };

  const groups = {}, depot = {}, belts = {}, total = {}, fluids = {};
  for (const o of objs) {
    if (o.kind !== "component" || (!o.class.endsWith("Component") && !o.class.includes("Inventory"))) continue;
    const own = by.get(o.parent || "");
    const g = own ? ownerGroup(own.class) : "Other";
    for (const [item, n] of stacks(o)) {
      if (isFluid(item)) { add(fluids, nice(item), n); continue; }
      add((groups[g] ??= {}), nice(item), n);
      add(total, nice(item), n);
    }
  }
  for (const st of props("FGCentralStorageSubsystem").mStoredItems || []) {
    const ic = (st.ItemClass || ["", ""])[1];
    const n = st.Amount || st.NumItems || 0;
    if (ic && n) add(depot, nice(ic), n);
  }
  for (const o of ents) for (const it of (o.special || {}).items || []) add(belts, nice(it.item.item[1]));
  out.items = {
    total: sum(Object.values(total)) + sum(Object.values(depot)) + sum(Object.values(belts)),
    groups: Object.fromEntries(Object.keys(groups).sort().map((g) => [g, srt(groups[g])])),
    fluidsCubicMeters: Object.fromEntries(Object.entries(srt(fluids)).map(([k, v]) => [k, pyRound(v / 1000, 1)])),
    dimensionalDepot: srt(depot), onBelts: srt(belts),
  };

  out.players = [];
  for (const o of ents) {
    if (cls(o) !== "Char_Player_C") continue;
    const p = o.props, inv = {};
    for (const key of ["mInventory", "mArmsEquipmentSlot", "mBackEquipmentSlot", "mLegsEquipmentSlot", "mHeadEquipmentSlot", "mBodyEquipmentSlot"]) {
      const c = by.get((p[key] || ["", ""])[1]);
      if (c) for (const [item, n] of stacks(c)) add(inv, nice(item), n);
    }
    out.players.push({ name: p.mCachedPlayerName ?? null, position: (o.pos || [0, 0, 0]).map((v) => pyRound(v)), items: srt(inv) });
  }

  const sch = props("BP_SchematicManager_C").mPurchasedSchematics || [];
  const kinds = {}, tiers = {};
  for (const [, path] of sch) {
    const parts = path.split("/");
    const ix = parts.indexOf("Schematics");
    const folder = ix >= 0 && ix + 1 < parts.length - 1 ? parts[ix + 1] : "Starting";
    add(kinds, folder);
    const n = leaf(path);
    if (folder === "Progression" && n.startsWith("Schematic_") && n.includes("-")) {
      const [t, m] = (n.slice("Schematic_".length).replace(/_C$/, "")).split("-");
      if (/^\d+$/.test(t) && /^\d+$/.test(m)) (tiers[+t] ??= new Set()).add(+m);
    }
  }
  const recipes = (props("FGRecipeManager").mAvailableRecipes || []).map((r) => r[1]);
  const alts = recipes.filter((r) => r.includes("Alternate") || leaf(r).includes("_Alt")).map(nice).sort();
  const ph = props("BP_GamePhaseManager_C"), sm = props("BP_SchematicManager_C");
  const uns = props("BP_UnlockSubsystem_C"), rs = props("FGResourceSinkSubsystem");
  const tierKeys = Object.keys(tiers).map(Number).sort((a, b) => a - b);
  const set = (r) => (r && r[1] ? nice(r[1]) : null);
  out.progression = {
    gamePhase: set(ph.mCurrentGamePhase), targetPhase: set(ph.mTargetGamePhase), activeSchematic: sm.mActiveSchematic && sm.mActiveSchematic[1] ? schematic(sm.mActiveSchematic[1]) : null,
    schematicNames: sch.map(([, p]) => schematic(p)).sort(), schematicsPurchased: sch.length, schematicKinds: srt(kinds),
    milestones: Object.fromEntries(tierKeys.map((t) => [`Tier ${t}`, [...tiers[t]].sort((a, b) => a - b)])),
    highestTier: tierKeys.length ? tierKeys[tierKeys.length - 1] : 0,
    recipesAvailable: recipes.length, alternateRecipes: alts,
    researchTrees: (props("BP_ResearchManager_C").mUnlockedResearchTrees || []).map((r) => nice(r[1])).sort(),
    hardDrivesUsed: props("BP_ResearchManager_C").mLastUsedHardDriveID ?? null,
    unlocks: Object.entries(uns).filter(([k, v]) => k.startsWith("mIs") && v === true).map(([k]) => k.slice(3)).sort(),
    inventorySlots: uns.mNumTotalInventorySlots ?? null, armSlots: uns.mNumTotalArmEquipmentSlots ?? null,
    resourceSink: { points: rs.mTotalPoints ?? null, levels: rs.mCurrentPointLevels ?? null },
    dropPodsLooted: (props("FGScannableSubsystem").mLootedDropPods || []).length,
  };

  const census = {};
  for (const o of ents) if (cls(o).startsWith("Build_")) add(census, o.class);
  for (const o of ents) for (const b of (o.special || {}).buildables || []) add(census, b.type[1], sum(b.instances.map(() => 1)));
  const cats = {}, rows = [];
  for (const [path, n] of Object.entries(census)) {
    const c = buildCategory(path); add(cats, c, n);
    rows.push({ class: leaf(path), name: nice(path), category: c, count: n });
  }
  rows.sort((a, b) => cmp(a.category, b.category) || b.count - a.count || cmp(a.name, b.name));
  out.buildings = { total: sum(Object.values(census)), byCategory: srt(cats), rows };

  const mach = [], rec = {};
  for (const o of ents) {
    const p = o.props, r = p.mCurrentRecipe;
    if (!cls(o).startsWith("Build_") || !r || !r[1]) continue;
    const dur = p.mLastProductivityMeasurementDuration || 0;
    mach.push({ producing: !!p.mIsProducing });
    add(rec, nice(r[1]) + "\u0000" + nice(o.class));
  }
  out.machines = {
    count: mach.length, producing: mach.filter((m) => m.producing).length,
    recipes: Object.entries(rec).map(([k, n]) => { const [r, m] = k.split("\u0000"); return [r, m, n]; })
      .sort((a, b) => b[2] - a[2] || cmp(a[0], b[0]) || cmp(a[1], b[1])).map(([r, m, n]) => ({ recipe: r, machine: m, count: n })),
  };

  const EXT = ["Build_Miner", "Build_WaterPump", "Build_OilPump", "Build_Frack"];
  const ext = {}, prod = {}, gens = {};
  for (const o of ents) if (EXT.some((k) => cls(o).startsWith(k))) { add(ext, nice(o.class)); if (o.props.mIsProducing) add(prod, nice(o.class)); }
  for (const o of ents) if (cls(o).startsWith("Build_Generator")) add(gens, nice(o.class));
  let cons = 0;
  for (const o of objs) {
    if (!o.class.endsWith("FGPowerInfoComponent")) continue;
    const own = by.get(o.parent || "");
    if (own && leaf(own.class).startsWith("Build_")) cons += (o.props || {}).mTargetConsumption || 0;
  }
  const circuitSub = ents.find((o) => cls(o) === "BP_CircuitSubsystem_C" && o.special);
  out.extraction = { extractors: srt(ext), producing: srt(prod) };
  out.power = {
    generators: srt(gens),
    circuits: Math.max(objs.filter((o) => cls(o) === "FGPowerCircuit").length, circuitSub ? circuitSub.special.circuits.length : 0),
    targetConsumptionMW: pyRound(cons, 1),
    poles: sum(Object.entries(census).filter(([c]) => c.includes("PowerPole") || c.includes("PowerTower")).map(([, n]) => n)),
    lines: census["/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C"] ?? 0,
  };

  const chains = ents.filter((o) => (o.special || {}).type === "ConveyorChain");
  const cb = (...keys) => sum(Object.entries(census).filter(([c]) => keys.some((k) => leaf(c).includes(k))).map(([, n]) => n));
  const veh = {};
  for (const o of ents) if (VEHICLES.some((v) => cls(o).startsWith(v))) add(veh, nice(o.class));
  out.logistics = {
    belts: cb("ConveyorBeltMk"), lifts: cb("ConveyorLiftMk"), chains: chains.length,
    beltLengthMeters: pyRound(sum(chains.map((o) => o.special.length)) / 100),
    itemsOnBelts: sum(chains.map((o) => o.special.items.length)),
    pipelines: cb("Build_Pipeline_C", "Build_PipelineMk2"), pipeNetworks: ents.filter((o) => cls(o) === "FGPipeNetwork").length,
    trackSegments: cb("RailroadTrack"), trainStations: cb("TrainStation"),
    locomotives: ents.filter((o) => cls(o).includes("Locomotive")).length, freightWagons: ents.filter((o) => cls(o).includes("FreightWagon")).length,
    droneStations: cb("DroneStation"), vehicles: srt(veh),
  };

  const drops = ents.filter((o) => cls(o) === "BP_DropPod_C");
  const slug = (n) => ents.filter((o) => cls(o) === n).length;
  const st = props("FGStatisticsSubsystem");
  const kv = (v) => { const c = {}; for (const [k, n] of pairs(v)) c[nice(k[1])] = n; return c; };
  const built = {};
  for (const [k, v] of pairs(st.mActorsBuiltCount)) built[nice(k[1])] = sum(((v || {}).BuiltPerPlayer || []).map(([, n]) => n));
  out.world = {
    dropPods: drops.length, dropPodsLooted: drops.filter((o) => o.props.mHasBeenLooted).length,
    mercerShrines: slug("BP_MercerShrine_C"),
    uncollectedSlugs: { blue: slug("BP_Crystal_C"), yellow: slug("BP_Crystal_mk2_C"), purple: slug("BP_Crystal_mk3_C") },
    pickupsCollected: (props("FGScannableSubsystem").mDestroyedPickups || []).length,
    destroyedActors: sum(save.levels.map((l) => l.destroyed || 0)), collectedRefs: sum(save.levels.map((l) => l.collectables || 0)),
  };
  out.statistics = {
    built: srt(built, 25),
    dismantled: sum(pairs(st.mActorsBuiltCount).flatMap(([, v]) => ((v || {}).DismantledPerPlayer || []).map(([, n]) => n))),
    creaturesKilled: srt(kv(st.mCreaturesKilledCount)), consumablesConsumed: srt(kv(st.mConsumablesConsumedCount)),
    itemsCrafted: srt(amounts(st.mItemsManuallyCraftedCount), 25), itemsPickedUp: srt(amounts(st.mItemsPickedUp), 25),
  };
  return out;
}
