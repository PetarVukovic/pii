# ClearCopy

ClearCopy prepares a PDF or prompt before it reaches an AI service. Open the original on your own computer, review the outgoing copy, and attach only the result to your chat. The local editor includes all four Newmean detection models and English or Croatian OCR. Models and OCR run in the browser without a model API.

## Quick start

On macOS, Windows or Linux with Node.js 22 or newer, run the versioned package from GitHub and open `http://127.0.0.1:8795`. The first install downloads the package. Document processing and assets are local after installation.

```sh
npx --yes --package=https://github.com/PetarVukovic/pii/releases/download/clearcopy-v0.1.0/petarvukovic-clearcopy-0.1.0.tgz clearcopy web
```

From source:

```sh
git clone https://github.com/PetarVukovic/pii.git
cd pii/product
npm ci
npm run build
npm run local
```

1. Try the sample NDA or open your PDF. Use **Detection model** to choose Nano, Small, Medium or Large. Medium is the default.
2. Compare both sides on every page. Add a mark by dragging over the export preview and remove unwanted marks from its list. Approve each page to enable download.
3. Download `clearcopy.pdf` locally. Upload this copy as the attachment in your AI conversation. For prompts, review the editable masked text, approve it, and copy it into the composer.

ClearCopy is a preflight step you opt into. An ordinary upload or message in a third-party chat bypasses it. An AI connector cannot intercept that data before the chat service sees it. Identification can miss names, hidden context, handwriting or text with low OCR accuracy. Always review the preview. Password-protected PDFs are outside the supported input flow. The raster export preserves page geometry and visible content outside the marks. Searchability, links, interactive forms, signatures and accessibility tags are discarded.

## Skills and plugins

Install the portable skill with `npx skills` for supported hosts:

```sh
npx skills add PetarVukovic/pii@clearcopy-v0.1.0 --skill clearcopy
```

**Claude Code** can install the marketplace plugin with `/plugin marketplace add PetarVukovic/pii`, then `/plugin install clearcopy@clearcopy`. For a source checkout, use `claude --plugin-dir /absolute/path/to/pii/product`.

**Codex** can add the marketplace with `codex plugin marketplace add /absolute/path/to/pii`, then select ClearCopy in the plugin interface. The package contains both a portable manifest and the Codex compatibility manifest.

**Claude Desktop** can use the stdio MCP config in [`.mcp.json`](.mcp.json) as the `mcpServers` entry in its developer config. If a desktop app cannot resolve `npx`, use its absolute path on macOS/Linux or configure a Node executable and the installed `server/cli.mjs` directly.

### Local MCP

Download the **local MCP bundle** after review. In your own terminal, import it. Give the resulting code to the assistant with the instruction to call `read_approved_export`.

```sh
npx --yes --package=https://github.com/PetarVukovic/pii/releases/download/clearcopy-v0.1.0/petarvukovic-clearcopy-0.1.0.tgz clearcopy import /path/to/clearcopy-approved.json
```

If using the source checkout, use `node server/cli.mjs import /path/to/clearcopy-approved.json`. To connect stdio manually, point the host at the absolute path to Node and pass the absolute path to `server/cli.mjs` followed by `mcp`.

The server reads only IDs in the approved inbox at `~/.clearcopy/approved` by default. It validates the raster-only PDF structure. Approval of visible pixels and outgoing text still comes from the user who reviews and imports the bundle. Revoke a local code with `clearcopy revoke <code>`. Local copies persist until revoked or deleted. The inbox is ordinary local storage and inherits the computer's backup and filesystem settings. Local MCP returns prompt text or an embedded PDF resource. If the host cannot consume the PDF resource, attach the downloaded redacted PDF directly.

### ChatGPT and optional hosted MCP

Regular ChatGPT accepts the redacted PDF as a normal attachment. The optional connector is for explicitly enabled deployments. Run `npm run deploy` inside a configured Cloudflare account, enable `REMOTE_SHARE=on` for the deployment, and add its HTTPS `/mcp` endpoint as a custom MCP plugin in ChatGPT Work. Claude remote MCP can use that endpoint where enabled.

To generate a portable package with the hosted MCP URL and the ClearCopy skill, run `clearcopy chatgpt-plugin https://your-worker.example/mcp` and use the generated `clearcopy-chatgpt/` directory when packaging the plugin for the supported host. A public plugin listing requires the host's publication process.

When enabled, the workspace can explicitly send the approved output to your Worker. It retains the approved bundle for up to 10 minutes and deletes it at redemption. The one-time code grants access to whoever holds it. The HTTPS route is opt-in and the local Node server has no upload endpoint. Custom plugin availability and embedded PDF support depend on the host and plan. ChatGPT chat/plugin publication is independent of GitHub installation.

## Web deployment on Render

Use a Render Blueprint with this repository's root [`render.yaml`](../render.yaml), or create a static site with build command `cd product && npm ci && npm run build` and publish directory `product/dist`. The build downloads and verifies the four pinned models. Render serves those assets. Chrome runs the PDF render, detection, OCR, preview and export locally. The static deployment has no document upload service.

To test a deployed URL in Chrome, run `CLEARCOPY_BASE_URL=https://your-site.onrender.com node test/browser.mjs` from a configured source checkout. The test verifies all four model requests, redaction of a synthetic scanned page, no cross-origin network requests, and no uploads while editing or exporting. For a private installation, the local Node server uses the same static build.

## Optional native workflow with PyMuPDF

PyMuPDF **2.1**, PyMuPDF Layout **2.1**, and PyMuPDF4LLM **2.1** provide layout-aware reading, Tesseract OCR, and Markdown, JSON and plain text. Use Python 3.12, Tesseract and the desired `eng` and `hrv` trained data. The PyMuPDF components are provided under **AGPL-3.0 or commercial terms from Artifex**. Review the applicable terms for your distribution or deployment. The web editor and npm package use the separate browser pipeline.

```sh
python -m venv .venv
.venv/bin/python -m pip install -r native/requirements.txt
.venv/bin/python native/clearcopy.py inspect original.pdf --plan review.json --preview preview.pdf --model medium --language eng
# Review preview.pdf against the original. Edit or add rectangles in review.json if needed.
.venv/bin/python native/clearcopy.py export original.pdf --plan review.json --output clearcopy.pdf --reviewed --include md json txt --bundle clearcopy-approved.json
```

On Windows use `.venv\Scripts\python.exe`. Set `TESSDATA_PREFIX` to your trained-data directory if Tesseract needs it. The PyMuPDF OCR pass reads every page, including pages that combine selectable text with images. Layout helps order input words and the optional structured extracts are generated from the approved, masked pixels. The private plan binds rectangles to the SHA-256 of the source. Keep the original PDF, plan and preview local. Review the final PDF and any derived text before sharing them.

## Verification

From `product/`, run:

```sh
npm run build
npm test
npm run bench
.venv/bin/python test/native_evidence.py --assets examples/nda
node test/browser.mjs
```

The browser test expects the local editor at port 8795 and Chrome installed. It uses PyMuPDF as an independent PDF and OCR check. For the optional transport, run `npx wrangler dev --port 8796 --var REMOTE_SHARE:on` in a separate terminal, then run `CLEARCOPY_REMOTE_URL=http://127.0.0.1:8796 npm test`. The SDK benchmark uses six synthetic HR/EN prompts and reports full-span coverage, false-positive spans, and warm processing time. It does not measure PDF or general detection accuracy.

For the 0.1.0 fixture run, each model detected all eight expected values across the six prompts and produced zero unrelated spans. Warm totals were 45 ms (Nano), 52 ms (Small), 63 ms (Medium), and 122 ms (Large) on the test Mac. In the two-page synthetic NDA, independent text extraction and OCR recovered zero of the four selected test values from the exported PDF. The Chrome test additionally checks that local editing and export send no uploads and make no cross-origin requests.

## Licensing and business model

ClearCopy source is [MIT](LICENSE). Newmean's [Apache-2.0 license](../LICENSE) and [notices](../NOTICE) remain in force for its SDK and model weights. See [PyMuPDF licensing](https://pymupdf.io/) for the optional Python dependencies.

The local workspace, review, PDF export and MCP are open source. Potential paid plans are for centrally managed redaction policies, self-hosted rollout support, audit events without document contents, and optional managed infrastructure. Ask teams how long approval of AI-ready contracts takes today, then measure time saved and how many sensitive fields reviewers still add. Paid features and billing are proposals.
