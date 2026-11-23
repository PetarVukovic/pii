import { createRedactor, type Size } from '@newmean-ai/pii';

let active: Size = 'medium';
const engines = new Map<Size, ReturnType<typeof createRedactor>>();
export type Span = Awaited<ReturnType<Awaited<ReturnType<typeof createRedactor>>['detect']>>[number];

export function selectModel(size: Size) {
  active = size;
  engines.clear();
}

function redactor() {
  const size = active;
  const current = engines.get(size);
  if (current) return current;
  const pending = createRedactor({
    size, regex: true, wholeWords: true, modelUrl: `/vendor/model/${size}/`,
  }).catch((error: unknown) => {
    if (engines.get(size) === pending) engines.delete(size);
    throw error;
  });
  engines.set(size, pending);
  return pending;
}

export async function detect(text: string) {
  return (await redactor()).detect(text);
}

export async function mask(text: string) {
  const spans = await detect(text);
  const tokens = new Map<string, string>();
  const counts = new Map<string, number>();
  let offset = 0;
  let output = '';
  for (const { start, end, label } of spans) {
    const value = text.slice(start, end);
    const key = JSON.stringify([label, value]);
    let token = tokens.get(key);
    if (!token) {
      const number = (counts.get(label) ?? 0) + 1;
      counts.set(label, number);
      token = `[${label}_${number}]`;
      tokens.set(key, token);
    }
    output += text.slice(offset, start) + token;
    offset = end;
  }
  return { text: output + text.slice(offset), count: spans.length };
}
