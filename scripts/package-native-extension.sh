#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: $0 <source-directory> <extension-id> <version> <host-effects-cid> <output-archive>" >&2
  exit 64
fi

source_directory=$1
extension_id=$2
extension_version=$3
host_effects_cid=$4
output_archive=$5

[[ $extension_id =~ ^[a-z][a-z0-9-]*$ ]] || { echo "invalid extension id: $extension_id" >&2; exit 65; }
[[ $extension_version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || { echo "invalid extension version: $extension_version" >&2; exit 65; }
[[ $host_effects_cid =~ ^radix-host-effects@[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || { echo "invalid host-effects CID: $host_effects_cid" >&2; exit 65; }
[[ -d $source_directory ]] || { echo "missing extension source directory: $source_directory" >&2; exit 66; }

manifest_path="$source_directory/radix-extension.json"
bundle_path="$source_directory/bundle.js"
[[ -f $manifest_path ]] || { echo "missing native extension manifest: $manifest_path" >&2; exit 66; }
[[ -f $bundle_path ]] || { echo "missing native extension bundle: $bundle_path" >&2; exit 66; }

python3 - "$manifest_path" "$extension_id" "$extension_version" "$host_effects_cid" <<'PYTHON'
import json
import sys

manifest_path, extension_id, version, host_effects_cid = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
if (
    manifest.get("extension_id") != extension_id
    or manifest.get("version") != version
    or manifest.get("host_effects_cid") != host_effects_cid
    or manifest.get("entrypoint") != "bundle.js"
):
    raise SystemExit(f"manifest does not exactly match the promoted release: {manifest_path}")
PYTHON

output_directory=$(dirname "$output_archive")
mkdir -p "$output_directory"
file_list=$(mktemp)
trap 'rm -f "$file_list"' EXIT

(
  cd "$source_directory"
  find . -type f \
    ! -path './.git/*' \
    ! -path './node_modules/*' \
    ! -path './dist/*' \
    ! -name '.DS_Store' \
    -printf '%P\0' | LC_ALL=C sort -z > "$file_list"
)

[[ -s $file_list ]] || { echo "native extension contains no publishable files" >&2; exit 66; }
tar --create \
  --file - \
  --format=posix \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --pax-option=delete=atime,delete=ctime \
  --no-recursion \
  --directory "$source_directory" \
  --null \
  --files-from "$file_list" | gzip -n > "$output_archive"

tar --list --gzip --file "$output_archive" | grep --fixed-strings --line-regexp 'radix-extension.json' >/dev/null
tar --list --gzip --file "$output_archive" | grep --fixed-strings --line-regexp 'bundle.js' >/dev/null

archive_sha256=$(sha256sum "$output_archive" | awk '{print $1}')
echo "archive_path=$output_archive"
echo "artifact_sha256=$archive_sha256"
