#!/bin/sh
# Copies the native core (../native/core: pii.h, LICENSE, NOTICE and src/) into native-core/ for `cargo publish`; build.rs
# uses it when it is there (the crate as downloaded from crates.io). The copy is ignored by git and listed in Cargo.toml's
# `include`; cargo calls those files uncommitted changes, hence --allow-dirty. `--clean` removes it.
#
#   tool/vendor_core.sh && cargo publish --dry-run --allow-dirty && tool/vendor_core.sh --clean
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/../native/core"
dst="$root/native-core"
rm -rf "$dst"
if [ "${1:-}" = "--clean" ]; then
  echo "removed $dst"
  exit 0
fi
[ -f "$src/pii.h" ] || { echo "native core not found at $src" >&2; exit 1; }
mkdir -p "$dst/src"
cp "$src/pii.h" "$src/LICENSE" "$src/NOTICE" "$dst/"
cp "$src"/src/*.c "$src"/src/*.h "$dst/src/"
echo "copied $(find "$dst" -type f | wc -l | tr -d ' ') files to $dst"
