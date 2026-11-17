//! Replacing spans in a text.
use crate::types::Span;

/// How a span is replaced.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Mode {
    /// The label family in brackets: `[EMAIL]`; `PersonL2` gives `[PERSON]`, `UrlL2` gives `[URL]`.
    #[default]
    Tag,
    /// One `*` per character (code point).
    Mask,
    /// One of the given character per character (code point).
    MaskWith(char),
    /// Removed.
    Blank,
}

/// A masked text and the spans that were replaced (offsets in the input, not in `text`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Redacted {
    pub text: String,
    pub spans: Vec<Span>,
}

/// Replaces each span of `text` as `mode` says. `spans` must be sorted and non-overlapping, as
/// [`crate::Redactor::detect`] returns them; a span that does not fit `text` is skipped.
pub fn apply_redaction(text: &str, spans: &[Span], mode: Mode) -> String {
    apply_redaction_with(text, spans, |span, original| match mode {
        Mode::Tag => format!("[{}]", span.label.family().as_str()),
        Mode::Mask => "*".repeat(original.chars().count()),
        Mode::MaskWith(c) => std::iter::repeat(c).take(original.chars().count()).collect(),
        Mode::Blank => String::new(),
    })
}

/// Replaces each span of `text` by `replace(span, original)`. `spans` as in [`apply_redaction`].
pub fn apply_redaction_with<F: FnMut(&Span, &str) -> String>(text: &str, spans: &[Span], mut replace: F) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for span in spans {
        if span.start < last || span.end < span.start {
            continue;
        }
        let (Some(before), Some(original)) = (text.get(last..span.start), text.get(span.start..span.end)) else {
            continue;
        };
        out.push_str(before);
        out.push_str(&replace(span, original));
        last = span.end;
    }
    out.push_str(&text[last..]);
    out
}
