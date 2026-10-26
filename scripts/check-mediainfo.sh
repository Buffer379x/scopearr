#!/bin/sh
# Optional CI smoke test, executed inside the production runtime container.
set -eu
branch="v$(cut -d. -f1,2 /etc/alpine-release)"
root=/data/tools/mediainfo/root-smoke
base=/data/tools/mediainfo
mkdir -p "$base/cache" "$base/home" "$base/tmp"
apk add --root "$root" --initdb --usermode --no-scripts --no-interactive \
  --keys-dir /etc/apk/keys \
  --repository "https://dl-cdn.alpinelinux.org/alpine/$branch/main" \
  --repository "https://dl-cdn.alpinelinux.org/alpine/$branch/community" \
  --cache-dir "$base/cache" mediainfo
case "$(uname -m)" in x86_64) loader=x86_64;; aarch64) loader=aarch64;; *) exit 1;; esac
run() {
  env -i HOME="$base/home" TMPDIR="$base/tmp" LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    "$root/lib/ld-musl-$loader.so.1" --library-path "$root/usr/lib:$root/lib" \
    "$root/usr/bin/mediainfo" "$@"
}
run --Version
run --Output=JSON --Full /fixture.wav > /data/mediainfo.json
grep -Eq '"@type"[[:space:]]*:[[:space:]]*"General"' /data/mediainfo.json
grep -Eq '"@type"[[:space:]]*:[[:space:]]*"Audio"' /data/mediainfo.json
grep -Eq '"Format"[[:space:]]*:[[:space:]]*"PCM"' /data/mediainfo.json
du -sk "$root"
rm -rf "$root"
test ! -e "$root/usr/bin/mediainfo"
cat /sys/fs/cgroup/memory.peak
