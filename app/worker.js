// Parsing worker. Inflating and decoding a save is 1-3 s of solid CPU, which on the main thread
// is a tab that cannot paint. Only the finished summary crosses back (plain data, structured-clonable).
import { parse } from "./reader.js";
import { summarize } from "./model.js";

self.addEventListener("message", async ({ data }) => {
  const { id, buf } = data;
  try {
    const summary = summarize(await parse(buf instanceof Uint8Array ? buf : new Uint8Array(buf)));
    self.postMessage({ id, ok: true, result: summary });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e && e.message ? e.message : String(e) });
  }
});
