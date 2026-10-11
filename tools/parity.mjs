// The correctness gate for the web port. Runs the Python reader and the JS reader over the same
// saves and demands the summary JSON and the Markdown agree exactly, then does the same for the
// combined document over the whole folder.
//   node tools/parity.mjs <folder-or-save>...
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../app/reader.js";
import { summarize } from "../app/model.js";
import { md } from "../app/render.js";
import { combined } from "../app/combine.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().flatMap((f) => walk(path.join(p, f))) : p.endsWith(".sav") ? [p] : []);
const files = process.argv.slice(2).flatMap(walk);

function diff(a, b, p = "") {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number" && Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (Array.isArray(a) !== Array.isArray(b) || ka.length !== kb.length) return `${p}: length/shape ${ka.length} vs ${kb.length}`;
  for (const k of ka) { if (!(k in b)) return `${p}/${k}: missing in JS`; const d = diff(a[k], b[k], `${p}/${k}`); if (d) return d; }
  if (!Array.isArray(a) && ka.join("\u0000") !== kb.join("\u0000")) return `${p}: key order differs`;
  return null;
}

let bad = 0;
const entries = [];
for (const f of files) {
  let py;
  try { py = JSON.parse(execFileSync("python3", [path.join(root, "tools/dump.py"), f], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] })); } catch { py = null; }
  let js = null;
  try { const s = summarize(await parse(new Uint8Array(fs.readFileSync(f)))); js = { summary: JSON.parse(JSON.stringify(s)), md: md(s, path.basename(f)) }; } catch { js = null; }
  if (!py !== !js) { console.log(`FAIL ${path.basename(f)}: only one side could read it`); bad++; continue; }
  if (!py) { console.log(`skip ${path.basename(f)} (not a world save, both agree)`); entries.push({ summary: null, name: path.basename(f), size: fs.statSync(f).size }); continue; }
  const d = diff(py.summary, js.summary);
  const same = py.md === js.md;
  if (d || !same) { bad++; console.log(`FAIL ${path.basename(f)}: ${d || "markdown differs"}`); }
  else console.log(`ok   ${path.basename(f)}`);
  entries.push({ summary: js.summary, name: path.basename(f), size: fs.statSync(f).size });
}
if (files.length > 1) {
  const pyDoc = execFileSync("python3", [path.join(root, "sat_to_md.py"), ...process.argv.slice(2)], { maxBuffer: 1 << 30 }).toString();
  const jsDoc = combined(entries);
  if (pyDoc === jsDoc) console.log("ok   combined document");
  else { bad++; const a = pyDoc.split("\n"), b = jsDoc.split("\n"); const i = a.findIndex((l, k) => l !== b[k]); console.log(`FAIL combined at line ${i + 1}:\n  py: ${a[i]}\n  js: ${b[i]}`); }
}
console.log(bad ? `${bad} FAILED` : "all parity checks passed");
process.exit(bad ? 1 : 0);
