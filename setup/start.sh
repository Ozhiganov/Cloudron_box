#!/bin/bash

set -eu -o pipefail

echo "==== Cloudron Start ===="

readonly USER="yellowtent"
# NOTE: Do NOT use BOX_SRC_DIR for accessing code and config files. This script will be run from a temp directory
# and the whole code will relocated to BOX_SRC_DIR by the installer. Use paths relative to script_dir or box_src_tmp_dir
readonly BOX_SRC_DIR="/home/${USER}/box"
readonly DATA_DIR="/home/${USER}/data"
readonly CONFIG_DIR="/home/${USER}/configs"
readonly SETUP_PROGRESS_JSON="/home/yellowtent/setup/website/progress.json"
readonly ADMIN_LOCATION="my" # keep this in sync with constants.js

readonly curl="curl --fail --connect-timeout 20 --retry 10 --retry-delay 2 --max-time 2400"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
box_src_tmp_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"

source "${script_dir}/argparser.sh" "$@" # this injects the arg_* variables used below

# keep this is sync with config.js appFqdn()
admin_fqdn=$([[ "${arg_is_custom_domain}" == "true" ]] && echo "${ADMIN_LOCATION}.${arg_fqdn}" ||  echo "${ADMIN_LOCATION}-${arg_fqdn}")

set_progress() {
    local percent="$1"
    local message="$2"

    echo "==== ${percent} - ${message} ===="
    (echo "{ \"update\": { \"percent\": \"${percent}\", \"message\": \"${message}\" }, \"backup\": {} }" > "${SETUP_PROGRESS_JSON}") 2> /dev/null || true # as this will fail in non-update mode
}

set_progress "1" "Create container"
$script_dir/container.sh

set_progress "10" "Ensuring directories"
# keep these in sync with paths.js
find "${DATA_DIR}/box" -mindepth 1 -delete || true
[[ ! -d "${DATA_DIR}/box" ]] && btrfs subvolume create "${DATA_DIR}/box"
mkdir -p "${DATA_DIR}/box/appicons"
mkdir -p "${DATA_DIR}/box/mail"
mkdir -p "${DATA_DIR}/box/graphite"
mkdir -p "${DATA_DIR}/snapshots"

# remove old snapshots. if we do want to keep this around, we will have to fix the chown -R below
# which currently fails because these are readonly fs
find "${DATA_DIR}/snapshots" -mindepth 1 -maxdepth 1 | xargs --no-run-if-empty btrfs subvolume delete

set_progress "15" "Downloading restore data"
if [[ -n "${arg_restore_url}" ]]; then
    echo "Downloading backup: ${arg_restore_url} and key: ${arg_restore_key}"

    while true; do
        if $curl -L "${arg_restore_url}" | openssl aes-256-cbc -d -pass "pass:${arg_restore_key}" | tar -zxf - -C "${DATA_DIR}/box"; then break; fi
        echo "Failed to download data, trying again"
    done
fi

set_progress "21" "Setting up MySQL"
mysqladmin -u root -ppassword password password # reset default root password
mysql -u root -ppassword -e 'CREATE DATABASE IF NOT EXISTS box'
if [[ -f "${DATA_DIR}/box/box.mysqldump" ]]; then
    echo "Importing existing database into MySQL"
    mysql -u root -ppassword box < "${DATA_DIR}/box/box.mysqldump"
fi

set_progress "25" "Migrating data"
sudo -u "${USER}" -H bash <<EOF
set -eu
cd "${box_src_tmp_dir}"
NODE_ENV=cloudron DATABASE_URL=mysql://root:password@localhost/box "${box_src_tmp_dir}/node_modules/.bin/db-migrate" up
EOF

set_progress "28" "Setup collectd"
mkdir -p "${DATA_DIR}/collectd/collectd.conf.d"
cp "${script_dir}/start/collectd.conf" "${DATA_DIR}/collectd/collectd.conf"

set_progress "30" "Setup nginx"
# setup naked domain to use admin by default. app restoration will overwrite this config
mkdir -p "${DATA_DIR}/nginx/applications"
cp "${script_dir}/start/nginx/nginx.conf" "${DATA_DIR}/nginx/nginx.conf"
cp "${script_dir}/start/nginx/mime.types" "${DATA_DIR}/nginx/mime.types"

${box_src_tmp_dir}/node_modules/.bin/ejs-cli -f "${script_dir}/start/nginx/appconfig.ejs" \
    -O "{ \"vhost\": \"${arg_fqdn}\", \"isAdmin\": true, \"sourceDir\": \"${BOX_SRC_DIR}\" }" > "${DATA_DIR}/nginx/naked_domain.conf"
${box_src_tmp_dir}/node_modules/.bin/ejs-cli -f "${script_dir}/start/nginx/appconfig.ejs" \
    -O "{ \"vhost\": \"${admin_fqdn}\", \"isAdmin\": true, \"sourceDir\": \"${BOX_SRC_DIR}\" }" > "${DATA_DIR}/nginx/applications/admin.conf"

mkdir -p "${DATA_DIR}/nginx/cert"
echo "${arg_tls_cert}" > ${DATA_DIR}/nginx/cert/host.cert
echo "${arg_tls_key}" > ${DATA_DIR}/nginx/cert/host.key

set_progress "33" "Changing ownership of source, data, configs"
chown "${USER}:${USER}" -R "${BOX_SRC_DIR}" "${DATA_DIR}" "${CONFIG_DIR}"

set_progress "40" "Setting up addons"
mysql_root_password=$(pwgen -1 -s)
postgresql_root_password=$(pwgen -1 -s)
mongodb_root_password=$(pwgen -1 -s)
${script_dir}/start/setup_cloud.sh "${arg_fqdn}" "${mysql_root_password}" "${postgresql_root_password}" "${mongodb_root_password}"

set_progress "65" "Creating cloudron.conf"
cloudron_sqlite="${DATA_DIR}/cloudron.sqlite"
admin_origin="https://${admin_fqdn}"
sudo -u yellowtent -H bash <<EOF
set -eu
echo "Creating cloudron.conf"
cat > "${CONFIG_DIR}/cloudron.conf" <<CONF_END
{
    "version": "${arg_version}",
    "token": "${arg_token}",
    "apiServerOrigin": "${arg_api_server_origin}",
    "webServerOrigin": "${arg_web_server_origin}",
    "fqdn": "${arg_fqdn}",
    "isCustomDomain": ${arg_is_custom_domain},
    "boxVersionsUrl": "${arg_box_versions_url}",
    "mailUsername": "admin@${arg_fqdn}",
    "database": {
        "hostname": "localhost",
        "username": "root",
        "password": "password",
        "port": 3306,
        "name": "box"
    },
    "addons": {
        "mysql": {
            "rootPassword": "${mysql_root_password}"
        },
        "postgresql": {
            "rootPassword": "${postgresql_root_password}"
        },
        "mongodb": {
            "rootPassword": "${mongodb_root_password}"
        }
    },
    "developerMode": ${arg_developer_mode}
}
CONF_END

echo "Creating config.json for webadmin"
cat > "${BOX_SRC_DIR}/webadmin/dist/config.json" <<CONF_END
{
    "webServerOrigin": "${arg_web_server_origin}"
}
CONF_END

# all other states other than install should proceed from where they left off
echo "Marking installed apps for restore"
mysql -u root -ppassword -e 'UPDATE apps SET installationState = "pending_restore" WHERE installationState = "installed"' box

# Add webadmin oauth client
# The domain might have changed, therefor we have to update the record
# !!! This needs to be in sync with the webadmin, specifically login_callback.js
echo "Add webadmin oauth cient"
ADMIN_SCOPES="root,developer,profile,users,apps,settings,roleUser"
mysql -u root -ppassword -e "REPLACE INTO clients (id, appId, clientSecret, redirectURI, scope) VALUES (\"cid-webadmin\", \"webadmin\", \"secret-webadmin\", \"${admin_origin}\", \"\$ADMIN_SCOPES\")" box
EOF

# bookkeep the version as part of data
echo "{ \"version\": \"${arg_version}\", \"boxVersionsUrl\": \"${arg_box_versions_url}\" }" > "${DATA_DIR}/box/version"

set_progress "80" "Reloading supervisor"
# looks like restarting supervisor completely is the only way to reload it
service supervisor stop || true

echo -n "Waiting for supervisord to stop"
while test -e "/var/run/supervisord.pid" && kill -0 `cat /var/run/supervisord.pid`; do
    echo -n "."
    sleep 1
done
echo ""

echo "Starting supervisor"

service supervisor start

sleep 2 # give supervisor sometime to start the processes

set_progress "85" "Reloading nginx"
nginx -s reload

set_progress "100" "Done"

