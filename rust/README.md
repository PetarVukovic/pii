English | [한국어](README.ko.md)

# newmean-pii (Rust)

On-device detection, masking and extraction of personal information in 54 languages. The models are small (2.6 to
15.5 MB) and run inside your process on the CPU: no service, no API key. The crate compiles the same C core as the
[Python, Swift, Android and Flutter packages](https://github.com/newmean-ai/pii) and gives the same spans; it has no
dependencies (a C compiler is needed at build time).

```toml
[dependencies]
newmean-pii = "1.6"
```

```rust
use newmean_pii::{Label, Mode, Redactor};

let redactor = Redactor::builder().model_dir("models/pii-medium").build()?;

let text = "안녕하세요 이준호입니다 제 이메일은 joon@example.com입니다";
redactor.redact(text, Mode::Tag)?.text;
// "안녕하세요 [PERSON]입니다 제 이메일은 [EMAIL]입니다"

let found = redactor.extract(text)?;
found.first(Label::Email);   // Some("joon@example.com")
found.to_json();             // {"person":["이준호"],"email":["joon@example.com"]}
```

No model finds everything: this lowers what leaves your system, it does not guarantee that nothing gets through. The
measured miss rates are in the [repository README](https://github.com/newmean-ai/pii#readme).

## Model files

The crate never downloads. Fetch the two files of a model once and keep their layout:

```sh
base=https://huggingface.co/newmean-ai/pii-medium/resolve/v1.1.0
mkdir -p models/pii-medium/onnx
curl -L -o models/pii-medium/tokenizer.web.json $base/tokenizer.web.json
curl -L -o models/pii-medium/onnx/model_q4e.onnx $base/onnx/model_q4e.onnx
```

`model_files(size, variant)` gives the URL, size and SHA-256 of each file. Every file is checked against its published
size and SHA-256 before it is loaded, so a damaged or replaced file is an error, not a different model.

| Size | Weights | File |
|---|---|---|
| `Size::Nano` | 2.6 MB | `onnx/model_q4.onnx` |
| `Size::Small` | 7.1 MB | `onnx/model_q4.onnx` |
| `Size::Medium` (default) | 11.3 MB | `onnx/model_q4e.onnx` |
| `Size::Large` | 15.5 MB | `onnx/model_q4e.onnx` |

Plus a 0.8 MB tokenizer. Larger models miss less. Other ways to give the files:

- `Builder::build()` without `model_dir` reads the cache of the Python package (`$NEWMEAN_PII_CACHE`,
  `$XDG_CACHE_HOME/newmean-pii` or `~/.cache/newmean-pii`), which `python -m newmean_pii download --size medium` fills.
- `Builder::build_from_bytes(onnx, tokenizer)` takes the bytes, for `include_bytes!` or your own storage.

## Labels

`Person`, `Email`, `Phone`, `Address`, `IdNumber`, `Financial`, `Org`, `Username`, `Url`, `DateOfBirth`, `Secret`, and two
level 2 labels for indirect identifiers: `PersonL2` (a surname with a title, a nickname, initials) and `UrlL2` (public
profile or page URLs). `Label::as_str()` gives the names the other packages use (`"PERSON"`, `"ID_NUMBER"`).

The model knows these labels only. Choose among them with `labels`; values of other kinds go in the block list.

## API

```rust
let redactor = Redactor::builder()
    .size(Size::Medium)                     // Nano | Small | Medium | Large
    .variant(Variant::Q4e)                  // default: Q4e for Large/Medium, Q4 for Small/Nano
    .sensitivity(0.0)                       // > 0 masks more, < 0 masks less (about -1..1)
    .labels([Label::Person, Label::Phone])  // default: all labels; Label::LEVEL1 leaves level 2 visible
    .keep_emoji(false)                      // true: the model also reads emoji
    .whole_words(true)                      // a span that ends inside a word covers the whole word
    .strict_short_names(false)              // true: short texts need stronger evidence to be read as names
    .allow("제주")                           // a value that is not PII in your data (any label)
    .allow_label("경기", Label::Person)      // ... for one label family only
    .block("새솔고등학교", Label::Org)         // a value that is PII in your data, masked wherever it occurs
    .model_dir("models/pii-medium")         // or .cache_dir(...), or build_from_bytes
    .build()?;

redactor.detect(text)?;                     // Vec<Span>, sorted, non-overlapping
redactor.redact(text, Mode::Tag)?;          // Redacted { text, spans }; Tag -> [EMAIL], Mask -> ****, MaskWith('#'), Blank
redactor.redact_with(text, |span, original| format!("<{}>", span.label.key()))?;
redactor.extract(text)?;                    // Extracted: values grouped by label
redactor.detect_table(csv, &TableOptions::default())?;
redactor.redact_table(csv, Mode::Tag, &TableOptions::default())?;
redactor.tokenize(text)?;                   // Vec<Token>
redactor.set_sensitivity(0.5)?;             // needs &mut; no reload
redactor.info();                            // versions, model files, kernel build, list sizes

apply_redaction(text, &spans, Mode::Tag);   // redact spans you filtered yourself
Extracted::new(text, spans);                // extract from spans you filtered yourself
```

- **Offsets**: `span.start..span.end` are UTF-8 bytes, so `&text[span.start..span.end]` (or `span.text(text)`) is the
  value. Each span also carries `char_start..char_end` (code points, as Python counts) and `utf16_start..utf16_end` (as
  JavaScript, Java and Swift's `NSString` count). Spans never split a grapheme cluster.
- **Sources**: `Source::Model`, `Source::Table` (propagated down a column in table mode) or `Source::Block`.
- **Threads**: `Redactor` is `Send + Sync`. The model is immutable and each call has its own working memory, so calls
  from several threads run in parallel, one core each. Put it in an `Arc` or a `OnceLock` and share it.
- **Build**: the C core is always compiled with `-O3`, also in a debug build of your program.
- **Errors**: `Error::InvalidOption`, `Error::ModelFile` (missing file, or size or SHA-256 differs), `Error::List`
  (which list, index and reason; never the entry's text) and `Error::Core`. Options and lists are checked before any
  model file is read.
- **Lists** follow the rules of the other packages: ASCII letters compare case-insensitively and nothing else is
  normalized (pass NFC text), entries are 1 to 64 code points, at most 10,000 per list. Details:
  [Python README, Lists](https://github.com/newmean-ai/pii/blob/main/python/README.md#lists).
- **Tables**: `TableOptions { delimiter, header, vote, context }` as in the other packages:
  [Python README, Tables](https://github.com/newmean-ai/pii/blob/main/python/README.md#tables).

## Extraction

`extract` returns what was found as data instead of a masked text:

```rust
let found = redactor.extract("Kim Minsu and Lee Jiwon, kim@example.com")?;
found.get(Label::Person);   // ["Kim Minsu", "Lee Jiwon"]
found.first(Label::Email);  // Some("kim@example.com")
found.to_map();             // BTreeMap {"email": [...], "person": [...]}
found.to_json();            // {"person":["Kim Minsu","Lee Jiwon"],"email":["kim@example.com"]}
for e in found.entities() { /* e.label, e.text, e.span, in text order */ }
```

- Values are grouped by label family (`PersonL2` under `person`, `UrlL2` under `url`), distinct, in text order. Keys are
  the label names in lower case (`person`, `email`, `phone`, `address`, `id_number`, `financial`, `org`, `username`, `url`,
  `date_of_birth`, `secret`); map them to your own field names as you need.
- Every group is a list, because a text can hold several values of one label.
- The model tells what a value is, not whose it is: the names of a customer and of an agent are both `person`.
- There is no confidence score per value; `sensitivity` moves the threshold for all of them.

## Not in this crate

The pattern layer of the other packages (`regex: true`, off by default there) and downloading model files.

## Development

```sh
cargo test                  # tests with a model read PII_MODELS or the cache, and pass without doing anything when absent
cargo run --release --example extract -- models/pii-medium "Call Maria Lopez on +1 415 555 0142"
tool/vendor_core.sh && cargo publish --dry-run --allow-dirty && tool/vendor_core.sh --clean
```

In the repository `build.rs` compiles `../native/core`; the published crate carries a copy in `native-core/`.

## License

Apache-2.0 (code and models). See [LICENSE](LICENSE) and [NOTICE](NOTICE).
