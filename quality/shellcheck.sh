#!/usr/bin/env bash
set -euo pipefail

# ShellCheck gate for NEAT-AI Explore (#480).
#
# Bash has no compile step, so common mistakes — unquoted expansions, undefined
# variables, misused constructs — slip past `bash -n` and land on the default
# branch. This gate runs `shellcheck` over every `*.sh` file under a scan root
# and fails loud when any script trips a finding at or above the configured
# severity. CI invokes it on every pull request via
# `.github/workflows/shellcheck.yml`, and `quality.sh` runs it locally so a
# regression is caught before it reaches a PR.
#
# Usage:
#   quality/shellcheck.sh [ROOT]
#     ROOT   Directory to scan. Defaults to the repository root (the parent of
#            this script's directory).
#
# Environment:
#   SHELLCHECK_SEVERITY  Minimum severity that fails the gate. Defaults to
#                        `warning` (one of: error, warning, info, style).
#
# Exit status:
#   0  every discovered script passes (or none were found)
#   1  a script tripped a finding, the scan root is missing, or `shellcheck`
#      itself is not installed

SEVERITY="${SHELLCHECK_SEVERITY:-warning}"

# Resolve the directory to scan: an explicit first argument, else the repo root.
if [[ $# -gt 0 ]]; then
  ROOT_DIR="$1"
else
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "shellcheck_gate: scan root not found: $ROOT_DIR" >&2
  exit 1
fi

# Fail loud rather than silently passing when the tool is absent — a missing
# linter must never be reconciled as a clean result (#3234).
if ! command -v shellcheck &> /dev/null; then
  echo "shellcheck_gate: shellcheck is not installed — cannot run the gate" >&2
  echo "shellcheck_gate: install it (e.g. 'apt-get install shellcheck' or" >&2
  echo "  'brew install shellcheck') and re-run" >&2
  exit 1
fi

echo "==> shellcheck gate (severity: $SEVERITY) over: $ROOT_DIR"

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
  echo "shellcheck_gate: no *.sh scripts found under $ROOT_DIR — nothing to check"
  exit 0
fi

# Run shellcheck over the full set in one invocation so it exits non-zero if any
# script trips a finding at or above the configured severity.
if shellcheck --severity="$SEVERITY" "${scripts[@]}"; then
  echo "==> shellcheck gate passed (${#scripts[@]} script(s))"
else
  echo "==> shellcheck gate FAILED" >&2
  exit 1
fi
