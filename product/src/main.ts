import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Size } from '@newmean-ai/pii';
import { draw, exportPdf, openPdf, type Box, type Page } from './pdf';
import { mask, selectModel } from './text';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const button = (id: string) => el<HTMLButtonElement>(id);
const field = (id: string) => el<HTMLTextAreaElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const preview = el<HTMLCanvasElement>('preview');
let language: 'en' | 'hr' = 'en';
let pages: Page[] = [];
let current = 0;
let busy = false;
let transfer = false;
let liveShare = false;
let cursor: Box | undefined;
let pointer: { x: number; y: number } | undefined;
const tr = (en: string, hr: string) => language === 'en' ? en : hr;
const status = (message: string) => { el('status').textContent = message; };

function approved() {
  return {
    pdf: pages.length > 0 && pages.every(({ reviewed }) => reviewed),
    text: input('prompt-approved').checked ? field('masked').value.trim() : '',
  };
}

function controls() {
  const { pdf, text } = approved();
  const items = [
    ...(pdf ? [tr(`PDF · ${pages.length} pages`, `PDF · ${pages.length} str.`)] : []),
    ...(text ? [tr('reviewed prompt', 'pregledani upit')] : []),
  ];
  el('approved-summary').textContent = items.length
    ? tr(`MCP bundle contains ${items.join(' and ')}.`, `MCP paket sadrži ${items.join(' i ')}.`) : '';
  for (const id of ['download', 'copy', 'bundle', 'share']) {
    button(id).disabled = busy || transfer || (
      id === 'download' ? !pdf : id === 'copy' ? !text : (!pdf && !text) || (id === 'share' && !liveShare)
    );
  }
  input('file').disabled = busy || transfer;
  for (const id of ['demo', 'mask']) button(id).disabled = busy || transfer;
  select('model').disabled = busy || transfer;
  select('ocr').disabled = busy || transfer;
  // Lock the approved snapshot while encoding or transferring it.
  for (const id of ['reviewed', 'prompt-approved']) input(id).disabled = transfer;
  field('source').readOnly = transfer;
  field('masked').readOnly = transfer;
  input('prompt-approved').disabled = transfer || field('masked').value.length > 100_000;
  el('review').toggleAttribute('inert', transfer);
}

function showCursor(box?: Box) {
  const page = pages[current];
  if (!page) return;
  draw(page, preview, true);
  if (!box) return;
  const context = preview.getContext('2d')!;
  context.lineWidth = 4;
  context.strokeStyle = '#991c62';
  context.setLineDash([8, 6]);
  context.strokeRect(box.x, box.y, box.w, box.h);
}

function showPage() {
  const page = pages[current];
  el('review').hidden = !page;
  controls();
  if (!page) return;
  el('page').textContent = `${current + 1} / ${pages.length}`;
  button('prev').disabled = current === 0;
  button('next').disabled = current === pages.length - 1;
  input('reviewed').checked = page.reviewed;
  draw(page, el<HTMLCanvasElement>('original'), false);
  showCursor(cursor);
  el('boxes').replaceChildren(...page.boxes.map((box, i) => {
    const item = document.createElement('li');
    const remove = document.createElement('button');
    remove.className = 'outline';
    remove.textContent = `${box.label} · ${i + 1} ×`;
    remove.setAttribute('aria-label', `${tr('Remove mark', 'Ukloni oznaku')} ${i + 1}: ${box.label}`);
    remove.addEventListener('click', () => {
      if (transfer) return;
      page.boxes.splice(i, 1);
      page.reviewed = false;
      showPage();
    });
    item.append(remove);
    return item;
  }));
}

async function load(getBytes: () => Promise<ArrayBuffer>) {
  if (busy || transfer) return;
  busy = true;
  pages = [];
  current = 0;
  cursor = undefined;
  showPage();
  status(tr('Opening PDF locally…', 'Lokalno otvaram PDF…'));
  const start = performance.now();
  try {
    pages = await openPdf(await getBytes(), select('ocr').value as 'en' | 'hr', (page, total) =>
      status(tr(`Reading page ${page} of ${total}…`, `Čitam stranicu ${page} od ${total}…`)),
    );
    const count = pages.reduce((total, page) => total + page.boxes.length, 0);
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    status(tr(`${count} proposed marks · ${pages.length} pages · ${seconds}s. Review every page.`, `${count} predloženih oznaka · ${pages.length} str. · ${seconds} s. Pregledaj svaku stranicu.`));
  } catch {
    status(tr('Could not process this PDF. Check that it opens without a password and is within the limits.', 'PDF se nije mogao obraditi. Provjeri otvara li se bez lozinke i je li unutar ograničenja.'));
  } finally {
    busy = false;
    showPage();
  }
}

async function sample() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([545, 690]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.11, 0.21);
  const line = (text: string, y: number, size = 13) => page.drawText(text, { x: 48, y, size, font: size > 18 ? bold : font, color: ink });
  line('Mutual Non-Disclosure Agreement', 615, 26);
  line('Sample agreement for a software evaluation', 583);
  line('Northwind Studio and Alpine Research', 540, 17);
  line('This agreement governs confidential information exchanged', 497);
  line('during the evaluation of a proposed collaboration.', 477);
  line('Designated contact', 420, 16);
  line('Name: Daniel Harper', 388);
  line('Email: daniel.harper@example.com', 363);
  line('Each party agrees to use shared materials solely for evaluation.', 299);
  line('This agreement remains in effect for two years.', 279);
  line('SYNTHETIC SAMPLE   /   FOR DEMONSTRATION', 81, 10);
  return new Uint8Array(await doc.save()).buffer;
}

input('file').addEventListener('change', () => {
  const file = input('file').files?.[0];
  if (file) void load(() => file.arrayBuffer());
  input('file').value = '';
});
button('demo').addEventListener('click', () => {
  location.hash = 'studio';
  void load(sample);
});
select('model').addEventListener('change', () => {
  selectModel(select('model').value as Size);
  status(tr('Model selected for the next PDF or prompt scan.', 'Model odabran za sljedeću analizu PDF-a ili upita.'));
});
button('prev').onclick = () => { current--; cursor = undefined; showPage(); };
button('next').onclick = () => { current++; cursor = undefined; showPage(); };
input('reviewed').onchange = () => { pages[current].reviewed = input('reviewed').checked; controls(); };
input('prompt-approved').onchange = controls;
field('masked').oninput = () => { input('prompt-approved').checked = false; controls(); };
field('source').oninput = () => { el('prompt-result').hidden = true; input('prompt-approved').checked = false; controls(); };

function manual(box: Box) {
  const page = pages[current];
  if (!page || transfer || Math.min(box.w, box.h) < 4) return;
  page.boxes.push({ ...box, label: tr('Manual', 'Ručno') });
  page.reviewed = false;
  cursor = undefined;
  showPage();
}

function position(event: PointerEvent) {
  const r = preview.getBoundingClientRect();
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return {
    x: clamp((event.clientX - r.left) * preview.width / r.width, 0, preview.width),
    y: clamp((event.clientY - r.top) * preview.height / r.height, 0, preview.height),
  };
}

function selection(a: {x: number; y: number}, b: {x: number; y: number}): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), label: '' };
}
preview.onpointerdown = (event) => {
  if (!event.isPrimary || event.button !== 0 || transfer) return;
  pointer = position(event);
  preview.setPointerCapture(event.pointerId);
};
preview.onpointermove = (event) => { if (pointer) showCursor(selection(pointer, position(event))); };
preview.onpointerup = (event) => {
  if (!pointer) return;
  const box = selection(pointer, position(event));
  pointer = undefined;
  showCursor();
  manual(box);
};
preview.onpointercancel = () => { pointer = undefined; showCursor(); };
preview.onkeydown = (event) => {
  if (transfer || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { cursor = undefined; showCursor(); return; }
  if (event.key === 'Enter') { if (cursor) manual(cursor); return; }
  cursor ??= { x: preview.width / 4, y: preview.height / 4, w: 100, h: 32, label: '' };
  const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const max = axis === 'x' ? preview.width : preview.height;
  const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -8 : 8;
  if (event.shiftKey) cursor[size] = Math.max(8, Math.min(max - cursor[axis], cursor[size] + step));
  else cursor[axis] = Math.max(0, Math.min(max - cursor[size], cursor[axis] + step));
  showCursor(cursor);
};
preview.onblur = () => { cursor = undefined; showCursor(); };

button('mask').onclick = async () => {
  const original = field('source').value;
  if (!original.trim() || busy || transfer) return;
  busy = true;
  controls();
  status(tr('Scanning the prompt locally…', 'Lokalno analiziram upit…'));
  try {
    const result = await mask(original);
    if (original !== field('source').value) return status(tr('The prompt changed. Run the scan again.', 'Upit je promijenjen. Pokreni analizu ponovno.'));
    field('masked').value = result.text;
    el('prompt-result').hidden = false;
    input('prompt-approved').checked = false;
    status(result.text.length > 100_000
      ? tr('Shorten the outgoing prompt to 100,000 characters before approval.', 'Skrati upit za slanje na 100.000 znakova prije odobravanja.')
      : tr(`${result.count} proposed replacements. Review the outgoing prompt.`, `${result.count} predloženih zamjena. Pregledaj upit za slanje.`));
  } catch {
    status(tr('Could not scan the prompt. Try again.', 'Upit se nije mogao analizirati. Pokušaj ponovno.'));
  } finally {
    busy = false;
    controls();
  }
};

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function action(kind: 'download' | 'copy' | 'bundle' | 'share') {
  if (busy || transfer || button(kind).disabled) return;
  const selected = approved();
  transfer = true;
  controls();
  el('share-result').hidden = true;
  el('transfer').textContent = tr('Preparing approved output…', 'Pripremam odobreni izvoz…');
  try {
    if (kind === 'copy') {
      await navigator.clipboard.writeText(selected.text);
    } else {
      const pdf = selected.pdf ? new Blob([new Uint8Array(await exportPdf(pages)).buffer], { type: 'application/pdf' }) : undefined;
      if (kind === 'download' && pdf) {
        download('clearcopy.pdf', pdf);
      } else {
        if (pdf && pdf.size > 5_600_000) throw new Error('EXPORT_SIZE');
        const encoded = pdf ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(pdf);
        }) : undefined;
        const contents = JSON.stringify({ version: 1, pdf: encoded, text: selected.text || undefined });
        if (kind === 'bundle') {
          download('clearcopy-approved.json', new Blob([contents], { type: 'application/json' }));
        } else {
          const response = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: contents });
          if (!response.ok) throw new Error('SHARE_FAILED');
          input('code').value = (await response.json()).code;
          el('share-result').hidden = false;
        }
      }
    }
    el('transfer').textContent = tr('Approved output is ready.', 'Odobreni izvoz je spreman.');
  } catch (error) {
    el('transfer').textContent = error instanceof Error && error.message === 'EXPORT_SIZE'
      ? tr('This PDF exceeds the MCP bundle size limit. Download the PDF directly.', 'PDF prelazi ograničenje MCP paketa. Preuzmi PDF izravno.')
      : tr('Could not complete this action. Try again or download the PDF directly.', 'Radnja nije uspjela. Pokušaj ponovno ili preuzmi PDF izravno.');
  } finally {
    transfer = false;
    controls();
  }
}
for (const kind of ['download', 'copy', 'bundle', 'share'] as const) button(kind).onclick = () => void action(kind);

button('language').onclick = () => {
  language = language === 'en' ? 'hr' : 'en';
  document.documentElement.lang = language;
  button('language').textContent = tr('HR', 'EN');
  button('language').setAttribute('aria-label', tr('Hrvatski', 'English'));
  for (const element of document.querySelectorAll<HTMLElement>('[data-en][data-hr]')) {
    element.textContent = element.dataset[language] ?? '';
  }
  showPage();
};

void fetch('/api/capabilities').then(async (response) => {
  if (!response.ok) return;
  liveShare = (await response.json()).remoteShare === true;
  button('share').hidden = !liveShare;
  controls();
}).catch(() => {});
controls();
