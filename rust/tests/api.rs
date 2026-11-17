// Tests without a model run everywhere. Tests with a model read PII_MODELS (a folder with pii-<size>/tokenizer.web.json and
// pii-<size>/onnx/model_<variant>.onnx, the layout of the Hugging Face repositories) or the cache of the Python package
// (~/.cache/newmean-pii/v1.1.0), and pass without doing anything when the files are not there.
use std::path::PathBuf;
use std::sync::Arc;

use newmean_pii::{
    apply_redaction, apply_redaction_with, default_cache_dir, model_files, sha256_hex, Delimiter, Error, Extracted, Label, ListKind,
    ListReason, Mode, Redactor, Size, Source, Span, TableOptions, Variant, MODEL_VERSION, VERSION,
};

fn model_dir(size: Size) -> Option<PathBuf> {
    let dir = match std::env::var_os("PII_MODELS") {
        Some(root) => PathBuf::from(root).join(format!("pii-{size}")),
        None => default_cache_dir()?.join(format!("v{MODEL_VERSION}")).join(format!("pii-{size}")),
    };
    let files = model_files(size, None);
    if files.iter().all(|f| dir.join(f.path).is_file()) {
        Some(dir)
    } else {
        eprintln!("skipped: no {size} model in {}", dir.display());
        None
    }
}

fn span(start: usize, end: usize, label: Label) -> Span {
    Span { start, end, char_start: start, char_end: end, utf16_start: start, utf16_end: end, label, source: Source::Model }
}

#[test]
fn versions_match_the_core() {
    assert_eq!(VERSION, newmean_pii::core_version());
    assert_eq!(MODEL_VERSION, "1.1.0");
}

#[test]
fn labels_round_trip() {
    for label in Label::ALL {
        assert_eq!(label.as_str().parse::<Label>().unwrap(), label);
    }
    assert_eq!(Label::PersonL2.family(), Label::Person);
    assert_eq!(Label::UrlL2.key(), "url");
    assert_eq!(Label::IdNumber.key(), "id_number");
    assert_eq!(Label::LEVEL1.len(), 11);
    assert!(matches!("person".parse::<Label>(), Err(Error::InvalidOption(_))));
    assert_eq!("large".parse::<Size>().unwrap(), Size::Large);
    assert_eq!("q4".parse::<Variant>().unwrap(), Variant::Q4);
}

#[test]
fn model_files_are_pinned() {
    assert_eq!(Size::Medium.default_variant(), Variant::Q4e);
    assert_eq!(Size::Large.default_variant(), Variant::Q4e);
    assert_eq!(Size::Small.default_variant(), Variant::Q4);
    assert_eq!(Size::Nano.default_variant(), Variant::Q4);
    let [model, tokenizer] = model_files(Size::Medium, None);
    assert_eq!(model.path, "onnx/model_q4e.onnx");
    assert_eq!(model.url, "https://huggingface.co/newmean-ai/pii-medium/resolve/v1.1.0/onnx/model_q4e.onnx");
    assert_eq!(tokenizer.path, "tokenizer.web.json");
    assert_eq!(model.sha256.len(), 64);
    assert!(model.bytes > 1_000_000);
    assert_eq!(model_files(Size::Medium, Some(Variant::Q4))[0].path, "onnx/model_q4.onnx");
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

#[test]
fn redaction_modes() {
    let text = "메일 a@b.kr 이름 김민지";
    let email = text.find("a@b.kr").unwrap();
    let name = text.find("김민지").unwrap();
    let spans = vec![span(email, email + 6, Label::Email), span(name, name + "김민지".len(), Label::PersonL2)];
    assert_eq!(apply_redaction(text, &spans, Mode::Tag), "메일 [EMAIL] 이름 [PERSON]");
    assert_eq!(apply_redaction(text, &spans, Mode::Mask), "메일 ****** 이름 ***");
    assert_eq!(apply_redaction(text, &spans, Mode::MaskWith('#')), "메일 ###### 이름 ###");
    assert_eq!(apply_redaction(text, &spans, Mode::Blank), "메일  이름 ");
    assert_eq!(apply_redaction_with(text, &spans, |s, o| format!("<{}:{}>", s.label, o.chars().count())), "메일 <EMAIL:6> 이름 <PERSON_L2:3>");
    // spans that do not fit the text (out of range, inside a character, overlapping) are skipped, never a panic
    let bad = vec![span(1, 2, Label::Email), span(email, email + 6, Label::Email), span(email + 1, email + 3, Label::Email), span(500, 600, Label::Url)];
    assert_eq!(apply_redaction(text, &bad, Mode::Tag), "메일 [EMAIL] 이름 김민지");
    assert_eq!(apply_redaction("", &[], Mode::Tag), "");
}

#[test]
fn extraction_groups_by_family() {
    let text = "Kim, Dr. Lee, Kim \"q\"\n";
    let spans = vec![span(0, 3, Label::Person), span(5, 12, Label::PersonL2), span(14, 17, Label::Person), span(18, 22, Label::Username)];
    let found = Extracted::new(text, spans);
    assert_eq!(found.len(), 4);
    assert_eq!(found.get(Label::Person), vec!["Kim", "Dr. Lee"]);
    assert_eq!(found.get(Label::PersonL2), vec!["Kim", "Dr. Lee"]);
    assert_eq!(found.first(Label::Username), Some("\"q\"\n"));
    assert_eq!(found.first(Label::Email), None);
    assert_eq!(found.to_json(), r#"{"person":["Kim","Dr. Lee"],"username":["\"q\"\n"]}"#);
    assert_eq!(found.to_map().keys().copied().collect::<Vec<_>>(), vec!["person", "username"]);
    assert_eq!(found.entities()[1].label, Label::PersonL2);
    assert_eq!(Extracted::new(text, vec![]).to_json(), "{}");
    assert!(Extracted::default().is_empty());
}

#[test]
fn bad_options_fail_before_any_model_file_is_read() {
    let nowhere = "/nonexistent/newmean-pii";
    let e = Redactor::builder().model_dir(nowhere).block("", Label::Person).build().unwrap_err();
    assert!(matches!(e, Error::List(l) if l.list == ListKind::Block && l.index == 0 && l.reason == ListReason::Empty), "{e}");
    let e = Redactor::builder().model_dir(nowhere).allow("ok").allow(" edge").build().unwrap_err();
    assert!(matches!(e, Error::List(l) if l.list == ListKind::Allow && l.index == 1 && l.reason == ListReason::EdgeSpace), "{e}");
    let e = Redactor::builder().model_dir(nowhere).allow("Kim").block("kim", Label::Person).build().unwrap_err();
    assert!(matches!(e, Error::List(l) if l.reason == ListReason::InBoth), "{e}");
    assert_eq!(e.to_string(), "invalid block entry at index 0: in_both");
    let e = Redactor::builder().model_dir(nowhere).sensitivity(f64::NAN).build().unwrap_err();
    assert!(matches!(e, Error::InvalidOption(_)), "{e}");
    let e = Redactor::builder().model_dir(nowhere).build().unwrap_err();
    assert!(matches!(&e, Error::ModelFile { path: Some(_), .. }), "{e}");
    assert!(e.to_string().contains("https://huggingface.co/newmean-ai/pii-medium/resolve/v1.1.0/tokenizer.web.json"), "{e}");
    let e = Redactor::builder().build_from_bytes(b"not a model", b"{}").unwrap_err();
    assert!(matches!(e, Error::ModelFile { path: None, .. }), "{e}");
}

#[test]
fn detect_redact_extract() {
    let Some(dir) = model_dir(Size::Medium) else { return };
    let redactor = Redactor::from_dir(&dir).unwrap();
    let text = "안녕하세요 이준호입니다 제 이메일은 joon@example.com입니다";
    let spans = redactor.detect(text).unwrap();
    assert_eq!(spans.len(), 2, "{spans:?}");
    assert_eq!((spans[0].label, spans[0].text(text), spans[0].source), (Label::Person, "이준호", Source::Model));
    assert_eq!((spans[1].label, spans[1].text(text)), (Label::Email, "joon@example.com"));
    // the three offset units describe the same span
    assert_eq!(text.chars().skip(spans[0].char_start).take(spans[0].char_end - spans[0].char_start).collect::<String>(), "이준호");
    let utf16: Vec<u16> = text.encode_utf16().collect();
    assert_eq!(String::from_utf16(&utf16[spans[1].utf16_start..spans[1].utf16_end]).unwrap(), "joon@example.com");

    let masked = redactor.redact(text, Mode::Tag).unwrap();
    assert_eq!(masked.text, "안녕하세요 [PERSON]입니다 제 이메일은 [EMAIL]입니다");
    assert_eq!(masked.spans, spans);
    assert_eq!(redactor.redact(text, Mode::Mask).unwrap().text, "안녕하세요 ***입니다 제 이메일은 ****************입니다");
    assert_eq!(redactor.redact_with(text, |s, _| format!("<{}>", s.label.key())).unwrap().text, "안녕하세요 <person>입니다 제 이메일은 <email>입니다");

    let found = redactor.extract(text).unwrap();
    assert_eq!(found.first(Label::Person), Some("이준호"));
    assert_eq!(found.get(Label::Email), vec!["joon@example.com"]);
    assert_eq!(found.to_json(), r#"{"person":["이준호"],"email":["joon@example.com"]}"#);

    assert!(redactor.detect("").unwrap().is_empty());
    assert!(redactor.extract("오늘 날씨가 좋네요.").unwrap().is_empty());
}

#[test]
fn labels_lists_and_sensitivity() {
    let Some(dir) = model_dir(Size::Medium) else { return };
    let text = "김민지 고객님, 010-2345-6789로 연락드리겠습니다. 메일은 minji.kim@example.com 입니다.";
    let only = Redactor::builder().model_dir(&dir).labels([Label::Person, Label::Phone]).build().unwrap();
    assert_eq!(only.labels(), vec![Label::Person, Label::Phone]);
    assert_eq!(only.redact(text, Mode::Tag).unwrap().text, "[PERSON] 고객님, [PHONE]로 연락드리겠습니다. 메일은 minji.kim@example.com 입니다.");

    let listed = Redactor::builder().model_dir(&dir).allow("김민지").block("고객님", Label::Org).build().unwrap();
    let spans = listed.detect(text).unwrap();
    assert!(spans.iter().all(|s| s.text(text) != "김민지"), "{spans:?}");
    assert!(spans.iter().any(|s| s.text(text) == "고객님" && s.label == Label::Org && s.source == Source::Block), "{spans:?}");
    let info = listed.info();
    assert_eq!((info.allow, info.block, info.size, info.variant), (1, 1, Size::Medium, Variant::Q4e));
    assert_eq!(info.package_version, VERSION);
    assert!(info.model_path.unwrap().ends_with("onnx/model_q4e.onnx"));
    assert!(info.hidden > 0 && info.max_tokens >= 256, "{} {}", info.hidden, info.max_tokens);

    let mut r = Redactor::from_dir(&dir).unwrap();
    assert!(r.set_sensitivity(f64::INFINITY).is_err());
    assert_eq!(r.sensitivity(), 0.0);
    r.set_sensitivity(-0.5).unwrap();
    assert_eq!(r.sensitivity(), -0.5);
    assert!(r.detect(text).is_ok());
}

#[test]
fn table_mode_keeps_the_table() {
    let Some(dir) = model_dir(Size::Medium) else { return };
    let redactor = Redactor::from_dir(&dir).unwrap();
    let csv = "name,email,plan\nKim Minsu,kim@example.com,Pro\nLee Jiwon,lee@example.com,Free";
    let out = redactor.redact_table(csv, Mode::Tag, &TableOptions::default()).unwrap();
    assert_eq!(out.text, "name,email,plan\n[PERSON],[EMAIL],Pro\n[PERSON],[EMAIL],Free");
    let tsv = csv.replace(',', "\t");
    let options = TableOptions { delimiter: Delimiter::Tab, vote: false, ..TableOptions::default() };
    let spans = redactor.detect_table(&tsv, &options).unwrap();
    assert!(spans.iter().all(|s| !s.text(&tsv).contains('\t') && !s.text(&tsv).contains('\n')), "{spans:?}");
}

#[test]
fn tokens_cover_the_text() {
    let Some(dir) = model_dir(Size::Nano) else { return };
    let redactor = Redactor::builder().size(Size::Nano).model_dir(&dir).build().unwrap();
    let text = "김민지 고객님 hello 👋";
    let tokens = redactor.tokenize(text).unwrap();
    assert!(!tokens.is_empty());
    // a word-start marker and the piece after it may share one range, so starts only never go back
    assert!(tokens.windows(2).all(|w| w[0].start <= w[1].start));
    assert!(tokens.iter().all(|t| text.get(t.start..t.end).is_some()));
    assert_eq!(redactor.size(), Size::Nano);
    assert_eq!(redactor.variant(), Variant::Q4);
}

#[test]
fn bytes_and_threads() {
    let Some(dir) = model_dir(Size::Nano) else { return };
    let [model, tokenizer] = model_files(Size::Nano, None);
    let onnx = std::fs::read(dir.join(model.path)).unwrap();
    let tok = std::fs::read(dir.join(tokenizer.path)).unwrap();
    assert_eq!(sha256_hex(&onnx), model.sha256);
    // the files of another size are refused
    assert!(matches!(Redactor::builder().size(Size::Small).build_from_bytes(&onnx, &tok), Err(Error::ModelFile { .. })));
    let redactor = Arc::new(Redactor::builder().size(Size::Nano).build_from_bytes(&onnx, &tok).unwrap());
    assert!(redactor.info().model_path.is_none());
    let text = "Contact Maria Lopez at maria.lopez@example.com or +1 415 555 0142.";
    let expected = redactor.detect(text).unwrap();
    assert!(expected.iter().any(|s| s.label == Label::Email && s.text(text) == "maria.lopez@example.com"), "{expected:?}");
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let r = Arc::clone(&redactor);
            let want = expected.clone();
            std::thread::spawn(move || (0..5).all(|_| r.detect(text).unwrap() == want))
        })
        .collect();
    assert!(handles.into_iter().all(|h| h.join().unwrap()));
}
