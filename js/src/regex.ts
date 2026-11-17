// Deterministic patterns that run next to the model (the "model + regex" setup evaluated in the technical report).
// Same patterns as the Python baseline (training/scripts/evaluate.py REGEX), with Python's Unicode \w, \d and \b.
import type { Span } from "./types.js";

const W = String.raw`[\p{L}\p{N}_]`;
const D = String.raw`\p{Nd}`;
const B0 = String.raw`(?<!${W})`; // \b before a digit
const B1 = String.raw`(?!${W})`; // \b after a digit

const EMAIL_LOCAL = String.raw`[\p{L}\p{N}_.+-]+`;
const EMAIL_DOMAIN = String.raw`@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+`;
const EMAIL = new RegExp(EMAIL_LOCAL + EMAIL_DOMAIN, "gu");
// The EMAIL rule as regexSpans runs it: the domain is optional, so a run of local-part characters without an address after
// it is consumed as one match (and dropped) instead of being tried again from each of its characters, which took time
// quadratic in the length of the run. The matches with a domain are exactly those of EMAIL: an address starts where its
// run of local-part characters starts (or where the previous match ended) in both.
const EMAIL_LINEAR = new RegExp(`${EMAIL_LOCAL}(${EMAIL_DOMAIN})?`, "gu");

export const REGEX_RULES: [label: string, pattern: RegExp][] = [
  ["EMAIL", EMAIL],
  ["URL", new RegExp(String.raw`https?://\S+|www\.\S+`, "gu")],
  ["ID_NUMBER", new RegExp(String.raw`${B0}${D}{6}[-\s]?[1-8]${D}{6}${B1}`, "gu")],
  ["FINANCIAL", new RegExp(String.raw`${B0}(?:${D}{4}[-\s]?){3}${D}{4}${B1}|${B0}${D}{2,6}-${D}{2,6}-${D}{2,8}(?:-${D}{1,3})?${B1}`, "gu")],
  ["PHONE", new RegExp(String.raw`(?:\+${D}{1,3}[\s-]?)?\(?${D}{2,4}\)?[\s.-]?${D}{3,4}[\s.-]?${D}{4}${B1}`, "gu")],
];

/** Matches of one rule as [start, end) pairs, in text order. */
function ranges(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  const email = re === EMAIL;
  const run = email ? EMAIL_LINEAR : re;
  re.lastIndex = 0;
  run.lastIndex = 0;
  for (const m of text.matchAll(run)) {
    if (email && m[1] === undefined) continue;
    out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

/** Pattern matches; a match that overlaps an earlier rule's match is skipped. */
export function regexSpans(text: string): Span[] {
  const out: Span[] = [];
  // the spans accepted so far in text order (they never overlap), so each rule checks its matches against them in one pass
  // instead of comparing every match with every earlier span
  let taken: Span[] = [];
  for (const [label, re] of REGEX_RULES) {
    const added: Span[] = [];
    let i = 0;
    for (const [start, end] of ranges(text, re)) {
      while (i < taken.length && taken[i].end <= start) i++;
      if (i < taken.length && taken[i].start < end) continue;
      added.push({ start, end, label, source: "regex" });
    }
    if (!added.length) continue;
    for (const span of added) out.push(span);
    const merged: Span[] = [];
    let a = 0;
    let b = 0;
    while (a < taken.length || b < added.length) {
      merged.push(b >= added.length || (a < taken.length && taken[a].start < added[b].start) ? taken[a++] : added[b++]);
    }
    taken = merged;
  }
  return out;
}
