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

if [ $# -lt 3 ]; then
    echo "Usage: restoreapp.sh <appid> <url> <key> [aws session token]"
    exit 1
fi

readonly DATA_DIR="${HOME}/data"
readonly curl="curl --fail --connect-timeout 20 --retry 10 --retry-delay 2 --max-time 2400"

app_id="$1"
restore_url="$2"
restore_key="$3"
session_token="$4"

echo "Downloading backup: ${restore_url} and key: ${restore_key}"

for try in `seq 1 5`; do
    echo "Download backup from ${restore_url} (try ${try})"
    error_log=$(mktemp)

    headers=("") # empty element required (http://stackoverflow.com/questions/7577052/bash-empty-array-expansion-with-set-u)

    # federated tokens in CaaS case need session token
    if [[ ! -z "${session_token}" ]]; then
        headers=(${headers[@]} "-H" "x-amz-security-token: ${session_token}")
    fi

    if $curl -L ${headers[@]} "${restore_url}" \
        | openssl aes-256-cbc -d -pass "pass:${restore_key}" \
        | tar -zxf - -C "${DATA_DIR}/${app_id}" 2>"${error_log}"; then
        chown -R yellowtent:yellowtent "${DATA_DIR}/${app_id}"
        break
    fi
    cat "${error_log}" && rm "${error_log}"
done

if [[ ${try} -eq 5 ]]; then
    echo "restore failed"
    exit 1
else
    echo "restore successful"
fi

