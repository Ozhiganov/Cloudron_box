#!/bin/bash

set -eu -o pipefail

readonly DATA_DIR="/home/yellowtent/data"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/../INFRA_VERSION" # this injects INFRA_VERSION

arg_fqdn="$1"

# removing containers ensures containers are launched with latest config updates
# restore code in appatask does not delete old containers
infra_version="none"
[[ -f "${DATA_DIR}/INFRA_VERSION" ]] && infra_version=$(cat "${DATA_DIR}/INFRA_VERSION")
if [[ "${infra_version}" == "${INFRA_VERSION}" ]]; then
    echo "Infrastructure is upto date"
    exit 0
fi

echo "Upgrading infrastructure from ${infra_version} to ${INFRA_VERSION}"

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
    --read-only -v /tmp -v /run -v /var/log \
    "${GRAPHITE_IMAGE}")
echo "Graphite container id: ${graphite_container_id}"

# mail
mail_container_id=$(docker run --restart=always -d --name="mail" \
    -m 75m \
    --memory-swap 150m \
    -p 127.0.0.1:25:25 \
    -h "${arg_fqdn}" \
    -e "DOMAIN_NAME=${arg_fqdn}" \
    -v "${DATA_DIR}/box/mail:/app/data" \
    --read-only -v /tmp -v /run -v /var/log \
    "${MAIL_IMAGE}")
echo "Mail container id: ${mail_container_id}"

# mysql
mysql_addon_root_password=$(pwgen -1 -s)
docker0_ip=$(/sbin/ifconfig docker0 | grep "inet addr" | awk -F: '{print $2}' | awk '{print $1}')
cat > "${DATA_DIR}/addons/mysql_vars.sh" <<EOF
readonly MYSQL_ROOT_PASSWORD='${mysql_addon_root_password}'
readonly MYSQL_ROOT_HOST='${docker0_ip}'
EOF
mysql_container_id=$(docker run --restart=always -d --name="mysql" \
    -m 100m \
    --memory-swap 200m \
    -h "${arg_fqdn}" \
    -v "${DATA_DIR}/mysql:/var/lib/mysql" \
    -v "${DATA_DIR}/addons/mysql_vars.sh:/etc/mysql/mysql_vars.sh:ro" \
    --read-only -v /tmp -v /run -v /var/log \
    "${MYSQL_IMAGE}")
echo "MySQL container id: ${mysql_container_id}"

# postgresql
postgresql_addon_root_password=$(pwgen -1 -s)
cat > "${DATA_DIR}/addons/postgresql_vars.sh" <<EOF
readonly POSTGRESQL_ROOT_PASSWORD='${postgresql_addon_root_password}'
EOF
postgresql_container_id=$(docker run --restart=always -d --name="postgresql" \
    -m 100m \
    --memory-swap 200m \
    -h "${arg_fqdn}" \
    -v "${DATA_DIR}/postgresql:/var/lib/postgresql" \
    -v "${DATA_DIR}/addons/postgresql_vars.sh:/etc/postgresql/postgresql_vars.sh:ro" \
    --read-only -v /tmp -v /run -v /var/log \
    "${POSTGRESQL_IMAGE}")
echo "PostgreSQL container id: ${postgresql_container_id}"

# mongodb
mongodb_addon_root_password=$(pwgen -1 -s)
cat > "${DATA_DIR}/addons/mongodb_vars.sh" <<EOF
readonly MONGODB_ROOT_PASSWORD='${mongodb_addon_root_password}'
EOF
mongodb_container_id=$(docker run --restart=always -d --name="mongodb" \
    -m 100m \
    --memory-swap 200m \
    -h "${arg_fqdn}" \
    -v "${DATA_DIR}/mongodb:/var/lib/mongodb" \
    -v "${DATA_DIR}/addons/mongodb_vars.sh:/etc/mongodb_vars.sh:ro" \
    --read-only -v /tmp -v /run -v /var/log \
    "${MONGODB_IMAGE}")
echo "Mongodb container id: ${mongodb_container_id}"

if [[ "${infra_version}" == "none" ]]; then
    # if no existing infra was found (for new and restoring cloudons), download app backups
    echo "Marking installed apps for restore"
    mysql -u root -ppassword -e 'UPDATE apps SET installationState = "pending_restore" WHERE installationState = "installed"' box
else
    # if existing infra was found, just mark apps for reconfiguration
    mysql -u root -ppassword -e 'UPDATE apps SET installationState = "pending_configure" WHERE installationState = "installed"' box
fi

echo -n "${INFRA_VERSION}" > "${DATA_DIR}/INFRA_VERSION"

