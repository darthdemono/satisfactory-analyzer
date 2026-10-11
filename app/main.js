// Browser entry: parse dropped/picked .sav files entirely client-side and render them.
// The save never leaves the page. Parsing runs in a worker so a 10 MB save cannot freeze the tab;
// if module workers are unavailable the same code runs inline.
import { renderSave } from "./view.js";
import { md } from "./render.js";
import { combined } from "./combine.js";
import { renderMarkdown } from "./mdview.js";

const $ = (id) => document.getElementById(id);
const out = $("out"), status = $("status");
const setStatus = (msg) => { status.textContent = msg; };

function showError(msg) {
  out.replaceChildren();
  const box = document.createElement("div");
  box.className = "error";
  box.setAttribute("role", "alert");
  box.textContent = msg;
  out.append(box);
}

let worker = null;
const jobs = new Map();
let nextJob = 1;

function startWorker() {
  if (worker !== null || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      data.ok ? job.resolve(data.result) : job.reject(new Error(data.error));
    });
    worker.addEventListener("error", () => {
      for (const j of jobs.values()) j.reject(new Error("worker failed"));
      jobs.clear(); worker.terminate(); worker = false;
    });
  } catch { worker = false; }
  return worker;
}

async function parseInline(buf) {
  const [{ parse }, { summarize }, { useNames }] = await Promise.all([import("./reader.js"), import("./model.js"), import("./names.js")]);
  useNames(await (await fetch("db_sat/names.json")).json());
  return summarize(await parse(buf));
}

function parseInWorker(buf) {
  const w = startWorker();
  if (!w) return parseInline(buf);
  return new Promise((resolve, reject) => {
    const id = nextJob++;
    jobs.set(id, { resolve, reject });
    w.postMessage({ id, buf }, [buf.buffer]);
  });
}

function toolbar(markdown, jsonText, base) {
  const bar = document.createElement("div");
  bar.className = "actions";
  const btn = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; b.textContent = label; b.addEventListener("click", () => fn(b, label)); bar.append(b); };
  btn("Copy Markdown", async (b, label) => {
    try { await navigator.clipboard.writeText(markdown); b.textContent = "Copied"; } catch { b.textContent = "Copy failed"; }
    setTimeout(() => { b.textContent = label; }, 1500);
  });
  const save = (name, text, type) => { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
  btn("Download .md", () => save(`${base}.md`, markdown, "text/markdown"));
  if (jsonText) btn("Download .json", () => save(`${base}.json`, jsonText, "application/json"));
  return bar;
}

async function handleFile(file) {
  setStatus(`Reading ${file.name}…`);
  out.replaceChildren();
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    setStatus(`Parsing ${file.name}…`);
    const summary = await parseInWorker(buf);
    const base = file.name.replace(/\.sav$/i, "");
    out.replaceChildren(toolbar(md(summary, file.name), JSON.stringify(summary, null, 1), base), renderSave(summary, file.name));
    setStatus(`Parsed ${file.name}`);
  } catch (e) {
    setStatus("");
    showError(`Could not read this file as a Satisfactory world save: ${e && e.message ? e.message : e}`);
  }
}

let mermaidReady = null;
function ensureMermaid() {
  if (mermaidReady) return mermaidReady;
  mermaidReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/mermaid.min.js";
    s.onload = () => resolve(window.mermaid);
    s.onerror = () => reject(new Error("chart library did not load"));
    document.head.append(s);
  }).then((mermaid) => {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const ink = v("--ink", "#c3c8d0"), accent = v("--accent", "#f08a24"), bg = v("--bg", "#07080a");
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "base",
      themeVariables: { background: bg, primaryColor: "#11141a", primaryTextColor: ink, primaryBorderColor: accent, secondaryColor: "#11141a", tertiaryColor: bg, lineColor: accent, textColor: ink, mainBkg: "#11141a", nodeBorder: accent, clusterBkg: bg, edgeLabelBackground: bg,
        xyChart: { backgroundColor: bg, titleColor: ink, xAxisLabelColor: ink, xAxisTitleColor: ink, xAxisTickColor: accent, xAxisLineColor: accent,
          yAxisLabelColor: ink, yAxisTitleColor: ink, yAxisTickColor: accent, yAxisLineColor: accent, plotColorPalette: accent } },
    });
    return mermaid;
  });
  return mermaidReady;
}

async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const outList = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      if (file.name.toLowerCase().endsWith(".sav")) outList.push({ file, path: prefix + file.name });
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + "/");
    }
  };
  for (const e of entries) await walk(e, "");
  return outList;
}

const asPairs = (list) => [...list].map((f) => (f.file ? f : { file: f, path: f.webkitRelativePath || f.name }));

async function handleMany(list) {
  const pairs = asPairs(list).filter(({ file }) => file.name.toLowerCase().endsWith(".sav")).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!pairs.length) { showError("No .sav files in that drop."); return; }
  out.replaceChildren();
  const entries = [];
  let done = 0;
  for (const { file } of pairs) {
    setStatus(`Reading ${++done} of ${pairs.length} — ${file.name}…`);
    let summary = null;
    try { summary = await parseInWorker(new Uint8Array(await file.arrayBuffer())); } catch { summary = null; } // settings files share the extension
    entries.push({ summary, name: file.name, size: file.size });
  }
  const readable = entries.filter((e) => e.summary).length;
  if (!readable) { setStatus(""); showError("None of those files could be read as a world save."); return; }
  setStatus("Building the timeline…");
  const markdown = combined(entries);
  const doc = document.createElement("div");
  doc.className = "result combined";
  doc.append(renderMarkdown(markdown));
  out.replaceChildren(toolbar(markdown, null, "combined-playthrough"), doc);
  setStatus(`Read ${readable} of ${pairs.length} files`);
  try {
    const mermaid = await ensureMermaid();
    await mermaid.run({ nodes: doc.querySelectorAll("pre.mermaid") });
  } catch { setStatus(`Read ${readable} of ${pairs.length} files — charts unavailable offline`); }
}

let many = false;
function setMode(on) {
  many = on;
  $("mode-single").classList.toggle("on", !on);
  $("mode-combined").classList.toggle("on", on);
  $("mode-single").setAttribute("aria-pressed", String(!on));
  $("mode-combined").setAttribute("aria-pressed", String(on));
  $("mode-note").textContent = on ? "Any number of saves, dropped together or a whole folder." : "One save, read in full.";
  $("drop-big").textContent = on ? "Drop .sav saves or a folder here, or click to choose" : "Drop a .sav save here, or click to choose";
  $("file").multiple = on;
  $("pick-folder").hidden = !on;
}

function wire() {
  const drop = $("drop"), input = $("file"), folder = $("folder");
  input.addEventListener("change", () => {
    const picked = [...input.files];
    input.value = "";
    if (!picked.length) return;
    many ? handleMany(picked) : handleFile(picked[0]);
  });
  $("mode-single").addEventListener("click", () => setMode(false));
  $("mode-combined").addEventListener("click", () => setMode(true));
  $("pick-folder").addEventListener("click", () => folder.click());
  folder.addEventListener("change", () => { const picked = [...folder.files]; folder.value = ""; if (picked.length) handleMany(picked); });
  drop.addEventListener("click", () => input.click());
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async (e) => {
    const multi = many || e.dataTransfer.files.length > 1 || [...(e.dataTransfer.items || [])].some((it) => it.webkitGetAsEntry && (it.webkitGetAsEntry() || {}).isDirectory);
    if (multi) { if (!many) setMode(true); handleMany(await filesFromDrop(e.dataTransfer)); return; }
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  ["dragover", "drop"].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
  startWorker();
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
else wire();
