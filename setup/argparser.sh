#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
json="${script_dir}/../node_modules/.bin/json"

# IMPORTANT: Fix cloudron.js:doUpdate if you add/remove any arg. keep these sorted for readability
arg_api_server_origin=""
arg_box_versions_url=""
arg_fqdn=""
arg_is_custom_domain="false"
arg_restore_key=""
arg_restore_url=""
arg_retire="false"
arg_tls_cert=""
arg_tls_key=""
arg_token=""
arg_version=""
arg_web_server_origin=""
arg_backup_key=""
arg_aws=""

args=$(getopt -o "" -l "data:,retire" -n "$0" -- "$@")
eval set -- "${args}"

while true; do
    case "$1" in
    --retire)
        arg_retire="true"
        shift
        ;;
    --data)
        # only read mandatory non-empty parameters here
        read -r arg_api_server_origin arg_web_server_origin arg_fqdn arg_token arg_is_custom_domain arg_box_versions_url arg_version <<EOF
        $(echo "$2" | $json apiServerOrigin webServerOrigin fqdn token isCustomDomain boxVersionsUrl version | tr '\n' ' ')
EOF
        # read possibly empty parameters here
        arg_tls_cert=$(echo "$2" | $json tlsCert)
        arg_tls_key=$(echo "$2" | $json tlsKey)

        arg_restore_url=$(echo "$2" | $json restoreUrl)
        [[ "${arg_restore_url}" == "null" ]] && arg_restore_url=""

        arg_restore_key=$(echo "$2" | $json restoreKey)
        [[ "${arg_restore_key}" == "null" ]] && arg_restore_key=""

        arg_backup_key=$(echo "$2" | $json backupKey)
        [[ "${arg_backup_key}" == "null" ]] && arg_backup_key=""

        arg_aws=$(echo "$2" | $json aws)
        [[ "${arg_aws}" == "null" ]] && arg_aws=""

        shift 2
        ;;
    --) break;;
    *) echo "Unknown option $1"; exit 1;;
    esac
done

echo "Parsed arguments:"
echo "api server: ${arg_api_server_origin}"
echo "box versions url: ${arg_box_versions_url}"
echo "fqdn: ${arg_fqdn}"
echo "custom domain: ${arg_is_custom_domain}"
echo "restore key: ${arg_restore_key}"
echo "restore url: ${arg_restore_url}"
echo "tls cert: ${arg_tls_cert}"
echo "tls key: ${arg_tls_key}"
echo "token: ${arg_token}"
echo "version: ${arg_version}"
echo "web server: ${arg_web_server_origin}"
