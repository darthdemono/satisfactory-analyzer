#!/usr/bin/env python3
"""Satisfactory .sav -> Markdown (default) or JSON (-o x.json). Folder(s) or several saves -> one combined history."""
import argparse, glob, json, os, sys
from pathlib import Path

from sav.combine import combined
from sav.model import summarize
from sav.reader import SavError, parse
from sav.render import md

## Where a save can live, newest wins. The dedicated server writes the newest of all on this machine.
SEARCH = ("~/docker/satisfactory/config/saved/server",
          "/mnt/*/Games/Heroic/Prefixes/*/drive_c/users/*/AppData/Local/FactoryGame/Saved/SaveGames/*",
          "~/.local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/*/AppData/Local/FactoryGame/Saved/SaveGames/*",
          "~/.config/Epic/FactoryGame/Saved/SaveGames/*", "~/AppData/Local/FactoryGame/Saved/SaveGames/*", ".")
NOT_WORLDS = ("ServerManager", "CurrentSettings", "ServerSettings")


def auto_find():
    found = [Path(f) for pat in SEARCH for d in glob.glob(os.path.expandvars(os.path.expanduser(pat))) for f in glob.glob(os.path.join(d, "*.sav"))]
    found = sorted((f for f in found if not f.name.startswith(NOT_WORLDS)), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in found:
        try:
            parse(f.read_bytes()); return f
        except SavError: continue
    sys.exit("no readable Satisfactory save found; pass a path")


def main():
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("paths", nargs="*"); a.add_argument("-o")
    a.add_argument("--combined", action="store_true", help="force the combined document for one save")
    a = a.parse_args()
    try:
        paths = a.paths or [str(auto_find())]
        path = Path(paths[0])
        if len(paths) > 1 or path.is_dir() or a.combined:
            out = combined(paths)
        else:
            summary = summarize(parse(path.read_bytes()))
            out = json.dumps(summary, indent=1, default=list) if a.o and a.o.endswith(".json") else md(summary, path.name)
    except (SavError, OSError) as e:
        sys.exit(f"{e}")
    Path(a.o).write_text(out) if a.o else sys.stdout.write(out)


if __name__ == "__main__":
    main()
