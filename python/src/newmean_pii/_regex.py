# Deterministic patterns that run next to the model (the "model + regex" setup evaluated in the technical report).
# Same patterns as the Python baseline (training/scripts/evaluate.py REGEX) and js/src/regex.ts. Python's Unicode \w, \d
# and \b equal the npm package's explicit classes; whitespace is spelled out as JavaScript's \s, because Python's \s also
# takes U+001C..U+001F and U+0085 and leaves out U+FEFF, which would split or join matches differently from npm.
import re
from typing import List, Tuple

from ._types import Span

_WS = "\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"  # ECMAScript \s
NS = f"[^{_WS}]"

_EMAIL_LOCAL = r"[\w.+-]+"
_EMAIL_DOMAIN = r"@[\w-]+(?:\.[\w-]+)+"
_EMAIL = re.compile(_EMAIL_LOCAL + _EMAIL_DOMAIN)
# The EMAIL rule as regex_spans runs it: the domain is optional, so a run of local-part characters without an address
# after it is consumed as one match (and dropped) instead of being tried again from each of its characters, which took
# time quadratic in the length of the run. The matches with a domain are exactly those of _EMAIL: an address starts where
# its run of local-part characters starts (or where the previous match ended) in both.
_EMAIL_LINEAR = re.compile(f"{_EMAIL_LOCAL}({_EMAIL_DOMAIN})?")

REGEX_RULES: List[Tuple[str, "re.Pattern[str]"]] = [
    ("EMAIL", _EMAIL),
    ("URL", re.compile(rf"https?://{NS}+|www\.{NS}+")),
    ("ID_NUMBER", re.compile(rf"\b\d{{6}}[-{_WS}]?[1-8]\d{{6}}\b")),
    ("FINANCIAL", re.compile(rf"\b(?:\d{{4}}[-{_WS}]?){{3}}\d{{4}}\b|\b\d{{2,6}}-\d{{2,6}}-\d{{2,8}}(?:-\d{{1,3}})?\b")),
    ("PHONE", re.compile(rf"(?:\+\d{{1,3}}[-{_WS}]?)?\(?\d{{2,4}}\)?[{_WS}.-]?\d{{3,4}}[{_WS}.-]?\d{{4}}\b")),
]


def _ranges(text: str, pattern: "re.Pattern[str]") -> List[Tuple[int, int]]:
    """Matches of one rule as (start, end) pairs, in text order."""
    if pattern is _EMAIL:
        return [m.span() for m in _EMAIL_LINEAR.finditer(text) if m.group(1) is not None]
    return [m.span() for m in pattern.finditer(text)]


def regex_spans(text: str) -> List[Span]:
    """Pattern matches in rule order; a match that overlaps an earlier rule's match is skipped."""
    out: List[Span] = []
    # the spans accepted so far in text order (they never overlap), so each rule checks its matches against them in one
    # pass instead of comparing every match with every earlier span
    taken: List[Span] = []
    for label, pattern in REGEX_RULES:
        added: List[Span] = []
        i = 0
        for start, end in _ranges(text, pattern):
            while i < len(taken) and taken[i].end <= start:
                i += 1
            if i < len(taken) and taken[i].start < end:
                continue
            added.append(Span(start, end, label, "regex"))
        if not added:
            continue
        out.extend(added)
        merged: List[Span] = []
        a = b = 0
        while a < len(taken) or b < len(added):
            if b >= len(added) or (a < len(taken) and taken[a].start < added[b].start):
                merged.append(taken[a])
                a += 1
            else:
                merged.append(added[b])
                b += 1
        taken = merged
    return out
