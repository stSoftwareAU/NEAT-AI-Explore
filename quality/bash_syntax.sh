#!/usr/bin/env bash
set -euo pipefail

# Bash syntax gate for NEAT-AI Explore (#479).
#
# Bash has no compile step, so an unparseable script can land on the default
# branch unnoticed. This gate runs `bash -n` (a parse-only no-op) over every
# `*.sh` file under a scan root and fails loud when any script has a syntax
# error. CI invokes it on every pull request via `.github/workflows/bash-syntax.yml`.
#
# Usage:
#   quality/bash_syntax.sh [ROOT]
#     ROOT   Directory to scan. Defaults to the repository root (the parent of
#            this script's directory).
#
# Exit status:
#   0  every discovered script parses cleanly (or none were found)
#   1  a script failed to parse, or the scan root does not exist

# Resolve the directory to scan: an explicit first argument, else the repo root.
if [[ $# -gt 0 ]]; then
  ROOT_DIR="$1"
else
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "bash_syntax: scan root not found: $ROOT_DIR" >&2
  exit 1
fi

echo "==> bash -n syntax gate over: $ROOT_DIR"

# Collect every *.sh file, pruning vendored and VCS directories. -print0 / a
# null-delimited read keeps paths with spaces or newlines safe.
scripts=()
while IFS= read -r -d '' file; do
  scripts+=("$file")
done < <(
  find "$ROOT_DIR" \
    \( -path '*/node_modules' -o -path '*/.git' -o -path '*/vendor' \) -prune \
    -o -type f -name '*.sh' -print0
)

# bash 3.2 treats ${arr[@]} on an empty array as an unbound-variable error
# under `set -u`; guard the count before expanding.
if [[ ${#scripts[@]} -eq 0 ]]; then
  echo "bash_syntax: no *.sh scripts found under $ROOT_DIR — nothing to check"
  exit 0
fi

failed=0
for file in "${scripts[@]}"; do
  if bash -n "$file"; then
    echo "  ok   $file"
  else
    echo "  FAIL $file" >&2
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "==> bash syntax gate FAILED" >&2
  exit 1
fi

echo "==> bash syntax gate passed (${#scripts[@]} script(s))"
