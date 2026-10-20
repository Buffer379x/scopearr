#!/bin/sh
# Optional CI smoke test, executed inside the production runtime container.
set -eu
branch="v$(cut -d. -f1,2 /etc/alpine-release)"
root=/data/tools/mkvtoolnix/root-smoke
base=/data/tools/mkvtoolnix
mkdir -p "$base/cache" "$base/home" "$base/tmp"
apk add --root "$root" --initdb --usermode --no-scripts --no-interactive \
  --keys-dir /etc/apk/keys \
  --repository "https://dl-cdn.alpinelinux.org/alpine/$branch/main" \
  --repository "https://dl-cdn.alpinelinux.org/alpine/$branch/community" \
  --cache-dir "$base/cache" mkvtoolnix
case "$(uname -m)" in x86_64) loader=x86_64;; aarch64) loader=aarch64;; *) exit 1;; esac
run() {
  env -i HOME="$base/home" TMPDIR="$base/tmp" LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    "$root/lib/ld-musl-$loader.so.1" --library-path "$root/usr/lib:$root/lib" \
    "$root/usr/bin/mkvmerge" --ui-language en_US "$@"
}
run --version
run -o /data/source.mkv --language 0:en /fixture.wav --language 0:de /fixture.wav
run --gui-mode -o /data/output.mkv --audio-tracks 0 /data/source.mkv
run -J /data/output.mkv > /data/output.json
test "$(grep -c '"type": "audio"' /data/output.json)" = 1
du -sk "$root"
cat /sys/fs/cgroup/memory.peak
