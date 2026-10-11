"""A folder of saves -> one history: runs, branches, snapshot table, first-appearance tables."""
from collections import defaultdict
from pathlib import Path

from .model import summarize
from .reader import SavError, parse
from .render import hms, md, n, table


def collect(paths):
    files = []
    for p in map(Path, paths):
        files += sorted(p.rglob("*.sav")) if p.is_dir() else [p]
    snaps, skipped = [], []
    for f in files:
        try:
            m = summarize(parse(f.read_bytes()))
        except Exception as e:  # settings and server-manager files share the extension
            skipped.append((f.name, str(e)[:60])); continue
        m["file"] = f.name; m["bytes"] = f.stat().st_size; snaps.append(m)
    return snaps, skipped


def key(m):
    me = m["meta"]
    return f"{me['sessionName']}|{me.get('saveIdentifier') or ''}"


def progress(m):
    pr = m["progression"]
    return set(pr["schematicNames"]) | {"alt:" + a for a in pr["alternateRecipes"]} | {"tree:" + t for t in pr["researchTrees"]}


def signature(m):
    pr, b, mc, lg = m["progression"], m["buildings"], m["machines"], m["logistics"]
    return (pr["highestTier"], pr["gamePhase"], pr["schematicsPurchased"], len(pr["alternateRecipes"]), b["total"], mc["count"],
            lg["beltLengthMeters"], m["items"]["total"], len(m["players"]))


def dedupe(snaps):
    """Autosaves and manual saves of the same moment are one snapshot; prefer the manually named file."""
    best = {}
    for m in snaps:
        k = (key(m), m["meta"]["playSeconds"], m["buildings"]["total"], m["items"]["total"])
        if k not in best or ("autosave" in best[k]["file"] and "autosave" not in m["file"]): best[k] = m
    return sorted(best.values(), key=lambda m: (key(m), m["meta"]["playSeconds"], m["meta"]["saved"]))


def runs_of(snaps):
    g = defaultdict(list)
    for m in snaps: g[key(m)].append(m)
    return sorted(g.values(), key=lambda r: r[0]["meta"]["saved"])


def parents(run):
    """Parent = latest earlier snapshot whose progress this one still contains."""
    out = []
    for i, m in enumerate(run):
        p = None
        for j in range(i - 1, -1, -1):
            if progress(run[j]) <= progress(m): p = j; break
        out.append(p)
    return out


def branches(run):
    par = parents(run); kids = defaultdict(list)
    for i, p in enumerate(par):
        if p is not None: kids[p].append(i)
    nodes, cur = [], {}  # chain id per snapshot
    for i, p in enumerate(par):
        if p is not None and len(kids[p]) == 1 and cur.get(p) is not None: cur[i] = cur[p]; nodes[cur[i]].append(i)
        else: cur[i] = len(nodes); nodes.append([i])
    edges = sorted({(cur[p], cur[i]) for i, p in enumerate(par) if p is not None and cur[p] != cur[i]})
    return nodes, edges


def first_seen(run, getter):
    seen = {}
    for m in run:
        for x in getter(m): seen.setdefault(x, m)
    return seen


def grouped(seen, label):
    by = defaultdict(list)
    for x, m in seen.items(): by[(m["meta"]["playSeconds"], m["file"])].append(x)
    L = []
    for (sec, f), xs in sorted(by.items()):
        L += [f"#### {hms(sec)}  _({f})_", ""] + [f"- {x}" for x in sorted(xs)] + [""]
    return L or [f"_no {label}_", ""]


def chart(run):
    lab = [hms(m["meta"]["playSeconds"])[:-3] for m in run]
    def series(name, vals):
        top = max(vals) or 1
        return ["```mermaid", "xychart-beta", f'  title "{name}"', "  x-axis [" + ", ".join(f'"{x}"' for x in lab) + "]",
                f'  y-axis "{name}" 0 --> {top}', "  line [" + ", ".join(str(v) for v in vals) + "]", "```", ""]
    return series("Buildings", [m["buildings"]["total"] for m in run]) + series("Belt length (m)", [m["logistics"]["beltLengthMeters"] for m in run]) + series("Schematics purchased", [m["progression"]["schematicsPurchased"] for m in run])


def combined(paths):
    snaps, skipped = collect(paths)
    snaps = dedupe(snaps)
    if not snaps: raise SavError("no readable world saves found")
    runs = runs_of(snaps)
    newest = max(snaps, key=lambda m: m["meta"]["saved"])
    L = ["# Satisfactory — Combined Playthrough Timeline", "",
         f"_Reconstructed from {len(snaps)} snapshots in {len(runs)} run{'s' if len(runs) != 1 else ''}. Timestamps are the in-game play time of the FIRST snapshot in which each milestone, recipe, research tree or building appears: an upper bound on when it happened, never a lower one._", "",
         f"_Span: {hms(min(m['meta']['playSeconds'] for m in snaps))} → {hms(max(m['meta']['playSeconds'] for m in snaps))} of play across the runs. Newest save: {newest['file']} ({hms(newest['meta']['playSeconds'])})._", "", "---", "",
         f"# Part 1 — Current State (newest save: {hms(newest['meta']['playSeconds'])})", "", md(newest, newest["file"], heading="##").split("\n", 2)[2], "", "---", "", "# Part 2 — Timeline", ""]
    for run in runs:
        me = run[-1]["meta"]
        L += [f"## Run: {me['sessionName']}  ({len(run)} snapshots, {hms(run[0]['meta']['playSeconds'])} → {hms(run[-1]['meta']['playSeconds'])})", "", "### Branches", "",
              "_Saves sorted by play time look like one line, but reloading an earlier save and playing on forks the run. A snapshot's parent is the latest earlier one whose progress (schematics, alternate recipes, research trees) it still entirely contains._", ""]
        nodes, edges = branches(run)
        L += ["```mermaid", "flowchart TD"]
        for i, ch in enumerate(nodes):
            a, z = run[ch[0]], run[ch[-1]]
            span = hms(a["meta"]["playSeconds"]) + (f" → {hms(z['meta']['playSeconds'])}" if a is not z else "")
            L.append(f'  n{i}["{span}<br/>{len(ch)} snapshot{"s" if len(ch) != 1 else ""} · tier {z["progression"]["highestTier"]}<br/>{n(z["buildings"]["total"])} buildings"]')
        L += [f"  n{a} --> n{b}" for a, b in edges] + ["```", ""]
        L += ["### Journey", ""] + chart(run)
        L += ["### Snapshots", "", "_Runs of consecutive snapshots where nothing tracked moved are collapsed to one row._", ""]
        rows, prev = [], None
        for m in run:
            sig = signature(m)
            if sig == prev: rows[-1][1].append(m); continue
            rows.append((sig, [m])); prev = sig
        out = []
        for sig, ms in rows:
            m = ms[0]; pr, b = m["progression"], m["buildings"]
            t = hms(m["meta"]["playSeconds"]) + (f" – {hms(ms[-1]['meta']['playSeconds'])} ({len(ms)} snapshots, no change)" if len(ms) > 1 else "")
            out.append((t, pr["highestTier"], pr["gamePhase"] or "—", pr["schematicsPurchased"], len(pr["alternateRecipes"]), b["total"], m["machines"]["count"], m["logistics"]["beltLengthMeters"], m["items"]["total"], len(m["players"])))
        L += table(("Play time", "Tier", "Phase", "Schematics", "Alt. recipes", "Buildings", "Machines", "Belt m", "Items", "Players"), out) + [""]
        L += ["### Schematics — first bought", ""] + grouped(first_seen(run, lambda m: m["progression"]["schematicNames"]), "schematics")
        L += ["### Alternate recipes — first unlocked", ""] + grouped(first_seen(run, lambda m: m["progression"]["alternateRecipes"]), "alternate recipes")
        L += ["### MAM research trees — first unlocked", ""] + grouped(first_seen(run, lambda m: m["progression"]["researchTrees"]), "research trees")
        L += ["### Building kinds — first built", ""] + grouped(first_seen(run, lambda m: [r["name"] for r in m["buildings"]["rows"]]), "buildings")
        L += ["### Game phases — first reached", ""] + grouped(first_seen(run, lambda m: [m["progression"]["gamePhase"]] if m["progression"]["gamePhase"] else []), "phases")
    L += ["---", "", "## Reference list", ""]
    for i, m in enumerate(sorted(snaps, key=lambda m: (key(m), m["meta"]["playSeconds"])), 1):
        L.append(f"{i}. `{m['file']}` — {m['meta']['sessionName']}, {hms(m['meta']['playSeconds'])}, saved {m['meta']['saved'][:19]}, build {m['meta']['buildVersion']}, {m['bytes']:,} bytes")
    if skipped: L += ["", "_Skipped (not world saves):_ " + ", ".join(f"`{f}`" for f, _ in skipped)]
    return "\n".join(L) + "\n"
