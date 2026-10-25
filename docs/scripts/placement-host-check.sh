#!/usr/bin/env bash
# Metadata-only counterpart to Scopearr's top-level placement filters.
set -euo pipefail
placement_share=${1:-}
placement_mode=${2:-several}
placement_root=${3:-/mnt}
if [[ -z "$placement_share" || "$placement_share" == /* || "$placement_share" == */ || "$placement_share" == *//* || "/$placement_share/" == */../* || "/$placement_share/" == */./* || "$placement_share" == *$'\n'* || "$placement_share" == *$'\r'* ]]; then
  echo 'Usage: placement-host-check.sh SHARE several|empty [DISK_ROOT] [explicit Arr dot-folder names ...]' >&2
  exit 2
fi
if [[ "$placement_mode" != several && "$placement_mode" != empty ]]; then
  echo 'Mode must be several or empty' >&2
  exit 2
fi
placement_root=$(readlink -f -- "$placement_root")
placement_hidden=()
if (( $# > 3 )); then placement_hidden=("${@:4}"); fi
placement_parent_device=$(stat -c '%d' "$placement_root")
{
  for placement_device in "$placement_root"/*; do
    placement_device_name=${placement_device##*/}
    case "$placement_device_name" in user|user0|disks|remotes|addons|rootshare|.*) continue;; esac
    [[ "$placement_device_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || continue
    [[ -d "$placement_device" && ! -L "$placement_device" ]] || continue
    [[ $(stat -c '%d' "$placement_device") != "$placement_parent_device" ]] || continue
    placement_path="$placement_device/$placement_share"
    [[ -d "$placement_path" && $(readlink -f -- "$placement_path") == "$placement_path" ]] || continue
    while IFS= read -r -d '' placement_folder; do
      placement_name=${placement_folder##*/}
      case "${placement_name,,}" in '#recycle'|'#snapshot'|'@eadir'|'@recycle'|'@recently-snapshot'|'@tmp'|'@synoresource'|'lost+found'|'.recycle.bin'|.trash-*) continue;; esac
      [[ "$placement_name" != *$'\n'* && "$placement_name" != *$'\r'* ]] || continue
      if [[ "$placement_name" == .* ]]; then
        placement_include=false
        for placement_known in "${placement_hidden[@]}"; do
          if [[ "$placement_name" == "$placement_known" ]]; then placement_include=true; break; fi
        done
        [[ "$placement_include" == true ]] || continue
      fi
      placement_state=empty
      if placement_entry=$(find -P "$placement_folder" -mindepth 1 ! -type d -printf x -quit); then
        if [[ -n "$placement_entry" ]]; then placement_state=content; fi
      else
        placement_state=unreadable
        printf 'Could not inspect %s\n' "$placement_folder" >&2
      fi
      printf '%s\0%s\0%s\0' "$placement_name" "$placement_device_name" "$placement_state"
    done < <(find -P "$placement_path" -mindepth 1 -maxdepth 1 -type d -print0)
  done
} | awk -v RS='\0' -v mode="$placement_mode" '
  NR%3==1 {name=$0}
  NR%3==2 {device=$0}
  NR%3==0 {n[name]++; devices[name]=devices[name] " " device; if ($0!="empty") content[name]=1}
  END {for (name in n) if ((mode=="several" && n[name]>=2) || (mode=="empty" && !content[name])) printf "%d\t%s\t%s\n", n[name],name,substr(devices[name],2)}
' | LC_ALL=C sort -t$'\t' -k2
