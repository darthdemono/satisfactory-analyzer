#!/usr/bin/env python3
"""Build db_sat/names.json from the game's own Docs file.

    python3 tools/gamefiles.py <Satisfactory>/CommunityResources/Docs/en-US.json db_sat/names.json

The game ships that file for modders: every item, building, recipe and schematic with the name the player sees.
A save only stores class names, so this table is how `Desc_ShockShank` gets to be the Xeno-Zapper."""
import json
import sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
blocks = json.loads(src.read_bytes().decode("utf-16"))
names = {c["ClassName"]: c["mDisplayName"] for b in blocks for c in b["Classes"] if c.get("mDisplayName")}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(names, indent=0, ensure_ascii=False, sort_keys=True) + "\n")
print(f"wrote {len(names)} names to {out}")
