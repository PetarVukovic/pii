// Reference spans for the phone-bench consistency set, computed in Node with the built package (builtin engine, the bench
// page's options: regex off, everything else default) on local model copies. Rewrites `ref` and `refDevice` of the
// consistency file (make_consistency.py output); run it again whenever the models or the SDK's default spans change.
//   npm run build && node experiments/phone-bench/make_ref.mjs <consistency.json> <models dir>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [file, models] = process.argv.slice(2);
if (!file || !models) {
  console.error("usage: node make_ref.mjs <consistency.json> <models dir>");
  process.exit(1);
}
const { createRedactor, DEFAULT_VARIANT, VERSION, MODEL_VERSION } = await import(new URL("../../dist/index.js", import.meta.url).href);
const check = JSON.parse(readFileSync(file, "utf8"));
const localFetch = async (url) => new Response(readFileSync(new URL(url)));
const ref = {};
for (const size of ["nano", "small", "medium", "large"]) {
  const r = await createRedactor({ engine: "builtin", size, variant: DEFAULT_VARIANT[size], modelUrl: pathToFileURL(`${models}/pii-${size}/`).href, fetch: localFetch, cache: false, regex: false });
  ref[size] = [];
  for (const x of check.set) ref[size].push((await r.detect(x.text)).map((y) => `${y.start}-${y.end}:${y.label}`).join(" "));
  await r.dispose();
}
check.ref = ref;
check.refDevice = `Node ${process.versions.node} ${process.platform} ${process.arch} · builtin · SDK ${VERSION} · models ${MODEL_VERSION}`;
writeFileSync(file, JSON.stringify(check));
console.log(check.refDevice, Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, v.length])));
