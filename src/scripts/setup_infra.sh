#!/bin/bash

set -eu -o pipefail

if [[ ${EUID} -ne 0 ]]; then
    echo "This script should be run as root." > /dev/stderr
    exit 1
fi

if [[ $# == 1 && "$1" == "--check" ]]; then
    echo "OK"
    exit 0
fi

readonly DATA_DIR="/home/yellowtent/data"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/../INFRA_VERSION" # this injects INFRA_VERSION

readonly fqdn="$1"

# removing containers ensures containers are launched with latest config updates
# restore code in appatask does not delete old containers
infra_version="none"
[[ -f "${DATA_DIR}/INFRA_VERSION" ]] && infra_version=$(cat "${DATA_DIR}/INFRA_VERSION")
if [[ "${infra_version}" == "${INFRA_VERSION}" ]]; then
    echo "Infrastructure is upto date"
    exit 0
fi

echo "Upgrading infrastructure from ${infra_version} to ${INFRA_VERSION}"

# TODO: be nice and stop addons cleanly (example, shutdown commands)
existing_containers=$(docker ps -qa)
echo "Remove containers: ${existing_containers}"
if [[ -n "${existing_containers}" ]]; then
    echo "${existing_containers}" | xargs docker rm -f
fi

# graphite
graphite_container_id=$(docker run --restart=always -d --name="graphite" \
    -m 75m \
    --memory-swap 150m \
    -p 127.0.0.1:2003:2003 \
    -p 127.0.0.1:2004:2004 \
    -p 127.0.0.1:8000:8000 \
    -v "${DATA_DIR}/graphite:/app/data" \
    --read-only -v /tmp -v /run \
    "${GRAPHITE_IMAGE}")
echo "Graphite container id: ${graphite_container_id}"
if docker images "${GRAPHITE_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${GRAPHITE_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old graphite images"
fi

# mail (MAIL_SMTP_PORT is 2500 in addons.js. used in mailer.js as well)
# MAIL_SERVER_NAME is the hostname of the mailserver i.e server uses these certs
# MAIL_DOMAIN is the domain for which this server is relaying mails
docker rmi -f cloudron/mail:0.11.0 || true
mail_container_id=$(docker run --restart=always -d --name="mail" \
    -m 75m \
    --memory-swap 150m \
    -h "${fqdn}" \
    -e "MAIL_SERVER_NAME=${fqdn}" \
    -e "MAIL_DOMAIN=${fqdn}" \
    -v "${DATA_DIR}/box/mail:/app/data" \
    --read-only -v /tmp -v /run \
    "${MAIL_IMAGE}")
echo "Mail container id: ${mail_container_id}"
if docker images "${MAIL_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${MAIL_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old mail images"
fi

# mysql
mysql_addon_root_password=$(pwgen -1 -s)
docker0_ip=$(/sbin/ifconfig docker0 | grep "inet addr" | awk -F: '{print $2}' | awk '{print $1}')
cat > "${DATA_DIR}/addons/mysql_vars.sh" <<EOF
readonly MYSQL_ROOT_PASSWORD='${mysql_addon_root_password}'
readonly MYSQL_ROOT_HOST='${docker0_ip}'
EOF
mysql_container_id=$(docker run --restart=always -d --name="mysql" \
    -m 256m \
    --memory-swap 512m \
    -h "${fqdn}" \
    -v "${DATA_DIR}/mysql:/var/lib/mysql" \
    -v "${DATA_DIR}/addons/mysql_vars.sh:/etc/mysql/mysql_vars.sh:ro" \
    --read-only -v /tmp -v /run \
    "${MYSQL_IMAGE}")
echo "MySQL container id: ${mysql_container_id}"
if docker images "${MYSQL_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${MYSQL_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old mysql images"
fi

# postgresql
postgresql_addon_root_password=$(pwgen -1 -s)
cat > "${DATA_DIR}/addons/postgresql_vars.sh" <<EOF
readonly POSTGRESQL_ROOT_PASSWORD='${postgresql_addon_root_password}'
EOF
postgresql_container_id=$(docker run --restart=always -d --name="postgresql" \
    -m 100m \
    --memory-swap 200m \
    -h "${fqdn}" \
    -v "${DATA_DIR}/postgresql:/var/lib/postgresql" \
    -v "${DATA_DIR}/addons/postgresql_vars.sh:/etc/postgresql/postgresql_vars.sh:ro" \
    --read-only -v /tmp -v /run \
    "${POSTGRESQL_IMAGE}")
echo "PostgreSQL container id: ${postgresql_container_id}"
if docker images "${POSTGRESQL_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${POSTGRESQL_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old postgresql images"
fi

# mongodb
mongodb_addon_root_password=$(pwgen -1 -s)
cat > "${DATA_DIR}/addons/mongodb_vars.sh" <<EOF
readonly MONGODB_ROOT_PASSWORD='${mongodb_addon_root_password}'
EOF
mongodb_container_id=$(docker run --restart=always -d --name="mongodb" \
    -m 100m \
    --memory-swap 200m \
    -h "${fqdn}" \
    -v "${DATA_DIR}/mongodb:/var/lib/mongodb" \
    -v "${DATA_DIR}/addons/mongodb_vars.sh:/etc/mongodb_vars.sh:ro" \
    --read-only -v /tmp -v /run \
    "${MONGODB_IMAGE}")
echo "Mongodb container id: ${mongodb_container_id}"
if docker images "${MONGODB_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${MONGODB_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old mongodb images"
fi

# redis
if docker images "${REDIS_REPO}" | tail -n +2 | awk '{ print $1 ":" $2 }' | grep -v "${REDIS_IMAGE}" | xargs --no-run-if-empty docker rmi; then
    echo "Removed old redis images"
fi

# only touch apps in installed state. any other state is just resumed by the taskmanager
if [[ "${infra_version}" == "none" ]]; then
    # if no existing infra was found (for new, upgraded and restored cloudons), download app backups
    echo "Marking installed apps for restore"
    mysql -u root -ppassword -e 'UPDATE apps SET installationState = "pending_restore", oldConfigJson = NULL WHERE installationState = "installed"' box
else
    # if existing infra was found, just mark apps for reconfiguration
    mysql -u root -ppassword -e 'UPDATE apps SET installationState = "pending_configure", oldConfigJson = NULL  WHERE installationState = "installed"' box
fi

echo -n "${INFRA_VERSION}" > "${DATA_DIR}/INFRA_VERSION"
