import { z } from 'zod';

export const MAX_BODY = 8 * 1024 * 1024;
export const ID = /^[a-f0-9]{48}$/;
const pdf = z.string().max(7_500_000).refine((value) => {
  if (!value.startsWith('JVBERi0') || value.length % 4 !== 0) return false;
  const payload = value.replace(/={1,2}$/, '');
  if (/[^a-zA-Z0-9+/]/.test(payload)) return false;
  try { return /%%EOF\s*$/.test(atob(value.slice(-256))); }
  catch { return false; }
});
export const bundleSchema = z.object({
  version: z.literal(1),
  pdf: pdf.optional(),
  text: z.string().min(1).max(100_000).optional(),
}).strict().refine(({ pdf, text }) => Boolean(pdf || text));

export function serialize(bundle) {
  return JSON.stringify(bundleSchema.parse(bundle));
}

export async function readLimited(request) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return chunks.join('') + decoder.decode();
      length += value.byteLength;
      if (length > MAX_BODY) throw new Error('Body too large');
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
