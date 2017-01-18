#!/bin/bash

set -eu -o pipefail

echo "==> Cloudron Start"

readonly USER="yellowtent"
readonly DATA_FILE="/root/user_data.img"
readonly BOX_SRC_DIR="/home/${USER}/box"
readonly DATA_DIR="/home/${USER}/data"
readonly CONFIG_DIR="/home/${USER}/configs"
readonly SETUP_PROGRESS_JSON="/home/yellowtent/setup/website/progress.json"
readonly ADMIN_LOCATION="my" # keep this in sync with constants.js

readonly curl="curl --fail --connect-timeout 20 --retry 10 --retry-delay 2 --max-time 2400"

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${script_dir}/argparser.sh" "$@" # this injects the arg_* variables used below

readonly is_update=$([[ -f "${CONFIG_DIR}/cloudron.conf" ]] && echo "true" || echo "false")

set_progress() {
    local percent="$1"
    local message="$2"

    echo "==> ${percent} - ${message}"
    (echo "{ \"update\": { \"percent\": \"${percent}\", \"message\": \"${message}\" }, \"backup\": {} }" > "${SETUP_PROGRESS_JSON}") 2> /dev/null || true # as this will fail in non-update mode
}

set_progress "20" "Configuring host"
sed -e 's/^#NTP=/NTP=0.ubuntu.pool.ntp.org 1.ubuntu.pool.ntp.org 2.ubuntu.pool.ntp.org 3.ubuntu.pool.ntp.org/' -i /etc/systemd/timesyncd.conf
timedatectl set-ntp 1
timedatectl set-timezone UTC
hostnamectl set-hostname "${arg_fqdn}"

echo "==> Setting up firewall"
iptables -t filter -N CLOUDRON || true
iptables -t filter -F CLOUDRON # empty any existing rules

# NOTE: keep these in sync with src/apps.js validatePortBindings
# allow ssh, http, https, ping, dns
iptables -t filter -I CLOUDRON -m state --state RELATED,ESTABLISHED -j ACCEPT
# caas has ssh on port 202
if [[ "${arg_provider}" == "caas" ]]; then
    iptables -A CLOUDRON -p tcp -m tcp -m multiport --dports 25,80,202,443,587,993,4190 -j ACCEPT
else
    iptables -A CLOUDRON -p tcp -m tcp -m multiport --dports 25,80,22,443,587,993,4190 -j ACCEPT
fi
iptables -t filter -A CLOUDRON -p icmp --icmp-type echo-request -j ACCEPT
iptables -t filter -A CLOUDRON -p icmp --icmp-type echo-reply -j ACCEPT
iptables -t filter -A CLOUDRON -p udp --sport 53 -j ACCEPT
iptables -t filter -A CLOUDRON -s 172.18.0.0/16 -j ACCEPT # required to accept any connections from apps to our IP:<public port>
iptables -t filter -A CLOUDRON -i lo -j ACCEPT # required for localhost connections (mysql)

# log dropped incoming. keep this at the end of all the rules
iptables -t filter -A CLOUDRON -m limit --limit 2/min -j LOG --log-prefix "IPTables Packet Dropped: " --log-level 7
iptables -t filter -A CLOUDRON -j DROP

if ! iptables -t filter -C INPUT -j CLOUDRON 2>/dev/null; then
    iptables -t filter -I INPUT -j CLOUDRON
fi

# so it gets restored across reboot
mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4

echo "==> Configuring docker"
cp "${script_dir}/start/docker-cloudron-app.apparmor" /etc/apparmor.d/docker-cloudron-app
systemctl enable apparmor
systemctl restart apparmor

usermod yellowtent -a -G docker
temp_file=$(mktemp)
# some apps do not work with aufs
sed -e 's,^ExecStart=.*$,ExecStart=/usr/bin/docker daemon -H fd:// --log-driver=journald --exec-opt native.cgroupdriver=cgroupfs --storage-driver=devicemapper --dns=172.18.0.1 --dns-search=.,' /lib/systemd/system/docker.service > "${temp_file}"
systemctl enable docker
if ! diff -q /lib/systemd/system/docker.service "${temp_file}" >/dev/null; then
    mv "${temp_file}" /lib/systemd/system/docker.service
    systemctl daemon-reload
    systemctl restart docker
fi
docker network create --subnet=172.18.0.0/16 cloudron || true

# caas has ssh on port 202 and we disable password login
if [[ "${arg_provider}" == "caas" ]]; then
    # https://stackoverflow.com/questions/4348166/using-with-sed on why ? must be escaped
    sed -e 's/^#\?PermitRootLogin .*/PermitRootLogin without-password/g' \
        -e 's/^#\?PermitEmptyPasswords .*/PermitEmptyPasswords no/g' \
        -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/g' \
        -e 's/^#\?Port .*/Port 202/g' \
        -i /etc/ssh/sshd_config

    # required so we can connect to this machine since port 22 is blocked by iptables by now
    systemctl reload sshd
fi

echo "==> Setup btrfs data"
if ! grep -q loop.ko /lib/modules/`uname -r`/modules.builtin; then
    # on scaleway loop is not built-in
    echo "loop" >> /etc/modules
    modprobe loop
fi

if [[ ! -d "${DATA_DIR}" ]]; then
    echo "==> Mounting loopback btrfs"
    truncate -s "8192m" "${DATA_FILE}" # 8gb start (this will get resized dynamically by cloudron-resize-fs.service)
    mkfs.btrfs -L UserDataHome "${DATA_FILE}"
    mkdir -p "${DATA_DIR}"
    mount -t btrfs -o loop,nosuid "${DATA_FILE}" ${DATA_DIR}
fi

# keep these in sync with paths.js
echo "==> Ensuring directories"
[[ "${is_update}" == "false" ]] && btrfs subvolume create "${DATA_DIR}/box"
mkdir -p "${DATA_DIR}/box/appicons"
mkdir -p "${DATA_DIR}/box/certs"
mkdir -p "${DATA_DIR}/box/acme" # acme keys
mkdir -p "${DATA_DIR}/graphite"
mkdir -p "${DATA_DIR}/box/mail/dkim"

if [[ -n "${arg_fqdn}" ]]; then
    mkdir -p "${DATA_DIR}/box/mail/dkim/${arg_fqdn}"
fi

mkdir -p "${DATA_DIR}/mysql"
mkdir -p "${DATA_DIR}/postgresql"
mkdir -p "${DATA_DIR}/mongodb"
mkdir -p "${DATA_DIR}/snapshots"
mkdir -p "${DATA_DIR}/addons/mail"
mkdir -p "${DATA_DIR}/collectd/collectd.conf.d"
mkdir -p "${DATA_DIR}/acme"

echo "==> Configuring journald"
sed -e "s/^#SystemMaxUse=.*$/SystemMaxUse=100M/" \
    -e "s/^#ForwardToSyslog=.*$/ForwardToSyslog=no/" \
    -i /etc/systemd/journald.conf

# When rotating logs, systemd kills journald too soon sometimes
# See https://github.com/systemd/systemd/issues/1353 (this is upstream default)
sed -e "s/^WatchdogSec=.*$/WatchdogSec=3min/" \
    -i /lib/systemd/system/systemd-journald.service

# Give user access to system logs
usermod -a -G systemd-journal yellowtent
mkdir -p /var/log/journal  # in some images, this directory is not created making system log to /run/systemd instead
chown root:systemd-journal /var/log/journal
systemctl restart systemd-journald
setfacl -n -m u:yellowtent:r /var/log/journal/*/system.journal

echo "==> Creating config directory"
rm -rf "${CONFIG_DIR}" && mkdir "${CONFIG_DIR}"

echo "==> Adding systemd services"
cp -r "${script_dir}/start/systemd/." /etc/systemd/system/
systemctl daemon-reload
systemctl enable cloudron.target
systemctl enable iptables-restore

# For logrotate
systemctl enable --now cron

# DO uses Google nameservers by default. This causes RBL queries to fail (host 2.0.0.127.zen.spamhaus.org)
# We do not use dnsmasq because it is not a recursive resolver and defaults to the value in the interfaces file (which is Google DNS!)
# We listen on 0.0.0.0 because there is no way control ordering of docker (which creates the 172.18.0.0/16) and unbound
echo -e "server:\n\tinterface: 0.0.0.0\n\taccess-control: 127.0.0.1 allow\n\taccess-control: 172.18.0.1/16 allow" > /etc/unbound/unbound.conf.d/cloudron-network.conf
systemctl enable unbound
systemctl restart unbound

echo "==> Configuring sudoers"
rm -f /etc/sudoers.d/yellowtent
cp "${script_dir}/start/sudoers" /etc/sudoers.d/yellowtent

echo "==> Configuring collectd"
rm -rf /etc/collectd
ln -sfF "${DATA_DIR}/collectd" /etc/collectd
cp "${script_dir}/start/collectd.conf" "${DATA_DIR}/collectd/collectd.conf"
systemctl restart collectd

echo "==> Configuring nginx"
# link nginx config to system config
unlink /etc/nginx 2>/dev/null || rm -rf /etc/nginx
ln -s "${DATA_DIR}/nginx" /etc/nginx
mkdir -p "${DATA_DIR}/nginx/applications"
mkdir -p "${DATA_DIR}/nginx/cert"
cp "${script_dir}/start/nginx/nginx.conf" "${DATA_DIR}/nginx/nginx.conf"
cp "${script_dir}/start/nginx/mime.types" "${DATA_DIR}/nginx/mime.types"

# bookkeep the version as part of data
echo "{ \"version\": \"${arg_version}\", \"boxVersionsUrl\": \"${arg_box_versions_url}\" }" > "${DATA_DIR}/box/version"

# remove old snapshots. if we do want to keep this around, we will have to fix the chown -R below
# which currently fails because these are readonly fs
echo "==> Cleaning up snapshots"
find "${DATA_DIR}/snapshots" -mindepth 1 -maxdepth 1 | xargs --no-run-if-empty btrfs subvolume delete

# restart mysql to make sure it has latest config
# wait for all running mysql jobs
cp "${script_dir}/start/mysql.cnf" /etc/mysql/mysql.cnf
while true; do
    if ! systemctl list-jobs | grep mysql; then break; fi
    echo "Waiting for mysql jobs..."
    sleep 1
done
systemctl restart mysql

readonly mysql_root_password="password"
mysqladmin -u root -ppassword password password # reset default root password
mysql -u root -p${mysql_root_password} -e 'CREATE DATABASE IF NOT EXISTS box'

if [[ -n "${arg_restore_url}" ]]; then
    set_progress "30" "Downloading restore data"

    echo "==> Downloading backup: ${arg_restore_url} and key: ${arg_restore_key}"

    while true; do
        if $curl -L "${arg_restore_url}" | openssl aes-256-cbc -d -pass "pass:${arg_restore_key}" | tar -zxf - -C "${DATA_DIR}/box"; then break; fi
        echo "Failed to download data, trying again"
    done

    set_progress "35" "Setting up MySQL"
    if [[ -f "${DATA_DIR}/box/box.mysqldump" ]]; then
        echo "==> Importing existing database into MySQL"
        mysql -u root -p${mysql_root_password} box < "${DATA_DIR}/box/box.mysqldump"
    fi
fi

set_progress "40" "Migrating data"
sudo -u "${USER}" -H bash <<EOF
set -eu
cd "${BOX_SRC_DIR}"
BOX_ENV=cloudron DATABASE_URL=mysql://root:${mysql_root_password}@localhost/box "${BOX_SRC_DIR}/node_modules/.bin/db-migrate" up
EOF

echo "==> Creating cloudron.conf"
cat > "${CONFIG_DIR}/cloudron.conf" <<CONF_END
{
    "version": "${arg_version}",
    "token": "${arg_token}",
    "apiServerOrigin": "${arg_api_server_origin}",
    "webServerOrigin": "${arg_web_server_origin}",
    "fqdn": "${arg_fqdn}",
    "isCustomDomain": ${arg_is_custom_domain},
    "boxVersionsUrl": "${arg_box_versions_url}",
    "provider": "${arg_provider}",
    "isDemo": ${arg_is_demo},
    "database": {
        "hostname": "localhost",
        "username": "root",
        "password": "${mysql_root_password}",
        "port": 3306,
        "name": "box"
    },
    "appBundle": ${arg_app_bundle}
}
CONF_END
# pass these out-of-band because they have new lines which interfere with json
if [[ -n "${arg_tls_cert}" && -n "${arg_tls_key}" ]]; then
    echo "${arg_tls_cert}" > "${CONFIG_DIR}/host.cert"
    echo "${arg_tls_key}" > "${CONFIG_DIR}/host.key"
fi

echo "==> Creating config.json for webadmin"
cat > "${BOX_SRC_DIR}/webadmin/dist/config.json" <<CONF_END
{
    "webServerOrigin": "${arg_web_server_origin}"
}
CONF_END

echo "==> Changing ownership"
chown "${USER}:${USER}" -R "${CONFIG_DIR}"
chown "${USER}:${USER}" -R "${DATA_DIR}/nginx" "${DATA_DIR}/collectd" "${DATA_DIR}/addons" "${DATA_DIR}/acme"
# during updates, do not trample mail ownership behind the the mail container's back
find "${DATA_DIR}/box" -mindepth 1 -maxdepth 1 -not -path "${DATA_DIR}/box/mail" -print0 | xargs -0 chown -R "${USER}:${USER}"
chown "${USER}:${USER}" "${DATA_DIR}/box"
chown "${USER}:${USER}" -R "${DATA_DIR}/box/mail/dkim" # this is owned by box currently since it generates the keys
chown "${USER}:${USER}" "${DATA_DIR}/INFRA_VERSION" 2>/dev/null || true
chown "${USER}:${USER}" "${DATA_DIR}"

echo "==> Adding automated configs"
if [[ ! -z "${arg_backup_config}" ]]; then
    mysql -u root -p${mysql_root_password} \
        -e "REPLACE INTO settings (name, value) VALUES (\"backup_config\", '$arg_backup_config')" box
fi

if [[ ! -z "${arg_dns_config}" ]]; then
    mysql -u root -p${mysql_root_password} \
        -e "REPLACE INTO settings (name, value) VALUES (\"dns_config\", '$arg_dns_config')" box
fi

if [[ ! -z "${arg_update_config}" ]]; then
    mysql -u root -p${mysql_root_password} \
        -e "REPLACE INTO settings (name, value) VALUES (\"update_config\", '$arg_update_config')" box
fi

if [[ ! -z "${arg_tls_config}" ]]; then
    mysql -u root -p${mysql_root_password} \
        -e "REPLACE INTO settings (name, value) VALUES (\"tls_config\", '$arg_tls_config')" box
fi

set_progress "60" "Starting Cloudron"
systemctl start cloudron.target

sleep 2 # give systemd sometime to start the processes

set_progress "100" "Done"
