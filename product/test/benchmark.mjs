import { createRedactor, DEFAULT_VARIANT } from '@newmean-ai/pii';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

const fixtures = [
  ['HR', 'Za ovaj ugovor kontakt je Ivana Horvat, e-pošta ivana.horvat@example.com.', ['Ivana Horvat', 'ivana.horvat@example.com']],
  ['HR', 'Sastanak vodi Petra Kovač. Njezin kontakt je petra.kovac@example.org.', ['Petra Kovač', 'petra.kovac@example.org']],
  ['HR', 'Dokument vrijedi dvije godine od dana potpisa.', []],
  ['EN', 'For this agreement, contact Daniel Harper at daniel.harper@example.com.', ['Daniel Harper', 'daniel.harper@example.com']],
  ['EN', 'Write to Taylor Morgan at taylor@example.org before submitting the form.', ['Taylor Morgan', 'taylor@example.org']],
  ['EN', 'The agreement remains in effect for two years.', []],
];
for (const size of Object.keys(DEFAULT_VARIANT)) {
  const redactor = await createRedactor({
    size, regex: true, cache: false,
    modelUrl: new URL(`../dist/vendor/model/${size}/`, import.meta.url).href,
    fetch: async (url) => new Response(await readFile(new URL(url))),
  });
  let found = 0;
  let total = 0;
  let extra = 0;
  const started = performance.now();
  for (const [, text, expected] of fixtures) {
    const spans = await redactor.detect(text);
    const targets = expected.map((value) => ({ start: text.indexOf(value), end: text.indexOf(value) + value.length }));
    const overlap = (a, b) => a.start < b.end && b.start < a.end;
    total += targets.length;
    found += targets.filter((target) => Array.from({ length: target.end - target.start }, (_, i) => target.start + i)
      .every((i) => spans.some((span) => span.start <= i && span.end > i))).length;
    extra += spans.filter((span) => !targets.some((target) => overlap(target, span))).length;
  }
  console.log(JSON.stringify({ size, documents: fixtures.length, found, total, unmatchedSpans: extra, ms: Math.round(performance.now() - started) }));
}
