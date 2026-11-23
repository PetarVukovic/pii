import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_VARIANT, MODEL_FILES, MODEL_VERSION } from '@newmean-ai/pii';

const copy = (source, target) => cp(source, `dist/${target}`, { recursive: true });
const modelCache = '.assets/model';
async function modelFile(size, name, expected) {
  const local = `${modelCache}/${size}/${name}`;
  const matches = (bytes) => createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  let bytes = await readFile(local).catch(() => undefined);
  if (!bytes || !matches(bytes)) {
    const response = await fetch(`https://huggingface.co/newmean-ai/pii-${size}/resolve/v${MODEL_VERSION}/${name}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!matches(bytes)) throw new Error(`Model checksum mismatch: ${name}`);
    await writeFile(local, bytes);
  }
}

await Promise.all([
  ...Object.entries(DEFAULT_VARIANT).map(async ([size, model]) => {
    await mkdir(`${modelCache}/${size}/onnx`, { recursive: true });
    await Promise.all([
      modelFile(size, `onnx/model_${model}.onnx`, MODEL_FILES[size][model]),
      modelFile(size, 'tokenizer.web.json', MODEL_FILES[size].tokenizer),
    ]);
  }),
  build({
    entryPoints: ['src/main.ts'], bundle: true, splitting: true, format: 'esm',
    target: 'es2022', outdir: 'dist', minify: true, legalComments: 'linked',
  }),
]);
await Promise.all([
  copy('src/index.html', 'index.html'),
  copy('src/style.css', 'style.css'),
  copy(modelCache, 'vendor/model'),
  copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/pdf.worker.mjs'),
  ...['cmaps', 'standard_fonts', 'iccs', 'wasm'].map((file) => copy(`node_modules/pdfjs-dist/${file}`, `vendor/${file}`)),
  copy('node_modules/tesseract.js/dist/worker.min.js', 'vendor/ocr-worker.min.js'),
  copy('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'vendor/worker.min.js.LICENSE.txt'),
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((engine) =>
    copy(`node_modules/tesseract.js-core/tesseract-core-${engine}.wasm.js`, `vendor/tesseract/tesseract-core-${engine}.wasm.js`)),
  ...['eng', 'hrv'].map((lang) =>
    copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `vendor/lang/${lang}.traineddata.gz`)),
  copy('../LICENSE', 'NEWMEAN-LICENSE.txt'),
  copy('../NOTICE', 'NEWMEAN-NOTICE.txt'),
  copy('LICENSE', 'LICENSE.txt'),
  copy('node_modules/pdfjs-dist/LICENSE', 'vendor/PDFJS-LICENSE.txt'),
  copy('node_modules/tesseract.js-core/LICENSE', 'vendor/TESSERACT-LICENSE.txt'),
]);
await mkdir('dist/api', { recursive: true });
await writeFile('dist/api/capabilities', '{"remoteShare":false}');
