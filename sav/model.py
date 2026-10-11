"""parse() result -> one JSON-able summary. Everything the renderers show is computed here,
so the Markdown, JSON and web front ends cannot drift."""
from collections import Counter

from .names import nice, leaf, build_category, is_fluid, schematic

VEHICLES = ("BP_Tractor", "BP_Truck", "BP_Explorer", "Testa_BP_WB", "BP_Golfcart", "BP_GolfcartGold")
GENERATOR_KEYS = ("Build_Generator",)


def srt(c, limit=None):
    items = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
    return dict(items[:limit] if limit else items)


def pairs(v):
    """A Map property -> list of (key, value); tolerates None."""
    return list(v or [])


def amounts(v):
    """[(key, {'ItemAmounts': [((lvl,path), n), ...]})] -> Counter(item name -> n)"""
    c = Counter()
    for _, st in pairs(v):
        for it, n in (st or {}).get("ItemAmounts", []) or []:
            c[nice(it[1])] += n
    return c


def index(save):
    objs = [o for l in save["levels"] for o in l["objects"]]
    return objs, {o["name"]: o for o in objs}


def stacks(o):
    """(item path, count) for every non-empty stack of an inventory component."""
    for st in (o.get("props") or {}).get("mInventoryStacks") or []:
        ref = ((st or {}).get("Item") or {}).get("item")
        n = (st or {}).get("NumItems") or 0
        if ref and ref[1] and n > 0: yield ref[1], n


def owner_group(cls):
    k = leaf(cls)
    if k.startswith("Char_Player"): return "Player"
    if any(t in k for t in ("Storage", "Locker", "Tank")): return "Storage"
    if k.startswith("Build_"): return "Machines and buildings"
    if k.startswith(VEHICLES) or "Locomotive" in k or "Wagon" in k: return "Vehicles"
    return "Other"


def summarize(save):
    objs, by = index(save)
    ents = [o for o in objs if o["kind"] == "entity"]
    h = save["header"]
    cls = lambda o: leaf(o["class"])
    first = lambda name: next((o for o in ents if cls(o) == name), None)
    props = lambda name: (first(name) or {}).get("props") or {}
    out = {"meta": {k: h.get(k) for k in ("saveName", "sessionName", "saved", "playSeconds", "buildVersion", "saveVersion", "headerType", "mapName", "creative", "modded", "partitioned", "saveIdentifier")}}

    # integrity: how much of the file was actually decoded
    out["integrity"] = {"objects": len(objs), "levels": len(save["levels"]),
                        "unreadProperties": sum(len(o.get("unread") or []) for o in objs),
                        "undecodedBytes": sum(o.get("trailing", 0) for o in objs) + save.get("unreadTail", 0),
                        "objectErrors": sum(1 for o in objs if "error" in o)}

    tod, gm = props("BP_TimeOfDaySubsystem_C"), props("BP_GameMode_C")
    out["time"] = {"playSeconds": h["playSeconds"], "inGameDays": tod.get("mNumberOfPassedDays"), "daySeconds": tod.get("mDaySeconds"),
                   "daysSinceLastDeath": tod.get("mNumberOfDaysSinceLastDeath"), "startingPoint": gm.get("mStartingPointTagName")}

    # inventories
    groups, depot, belts, total, fluids = {}, Counter(), Counter(), Counter(), Counter()
    for o in objs:
        if o["kind"] != "component" or not o["class"].endswith("Component") and "Inventory" not in o["class"]: continue
        own = by.get(o.get("parent", ""))
        g = owner_group(own["class"]) if own else "Other"
        for item, n in stacks(o):
            if is_fluid(item): fluids[nice(item)] += n; continue
            groups.setdefault(g, Counter())[nice(item)] += n
            total[nice(item)] += n
    for st in (props("FGCentralStorageSubsystem").get("mStoredItems") or []):
        ic = (st.get("ItemClass") or ("", ""))[1]
        n = st.get("Amount") or st.get("NumItems") or 0
        if ic and n: depot[nice(ic)] += n
    for o in ents:
        for it in ((o.get("special") or {}).get("items") or []):
            belts[nice(it["item"]["item"][1])] += 1
    out["items"] = {"total": sum(total.values()) + sum(depot.values()) + sum(belts.values()),
                    "groups": {g: srt(c) for g, c in sorted(groups.items())}, "fluidsCubicMeters": {k: round(v / 1000, 1) for k, v in srt(fluids).items()}, "dimensionalDepot": srt(depot), "onBelts": srt(belts)}

    # players
    pl = []
    for o in ents:
        if cls(o) != "Char_Player_C": continue
        p = o["props"]; inv = Counter()
        for key in ("mInventory", "mArmsEquipmentSlot", "mBackEquipmentSlot", "mLegsEquipmentSlot", "mHeadEquipmentSlot", "mBodyEquipmentSlot"):
            c = by.get((p.get(key) or ("", ""))[1])
            for item, n in (stacks(c) if c else []): inv[nice(item)] += n
        pl.append({"name": p.get("mCachedPlayerName"), "position": [round(v) for v in o.get("pos", (0, 0, 0))], "items": srt(inv)})
    out["players"] = pl

    # progression
    sch = (props("BP_SchematicManager_C").get("mPurchasedSchematics") or [])
    kinds = Counter(); tiers = {}
    for _lvl, path in sch:
        parts = path.split("/")
        folder = parts[parts.index("Schematics") + 1] if "Schematics" in parts and parts.index("Schematics") + 1 < len(parts) - 1 else "Starting"
        kinds[folder] += 1
        n = leaf(path)
        if folder == "Progression" and n.startswith("Schematic_") and "-" in n:
            t, m = n[len("Schematic_"):].removesuffix("_C").split("-")[:2]
            if t.isdigit() and m.isdigit(): tiers.setdefault(int(t), set()).add(int(m))
    recipes = [r[1] for r in (props("FGRecipeManager").get("mAvailableRecipes") or [])]
    alts = sorted(nice(r) for r in recipes if "Alternate" in r or "_Alt" in leaf(r))
    ph, sm = props("BP_GamePhaseManager_C"), props("BP_SchematicManager_C")
    uns = props("BP_UnlockSubsystem_C"); rs = props("FGResourceSinkSubsystem")
    out["progression"] = {
        "gamePhase": nice(ph["mCurrentGamePhase"][1]) if ph.get("mCurrentGamePhase") and ph["mCurrentGamePhase"][1] else None,
        "targetPhase": nice(ph["mTargetGamePhase"][1]) if ph.get("mTargetGamePhase") and ph["mTargetGamePhase"][1] else None,
        "activeSchematic": schematic(sm["mActiveSchematic"][1]) if sm.get("mActiveSchematic") and sm["mActiveSchematic"][1] else None,
        "schematicNames": sorted(schematic(p) for _, p in sch), "schematicsPurchased": len(sch), "schematicKinds": srt(kinds),
        "milestones": {f"Tier {t}": sorted(m) for t, m in sorted(tiers.items())},
        "highestTier": max(tiers) if tiers else 0,
        "recipesAvailable": len(recipes), "alternateRecipes": alts,
        "researchTrees": sorted(nice(r[1]) for r in (props("BP_ResearchManager_C").get("mUnlockedResearchTrees") or [])),
        "hardDrivesUsed": props("BP_ResearchManager_C").get("mLastUsedHardDriveID"),
        "unlocks": sorted(k[3:] for k, v in uns.items() if k.startswith("mIs") and v is True),
        "inventorySlots": uns.get("mNumTotalInventorySlots"), "armSlots": uns.get("mNumTotalArmEquipmentSlots"),
        "resourceSink": {"points": rs.get("mTotalPoints"), "levels": rs.get("mCurrentPointLevels")},
        "dropPodsLooted": len(props("FGScannableSubsystem").get("mLootedDropPods") or []),
    }

    # buildings (entities plus the lightweight instances that foundations and walls live in)
    census = Counter()
    for o in ents:
        if cls(o).startswith("Build_"): census[o["class"]] += 1
    for o in ents:
        for b in ((o.get("special") or {}).get("buildables") or []):
            census[b["type"][1]] += len(b["instances"])
    cats, rows = Counter(), []
    for path, n in census.items():
        c = build_category(path); cats[c] += n
        rows.append({"class": leaf(path), "name": nice(path), "category": c, "count": n})
    rows.sort(key=lambda r: (r["category"], -r["count"], r["name"]))
    out["buildings"] = {"total": sum(census.values()), "byCategory": srt(cats), "rows": rows}

    # machines
    mach, rec = [], Counter()
    for o in ents:
        p = o["props"]; r = p.get("mCurrentRecipe")
        if not cls(o).startswith("Build_") or not r or not r[1]: continue
        dur = p.get("mLastProductivityMeasurementDuration") or 0
        mach.append({"machine": nice(o["class"]), "recipe": nice(r[1]), "producing": bool(p.get("mIsProducing")),
                     "clock": round(p.get("mCurrentPotential", 1.0) * 100), "productivity": round(100 * (p.get("mLastProductivityMeasurementProduceDuration") or 0) / dur) if dur else None})
        rec[(nice(r[1]), nice(o["class"]))] += 1
    out["machines"] = {"count": len(mach), "producing": sum(m["producing"] for m in mach),
                       "recipes": [{"recipe": r, "machine": m, "count": n} for (r, m), n in sorted(rec.items(), key=lambda kv: (-kv[1], kv[0]))]}

    # extraction and power
    ext = Counter(nice(o["class"]) for o in ents if cls(o).startswith(("Build_Miner", "Build_WaterPump", "Build_OilPump", "Build_Frack")))
    prod = Counter(nice(o["class"]) for o in ents if cls(o).startswith(("Build_Miner", "Build_WaterPump", "Build_OilPump", "Build_Frack")) and o["props"].get("mIsProducing"))
    gens = Counter(nice(o["class"]) for o in ents if cls(o).startswith(GENERATOR_KEYS))
    cons = sum((o.get("props") or {}).get("mTargetConsumption") or 0 for o in objs if o["class"].endswith("FGPowerInfoComponent") and by.get(o.get("parent", ""), {"class": ""})["class"].rsplit(".", 1)[-1].startswith("Build_"))
    out["extraction"] = {"extractors": srt(ext), "producing": srt(prod)}
    out["power"] = {"generators": srt(gens), "circuits": max(sum(1 for o in objs if cls(o) == "FGPowerCircuit"), len(next((o["special"]["circuits"] for o in ents if cls(o) == "BP_CircuitSubsystem_C" and o.get("special")), []))),
                    "targetConsumptionMW": round(cons, 1), "poles": sum(n for c, n in census.items() if "PowerPole" in c or "PowerTower" in c), "lines": census.get("/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C", 0)}

    # logistics
    chains = [o for o in ents if (o.get("special") or {}).get("type") == "ConveyorChain"]
    cb = lambda *keys: sum(n for c, n in census.items() if any(k in leaf(c) for k in keys))
    out["logistics"] = {"belts": cb("ConveyorBeltMk"), "lifts": cb("ConveyorLiftMk"), "chains": len(chains),
                        "beltLengthMeters": round(sum(o["special"]["length"] for o in chains) / 100),
                        "itemsOnBelts": sum(len(o["special"]["items"]) for o in chains),
                        "pipelines": cb("Build_Pipeline_C", "Build_PipelineMk2"), "pipeNetworks": sum(1 for o in ents if cls(o) == "FGPipeNetwork"),
                        "trackSegments": cb("RailroadTrack"), "trainStations": cb("TrainStation"),
                        "locomotives": sum(1 for o in ents if "Locomotive" in cls(o)), "freightWagons": sum(1 for o in ents if "FreightWagon" in cls(o)),
                        "droneStations": cb("DroneStation"), "vehicles": srt(Counter(nice(o["class"]) for o in ents if cls(o).startswith(VEHICLES)))}

    # world and statistics
    drops = [o for o in ents if cls(o) == "BP_DropPod_C"]
    slug = Counter(cls(o) for o in ents if cls(o) in ("BP_Crystal_C", "BP_Crystal_mk2_C", "BP_Crystal_mk3_C"))
    st = props("FGStatisticsSubsystem")
    out["world"] = {"dropPods": len(drops), "dropPodsLooted": sum(1 for o in drops if o["props"].get("mHasBeenLooted")),
                    "mercerShrines": sum(1 for o in ents if cls(o) == "BP_MercerShrine_C"),
                    "uncollectedSlugs": {"blue": slug["BP_Crystal_C"], "yellow": slug["BP_Crystal_mk2_C"], "purple": slug["BP_Crystal_mk3_C"]},
                    "pickupsCollected": len(props("FGScannableSubsystem").get("mDestroyedPickups") or []),
                    "destroyedActors": sum(l.get("destroyed", 0) for l in save["levels"]), "collectedRefs": sum(l.get("collectables", 0) for l in save["levels"])}
    out["statistics"] = {
        "built": srt(Counter({nice(k[1]): sum(n for _, n in (v or {}).get("BuiltPerPlayer", [])) for k, v in pairs(st.get("mActorsBuiltCount"))}), 25),
        "dismantled": sum(n for _, v in pairs(st.get("mActorsBuiltCount")) for _, n in (v or {}).get("DismantledPerPlayer", [])),
        "creaturesKilled": srt(Counter({nice(k[1]): n for k, n in pairs(st.get("mCreaturesKilledCount"))})),
        "consumablesConsumed": srt(Counter({nice(k[1]): n for k, n in pairs(st.get("mConsumablesConsumedCount"))})),
        "itemsCrafted": srt(amounts(st.get("mItemsManuallyCraftedCount")), 25), "itemsPickedUp": srt(amounts(st.get("mItemsPickedUp")), 25)}
    return out
