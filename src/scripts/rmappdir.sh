#!/bin/bash

set -eu -o pipefail

if [[ ${EUID} -ne 0 ]]; then
    echo "This script should be run as root." > /dev/stderr
    exit 1
fi

if [[ $# -eq 0 ]]; then
    echo "No arguments supplied"
    exit 1
fi

if [[ "$1" == "--check" ]]; then
    echo "OK"
    exit 0
fi

if [[ "${NODE_ENV}" == "cloudron" ]]; then
    readonly app_data_dir="${HOME}/data/$1"
    rm -rf ${app_data_dir}/* ${app_data_dir}/.*
    btrfs subvolume delete "${app_data_dir}"
else
    readonly app_data_dir="${HOME}/.cloudron_test/data/$1"
    rm -rf "${app_data_dir}"
fi

