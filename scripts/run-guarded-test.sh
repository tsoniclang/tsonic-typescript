#!/usr/bin/env bash
set -euo pipefail

root="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
cd "$root"

if [[ $# -lt 1 ]]; then
  echo "usage: npm run test:guarded -- dist/path/to/file.test.js [node test options]" >&2
  exit 64
fi

test_file="$1"
shift
if [[ "$test_file" != dist/*.test.js || ! -f "$test_file" ]]; then
  echo "guarded test requires one built dist/**/*.test.js file" >&2
  exit 64
fi
for argument in "$@"; do
  if [[ "$argument" == *.test.js ]]; then
    echo "guarded test accepts exactly one test file" >&2
    exit 64
  fi
done

for utility in awk date env flock mkdir node systemd-run tail time timeout; do
  if ! command -v "$utility" >/dev/null 2>&1; then
    echo "guarded test requires '$utility'" >&2
    exit 69
  fi
done

mkdir -p .temp
exec 9>.temp/guarded-test.lock
if ! flock -n 9; then
  echo "another guarded checker test is already running" >&2
  exit 75
fi

memory_max="${TSONIC_TS_TEST_MEMORY_MAX:-2G}"
minimum_available_kib="${TSONIC_TS_TEST_MIN_AVAILABLE_KIB:-4194304}"
timeout_value="${TSONIC_TS_TEST_TIMEOUT:-5m}"
old_space_mib="${TSONIC_TS_TEST_OLD_SPACE_MIB:-1024}"
available_kib="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
if [[ -z "$available_kib" || "$available_kib" -lt "$minimum_available_kib" ]]; then
  echo "insufficient available memory: ${available_kib:-unknown} KiB" >&2
  exit 75
fi

node_bin="$(command -v node)"
env_bin="$(type -P env)"
time_bin="$(type -P time)"
timeout_bin="$(type -P timeout)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
record=".temp/guarded-test-$run_id"
printf 'test_file=%q\n' "$test_file" >"$record.started"

set +e
systemd-run --user --scope --quiet \
  --unit "tsonic-typescript-test-$run_id" \
  -p "MemoryMax=$memory_max" \
  -p MemorySwapMax=0 \
  -p OOMPolicy=kill \
  "$time_bin" --verbose --output "$record.time" \
  "$timeout_bin" --signal=TERM --kill-after=10s "$timeout_value" \
  "$env_bin" NODE_OPTIONS="--max-old-space-size=$old_space_mib" \
  "$node_bin" --preserve-symlinks --test --test-concurrency=1 \
  "$@" "$test_file" >"$record.log" 2>&1
status=$?
set -e

printf 'exit_status=%s\n' "$status" >"$record.finished"
tail -n 40 "$record.log"
if [[ -s "$record.time" ]]; then
  tail -n 24 "$record.time"
fi
exit "$status"
