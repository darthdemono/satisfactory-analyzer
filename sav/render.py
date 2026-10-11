"""summary dict -> Markdown. Same shape as the sl2-analyzer exports: bold-label bullets, tables,
details blocks for reference material."""
REPO_NOTE = "_Read by satisfactory-analyzer: header, every object's properties and the class-specific data are decoded; nothing is guessed. Derived figures are labelled._"


def n(v):
    """Whole numbers print whole, whether the source held 200 or 200.0 (JSON has one number type)."""
    if isinstance(v, float): return f"{int(v):,}" if v.is_integer() else f"{v:,.1f}"
    return f"{v:,}" if isinstance(v, int) else str(v)


def hms(sec):
    sec = int(sec or 0)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def table(head, rows):
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(n(c) for c in r) + " |" for r in rows]


def counts(d, head=("Name", "Count"), limit=None):
    rows = list(d.items())[:limit]
    return table(head, rows) if rows else ["_none_"]


def md(m, source=None, heading="#"):
    me, t, pr = m["meta"], m["time"], m["progression"]
    h2, h3 = heading + "#", heading + "##"
    L = [f"{heading} Satisfactory save: {me['saveName'] or me['sessionName']}", ""]
    if source: L += [f"_Source: `{source}`_", ""]
    L += [REPO_NOTE, ""]
    L += [f"- **Session:** {me['sessionName']}", f"- **Saved:** {me['saved']}", f"- **Play time:** {hms(t['playSeconds'])}"]
    if t.get("inGameDays") is not None: L.append(f"- **In-game days passed:** {t['inGameDays']} ({t.get('daysSinceLastDeath')} since the last death)")
    if t.get("startingPoint"): L.append(f"- **Starting area:** {t['startingPoint']}")
    L += [f"- **Game build:** {me['buildVersion']} (save version {me['saveVersion']})", f"- **Creative mode:** {'Yes' if me['creative'] else 'No'}  ·  **Modded:** {'Yes' if me['modded'] else 'No'}", ""]
    ig = m["integrity"]
    L += [f"- **Read integrity:** {n(ig['objects'])} objects in {ig['levels']} levels, {ig['unreadProperties']} unreadable properties, {ig['undecodedBytes']} undecoded bytes, {ig['objectErrors']} object errors", ""]

    L += [f"{h2} Players", ""]
    for p in m["players"]:
        pos = ", ".join(f"{v / 100:,.0f}" for v in p["position"])
        L += [f"{h3} {p['name'] or '(unnamed)'}", "", f"- **Position:** {pos} (metres, x / y / z)", f"- **Carrying:** {n(sum(p['items'].values()))} items in {len(p['items'])} kinds", ""]
        L += counts(p["items"], ("Item", "×")) + [""]

    L += [f"{h2} Progression", ""]
    if pr["gamePhase"]: L.append(f"- **Game phase:** {pr['gamePhase']}" + (f" (working toward {pr['targetPhase']})" if pr["targetPhase"] else ""))
    L += [f"- **Highest HUB tier:** {pr['highestTier']}" + (f" (active milestone {pr['activeSchematic']})" if pr["activeSchematic"] else ""),
          f"- **Schematics purchased:** {pr['schematicsPurchased']} — " + ", ".join(f"{k} {v}" for k, v in pr["schematicKinds"].items()),
          f"- **Recipes available:** {pr['recipesAvailable']}, of which {len(pr['alternateRecipes'])} alternate"]
    if pr["hardDrivesUsed"] is not None: L.append(f"- **Hard drive research id (last used):** {pr['hardDrivesUsed']}")
    if pr["inventorySlots"]: L.append(f"- **Inventory slots:** {pr['inventorySlots']}  ·  **Arm slots:** {pr['armSlots']}")
    rs = pr["resourceSink"]
    if rs["points"]: L.append(f"- **AWESOME Sink:** {' / '.join(n(x) for x in rs['points'])} points, levels {' / '.join(str(x) for x in rs['levels'] or [])}")
    L += [f"- **Drop pods looted (scannable list):** {pr['dropPodsLooted']}", ""]
    if pr["milestones"]:
        L += ["#### Milestones", ""] + table(("Tier", "Milestones bought"), [(k, ", ".join(map(str, v))) for k, v in pr["milestones"].items()]) + [""]
    if pr["alternateRecipes"]: L += ["#### Alternate recipes", ""] + [f"- {r}" for r in pr["alternateRecipes"]] + [""]
    if pr["researchTrees"]: L += ["#### MAM research trees", ""] + [f"- {r}" for r in pr["researchTrees"]] + [""]
    if pr["unlocks"]: L += ["#### Unlocks", "", ", ".join(pr["unlocks"]), ""]

    b = m["buildings"]
    L += [f"{h2} Factory", "", f"- **Buildings:** {n(b['total'])} — " + ", ".join(f"{k} {n(v)}" for k, v in b["byCategory"].items()), ""]
    for cat in b["byCategory"]:
        rows = [(r["name"], r["count"]) for r in b["rows"] if r["category"] == cat]
        L += [f"{h3} {cat}", ""] + table(("Building", "Count"), rows[:40]) + ([f"_… and {len(rows) - 40} more kinds_"] if len(rows) > 40 else []) + [""]
    mc = m["machines"]
    L += [f"{h3} Active recipes", "", f"{mc['count']} machines set to a recipe, {mc['producing']} producing when saved.", ""]
    L += table(("Recipe", "Machine", "Count"), [(r["recipe"], r["machine"], r["count"]) for r in mc["recipes"]]) + [""]
    ex, pw = m["extraction"], m["power"]
    L += [f"{h3} Extraction and power", ""]
    L += [f"- **Extractors:** " + (", ".join(f"{k} {v}" + (f" ({ex['producing'].get(k, 0)} producing)") for k, v in ex["extractors"].items()) or "none")]
    L += [f"- **Generators:** " + (", ".join(f"{k} {v}" for k, v in pw["generators"].items()) or "none"),
          f"- **Power grid:** {pw['circuits']} circuits, {n(pw['poles'])} poles/towers, {n(pw['lines'])} power lines; summed target consumption {n(pw['targetConsumptionMW'])} MW _(sum of every machine's target draw, not the grid's live load)_", ""]
    lg = m["logistics"]
    L += [f"{h2} Logistics", "", f"- **Conveyor belts:** {n(lg['belts'])}, **lifts:** {n(lg['lifts'])}, in {n(lg['chains'])} chains totalling {n(lg['beltLengthMeters'])} m",
          f"- **Items riding belts:** {n(lg['itemsOnBelts'])}", f"- **Pipelines:** {n(lg['pipelines'])} in {lg['pipeNetworks']} networks",
          f"- **Trains:** {lg['locomotives']} locomotives, {lg['freightWagons']} freight wagons, {lg['trainStations']} stations, {n(lg['trackSegments'])} track segments",
          f"- **Drone stations:** {lg['droneStations']}", "- **Vehicles:** " + (", ".join(f"{k} {v}" for k, v in lg["vehicles"].items()) or "none"), ""]

    it = m["items"]
    L += [f"{h2} Items", "", f"{n(it['total'])} items counted across inventories, the Dimensional Depot and belts. Fluids are listed separately.", ""]
    for g, c in it["groups"].items(): L += [f"{h3} {g} ({n(sum(c.values()))})", ""] + counts(c, ("Item", "×"), 60) + [""]
    if it["dimensionalDepot"]: L += [f"{h3} Dimensional Depot ({n(sum(it['dimensionalDepot'].values()))})", ""] + counts(it["dimensionalDepot"], ("Item", "×")) + [""]
    if it["onBelts"]: L += [f"{h3} On belts ({n(sum(it['onBelts'].values()))})", ""] + counts(it["onBelts"], ("Item", "×"), 40) + [""]
    if it["fluidsCubicMeters"]: L += [f"{h3} Fluids stored (m³)", ""] + counts(it["fluidsCubicMeters"], ("Fluid", "m³")) + [""]

    w, st = m["world"], m["statistics"]
    L += [f"{h2} World", "", f"- **Drop pods:** {w['dropPodsLooted']} of {w['dropPods']} looted", f"- **Mercer shrines (standing):** {w['mercerShrines']}",
          f"- **Power slugs still in the world:** blue {w['uncollectedSlugs']['blue']}, yellow {w['uncollectedSlugs']['yellow']}, purple {w['uncollectedSlugs']['purple']}",
          f"- **Pickups collected:** {w['pickupsCollected']}  ·  **Collected references (sublevels):** {n(w['collectedRefs'])}", ""]
    L += [f"{h2} Statistics", "", f"- **Buildings dismantled:** {n(st['dismantled'])}", ""]
    for key, title in (("built", "Built (top 25)"), ("itemsCrafted", "Crafted by hand (top 25)"), ("itemsPickedUp", "Picked up (top 25)"), ("creaturesKilled", "Creatures killed"), ("consumablesConsumed", "Consumed")):
        if st[key]: L += [f"{h3} {title}", ""] + counts(st[key]) + [""]
    return "\n".join(L).rstrip() + "\n"
