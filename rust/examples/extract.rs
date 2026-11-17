// Masks and extracts the personal information in a text.
//
//   cargo run --release --example extract -- <model folder> "안녕하세요 이준호입니다 제 이메일은 joon@example.com입니다"
//
// The model folder holds tokenizer.web.json and onnx/model_q4e.onnx of newmean-ai/pii-medium (see the README).
use newmean_pii::{Mode, Redactor};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let (Some(dir), Some(text)) = (args.next(), args.next()) else {
        eprintln!("usage: extract <model folder> <text>");
        std::process::exit(2);
    };
    let redactor = Redactor::from_dir(dir)?;
    println!("{}", redactor.redact(&text, Mode::Tag)?.text);
    let found = redactor.extract(&text)?;
    for e in found.entities() {
        println!("{:<14} {:>4}..{:<4} {}", e.label, e.span.start, e.span.end, e.text);
    }
    println!("{}", found.to_json());
    Ok(())
}
