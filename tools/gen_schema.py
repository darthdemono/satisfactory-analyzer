#!/usr/bin/env python3
"""Writes schema.json: the contract for `sat_to_md.py x.sav -o x.json` and the web app's JSON download."""
import json
from pathlib import Path

INT, NUM, STR = {"type": "integer"}, {"type": "number"}, {"type": "string"}
NSTR, NINT, NNUM = {"type": ["string", "null"]}, {"type": ["integer", "null"]}, {"type": ["number", "null"]}
BOOL = {"type": "boolean"}


def obj(props, **kw):
    return {"type": "object", "required": list(props), "additionalProperties": False, "properties": props, **kw}


def counter(note):
    """A name -> count map, ordered by count descending then name."""
    return {"type": "object", "description": note, "additionalProperties": INT}


def arr(item): return {"type": "array", "items": item}


schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://github.com/darthdemono/satisfactory-analyzer/schema.json",
    "title": "satisfactory-analyzer save export",
    "description": "One summary per world save. Every figure is read from the file; derived figures are named as such in the Markdown. Python (sav/model.py) and JavaScript (app/model.js) produce identical documents, held together by tools/parity.mjs.",
    **obj({
        "meta": obj({"saveName": NSTR, "sessionName": STR, "saved": STR, "playSeconds": INT, "buildVersion": INT, "saveVersion": INT, "headerType": INT,
                     "mapName": STR, "creative": {"type": ["boolean", "null"]}, "modded": INT, "partitioned": {"type": ["boolean", "null"]}, "saveIdentifier": NSTR}),
        "integrity": obj({"objects": INT, "levels": INT, "unreadProperties": INT, "undecodedBytes": INT, "objectErrors": INT},
                         description="What the reader could not decode. All three counters are zero on a clean read."),
        "time": obj({"playSeconds": INT, "inGameDays": NINT, "daySeconds": NNUM, "daysSinceLastDeath": NINT, "startingPoint": NSTR}),
        "items": obj({"total": INT, "groups": {"type": "object", "additionalProperties": counter("item -> count")}, "fluidsCubicMeters": {"type": "object", "additionalProperties": NUM},
                      "dimensionalDepot": counter("item -> count"), "onBelts": counter("item -> count")}),
        "players": arr(obj({"name": NSTR, "position": {"type": "array", "items": INT, "minItems": 3, "maxItems": 3, "description": "centimetres, x/y/z"}, "items": counter("inventory and equipment")})),
        "progression": obj({
            "gamePhase": NSTR, "targetPhase": NSTR, "activeSchematic": NSTR, "schematicNames": arr(STR), "schematicsPurchased": INT, "schematicKinds": counter("schematic folder -> count"),
            "milestones": {"type": "object", "additionalProperties": arr(INT)}, "highestTier": INT, "recipesAvailable": INT, "alternateRecipes": arr(STR), "researchTrees": arr(STR),
            "hardDrivesUsed": NINT, "unlocks": arr(STR), "inventorySlots": NINT, "armSlots": NINT,
            "resourceSink": obj({"points": {"type": ["array", "null"], "items": INT}, "levels": {"type": ["array", "null"], "items": INT}}), "dropPodsLooted": INT}),
        "buildings": obj({"total": INT, "byCategory": counter("category -> count"),
                          "rows": arr(obj({"class": STR, "name": STR, "category": STR, "count": INT}))}),
        "machines": obj({"count": INT, "producing": INT, "recipes": arr(obj({"recipe": STR, "machine": STR, "count": INT}))}),
        "extraction": obj({"extractors": counter("kind -> count"), "producing": counter("kind -> count")}),
        "power": obj({"generators": counter("kind -> count"), "circuits": INT, "targetConsumptionMW": NUM, "poles": INT, "lines": INT}),
        "logistics": obj({"belts": INT, "lifts": INT, "chains": INT, "beltLengthMeters": INT, "itemsOnBelts": INT, "pipelines": INT, "pipeNetworks": INT, "trackSegments": INT,
                          "trainStations": INT, "locomotives": INT, "freightWagons": INT, "droneStations": INT, "vehicles": counter("kind -> count")}),
        "world": obj({"dropPods": INT, "dropPodsLooted": INT, "mercerShrines": INT, "uncollectedSlugs": obj({"blue": INT, "yellow": INT, "purple": INT}),
                      "pickupsCollected": INT, "destroyedActors": INT, "collectedRefs": INT}),
        "statistics": obj({"built": counter("top 25"), "dismantled": INT, "creaturesKilled": counter("kind -> count"), "consumablesConsumed": counter("kind -> count"),
                           "itemsCrafted": counter("top 25"), "itemsPickedUp": counter("top 25")}),
    }),
}
Path(__file__).resolve().parent.parent.joinpath("schema.json").write_text(json.dumps(schema, indent=1) + "\n")
