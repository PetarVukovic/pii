//! The values a redactor finds, as structured data.
use std::collections::BTreeMap;
use std::fmt::Write;

use crate::types::{Label, Span};

/// One value found in a text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entity {
    pub label: Label,
    /// The value as it is written in the text.
    pub text: String,
    /// Where it is in the text.
    pub span: Span,
}

/// The values found in a text ([`crate::Redactor::extract`]), in the order they appear.
///
/// Values are grouped by label family: `PersonL2` values are listed under `Person`, `UrlL2` under `Url`. A text can hold
/// several values of one label (two names), so every group is a list. The model tells what a value is, not whose it is:
/// the names of a customer and of an agent are both `Person`.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Extracted {
    entities: Vec<Entity>,
}

impl Extracted {
    /// From a text and spans found in it (sorted, as [`crate::Redactor::detect`] returns them); spans that do not fit the
    /// text are skipped. Use it to extract from spans you filtered yourself.
    pub fn new(text: &str, spans: Vec<Span>) -> Extracted {
        let entities = spans
            .into_iter()
            .filter_map(|span| text.get(span.start..span.end).map(|t| Entity { label: span.label, text: t.to_owned(), span }))
            .collect();
        Extracted { entities }
    }

    /// Every value with its exact label and position, in text order.
    pub fn entities(&self) -> &[Entity] {
        &self.entities
    }

    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    /// Number of values found (repeated values count each time).
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    /// The distinct values of a label family in text order: `get(Label::Person)` also gives `PersonL2` values.
    pub fn get(&self, label: Label) -> Vec<&str> {
        let family = label.family();
        let mut out: Vec<&str> = Vec::new();
        for e in &self.entities {
            if e.label.family() == family && !out.contains(&e.text.as_str()) {
                out.push(&e.text);
            }
        }
        out
    }

    /// The first value of a label family, if any.
    pub fn first(&self, label: Label) -> Option<&str> {
        let family = label.family();
        self.entities.iter().find(|e| e.label.family() == family).map(|e| e.text.as_str())
    }

    /// The distinct values by label key ([`Label::key`]: `"person"`, `"email"`, `"id_number"`, ...); labels without values
    /// are left out.
    pub fn to_map(&self) -> BTreeMap<&'static str, Vec<String>> {
        let mut map = BTreeMap::new();
        for label in Label::ALL {
            if label.family() != label {
                continue;
            }
            let values = self.get(label);
            if !values.is_empty() {
                map.insert(label.key(), values.into_iter().map(str::to_owned).collect());
            }
        }
        map
    }

    /// The distinct values as a JSON object, keys in label order: `{"person":["이준호"],"email":["joon@example.com"]}`;
    /// `{}` when nothing was found.
    pub fn to_json(&self) -> String {
        let mut out = String::from("{");
        for label in Label::ALL {
            if label.family() != label {
                continue;
            }
            let values = self.get(label);
            if values.is_empty() {
                continue;
            }
            if out.len() > 1 {
                out.push(',');
            }
            write_json_string(&mut out, label.key());
            out.push_str(":[");
            for (i, v) in values.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json_string(&mut out, v);
            }
            out.push(']');
        }
        out.push('}');
        out
    }
}

fn write_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
