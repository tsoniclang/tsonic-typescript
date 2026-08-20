#!/usr/bin/env bash
set -euo pipefail

root="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
cd "$root"

if [[ $# -ne 0 ]]; then
  echo "usage: scripts/run-guarded-suite.sh" >&2
  exit 64
fi

for utility in date find flock mkdir sort; do
  if ! command -v "$utility" >/dev/null 2>&1; then
    echo "guarded suite requires '$utility'" >&2
    exit 69
  fi
done

mkdir -p .temp
exec 8>.temp/guarded-suite.lock
if ! flock -n 8; then
  echo "another guarded suite is already running" >&2
  exit 75
fi

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
record=".temp/guarded-suite-$run_id"
mkdir -p "$record"
printf '%s\n' "$record" >.temp/latest-guarded-suite
find dist -type f -name '*.test.js' -print | sort >"$record/tests.list"
if [[ ! -s "$record/tests.list" ]]; then
  echo "guarded suite found no built test files" >&2
  exit 66
fi

passed=0
failed=0
total=0
set +e
while IFS= read -r test_file; do
  total=$((total + 1))
  printf -v index '%03d' "$total"
  printf '%s\n' "$test_file" >"$record/$index.test"
  if bash scripts/run-guarded-test.sh "$test_file" >"$record/$index.output" 2>&1; then
    passed=$((passed + 1))
    printf 'PASS %s %s\n' "$index" "$test_file"
  else
    failed=$((failed + 1))
    printf 'FAIL %s %s\n' "$index" "$test_file"
  fi
done <"$record/tests.list"
set -e

printf 'passed=%s\nfailed=%s\ntotal=%s\n' "$passed" "$failed" "$total" |
  tee "$record/summary.txt"
if [[ "$failed" -ne 0 ]]; then
  echo "complete failure logs: $record" >&2
  exit 1
fi
