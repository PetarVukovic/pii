//! Model sizes, the published files (pinned sizes and SHA-256) and where they are read from.
use std::env;
use std::ffi::{CStr, CString};
use std::fmt;
use std::os::raw::c_void;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use crate::ffi;
use crate::types::{Error, Result};

/// The release of the models this crate runs (the Hugging Face tag `v<MODEL_VERSION>`).
pub const MODEL_VERSION: &str = "1.1.0";

/// Model size: `Nano` 2.6 MB, `Small` 7.1 MB, `Medium` 11.3 MB (default), `Large` 15.5 MB. Larger models miss less.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Size {
    Nano,
    Small,
    #[default]
    Medium,
    Large,
}

impl Size {
    pub const ALL: [Size; 4] = [Size::Nano, Size::Small, Size::Medium, Size::Large];

    /// `"nano"`, `"small"`, `"medium"` or `"large"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Size::Nano => "nano",
            Size::Small => "small",
            Size::Medium => "medium",
            Size::Large => "large",
        }
    }

    /// The variant every package loads by default: `Q4e` for large and medium, `Q4` for small and nano.
    pub fn default_variant(self) -> Variant {
        let size = CString::new(self.as_str()).expect("no NUL");
        // SAFETY: a NUL-terminated string; the result is NULL or a static string.
        let v = unsafe { ffi::pii_default_variant(size.as_ptr()) };
        if !v.is_null() && unsafe { CStr::from_ptr(v) }.to_bytes() == b"q4" {
            Variant::Q4
        } else {
            Variant::Q4e
        }
    }
}

impl fmt::Display for Size {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

impl FromStr for Size {
    type Err = Error;

    fn from_str(s: &str) -> Result<Size> {
        Size::ALL
            .into_iter()
            .find(|v| v.as_str() == s)
            .ok_or_else(|| Error::InvalidOption(format!("unknown size {s:?} (nano, small, medium, large)")))
    }
}

/// Weight format of a model file: `Q4` stores the embeddings in 8 bits, `Q4e` in 4 bits (smaller file).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Variant {
    Q4,
    Q4e,
}

impl Variant {
    /// `"q4"` or `"q4e"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Variant::Q4 => "q4",
            Variant::Q4e => "q4e",
        }
    }
}

impl fmt::Display for Variant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

impl FromStr for Variant {
    type Err = Error;

    fn from_str(s: &str) -> Result<Variant> {
        match s {
            "q4" => Ok(Variant::Q4),
            "q4e" => Ok(Variant::Q4e),
            _ => Err(Error::InvalidOption(format!("unknown variant {s:?} (q4, q4e)"))),
        }
    }
}

/// A published model file: where it is inside the model folder, where to download it, and the size and SHA-256 that
/// every copy is checked against before it is loaded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelFile {
    /// Relative to the model folder: `"onnx/model_q4e.onnx"` or `"tokenizer.web.json"`.
    pub path: &'static str,
    /// On Hugging Face, at the tag of [`MODEL_VERSION`].
    pub url: String,
    pub bytes: u64,
    /// Lower-case hex.
    pub sha256: &'static str,
}

fn pin(size: Size, file: &str) -> ModelFile {
    let s = CString::new(size.as_str()).expect("no NUL");
    let f = CString::new(file).expect("no NUL");
    // SAFETY: NUL-terminated strings; the result points to a static table of the library.
    let p = unsafe { ffi::pii_model_file(s.as_ptr(), f.as_ptr()) };
    assert!(!p.is_null(), "the native core has no pin for {size} {file}");
    // SAFETY: p is not NULL and its strings are static and NUL-terminated ASCII.
    let (path, sha256, bytes) = unsafe {
        let p = &*p;
        (CStr::from_ptr(p.path).to_str().expect("ASCII"), CStr::from_ptr(p.sha256).to_str().expect("ASCII"), p.bytes)
    };
    ModelFile { path, url: format!("https://huggingface.co/newmean-ai/pii-{size}/resolve/v{MODEL_VERSION}/{path}"), bytes, sha256 }
}

/// The two files of a model: the weights of `variant` (the size's default when `None`) and the tokenizer. Download both
/// into one folder, keeping `path`, and pass the folder to [`crate::Builder::model_dir`].
pub fn model_files(size: Size, variant: Option<Variant>) -> [ModelFile; 2] {
    [pin(size, variant.unwrap_or_else(|| size.default_variant()).as_str()), pin(size, "tokenizer")]
}

/// The cache shared with the Python package: `$NEWMEAN_PII_CACHE`, else `$XDG_CACHE_HOME/newmean-pii`, else
/// `~/.cache/newmean-pii`. `None` when no home folder is known.
pub fn default_cache_dir() -> Option<PathBuf> {
    if let Some(dir) = env::var_os("NEWMEAN_PII_CACHE").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    if let Some(xdg) = env::var_os("XDG_CACHE_HOME").map(PathBuf::from).filter(|p| p.is_absolute()) {
        return Some(xdg.join("newmean-pii"));
    }
    let home = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).filter(|v| !v.is_empty())?;
    Some(PathBuf::from(home).join(".cache").join("newmean-pii"))
}

/// The folder of one model inside a cache folder: `<cache>/v1.1.0/pii-<size>`.
pub(crate) fn cached_model_dir(cache: &Path, size: Size) -> PathBuf {
    cache.join(format!("v{MODEL_VERSION}")).join(format!("pii-{size}"))
}

/// `Ok` when `data` has the published size and SHA-256 of the file.
pub(crate) fn verify(data: &[u8], size: Size, file: &str) -> bool {
    let s = CString::new(size.as_str()).expect("no NUL");
    let f = CString::new(file).expect("no NUL");
    // SAFETY: data is valid for data.len() bytes; the strings are NUL-terminated.
    unsafe { ffi::pii_verify_file(data.as_ptr() as *const c_void, data.len(), s.as_ptr(), f.as_ptr()) == ffi::PII_OK }
}

/// Reads one file of a model folder and checks it against its pin.
pub(crate) fn read_verified(dir: &Path, size: Size, file: &str) -> Result<(Vec<u8>, PathBuf)> {
    let pin = pin(size, file);
    let path = dir.join(pin.path);
    let data = std::fs::read(&path).map_err(|e| Error::ModelFile {
        path: Some(path.clone()),
        message: format!("cannot read the model file ({e}); download {} ({} bytes) to this path", pin.url, pin.bytes),
    })?;
    if !verify(&data, size, file) {
        return Err(Error::ModelFile {
            path: Some(path),
            message: format!("does not match the published {size} {file} file (size or SHA-256 differs); download {} again", pin.url),
        });
    }
    Ok((data, path))
}

/// SHA-256 of `data` in lower-case hex (the hash the model files are pinned by).
pub fn sha256_hex(data: &[u8]) -> String {
    let mut out = [0 as std::os::raw::c_char; 65];
    // SAFETY: out holds 65 bytes, as the function requires.
    unsafe { ffi::pii_sha256_hex(data.as_ptr() as *const c_void, data.len(), out.as_mut_ptr()) };
    // SAFETY: the function wrote 64 hex characters and a NUL.
    unsafe { CStr::from_ptr(out.as_ptr()) }.to_string_lossy().into_owned()
}
