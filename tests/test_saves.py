"""Acceptance gate: every local world save must decode COMPLETELY (no unread property, no undecoded
byte, no object error) and its summary must validate against schema.json. Skips with no corpus.
    python3 -m unittest discover -s tests
"""
import glob, json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from sav.model import summarize
from sav.reader import SavError, parse

CORPUS = ("~/docker/satisfactory/config/saved/server/*.sav", "/mnt/nobara-data/Backup/AppData/Local/FactoryGame/Saved/SaveGames/*/*.sav")
NOT_WORLDS = ("ServerManager", "CurrentSettings", "ServerSettings")


def worlds():
    return sorted({Path(f).expanduser() for pat in CORPUS for f in glob.glob(str(Path(pat).expanduser())) if not Path(f).name.startswith(NOT_WORLDS)})


class Saves(unittest.TestCase):
    def test_every_save_decodes_completely(self):
        files = worlds()
        if not files: self.skipTest("no local saves")
        for f in files:
            with self.subTest(save=f.name):
                m = summarize(parse(f.read_bytes()))
                ig = m["integrity"]
                self.assertEqual((ig["unreadProperties"], ig["undecodedBytes"], ig["objectErrors"]), (0, 0, 0))

    def test_summary_matches_schema(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema not installed (dev-only check)")
        files = worlds()
        if not files: self.skipTest("no local saves")
        schema = json.loads((ROOT / "schema.json").read_text())
        for f in files[:: max(1, len(files) // 6)]:  # a spread across versions, not all of them
            with self.subTest(save=f.name):
                jsonschema.validate(json.loads(json.dumps(summarize(parse(f.read_bytes())), default=list)), schema)

    def test_settings_files_are_refused_cleanly(self):
        for f in glob.glob(str(Path("~/docker/satisfactory/config/saved/ServerSettings.*.sav").expanduser())):
            with self.assertRaises(SavError): parse(Path(f).read_bytes())


if __name__ == "__main__":
    unittest.main()
