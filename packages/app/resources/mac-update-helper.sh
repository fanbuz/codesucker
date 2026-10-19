#!/bin/sh
set -eu
old_pid=$1
target=$2
staged=$3
work=$4
version=$5
user_data=$6
backup="$work/previous.app"
printf ready > "$work/helper-ready"

report_failure() {
  printf '%s\n' '上次更新安装未完成，已保留原版本。请重新下载更新。' > "$user_data/update-install-error.txt" || true
}

count=0
while kill -0 "$old_pid" 2>/dev/null; do
  count=$((count + 1))
  if [ "$count" -ge 120 ]; then exit 1; fi
  sleep 0.25
done

if ! mv "$target" "$backup"; then
  report_failure
  "$target/Contents/MacOS/CodeSucker" --user-data-dir="$user_data" >/dev/null 2>&1 &
  exit 1
fi
if ! mv "$staged" "$target"; then
  mv "$backup" "$target"
  report_failure
  "$target/Contents/MacOS/CodeSucker" --user-data-dir="$user_data" >/dev/null 2>&1 &
  exit 1
fi

"$target/Contents/MacOS/CodeSucker" --user-data-dir="$user_data" --codesucker-update-receipt="$work/ready" > "$work/launch.log" 2>&1 &
new_pid=$!
count=0
while kill -0 "$new_pid" 2>/dev/null && [ "$count" -lt 120 ]; do
  if [ -f "$work/ready" ] && [ "$(cat "$work/ready")" = "$version" ]; then
    rm -rf "$work"
    exit 0
  fi
  count=$((count + 1))
  sleep 0.25
done

kill "$new_pid" 2>/dev/null || true
count=0
while kill -0 "$new_pid" 2>/dev/null && [ "$count" -lt 20 ]; do
  count=$((count + 1))
  sleep 0.1
done
kill -9 "$new_pid" 2>/dev/null || true
wait "$new_pid" 2>/dev/null || true
mv "$target" "$work/failed.app"
mv "$backup" "$target"
report_failure
"$target/Contents/MacOS/CodeSucker" --user-data-dir="$user_data" >/dev/null 2>&1 &
exit 1
