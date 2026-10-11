"""Print a save's summary JSON and Markdown for the parity harness (stdout: one JSON object)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sav.model import summarize
from sav.reader import parse
from sav.render import md

p = Path(sys.argv[1])
s = summarize(parse(p.read_bytes()))
print(json.dumps({"summary": s, "md": md(s, p.name)}, default=list))
