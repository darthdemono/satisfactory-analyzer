// Satisfactory .sav reader: header, chunk inflate, per-level object tables, then every
// object's properties and class-specific data. A faithful port of sav/reader.py + sav/props.py;
// scratch/parity.mjs holds the two together on the real saves.

export class SavError extends Error {}

const CHUNK_MAGIC = 0x9e2a83c1;
const EPOCH_TICKS = 621355968000000000n;
const F64 = 41;
const INV_STATE = 43;
const NEW_HANDLE = 57;
const td = new TextDecoder("utf-8");
const tdw = new TextDecoder("utf-16le");

/** Little-endian cursor over a Uint8Array. */
export class R {
  constructor(b, o = 0) {
    this.b = b;
    this.o = o;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() { const x = this.v.getUint8(this.o); this.o += 1; return x; }
  i8() { const x = this.v.getInt8(this.o); this.o += 1; return x; }
  i16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i32() { const x = this.v.getInt32(this.o, true); this.o += 4; return x; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  i64() { const x = this.v.getBigInt64(this.o, true); this.o += 8; return safe(x); }
  u64() { const x = this.v.getBigUint64(this.o, true); this.o += 8; return safe(x); }
  f32() { const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }
  f64() { const x = this.v.getFloat64(this.o, true); this.o += 8; return x; }
  skip(n) { this.o += n; }
  hex(n) { let s = ""; for (let i = 0; i < n; i++) s += this.b[this.o + i].toString(16).padStart(2, "0"); this.o += n; return s; }
  string() {
    const n = this.i32();
    if (n === 0) return "";
    if (n < 0) { const s = tdw.decode(this.b.subarray(this.o, this.o - 2 * n - 2)); this.o += -2 * n; return s; }
    const s = td.decode(this.b.subarray(this.o, this.o + n - 1));
    this.o += n;
    return s;
  }
  f32s(n) { return Array.from({ length: n }, () => this.f32()); }
  i32s(n) { return Array.from({ length: n }, () => this.i32()); }
}

const safe = (x) => (x >= -9007199254740991n && x <= 9007199254740991n ? Number(x) : x.toString());

export const ref = (r) => { const a = r.string(); return [a, r.string()]; };
export const refList = (r) => Array.from({ length: r.i32() }, () => ref(r));

export function readHeader(r) {
  const h = { headerType: r.i32(), saveVersion: r.i32(), buildVersion: r.i32() };
  const t = h.headerType;
  if (t < 8) throw new SavError(`header type ${t} too old`);
  if (t >= 14) h.saveName = r.string();
  h.mapName = r.string(); h.mapOptions = r.string(); h.sessionName = r.string();
  h.playSeconds = r.i32();
  const ticks = r.v.getBigInt64(r.o, true); r.o += 8;
  // Python: (ticks - EPOCH) // 10 microseconds from 1970-01-01, isoformat with +00:00
  const us = (ticks - EPOCH_TICKS) / 10n;
  h.saved = isoMicro(us);
  h.visibility = r.u8();
  r.skip(4);
  h.modMetadata = r.string(); h.modded = r.i32();
  if (t >= 10) h.saveIdentifier = r.string();
  if (t >= 11) h.partitioned = r.i32() === 1;
  if (t >= 12) h.consistencyHash = r.hex(16);
  if (t >= 13) h.creative = r.i32() === 1;
  return h;
}

/** Python's datetime.isoformat() for a UTC microsecond count: microseconds only when non-zero. */
function isoMicro(us) {
  const ms = Number(us / 1000n), micro = Number(us % 1000n);
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  let s = `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  const frac = d.getUTCMilliseconds() * 1000 + micro;
  if (frac) s += "." + p(frac, 6);
  return s + "+00:00";
}

async function inflateOne(bytes) {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function inflate(r) {
  const b = r.b, magic = [0xc1, 0x83, 0x2a, 0x9e];
  let o = -1;
  for (let i = r.o; i < Math.min(b.length - 4, r.o + 17); i++) if (magic.every((m, k) => b[i + k] === m)) { o = i; break; }
  if (o < 0) throw new SavError(`no chunk magic after header at ${r.o}`);
  const parts = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (o < b.length) {
    if (v.getUint32(o, true) !== CHUNK_MAGIC || b[o + 16] !== 3) throw new SavError(`bad chunk at ${o}`);
    const c = Number(v.getBigInt64(o + 17, true));
    o += 49;
    parts.push(await inflateOne(b.subarray(o, o + c)));
    o += c;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function readObjectVersionData(r) {
  r.skip(8);
  const ue5 = r.i32();
  r.skip(14);
  r.string();
  for (let n = r.i32(); n > 0; n--) r.skip(20);
  return ue5;
}

function readToc(r, lv) {
  const objs = [];
  for (let n = r.i32(); n > 0; n--) {
    const kind = r.i32();
    const o = { kind: kind === 1 ? "entity" : "component", class: r.string(), root: r.string(), name: r.string() };
    if (lv >= 49) o.flags = r.u32();
    if (kind === 1) {
      r.skip(4);
      o.rot = r.f32s(4); o.pos = r.f32s(3); o.scale = r.f32s(3);
      r.skip(4);
    } else if (kind === 0) o.parent = r.string();
    else throw new SavError(`unknown object kind ${kind}`);
    objs.push(o);
  }
  return objs;
}

/** bytes -> save. Anything that is not a readable world save rejects with SavError, never a RangeError. */
export async function parse(data) {
  try {
    return await parseSave(data);
  } catch (e) {
    if (e instanceof SavError) throw e;
    throw new SavError(`not a readable Satisfactory world save (${e && e.name})`);
  }
}

async function parseSave(data) {
  let r = new R(data);
  const h = readHeader(r);
  const body = await inflate(r);
  r = new R(body);
  const size = r.i32();
  if (size + 8 !== body.length) throw new SavError(`body size ${size + 8} != inflated ${body.length}`);
  r.skip(4);
  const ver = h.saveVersion;
  const ue5 = ver >= 53 ? readObjectVersionData(r) : 0;
  const grids = {};
  if (ver >= 38) {
    for (let n = r.i32(); n > 0; n--) {
      const name = r.string(), cell = r.i32(), hash = r.u32();
      const cells = [];
      for (let k = r.u32(); k > 0; k--) { const a = r.string(); cells.push([a, r.u32()]); }
      grids[name] = { cellSize: cell, hash, cells };
    }
  }
  const n = r.i32();
  const levels = [];
  for (let i = 0; i <= n; i++) {
    const persistent = i === n;
    const name = persistent ? h.mapName : r.string();
    const tocLen = r.i32(); r.skip(4); const toc = r.o; r.skip(tocLen);
    const dataLen = r.i32(); r.skip(4); const dataAt = r.o; r.skip(dataLen);
    let lv = ver;
    if (!persistent && ver >= 51) lv = r.i32();
    let lvlUe5 = ue5;
    const lvl = { name, version: lv, destroyed: 0, collectables: 0 };
    if (persistent) {
      lvl.destroyedActors = {};
      for (let k = r.i32(); k > 0; k--) { const key = r.string(); lvl.destroyedActors[key] = refList(r); }
      lvl.destroyed = Object.values(lvl.destroyedActors).reduce((a, v) => a + v.length, 0);
    } else {
      lvl.collectedRefs = refList(r); lvl.collectables = lvl.collectedRefs.length;
      if (ver >= 53 && r.i32() >= 1) lvlUe5 = readObjectVersionData(r);
    }
    const end = r.o;
    r.o = toc;
    lvl.objects = readToc(r, lv);
    r.o = dataAt;
    readData(r, lvl.objects, lv, ver, lvlUe5);
    r.o = end;
    levels.push(lvl);
  }
  const unresolved = r.o < body.length ? refList(r) : [];
  return { header: h, grids, levels, unresolved, unreadTail: body.length - r.o, ue5 };
}

// ── properties ───────────────────────────────────────────────────────────────

const SCALARS = {
  Int8Property: "i8", UInt8Property: "u8", Uint8Property: "u8", Int16Property: "i16", UInt16Property: "u16",
  IntProperty: "i32", UInt32Property: "u32", Uint32Property: "u32", Int64Property: "i64", UInt64Property: "u64",
  Uint64Property: "u64", FloatProperty: "f32", SingleProperty: "f32", DoubleProperty: "f64", ByteProperty: "u8",
};

const tagNode = (r) => { const name = r.string(); const kids = []; for (let n = r.i32(); n > 0; n--) kids.push(tagNode(r)); return [name, kids]; };

function legacyTag(r) {
  const t = r.string(), size = r.i32(); r.skip(4);
  let kids = [], flags = 0;
  if (t === "ArrayProperty" || t === "SetProperty") kids = [[r.string(), []]];
  else if (t === "StructProperty") { kids = [[r.string(), []]]; r.skip(16); }
  else if (t === "BoolProperty") flags = r.i8() > 0 ? 0x10 : 0;
  else if (t === "ByteProperty" || t === "EnumProperty") { const en = r.string(); if (t === "ByteProperty" && en !== "None") kids = [[en, []]]; }
  else if (t === "MapProperty") { const a = r.string(); kids = [[a, []], [r.string(), []]]; }
  if (r.u8() === 1) r.skip(16);
  return [[t, kids], size, flags];
}

const vec = (r, c, n) => Array.from({ length: n }, () => (c.ver >= F64 ? r.f64() : r.f32()));
const guid = (r) => r.hex(16);

function text(r) {
  const t = { flags: r.u32(), type: r.i8() };
  const k = t.type;
  if (k === 0) { t.namespace = r.string(); t.key = r.string(); t.value = r.string(); }
  else if (k === 1 || k === 3) {
    t.format = text(r); t.args = [];
    for (let n = r.i32(); n > 0; n--) {
      const a = { name: r.string(), kind: r.u8() };
      if (a.kind !== 4) throw new SavError(`format arg kind ${a.kind}`);
      a.value = text(r); t.args.push(a);
    }
  } else if (k === 10) { t.source = text(r); t.transform = r.u8(); }
  else if (k === 11) { t.table = r.string(); t.key = r.string(); }
  else if (k === -1) { if (r.i32() === 1) t.value = r.string(); }
  else throw new SavError(`text history ${k}`);
  return t;
}

function dynStruct(r, c) {
  if (r.i32() < 1) return null;
  const kind = ref(r), size = r.i32(), end = r.o + size;
  const props = readProps(r, c);
  if (r.o !== end) throw new SavError("dynamic struct size");
  return { type: kind, props };
}

function invItem(r, c) {
  const item = ref(r);
  if (c.ver >= INV_STATE) return { item, state: dynStruct(r, c) };
  return { item, legacyState: ref(r) };
}

const playerHandle = (r, c) => (c.ver < NEW_HANDLE ? [r.u8(), r.u8()] : [r.u8(), r.i32()]);

function readStruct(r, c, name, size) {
  switch (name) {
    case "Color": { const b = [r.u8(), r.u8(), r.u8(), r.u8()]; return { b: b[0], g: b[1], r: b[2], a: b[3] }; }
    case "LinearColor": { const f = r.f32s(4); return { r: f[0], g: f[1], b: f[2], a: f[3] }; }
    case "IntPoint": return r.i32s(2);
    case "Guid": return guid(r);
    case "FluidBox": return r.f32();
    case "DateTime": return r.i64();
    case "Vector2D": return vec(r, c, 2);
    case "Vector": case "Rotator": return vec(r, c, 3);
    case "Quat": case "Vector4": case "Vector4D": return vec(r, c, 4);
    case "Box": return { min: vec(r, c, 3), max: vec(r, c, 3), valid: r.u8() };
    case "RailroadTrackPosition": return { root: r.string(), instance: r.string(), offset: r.f32(), forward: r.f32() };
    case "TimerHandle": case "SlateBrush": return r.string();
    case "InventoryItem": return invItem(r, c);
    case "PlayerInfoHandle": return playerHandle(r, c);
    case "UniqueNetIdRepl": return r.hex(size);
    case "ClientIdentityInfo": {
      const off = r.string(), ids = {};
      for (let n = r.i32(); n > 0; n--) { const flag = r.u8(), len = r.i32(); ids[flag] = r.hex(len); }
      return { offlineId: off, accountIds: ids };
    }
    default: return readProps(r, c);
  }
}

function readScalar(r, c, node) {
  const [t, kids] = node;
  if (t in SCALARS) {
    if (t === "ByteProperty" && kids.length) return r.string();
    return r[SCALARS[t]]();
  }
  if (t === "StrProperty" || t === "NameProperty" || t === "EnumProperty") return r.string();
  if (t === "ObjectProperty" || t === "InterfaceProperty") return ref(r);
  if (t === "SoftObjectProperty") return { path: r.string(), instance: r.string(), sub: r.i32() };
  if (t === "TextProperty") return text(r);
  return undefined;
}

function readValue(r, c, node, size, flags, name) {
  const [t, kids] = node;
  const s = readScalar(r, c, node);
  if (s !== undefined) return s;
  if (t === "BoolProperty") return !!(flags & 0x10);
  if (t === "StructProperty") return readStruct(r, c, kids[0][0], size);
  if (t === "ArrayProperty") {
    let inner = kids[0];
    const n = r.i32();
    if (inner[0] === "StructProperty" && !c.complete) { r.string(); inner = legacyTag(r)[0]; }
    if (inner[0] === "BoolProperty") return Array.from({ length: n }, () => r.u8() > 0);
    return Array.from({ length: n }, () => readValue(r, c, inner, size, flags, name));
  }
  if (t === "MapProperty") {
    if (r.i32() > 0) throw new SavError("map removals");
    const [kn, vn] = kids, out = [];
    for (let n = r.i32(); n > 0; n--) {
      const k = kn[0] === "StructProperty" ? (name === "mSaveData" || name === "mUnresolvedSaveData" ? r.i32s(3) : readProps(r, c)) : mustScalar(r, c, kn);
      const v = vn[0] === "StructProperty" ? readProps(r, c) : mustScalar(r, c, vn);
      out.push([k, v]);
    }
    return out;
  }
  if (t === "SetProperty") {
    if (r.i32() > 0) throw new SavError("set removals");
    const el = kids[0], n = r.i32();
    if (el[0] === "StructProperty") {
      if (name === "mRemovalLocations") return Array.from({ length: n }, () => r.f32s(3));
      if (name === "mDestroyedPickups" || name === "mLootedDropPods") return Array.from({ length: n }, () => guid(r));
      throw new SavError(`set of struct ${name}`);
    }
    return Array.from({ length: n }, () => mustScalar(r, c, el));
  }
  throw new SavError(`unhandled ${t}`);
}

function mustScalar(r, c, node) {
  const v = readScalar(r, c, node);
  if (v === undefined) throw new SavError(`unhandled ${node[0]}`);
  return v;
}

/** A repeated property name keeps every value; flagged so a single array value is not confused with it. */
export class Multi extends Array {}

export function readProps(r, c) {
  const props = {};
  for (;;) {
    const name = r.string();
    if (name === "None") return props;
    let node, size, flags;
    if (c.complete) {
      node = tagNode(r); size = r.i32(); flags = r.u8();
      if (flags & 1) r.skip(4);
      if (flags & 2) r.skip(16);
    } else [node, size, flags] = legacyTag(r);
    const start = r.o;
    let v;
    try {
      v = readValue(r, c, node, size, flags, name);
      if (node[0] === "StructProperty" && r.o - start === size - 4) r.skip(4);
      if (r.o - start !== size) throw new SavError(`read ${r.o - start} of ${size}`);
    } catch (e) {
      v = null;
      c.unread.push([name, node[0], node[1].length ? node[1][0][0] : "", String(e.message).slice(0, 60)]);
    }
    r.o = start + size;
    if (name in props) {
      if (!(props[name] instanceof Multi)) props[name] = Multi.of(props[name]);
      props[name].push(v);
    } else props[name] = v;
  }
}

// ── class-specific trailing data ─────────────────────────────────────────────

const leafOf = (c) => c.slice(c.lastIndexOf(".") + 1).replace(/_C$/, "");
const VEHICLES = new Set(["BP_Tractor", "BP_Truck", "BP_Explorer", "Testa_BP_WB", "BP_Golfcart", "BP_GolfcartGold", "BP_Locomotive", "BP_FreightWagon"]);

function special(r, c, cls, remaining) {
  const leaf = leafOf(cls), end = r.o + remaining;
  if (leaf.startsWith("Build_ConveyorBeltMk") || leaf.startsWith("Build_ConveyorLiftMk")) { r.skip(4); return { type: "Conveyor" }; }
  if (leaf === "BP_CircuitSubsystem") return { type: "Circuits", circuits: Array.from({ length: r.i32() }, () => { const id = r.i32(); return [id, ref(r)]; }) };
  if (leaf === "BP_GameState" || leaf === "BP_GameMode") return { type: "ObjectsList", objects: refList(r) };
  if (cls.startsWith("/Script/FactoryGame.FGConveyorChainActor")) {
    const last = ref(r), first = ref(r), segments = [];
    for (let n = r.i32(); n > 0; n--) {
      const seg = { chain: ref(r), belt: ref(r), points: [] };
      for (let k = r.i32(); k > 0; k--) seg.points.push([vec(r, c, 3), vec(r, c, 3), vec(r, c, 3)]);
      [seg.offset, seg.start, seg.end] = r.f32s(3);
      [seg.firstItem, seg.lastItem, seg.index] = r.i32s(3);
      segments.push(seg);
    }
    const d = { type: "ConveyorChain", first, last, segments, length: r.f32() };
    [d.totalItems, d.firstIndex, d.lastIndex] = r.i32s(3);
    d.items = Array.from({ length: r.i32() }, () => { const item = invItem(r, c); return { item, pos: r.f32() }; });
    return d;
  }
  if (leaf === "Build_PowerLine" || leaf === "Build_XmassLightsLine") {
    const d = { type: "PowerLine", source: ref(r), target: ref(r) };
    if (end - r.o >= 24) d.cached = [r.f32s(3), r.f32s(3)];
    return d;
  }
  if (VEHICLES.has(leaf)) {
    const d = { type: "Vehicle", physics: [] };
    for (let n = r.i32(); n > 0; n--) d.physics.push({ bone: r.string(), pos: vec(r, c, 3), rot: vec(r, c, 4), angVel: vec(r, c, 3), linVel: vec(r, c, 3), flags: r.u8() });
    if ((leaf === "BP_Locomotive" || leaf === "BP_FreightWagon") && end - r.o > 0) { d.front = ref(r); d.behind = ref(r); }
    return d;
  }
  if (leaf === "BP_DroneTransport") {
    r.skip(4);
    const acts = () => Array.from({ length: r.i32() }, () => { const name = r.string(); return { name, props: readProps(r, c) }; });
    const active = acts();
    return { type: "Drone", active, queued: acts() };
  }
  if (leaf === "BP_PlayerState") {
    const flag = r.u8(), d = { type: "PlayerState", flag };
    if (flag === 248) { const a = r.string(); d.eos = [a, r.string()]; }
    else if (remaining >= 6) { d.idType = r.u8(); const n = r.i32(); d.id = r.hex(n); }
    return d;
  }
  if (leaf === "FGLightweightBuildableSubsystem") {
    const version = c.ver >= 48 ? r.i32() : 0;
    const d = { type: "Lightweight", version, buildables: [] };
    for (let n = r.i32(); n > 0; n--) {
      const type = ref(r), instances = [];
      for (let k = r.i32(); k > 0; k--) {
        const i = { rot: vec(r, c, 4), pos: vec(r, c, 3), scale: vec(r, c, 3), swatch: ref(r), material: ref(r), pattern: ref(r), skin: ref(r), primary: r.f32s(4), secondary: r.f32s(4), paint: ref(r), patternRot: r.u8(), recipe: ref(r), proxy: ref(r) };
        if (version >= 2) i.data = dynStruct(r, c);
        if (version >= 3) i.builtBy = playerHandle(r, c);
        instances.push(i);
      }
      d.buildables.push({ type, instances });
    }
    return d;
  }
  return null;
}

function readData(r, objs, lv, ver, ue5) {
  if (r.i32() !== objs.length) throw new SavError("object count mismatch");
  for (const o of objs) {
    const c = { ver, complete: ue5 >= 1012, unread: [] };
    if (lv >= 38) r.skip(8);
    const size = r.i32(), start = r.o, end = start + size;
    r.o = end;
    if (ver >= 53 && r.i32() === 1) readObjectVersionData(r);
    const after = r.o;
    r.o = start;
    o.unread = c.unread;
    try {
      if (o.kind === "entity") { o.parentRef = ref(r); o.components = Array.from({ length: r.i32() }, () => ref(r)); }
      if (c.complete) r.skip(1);
      o.props = readProps(r, c);
      if (r.i32() > 0) o.guid = guid(r);
      o.special = special(r, c, o.class, end - r.o);
    } catch (e) {
      o.props = o.props || {};
      o.error = String(e.message).slice(0, 80);
    }
    if (end - r.o === 4 && r.v.getUint32(r.o, true) === 0) { r.skip(4); o.pad = 4; }
    o.trailing = Math.max(0, end - r.o);
    r.o = after;
  }
}
