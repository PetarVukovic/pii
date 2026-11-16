// Builds the public demo into <out>/ (for the site: ../../site/public/demo): index.html, app/ (SDK source + both engines +
// onnxruntime-web), ort/ (onnxruntime-web wasm). No model files: they come from Hugging Face. The same folder works as a
// GitHub Pages site or a static Hugging Face Space. License notices ship with it: app/*.LEGAL.txt (esbuild), ort/LICENSE.txt
// (onnxruntime-web, MIT; the npm package has no LICENSE file, so the text is kept in onnxruntime-web.LICENSE.txt), and
// LICENSE.txt and NOTICE.txt (this repo's Apache-2.0 license and NOTICE plus the onnxruntime-web license), linked from the footer.
// index.html preloads the medium model (the size the page opens with) from Hugging Face unless it is already in the SDK's
// Cache Storage, so a first visit's download starts before the script has loaded.
// node playground/build.mjs [out]
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const js = resolve(here, "..");
const out = resolve(process.argv[2] ?? join(here, "dist"));

// the SDK's model version, default variants and cache name, read from the TypeScript source
const tables = await build({
  stdin: { contents: 'export { MODEL_VERSION } from "./src/models.ts"; export { DEFAULT_VARIANT } from "./src/index.ts"; export { CACHE_NAME } from "./src/loader.ts";', resolveDir: js, loader: "ts" },
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const { MODEL_VERSION, DEFAULT_VARIANT, CACHE_NAME } = await import(`data:text/javascript;base64,${Buffer.from(tables.outputFiles[0].text).toString("base64")}`);

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: [join(here, "main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  splitting: true,
  outdir: join(out, "app"),
  chunkNames: "[name]-[hash]",
  minify: true,
  legalComments: "linked",
  define: { __VERSION__: JSON.stringify(JSON.parse(readFileSync(join(js, "package.json"), "utf8")).version) },
  absWorkingDir: js,
});
mkdirSync(join(out, "ort"), { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"])
  cpSync(join(js, "node_modules/onnxruntime-web/dist", f), join(out, "ort", f));
const ortLicense = join(here, "onnxruntime-web.LICENSE.txt");
cpSync(ortLicense, join(out, "ort", "LICENSE.txt"));
cpSync(join(js, "..", "LICENSE"), join(out, "LICENSE.txt"));
writeFileSync(
  join(out, "NOTICE.txt"),
  `${readFileSync(join(js, "..", "NOTICE"), "utf8")}\n${"-".repeat(80)}\n${readFileSync(ortLicense, "utf8")}`,
);
let html = readFileSync(join(here, "index.html"), "utf8");
// The page opens with the medium model: start its download while the script is still loading. A preload link is the same
// request as the SDK's fetch, so the browser hands the response over. Added from a script, and only when the files are not in
// the SDK's Cache Storage yet: Hugging Face sends them with no-store, so a preload on a later visit would download them again.
const medium = `https://huggingface.co/newmean-ai/pii-medium/resolve/v${MODEL_VERSION}/`; // the SDK's default modelUrl
const preload = [`${medium}onnx/model_${DEFAULT_VARIANT.medium}.onnx`, `${medium}tokenizer.web.json`];
const script = `<script>(async () => {
  try { const c = await caches.open(${JSON.stringify(CACHE_NAME)}); if (await c.match(${JSON.stringify(preload[0])})) return; } catch {}
  for (const href of ${JSON.stringify(preload)}) {
    const l = document.createElement("link");
    Object.assign(l, { rel: "preload", as: "fetch", href, crossOrigin: "anonymous" });
    document.head.append(l);
  }
})();</script>`;
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${script}`);
writeFileSync(join(out, "index.html"), html);
cpSync(join(here, "og-image.png"), join(out, "og-image.png")); // link-preview image (source: og-image.html)
console.log("built", out);
