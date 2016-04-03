#!/bin/bash

set -eu -o pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script should be run as root." >&2
    exit 1
fi

if [[ $# == 1 && "$1" == "--check" ]]; then
    echo "OK"
    exit 0
fi

if [ $# -lt 4 ]; then
    echo "Usage: backupapp.sh <appid> <url> <url> <key> [aws session token]"
    exit 1
fi

readonly DATA_DIR="${HOME}/data"

app_id="$1"
backup_url="$2"
backup_config_url="$3"
backup_key="$4"
session_token="$5" # unused since it seems to be part of the url query param in v4 signature
readonly now=$(date "+%Y-%m-%dT%H:%M:%S")
readonly app_data_dir="${DATA_DIR}/${app_id}"
readonly app_data_snapshot="${DATA_DIR}/snapshots/${app_id}-${now}"

btrfs subvolume snapshot -r "${app_data_dir}" "${app_data_snapshot}"

for try in `seq 1 5`; do
    echo "Uploading config.json to ${backup_config_url} (try ${try})"
    error_log=$(mktemp)

    headers=("-H" "Content-Type:")

    if cat "${app_data_snapshot}/config.json" \
           | curl --fail -X PUT ${headers[@]} --data-binary @- "${backup_config_url}" 2>"${error_log}"; then
        break
    fi
    cat "${error_log}" && rm "${error_log}"
done

if [[ ${try} -eq 5 ]]; then
    echo "Backup failed uploading config.json"
    btrfs subvolume delete "${app_data_snapshot}"
    exit 1
fi

for try in `seq 1 5`; do
    echo "Uploading backup to ${backup_url} (try ${try})"
    error_log=$(mktemp)

    headers=("-H" "Content-Type:")

    if tar -cvzf - -C "${app_data_snapshot}" . \
           | openssl aes-256-cbc -e -pass "pass:${backup_key}" \
           | curl --fail -X PUT ${headers[@]} --data-binary @- "${backup_url}" 2>"${error_log}"; then
        break
    fi
    cat "${error_log}" && rm "${error_log}"
done

btrfs subvolume delete "${app_data_snapshot}"

if [[ ${try} -eq 5 ]]; then
    echo "Backup failed uploading backup tarball"
    exit 1
else
    echo "Backup successful"
fi
