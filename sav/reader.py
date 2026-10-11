"""Satisfactory .sav reader (header, chunk inflate, per-level object TOC).

Format spec cross-checked against @etothepii/satisfactory-file-parser (MIT). Reads
save header type 14 / save version 60. Object DATA blobs (properties) are skipped:
the TOC carries class path, instance name, transform, which is enough for a census.
"""
import struct
import zlib
from datetime import datetime, timedelta, timezone

CHUNK_MAGIC = 0x9E2A83C1
EPOCH_TICKS = 621355968000000000  # .NET ticks at 1970-01-01


class SavError(Exception):
    pass


class R:
    def __init__(self, b, o=0):
        self.b, self.o = b, o

    def take(self, fmt):
        v = struct.unpack_from("<" + fmt, self.b, self.o)
        self.o += struct.calcsize("<" + fmt)
        return v if len(v) > 1 else v[0]

    def i32(self): return self.take("i")
    def u32(self): return self.take("I")
    def skip(self, n): self.o += n

    def string(self):
        n = self.i32()
        if n == 0:
            return ""
        if n < 0:
            s = self.b[self.o:self.o - 2 * n - 2].decode("utf-16-le")
            self.o += -2 * n
            return s
        s = self.b[self.o:self.o + n - 1].decode("utf-8", "replace")
        self.o += n
        return s


def read_header(r):
    h = {"headerType": r.i32(), "saveVersion": r.i32(), "buildVersion": r.i32()}
    t = h["headerType"]
    if t < 8:
        raise SavError(f"header type {t} too old")
    if t >= 14: h["saveName"] = r.string()
    h["mapName"], h["mapOptions"], h["sessionName"] = r.string(), r.string(), r.string()
    h["playSeconds"] = r.i32()
    ticks = r.take("q")
    h["saved"] = (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(microseconds=(ticks - EPOCH_TICKS) // 10)).isoformat()
    h["visibility"] = r.take("B")
    r.skip(4)  # editor object version
    h["modMetadata"], h["modded"] = r.string(), r.i32()
    if t >= 10: h["saveIdentifier"] = r.string()
    if t >= 11: h["partitioned"] = r.i32() == 1
    if t >= 12: h["consistencyHash"] = r.b[r.o:r.o + 16].hex(); r.skip(16)
    if t >= 13: h["creative"] = r.i32() == 1
    return h


def inflate(r):
    b = r.b
    o = b.find(struct.pack("<I", CHUNK_MAGIC), r.o)  # a few header bytes (e.g. creative-mode extras) sit before the first chunk
    if o < 0 or o - r.o > 16:
        raise SavError(f"no chunk magic after header at {r.o}")
    out = []
    while o < len(b):
        magic, _m2, _mx, alg, c = struct.unpack_from("<IIQBq", b, o)
        if magic != CHUNK_MAGIC or alg != 3:
            raise SavError(f"bad chunk at {o}: magic {magic:#x} alg {alg}")
        o += 49
        out.append(zlib.decompress(b[o:o + c]))
        o += c
    return b"".join(out)


def read_object_version_data(r):
    """Returns the UE5 package version (>=1012 means complete property tags)."""
    r.skip(4 + 4)  # dataVersion, ue4 version
    ue5 = r.i32()
    r.skip(4 + 6 + 4)  # licence, engine major/minor/patch + changelist
    r.string()
    for _ in range(r.i32()): r.skip(20)  # custom versions: guid + int32
    return ue5


def read_toc(r, lvl_version):
    objs = []
    for _ in range(r.i32()):
        kind = r.i32()
        o = {"kind": "entity" if kind == 1 else "component", "class": r.string(), "root": r.string(), "name": r.string()}
        if lvl_version >= 49: o["flags"] = r.u32()
        if kind == 1:
            r.skip(4)  # needTransform
            o["rot"], o["pos"], o["scale"] = r.take("4f"), r.take("3f"), r.take("3f")
            r.skip(4)  # wasPlacedInLevel
        elif kind == 0:
            o["parent"] = r.string()
        else:
            raise SavError(f"unknown object kind {kind}")
        objs.append(o)
    return objs


def ref(r):
    return (r.string(), r.string())


def ref_list(r):
    return [ref(r) for _ in range(r.i32())]


def parse(data):
    """bytes -> dict. Anything that is not a readable world save raises SavError, never a raw struct error."""
    try:
        return _parse(data)
    except (struct.error, IndexError, UnicodeDecodeError, zlib.error, MemoryError, OverflowError) as e:
        raise SavError(f"not a readable Satisfactory world save ({type(e).__name__})") from e


def _parse(data):
    r = R(data)
    h = read_header(r)
    r.o = r.o  # chunks start right after the header
    r.b = inflate(r)
    r.o = 0
    body = r.i32()
    if body + 8 != len(r.b):
        raise SavError(f"body size {body + 8} != inflated {len(r.b)}")
    r.skip(4)
    ver = h["saveVersion"]
    ue5 = read_object_version_data(r) if ver >= 53 else 0
    grids = {}
    if ver >= 38:
        for _ in range(r.i32()):
            name, cell, ghash = r.string(), r.i32(), r.u32()
            grids[name] = {"cellSize": cell, "hash": ghash, "cells": [(r.string(), r.u32()) for _ in range(r.u32())]}
    n = r.i32()
    levels = []
    for i in range(n + 1):
        name = h["mapName"] if i == n else r.string()
        persistent = i == n
        toc_len = r.i32(); r.skip(4); toc = r.o; r.skip(toc_len)
        data_len = r.i32(); r.skip(4); data = r.o; r.skip(data_len)
        lv = ver
        if not persistent and ver >= 51: lv = r.i32()
        lvl_ue5 = ue5
        lvl = {"name": name, "version": lv, "destroyed": 0, "collectables": 0}
        if persistent:
            lvl["destroyedActors"] = {}
            for _ in range(r.i32()):
                k = r.string(); lvl["destroyedActors"][k] = ref_list(r)
            lvl["destroyed"] = sum(len(v) for v in lvl["destroyedActors"].values())
        else:
            lvl["collectedRefs"] = ref_list(r); lvl["collectables"] = len(lvl["collectedRefs"])
            if ver >= 53 and r.i32() >= 1: lvl_ue5 = read_object_version_data(r)
        end = r.o
        r.o = toc
        lvl["objects"] = read_toc(r, lv)
        r.o = data
        from .props import read_data
        read_data(r, lvl["objects"], lv, ver, lvl_ue5)
        r.o = end
        levels.append(lvl)
    unresolved = ref_list(r) if r.o < len(r.b) else []
    left = len(r.b) - r.o
    return {"header": h, "grids": grids, "levels": levels, "unresolved": unresolved, "unreadTail": left, "ue5": ue5}
