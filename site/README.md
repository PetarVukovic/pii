English | [한국어](README.ko.md)

# pii.newmean.ai

A Cloudflare Worker with static assets (`public/`) and a D1 database (`pii-site`).

- `/`: the demo (`js/playground`), served from `public/demo/` with a `<base href="/demo/">` so its relative paths resolve.
- `/mobile-bench/?k=<share code>`: the phone benchmark (`js/experiments/phone-bench`). The model files under
  `/mobile-bench/models/` and the results API `/api/bench` need the share code, which is the Worker secret `BENCH_KEY`. Each
  finished run is stored in the D1 table `bench_runs` (`schema.sql`); the stored fields are the device information the browser
  reports and the measurements, not IP addresses or other request metadata.
- `/api/demo`: the demo's speed numbers. On pii.newmean.ai the demo sends, when the page is hidden or closed, the model size,
  engine, time and token count of each run and model load, a coarse device class (OS, browser, phone or not, CPU cores, memory)
  and whether the text was one of the samples. Never the text or what was found; the line under the demo title says so. The
  Worker writes one data point per event to the Workers Analytics Engine dataset `pii_demo_runs` (binding `DEMO`) with the
  country Cloudflare reports, and no IP address. Read it with the Analytics Engine SQL API (an API token with Account
  Analytics: Read).

## Setup (once)

```bash
wrangler d1 create pii-site                                    # put the printed database_id into wrangler.jsonc
wrangler d1 execute pii-site --remote --file schema.sql        # creates bench_runs
wrangler secret put BENCH_KEY                                  # the share code for the phone benchmark
```

`wrangler.jsonc` binds the custom domain `pii.newmean.ai`; change or remove `routes` to deploy your own copy.

## Build and deploy

Run `npm install` in `js/` first; both build scripts use its esbuild and onnxruntime-web.

```bash
node ../js/playground/build.mjs public/demo                                         # demo page, bundle, ORT wasm (models come from Hugging Face)
node ../js/experiments/phone-bench/build.mjs public/mobile-bench <models dir>       # bench page, bundle, ORT wasm, model files
wrangler deploy
```

`<models dir>` holds local copies of the four Hugging Face model repos (`pii-nano/`, `pii-small/`, `pii-medium/`,
`pii-large/`). `public/demo/` and `public/mobile-bench/` are build output and stay out of git.

Read the stored runs:

```bash
wrangler d1 execute pii-site --remote --command "SELECT created_at, device, size, engine, data FROM bench_runs ORDER BY id"
```

Each run's `data` holds the SDK version of the page that measured it (`sdk`; runs before 1.5.0 have none), so speed can be
compared by release:

```bash
wrangler d1 execute pii-site --remote --command "SELECT json_extract(data, '$.sdk') AS sdk, size, engine, count(*) AS runs FROM bench_runs GROUP BY 1, 2, 3"
```

The demo's speed numbers carry it too (`blob9` of `pii_demo_runs`).
