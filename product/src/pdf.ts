import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { createWorker } from 'tesseract.js';
import { detect, type Span } from './text';

GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';

export type Box = { x: number; y: number; w: number; h: number; label: string };
export type Page = { canvas: HTMLCanvasElement; width: number; height: number; boxes: Box[]; reviewed: boolean };
type Word = Box & { text: string };
const maskFill = '#392847';
const maskEdge = '#6b4b80';
const MAX_PAGES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function cover(words: Word[], spans: Span[]): Box[] {
  let offset = 0;
  return words.flatMap(({ text, ...box }) => {
    const start = offset;
    offset += text.length + 1;
    const span = spans.find(({ start: from, end }) => from < start + text.length && end > start);
    return span ? [{ ...box, label: span.label }] : [];
  });
}

async function mark(words: Word[]) {
  if (!words.length) return [];
  return cover(words, await detect(words.map((word) => word.text).join(' ')));
}

export async function openPdf(bytes: ArrayBuffer, language: 'hr' | 'en', progress: (page: number, total: number) => void) {
  if (bytes.byteLength > MAX_FILE_SIZE) throw new Error('PDF_LIMIT');
  const loading = getDocument({
    data: bytes,
    enableXfa: false,
    cMapUrl: '/vendor/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/standard_fonts/',
    iccUrl: '/vendor/iccs/',
    wasmUrl: '/vendor/wasm/',
  });
  let ocr: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > MAX_PAGES) throw new Error('PDF_LIMIT');
    ocr = await createWorker(language === 'hr' ? ['hrv', 'eng'] : 'eng', 1, {
      workerPath: '/vendor/ocr-worker.min.js',
      corePath: '/vendor/tesseract',
      langPath: '/vendor/lang',
      workerBlobURL: false,
    });
    const pages: Page[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const size = page.getViewport({ scale: 1 });
      const view = page.getViewport({ scale: Math.min(2.5, 2300 / Math.max(size.width, size.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      const context = canvas.getContext('2d')!;
      await page.render({ canvas, canvasContext: context, viewport: view }).promise;

      const content = await page.getTextContent();
      const runs = content.items.flatMap((item): Word[] => {
        if (!('str' in item) || !item.str.trim()) return [];
        const [a, b, c, d, x, y] = Util.transform(view.transform, item.transform);
        const h = Math.hypot(c, d);
        const width = item.width * view.scale;
        const angle = Math.atan2(b, a);
        const alongX = Math.cos(angle) * width;
        const alongY = Math.sin(angle) * width;
        const upX = Math.sin(angle) * h;
        const upY = -Math.cos(angle) * h;
        const xs = [x, x + alongX, x + upX, x + alongX + upX];
        const ys = [y, y + alongY, y + upY, y + alongY + upY];
        return [{ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), text: item.str, label: '' }];
      });
      const { data } = await ocr.recognize(canvas, {}, { blocks: true });
      const words = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) =>
        line.words.map(({ bbox, text }) => ({
          x: bbox.x0, y: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0, text, label: '',
        })),
      )));
      const ocrBoxes = await mark(words);
      const textBoxes = await mark(runs);
      pages.push({
        canvas, width: size.width, height: size.height, boxes: [...ocrBoxes, ...textBoxes], reviewed: false,
      });
      page.cleanup();
    }
    return pages;
  } finally {
    try { await ocr?.terminate(); } finally { await loading.destroy(); }
  }
}

export function draw(page: Page, target: HTMLCanvasElement, redacted: boolean) {
  target.width = page.canvas.width;
  target.height = page.canvas.height;
  const ctx = target.getContext('2d')!;
  ctx.drawImage(page.canvas, 0, 0);
  if (!redacted) return;
  for (const { x, y, w, h } of page.boxes) {
    const pad = Math.max(4, h * 0.18);
    const left = Math.floor(x - pad);
    const top = Math.floor(y - pad);
    const width = Math.ceil(x + w + pad) - left;
    const height = Math.ceil(y + h + pad) - top;
    ctx.fillStyle = maskFill;
    ctx.fillRect(left, top, width, height);
    ctx.fillStyle = maskEdge;
    ctx.fillRect(left, top, width, Math.min(6, Math.max(2, Math.round(height / 8))));
  }
}

export async function exportPdf(pages: Page[]) {
  if (!pages.length || pages.some((page) => !page.reviewed)) throw new Error('REVIEW_REQUIRED');
  const output = await PDFDocument.create({ updateMetadata: false });
  output.setTitle('ClearCopy');
  const canvas = document.createElement('canvas');
  for (const page of pages) {
    draw(page, canvas, true);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((image) => image ? resolve(image) : reject(new Error('PNG_FAILED')), 'image/png'),
    );
    const png = await output.embedPng(await blob.arrayBuffer());
    output.addPage([page.width, page.height]).drawImage(png, { x: 0, y: 0, width: page.width, height: page.height });
  }
  return output.save();
}
