# The .sav format as this reader implements it

Cross-checked against `@etothepii/satisfactory-file-parser` (MIT) and then against the files themselves: every world save on this machine (versions 46, 51, 52, 60) decodes with zero unread properties and zero undecoded bytes.

## Container

1. **Header**, uncompressed, little endian: `headerType i32`, `saveVersion i32`, `buildVersion i32`, then (type >= 14) `saveName`, then `mapName`, `mapOptions`, `sessionName`, `playSeconds i32`, `saveTime i64` (.NET ticks), `visibility u8`, `editorObjectVersion i32`, `modMetadata` string, `isModded i32`, (>= 10) `saveIdentifier`, (>= 11) `partitioned i32`, (>= 12) 16-byte consistency hash, (>= 13) `creative i32`. Strings are `i32 length` + bytes + NUL; a negative length is UTF-16.
2. **Chunks** until end of file, each a 49-byte header (`magic 0x9E2A83C1`, `0x22222222`, `maxChunk i64`, `algo u8` = 3 zlib, `compressed i64`, `uncompressed i64`, then both again) plus a zlib stream. **On a save with the creative flag the first chunk magic sits a few bytes later than the header parse ends**, so the reader scans up to 16 bytes forward for it.
3. **Body**, the concatenated inflated chunks: `size i32` + `0 i32` (must equal total - 8), object-version data (save >= 53), world-partition grids (>= 38), then levels.

## Levels

`levelCount i32`, then `levelCount` named sublevels plus the persistent level (named by `mapName`, last). Each level is: TOC blob (length, 0, object headers), data blob (length, 0, count + object bodies), then `saveVersion i32` (sublevels, >= 51), the destroyed-actor map (persistent) or collectables list (sublevels), and (>= 53) optional per-level object-version data. The TOC and the data blob are read in the order TOC, data, so the reader remembers both offsets and jumps.

Object header: `kind i32` (1 entity, 0 component), `class`, `root`, `name`, `flags u32` (level version >= 49); entities add `needTransform i32`, rotation `4f`, position `3f`, scale `3f`, `placedInLevel i32`; components add the parent entity name.

Object body (save >= 38 prefixes `objectVersion i32` and `migrate i32`): `size i32`, the data, then (>= 53) a flag and optional per-object version data. Data = entities: parent ref + component refs; then (UE5 tag format) one control byte, the property list, `hasGuid i32` + guid, then class-specific data. **Every component ends with one zero int32** that no class owns; the reader accounts for it as `pad` so that "undecoded bytes = 0" is a real statement.

## Properties

Two tag layouts. UE5 package version >= 1012 (save 60) writes a **complete tag**: name, a type tree (`name`, child count, children), `size i32`, `flags u8` (bit 0 index follows, bit 1 guid follows, bit 4 = boolean value), no per-element tag for arrays. Older saves write type string, size, index, type-specific extras (struct name + guid, enum name, array element type, map key and value types) and an optional guid; **an array of structs carries ONE tag for all elements** (name + legacy tag) before the elements. Each property's `size` is authoritative: a value that fails to decode is recorded in `obj.unread` and the cursor resyncs to `start + size`, so one bad property never loses its neighbours.

Vectors are doubles from save 41, floats before. `InventoryItem` is `item ref` + a dynamic struct (>= 43) whose payload is a property list. Maps and sets carry a removal count (always 0 here). `PlayerInfoHandle` is `u8` + `i32` from save 57.

## Class-specific data

Conveyor belts and lifts: one zero int32. **Items riding belts live on the `FGConveyorChainActor`, not on the belt**: spline segments, length, then `{item, position}` pairs. Foundations, walls and the like are **not entities at all**: they are instances inside `FGLightweightBuildableSubsystem`. Also read: circuits, game state/mode object lists, power line endpoints, vehicle physics and train couplings, drone actions, player state ids.
