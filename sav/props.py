"""Property, struct and class-specific data readers. Every byte of an object is accounted
for: a value that cannot be decoded is recorded in obj['unread'], never silently dropped."""
from .reader import R, SavError, ref, ref_list, read_object_version_data

F64 = 41      # SwitchTo64BitSaveArchive: vectors are doubles from this save version on
INV_STATE = 43  # RefactoredInventoryItemState
NEW_HANDLE = 57  # NewPlayerInfoHandleSerializationFormat

SCALARS = {"Int8Property": "b", "UInt8Property": "B", "Uint8Property": "B", "Int16Property": "h", "UInt16Property": "H",
           "IntProperty": "i", "UInt32Property": "I", "Uint32Property": "I", "Int64Property": "q",
           "UInt64Property": "Q", "Uint64Property": "Q", "FloatProperty": "f", "SingleProperty": "f",
           "DoubleProperty": "d", "ByteProperty": "B"}


class Ctx:
    def __init__(self, ver, ue5):
        self.ver, self.complete = ver, ue5 >= 1012


def tag_node(r):
    name = r.string()
    return name, [tag_node(r) for _ in range(r.i32())]


def legacy_tag(r):
    """Pre-1012 tag after the name: type, size, index, extras, optional guid -> (node, size, flags)."""
    t = r.string(); size = r.i32(); r.skip(4)
    kids, flags = [], 0
    if t in ("ArrayProperty", "SetProperty"): kids = [(r.string(), [])]
    elif t == "StructProperty": kids = [(r.string(), [])]; r.skip(16)
    elif t == "BoolProperty": flags = 0x10 if r.take("b") > 0 else 0
    elif t in ("ByteProperty", "EnumProperty"):
        en = r.string()
        if t == "ByteProperty" and en != "None": kids = [(en, [])]
    elif t == "MapProperty": kids = [(r.string(), []), (r.string(), [])]
    if r.take("B") == 1: r.skip(16)
    return (t, kids), size, flags


def vec(r, c, n):
    return r.take(f"{n}{'d' if c.ver >= F64 else 'f'}")


def guid(r):
    return r.b[r.o:r.o + 16].hex(), r.skip(16)


def text(r):
    t = {"flags": r.u32(), "type": r.take("b")}
    k = t["type"]
    if k == 0: t.update(namespace=r.string(), key=r.string(), value=r.string())
    elif k in (1, 3):
        t["format"] = text(r)
        t["args"] = []
        for _ in range(r.i32()):
            a = {"name": r.string(), "kind": r.take("B")}
            if a["kind"] != 4: raise SavError(f"format arg kind {a['kind']}")
            a["value"] = text(r); t["args"].append(a)
    elif k == 10: t["source"] = text(r); t["transform"] = r.take("B")
    elif k == 11: t["table"] = r.string(); t["key"] = r.string()
    elif k == -1:
        if r.i32() == 1: t["value"] = r.string()
    else: raise SavError(f"text history {k}")
    return t


def dyn_struct(r, c):
    """FGDynamicStruct: optional (type ref, payload size, property list)."""
    if r.i32() < 1: return None
    kind = ref(r); size = r.i32(); end = r.o + size
    props = read_props(r, c)
    if r.o != end: raise SavError("dynamic struct size")
    return {"type": kind, "props": props}


def inv_item(r, c):
    item = ref(r)
    if c.ver >= INV_STATE: return {"item": item, "state": dyn_struct(r, c)}
    return {"item": item, "legacyState": ref(r)}


def player_handle(r, c):
    if c.ver < NEW_HANDLE: return (r.take("B"), r.take("B"))
    return (r.take("B"), r.i32())


def read_struct(r, c, name, size, prop):
    if name == "Color": b = r.take("4B"); return {"b": b[0], "g": b[1], "r": b[2], "a": b[3]}
    if name == "LinearColor": return dict(zip("rgba", r.take("4f")))
    if name == "IntPoint": return r.take("2i") if c.ver >= F64 or True else None
    if name == "Guid": return guid(r)[0]
    if name == "FluidBox": return r.take("f")
    if name == "DateTime": return r.take("q")
    if name == "Vector2D": return vec(r, c, 2)
    if name in ("Vector", "Rotator"): return vec(r, c, 3)
    if name in ("Quat", "Vector4", "Vector4D"): return vec(r, c, 4)
    if name == "Box": return {"min": vec(r, c, 3), "max": vec(r, c, 3), "valid": r.take("B")}
    if name == "RailroadTrackPosition": return {"root": r.string(), "instance": r.string(), "offset": r.take("f"), "forward": r.take("f")}
    if name in ("TimerHandle", "SlateBrush"): return r.string()
    if name == "InventoryItem": return inv_item(r, c)
    if name == "PlayerInfoHandle": return player_handle(r, c)
    if name == "UniqueNetIdRepl":
        v = r.b[r.o:r.o + size]; r.skip(size); return v.hex()
    if name == "ClientIdentityInfo":
        off = r.string(); ids = {}
        for _ in range(r.i32()):
            flag = r.take("B"); n = r.i32(); ids[flag] = r.b[r.o:r.o + n].hex(); r.skip(n)
        return {"offlineId": off, "accountIds": ids}
    return read_props(r, c)  # anything else is a nested property list


def read_scalar(r, c, node):
    t, kids = node
    if t in SCALARS:
        if t == "ByteProperty" and kids: return r.string()
        return r.take(SCALARS[t])
    if t in ("StrProperty", "NameProperty", "EnumProperty"): return r.string()
    if t in ("ObjectProperty", "InterfaceProperty"): return ref(r)
    if t == "SoftObjectProperty": return {"path": r.string(), "instance": r.string(), "sub": r.i32()}
    if t == "TextProperty": return text(r)
    raise KeyError(t)


def read_value(r, c, node, size, flags, name):
    t, kids = node
    try: return read_scalar(r, c, node)
    except KeyError: pass
    if t == "BoolProperty": return bool(flags & 0x10)
    if t == "StructProperty": return read_struct(r, c, kids[0][0], size, name)
    if t == "ArrayProperty":
        inner, n = kids[0], r.i32()
        if inner[0] == "StructProperty" and not c.complete:  # legacy: one tag describes all elements
            r.string(); inner, _, _ = legacy_tag(r)
        if inner[0] == "BoolProperty": return [r.take("B") > 0 for _ in range(n)]
        return [read_value(r, c, inner, size, flags, name) for _ in range(n)]
    if t == "MapProperty":
        if r.i32() > 0: raise SavError("map removals")
        kn, vn = kids
        out = []
        for _ in range(r.i32()):
            if kn[0] == "StructProperty":
                k = tuple(r.take("3i")) if name in ("mSaveData", "mUnresolvedSaveData") else read_props(r, c)
            else: k = read_scalar(r, c, kn)
            v = read_props(r, c) if vn[0] == "StructProperty" else read_scalar(r, c, vn)
            out.append((k, v))
        return out
    if t == "SetProperty":
        if r.i32() > 0: raise SavError("set removals")
        el, n = kids[0], r.i32()
        if el[0] == "StructProperty":
            if name == "mRemovalLocations": return [r.take("3f") for _ in range(n)]
            if name in ("mDestroyedPickups", "mLootedDropPods"): return [guid(r)[0] for _ in range(n)]
            raise SavError(f"set of struct {name}")
        return [read_scalar(r, c, el) for _ in range(n)]
    raise SavError(f"unhandled {t}")


def read_props(r, c, unread=None):
    props = {}
    while True:
        name = r.string()
        if name == "None": return props
        if c.complete:
            node = tag_node(r); size = r.i32(); flags = r.take("B")
            if flags & 1: r.skip(4)
            if flags & 2: r.skip(16)
        else:
            node, size, flags = legacy_tag(r)
        start = r.o
        try:
            v = read_value(r, c, node, size, flags, name)
            if node[0] == "StructProperty" and r.o - start == size - 4: r.skip(4)  # some structs carry 4 pad bytes
            if r.o - start != size: raise SavError(f"read {r.o - start} of {size}")
        except Exception as e:
            v = None
            c.unread.append((name, node[0], (node[1][0][0] if node[1] else ""), str(e)[:60]))
        r.o = start + size
        if name in props:  # repeated names are array-like (index flag); keep every one
            if not isinstance(props[name], _Multi): props[name] = _Multi([props[name]])
            props[name].append(v)
        else: props[name] = v


class _Multi(list):
    pass


# ---- class-specific trailing data ------------------------------------------------------------

CONVEYOR = ("ConveyorBeltMk", "ConveyorLiftMk")
VEHICLES = ("BP_Tractor", "BP_Truck", "BP_Explorer", "Testa_BP_WB", "BP_Golfcart", "BP_GolfcartGold", "BP_Locomotive", "BP_FreightWagon")


def special(r, c, cls, remaining):
    leaf = cls.rsplit(".", 1)[-1].removesuffix("_C")
    end = r.o + remaining
    if leaf.startswith(("Build_ConveyorBeltMk", "Build_ConveyorLiftMk")):
        r.skip(4); return {"type": "Conveyor"}
    if leaf == "BP_CircuitSubsystem": return {"type": "Circuits", "circuits": [(r.i32(), ref(r)) for _ in range(r.i32())]}
    if leaf in ("BP_GameState", "BP_GameMode"): return {"type": "ObjectsList", "objects": ref_list(r)}
    if cls.startswith("/Script/FactoryGame.FGConveyorChainActor"):
        last, first = ref(r), ref(r)
        segs = []
        for _ in range(r.i32()):
            seg = {"chain": ref(r), "belt": ref(r), "points": [(vec(r, c, 3), vec(r, c, 3), vec(r, c, 3)) for _ in range(r.i32())]}
            seg.update(zip(("offset", "start", "end"), r.take("3f")))
            seg.update(zip(("firstItem", "lastItem", "index"), r.take("3i")))
            segs.append(seg)
        d = {"type": "ConveyorChain", "first": first, "last": last, "segments": segs, "length": r.take("f")}
        d["totalItems"], d["firstIndex"], d["lastIndex"] = r.take("3i")
        d["items"] = [{"item": inv_item(r, c), "pos": r.take("f")} for _ in range(r.i32())]
        return d
    if leaf in ("Build_PowerLine", "Build_XmassLightsLine"):
        d = {"type": "PowerLine", "source": ref(r), "target": ref(r)}
        if end - r.o >= 24: d["cached"] = (r.take("3f"), r.take("3f"))
        return d
    if leaf in VEHICLES:
        d = {"type": "Vehicle", "physics": []}
        for _ in range(r.i32()):
            d["physics"].append({"bone": r.string(), "pos": vec(r, c, 3), "rot": vec(r, c, 4), "angVel": vec(r, c, 3),
                                 "linVel": vec(r, c, 3), "flags": r.take("B")})
        if leaf in ("BP_Locomotive", "BP_FreightWagon") and end - r.o > 0:
            d["front"], d["behind"] = ref(r), ref(r)
        return d
    if leaf == "BP_DroneTransport":
        r.skip(4)
        acts = lambda: [{"name": r.string(), "props": read_props(r, c)} for _ in range(r.i32())]
        return {"type": "Drone", "active": acts(), "queued": acts()}
    if leaf == "BP_PlayerState":
        flag = r.take("B"); d = {"type": "PlayerState", "flag": flag}
        if flag == 248: d["eos"] = (r.string(), r.string())
        elif remaining >= 6:  # online id: type byte, length, bytes (seen: flag 0xf1, type 6, 8 bytes)
            d["idType"] = r.take("B"); n = r.i32(); d["id"] = r.b[r.o:r.o + n].hex(); r.skip(n)
        return d
    if leaf == "FGLightweightBuildableSubsystem":
        ver = r.i32() if c.ver >= 48 else 0
        d = {"type": "Lightweight", "version": ver, "buildables": []}
        for _ in range(r.i32()):
            t = ref(r); inst = []
            for _ in range(r.i32()):
                i = {"rot": vec(r, c, 4), "pos": vec(r, c, 3), "scale": vec(r, c, 3), "swatch": ref(r), "material": ref(r),
                     "pattern": ref(r), "skin": ref(r), "primary": r.take("4f"), "secondary": r.take("4f"),
                     "paint": ref(r), "patternRot": r.take("B"), "recipe": ref(r), "proxy": ref(r)}
                if ver >= 2: i["data"] = dyn_struct(r, c)
                if ver >= 3: i["builtBy"] = player_handle(r, c)
                inst.append(i)
            d["buildables"].append({"type": t, "instances": inst})
        return d
    return None


def read_data(r, objs, lv, ver, ue5):
    if r.i32() != len(objs): raise SavError("object count mismatch")
    for o in objs:
        c = Ctx(ver, ue5); c.unread = []
        if lv >= 38: r.skip(8)  # per-object save version, migrate flag
        size = r.i32(); start = r.o; end = start + size
        r.o = end
        if ver >= 53 and r.i32() == 1: read_object_version_data(r)
        after = r.o
        r.o = start
        o["unread"] = c.unread
        try:
            if o["kind"] == "entity":
                o["parentRef"] = ref(r)
                o["components"] = [ref(r) for _ in range(r.i32())]
            if c.complete: r.skip(1)  # serialization control byte
            o["props"] = read_props(r, c)
            if r.i32() > 0: o["guid"] = guid(r)[0]
            o["special"] = special(r, c, o["class"], end - r.o)
        except Exception as e:
            o["props"] = o.get("props", {}); o["error"] = str(e)[:80]
        if end - r.o == 4 and r.b[r.o:r.o + 4] == b"\0\0\0\0":  # every component ends with one zero int32
            r.skip(4); o["pad"] = 4
        o["trailing"] = max(0, end - r.o)  # bytes nobody decoded
        r.o = after
