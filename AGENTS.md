# AGENTS.md

Unified instruction file for any coding agent (Claude Code, Codex, or similar). Both `CLAUDE.md` and `AGENTS.md` resolve to this content.

## What this is

A Satisfactory world save goes in, a report comes out. It is shaped like `~/Code/sl2-analyzer` on purpose: a Python CLI (`sat_to_md.py`: Markdown, JSON against `schema.json`, or a combined history of many saves) and a browser app (`index.html` + `app/*.js`) that is a port of the Python, held byte for byte by `tools/parity.mjs`. Python side: the `sav/` package, standard library. Web side: no framework, no build step, Mermaid vendored.

## Commands

```bash
python3 sat_to_md.py                              # newest save on this machine (auto_find)
python3 sat_to_md.py x.sav -o x.md|x.json         # one save
python3 sat_to_md.py dir1 dir2 f.sav -o out.md    # COMBINED history; --combined forces it for one save
python3 -m unittest discover -s tests             # every local save decodes completely + schema check (~80 s)
node tools/parity.mjs <folder|save>...            # THE gate for the web port: py vs js summary, markdown, combined doc
python3 tools/gen_schema.py                       # regenerate schema.json after changing the summary shape
python3 -m http.server <free port> --bind 127.0.0.1   # then open index.html; CHECK `ss -ltn` for the port first
```

## Local paths (mandatory)

- The **dedicated server's save folder is authoritative and newest**: `~/docker/satisfactory/config/saved/server/`. It holds the Joy-and-Jade lineage and the old First/Test lineages. `ServerSettings.*.sav`, `ServerManager_V2.sav` and `CurrentSettingsSaveName.sav` are NOT worlds and must be refused cleanly (`SavError`).
- Backups of the Heroic-prefix and wd-blue saves: `/mnt/nobara-data/Backup/AppData/Local/FactoryGame/Saved/SaveGames/` (49 files, md5-verified 11-10-2026).
- Write generated reports to `/mnt/nobara-data/Game Save Data/` (renamed from `Temp/DS Save Data` on 11-10-2026): `satisfactory_playthrough(combined).md` and `satisfactory_playthrough.md`.

## Architecture

```
sav/reader.py    header, chunk inflate, world-partition grids, per-level object TOC; parse() -> dict
sav/props.py     properties (both tag layouts), structs, text, maps, sets, class-specific data
sav/model.py     summarize(parsed) -> one JSON-able dict; EVERYTHING the writers show is computed here
sav/names.py     readable names + categories from class paths (override table is hand-curated)
sav/render.py    summary -> Markdown          sav/combine.py   many summaries -> history document
app/*.js         line-for-line ports of the above; view.js/mdview.js/main.js/worker.js are web-only
```

Layers point one way. `parse()` never raises anything but `SavError`.

**The reading rule: every byte is accounted for.** A property that cannot be decoded is recorded in `obj["unread"]` and skipped by its own stored size, so it never costs its neighbours. Bytes left in an object after properties and class data are `obj["trailing"]`. The component pad (one zero int32 on every component) is `obj["pad"]`, not trailing. `summary["integrity"]` reports the totals, every report prints them, and `tests/test_saves.py` demands zero across the corpus. **Do not add a guess to make a number go to zero**; find the structure.

**Facts that cost time to find** (details in `notes/format.md`): the first chunk magic can sit a few bytes after the header ends (scan forward <= 16); belt items live on `FGConveyorChainActor`, not on the belt; foundations and walls are lightweight instances inside `FGLightweightBuildableSubsystem`, not entities; old saves (< ue5 1012) carry ONE element tag for an array of structs; fluids are stored in 1/1000 m3 and are summed separately from items; `mActorsBuiltCount` values are structs (`BuiltPerPlayer`), not counts.

## The parity gate (do not skip)

`app/` is a port, and a port drifts silently. `tools/parity.mjs` runs both readers on the same saves and compares the summary JSON (value AND key order), the Markdown (byte for byte) and the combined document. Traps already hit: Python `round()` is half-even and JS `Math.round` is not (`pyRound` in `model.js`); a JSON number has no int/float split, so `render.n()` prints whole-valued floats as integers in both; `str(None)` is `None` and a template literal prints `null`; JS objects reorder integer-like keys, so no map key may be a bare integer. After ANY change to `sav/*.py` or `app/*.js`: `python3 tools/gen_schema.py` if the shape moved, then `node tools/parity.mjs <a few saves>`; full corpus before declaring done.

## Conventions

- Match `~/Code/sl2-analyzer`: comments in the owner's direct voice, stating the point first and why. No restating the obvious. Doxygen-style `##` blocks where a function needs one.
- Output shape lives in `render.py` / `render.js`: bold-label bullets, tables, `×` for counts. No emoji, no em dashes.
- A derived figure is labelled as derived in the output (see the power line). Never print a field the file cannot back.
- Never commit or push. Hand a pwsh one-liner (see the user's global instructions).

## Open items and limits

Resource-node purity is not in the save, so extraction reports kind and producing/idle only. Class names have no display-name table of their own; add to `OVERRIDES` in BOTH `names.py` and `names.js` when a name reads badly. The combined document's branch inference uses schematics, alternate recipes and research trees as "progress"; a fork that diverges only in building layout looks linear.
