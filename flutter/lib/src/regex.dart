// Deterministic patterns that run next to the model when `regex: true`: a port of js/src/regex.ts (same patterns as the
// Python baseline, with Python's Unicode \w, \d and \b). Dart's RegExp with `unicode: true` follows JavaScript's.
import 'span.dart';

const _w = r'[\p{L}\p{N}_]';
const _d = r'\p{Nd}';
const _b0 = '(?<!$_w)'; // \b before a digit
const _b1 = '(?!$_w)'; // \b after a digit

RegExp _re(String pattern) => RegExp(pattern, unicode: true);

const _emailLocal = r'[\p{L}\p{N}_.+-]+';
const _emailDomain = r'@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+';
final RegExp _email = _re('$_emailLocal$_emailDomain');

// The EMAIL rule as regexSpans runs it: the domain is optional, so a run of local-part characters without an address after
// it is consumed as one match (and dropped) instead of being tried again from each of its characters, which took time
// quadratic in the length of the run. The matches with a domain are exactly those of _email: an address starts where its
// run of local-part characters starts (or where the previous match ended) in both.
final RegExp _emailLinear = _re('$_emailLocal($_emailDomain)?');

/// The rules in order; a match that overlaps an earlier rule's match is skipped.
final List<(String, RegExp)> regexRules = [
  ('EMAIL', _email),
  ('URL', _re(r'https?://\S+|www\.\S+')),
  ('ID_NUMBER', _re('$_b0$_d{6}[-\\s]?[1-8]$_d{6}$_b1')),
  ('FINANCIAL', _re('$_b0(?:$_d{4}[-\\s]?){3}$_d{4}$_b1|$_b0$_d{2,6}-$_d{2,6}-$_d{2,8}(?:-$_d{1,3})?$_b1')),
  ('PHONE', _re('(?:\\+$_d{1,3}[\\s-]?)?\\(?$_d{2,4}\\)?[\\s.-]?$_d{3,4}[\\s.-]?$_d{4}$_b1')),
];

/// Pattern matches in [text], with UTF-16 offsets (source "regex"), in rule order.
List<PiiSpan> regexSpans(String text) {
  final out = <PiiSpan>[];
  // the spans accepted so far in text order (they never overlap), so each rule checks its matches against them in one pass
  // instead of comparing every match with every earlier span
  var taken = <PiiSpan>[];
  for (final (label, re) in regexRules) {
    final email = identical(re, _email);
    final added = <PiiSpan>[];
    var i = 0;
    for (final m in (email ? _emailLinear : re).allMatches(text)) {
      if (email && m.group(1) == null) continue;
      while (i < taken.length && taken[i].end <= m.start) {
        i++;
      }
      if (i < taken.length && taken[i].start < m.end) continue;
      added.add(PiiSpan(m.start, m.end, label, 'regex'));
    }
    if (added.isEmpty) continue;
    out.addAll(added);
    final merged = <PiiSpan>[];
    var a = 0;
    var b = 0;
    while (a < taken.length || b < added.length) {
      merged.add(b >= added.length || (a < taken.length && taken[a].start < added[b].start) ? taken[a++] : added[b++]);
    }
    taken = merged;
  }
  return out;
}
