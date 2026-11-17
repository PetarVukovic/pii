//! Declarations of the native core (pii.h of the same release; the structs are checked against the library's sizes when a
//! redactor is built).
#![allow(non_camel_case_types)]

use std::os::raw::{c_char, c_int, c_void};

pub const PII_OK: c_int = 0;
pub const PII_SOURCE_MODEL: c_int = 1;
pub const PII_SOURCE_TABLE: c_int = 4;
pub const PII_SOURCE_BLOCK: c_int = 8;
pub const PII_LIST_ALLOW: c_int = 0;

#[repr(C)]
pub struct pii_model {
    _private: [u8; 0],
}

#[repr(C)]
pub struct pii_lists {
    _private: [u8; 0],
}

#[repr(C)]
pub struct pii_span {
    pub byte_start: usize,
    pub byte_end: usize,
    pub cp_start: usize,
    pub cp_end: usize,
    pub u16_start: usize,
    pub u16_end: usize,
    pub label: c_int,
    pub label_name: *const c_char,
    pub source: c_int,
}

#[repr(C)]
pub struct pii_token {
    pub id: i32,
    pub byte_start: usize,
    pub byte_end: usize,
    pub cp_start: usize,
    pub cp_end: usize,
    pub u16_start: usize,
    pub u16_end: usize,
}

#[repr(C)]
pub struct pii_extra_span {
    pub start: usize,
    pub end: usize,
    pub label: c_int,
}

#[repr(C)]
pub struct pii_term {
    pub utf8: *const c_char,
    pub len: usize,
    pub label: c_int,
}

#[repr(C)]
pub struct pii_list_error {
    pub list: c_int,
    pub index: usize,
    pub reason: c_int,
}

#[repr(C)]
pub struct pii_options {
    pub struct_size: usize,
    pub sensitivity: f64,
    pub labels: u32,
    pub extra: *const pii_extra_span,
    pub n_extra: usize,
    pub extra_unit: c_int,
    pub keep_emoji: c_int,
    pub whole_words: c_int,
    pub strict_short_names: c_int,
    pub lists: *const pii_lists,
}

#[repr(C)]
pub struct pii_table_options {
    pub struct_size: usize,
    pub delimiter: c_int,
    pub header: c_int,
    pub vote: c_int,
    pub context: c_int,
}

#[repr(C)]
#[derive(Default)]
pub struct pii_model_info {
    pub hidden: c_int,
    pub layers: c_int,
    pub layer_applications: c_int,
    pub vocab: c_int,
    pub max_tokens: c_int,
    pub tags: c_int,
    pub embedding_kind: c_int,
}

#[repr(C)]
pub struct pii_file_pin {
    pub size: *const c_char,
    pub file: *const c_char,
    pub path: *const c_char,
    pub bytes: u64,
    pub sha256: *const c_char,
}

extern "C" {
    pub fn pii_version() -> *const c_char;
    pub fn pii_strerror(code: c_int) -> *const c_char;
    pub fn pii_build_info() -> *const c_char;
    pub fn pii_options_init(options: *mut pii_options);
    pub fn pii_model_load(
        onnx: *const u8,
        onnx_len: usize,
        tokenizer_json: *const u8,
        tokenizer_len: usize,
        err: *mut c_char,
        errlen: usize,
    ) -> *mut pii_model;
    pub fn pii_model_free(model: *mut pii_model);
    pub fn pii_model_get_info(model: *const pii_model, info: *mut pii_model_info);
    pub fn pii_detect(
        model: *const pii_model,
        utf8: *const c_char,
        len: usize,
        options: *const pii_options,
        out: *mut *mut pii_span,
        n_out: *mut usize,
    ) -> c_int;
    pub fn pii_spans_free(spans: *mut pii_span);
    pub fn pii_table_options_init(table: *mut pii_table_options);
    pub fn pii_detect_table(
        model: *const pii_model,
        utf8: *const c_char,
        len: usize,
        options: *const pii_options,
        table: *const pii_table_options,
        out: *mut *mut pii_span,
        n_out: *mut usize,
    ) -> c_int;
    pub fn pii_lists_create(
        allow: *const pii_term,
        n_allow: usize,
        block: *const pii_term,
        n_block: usize,
        out: *mut *mut pii_lists,
        err: *mut pii_list_error,
    ) -> c_int;
    pub fn pii_lists_free(lists: *mut pii_lists);
    pub fn pii_lists_counts(lists: *const pii_lists, n_allow: *mut usize, n_block: *mut usize);
    pub fn pii_options_size() -> usize;
    pub fn pii_table_options_size() -> usize;
    pub fn pii_tokenize(model: *const pii_model, utf8: *const c_char, len: usize, out: *mut *mut pii_token, n_out: *mut usize) -> c_int;
    pub fn pii_tokens_free(tokens: *mut pii_token);
    pub fn pii_model_file(size: *const c_char, file: *const c_char) -> *const pii_file_pin;
    pub fn pii_default_variant(size: *const c_char) -> *const c_char;
    pub fn pii_sha256_hex(data: *const c_void, n: usize, hex_out: *mut c_char);
    pub fn pii_verify_file(data: *const c_void, n: usize, size: *const c_char, file: *const c_char) -> c_int;
}
