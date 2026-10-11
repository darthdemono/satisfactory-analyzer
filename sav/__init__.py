import json
from pathlib import Path

from . import names

_table = Path(__file__).resolve().parent.parent / "db_sat" / "names.json"
if _table.exists():
    names.use(json.loads(_table.read_text()))
