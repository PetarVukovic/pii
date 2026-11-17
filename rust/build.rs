// Compiles the native core (C11, no dependencies) into this crate: native-core/ inside the published crate (copied there
// by tool/vendor_core.sh), ../native/core in the repository. Same flags as native/core/Makefile: -ffp-contract=off (MSVC
// /fp:precise) keeps every multiply and add separate, as in the npm package's WebAssembly engine, so every package gives
// the same spans. Always optimized: the model is far too slow at -O0, also in a debug build of your program.
use std::env;
use std::path::PathBuf;

const SOURCES: [&str; 8] = ["api.c", "engine.c", "onnx.c", "tokenizer.c", "util.c", "sha256.c", "models.c", "lists.c"];
const HEADERS: [&str; 4] = ["internal.h", "simd.h", "unicode_tables.h", "word_tables.h"];

fn main() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vendored = here.join("native-core");
    let core = if vendored.join("pii.h").is_file() { vendored } else { here.join("..").join("native").join("core") };
    if !core.join("pii.h").is_file() {
        panic!("native core not found at {}: build from the repository or from the published crate", core.display());
    }
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", core.join("pii.h").display());
    for f in SOURCES.iter().chain(HEADERS.iter()) {
        println!("cargo:rerun-if-changed={}", core.join("src").join(f).display());
    }

    let mut build = cc::Build::new();
    build.include(&core).include(core.join("src")).opt_level(3).warnings(false);
    for f in SOURCES {
        build.file(core.join("src").join(f));
    }
    if build.get_compiler().is_like_msvc() {
        build.flag("/std:c11").flag("/fp:precise");
    } else {
        for flag in ["-std=c11", "-fno-wrapv", "-ffp-contract=off", "-fno-math-errno", "-fvisibility=hidden"] {
            build.flag(flag);
        }
    }
    build.compile("newmean_pii_core");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-lib=m");
    }
}
