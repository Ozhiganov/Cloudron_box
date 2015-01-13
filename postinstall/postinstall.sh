#!/bin/bash

# Count installer files so that we can correlate install and postinstall logs
COUNT=$(find /var/log/cloudron -name "installer*" | wc -l)
exec > >(tee "/var/log/cloudron/postinstall-$COUNT.log")
exec 2>&1

set -e
set -x

echo "==== Cloudron post installation ===="

USER=yellowtent
SRCDIR=/home/$USER/box
DATA_DIR=/home/$USER/data
CONFIG_DIR=/home/$USER/configs
HARAKA_DIR=$CONFIG_DIR/haraka
NGINX_CONFIG_DIR=$CONFIG_DIR/nginx
NGINX_APPCONFIG_DIR=$CONFIG_DIR/nginx/applications
CLOUDRON_CONF=$CONFIG_DIR/cloudron.conf
CLOUDRON_SQLITE=$DATA_DIR/cloudron.sqlite
MYSQL_DIR="$DATA_DIR/mysql"
POSTGRESQL_DIR="$DATA_DIR/postgresql"
DOMAIN_NAME=`hostname -f`
JSON="$SRCDIR/node_modules/.bin/json"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

SAVED_ARGS=("$@")
ARGS=$(getopt -o "" -l "boxversionsurl:,data:" -n "$0" -- "$@")
eval set -- "$ARGS"

while true; do
    case "$1" in
    --boxversionsurl) PROVISION_BOX_VERSIONS_URL="$2";;
    --data) PROVISION_DATA="$2";;
    --) break;;
    *) echo "Unknown option $1"; exit 1;;
    esac

    shift 2
done

read -r PROVISION_APP_SERVER_URL PROVISION_FQDN PROVISION_TOKEN <<EOF
$(echo "$PROVISION_DATA" | $JSON appServerUrl fqdn token | tr '\n' ' ')
EOF

ADMIN_FQDN="admin-$PROVISION_FQDN"
ADMIN_ORIGIN="https://$ADMIN_FQDN"

# Every docker restart results in a new IP. Give our mail server a
# static IP. Alternately, we need to link the mail container with
# all our apps
# This IP is set by the haraka container on every start and the firewall
# allows connect to port 25
MAIL_SERVER="172.17.120.120"

echo "==== Sudoers file for app removal ===="
cat > /etc/sudoers.d/yellowtent <<EOF
Defaults!$SRCDIR/src/scripts/rmappdir.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/rmappdir.sh

Defaults!$SRCDIR/src/scripts/reloadnginx.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reloadnginx.sh

Defaults!$SRCDIR/src/scripts/backup.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/backup.sh

Defaults!$SRCDIR/src/scripts/reboot.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reboot.sh

Defaults!$SRCDIR/src/scripts/reloadcollectd.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reloadcollectd.sh

Defaults!$SRCDIR/installer/scripts/installer.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/installer/scripts/installer.sh

EOF

echo "==== Migrate data ===="
sudo -u $USER -H bash <<EOF
set -e
set -x
cd $SRCDIR
PATH=$PATH:$SRCDIR/node_modules/.bin npm run-script migrate_data
EOF

echo "==== Setup nginx ===="
mkdir -p $NGINX_APPCONFIG_DIR
cp $SRCDIR/postinstall/nginx/nginx.conf $NGINX_CONFIG_DIR/nginx.conf
cp $SRCDIR/postinstall/nginx/mime.types $NGINX_CONFIG_DIR/mime.types
cp $SRCDIR/postinstall/nginx/certificates.conf $NGINX_CONFIG_DIR/certificates.conf
touch $NGINX_CONFIG_DIR/naked_domain.conf
sed -e "s/##ADMIN_FQDN##/$ADMIN_FQDN/" -e "s|##SRCDIR##|$SRCDIR|" $SRCDIR/postinstall/nginx/admin.conf_template > $NGINX_APPCONFIG_DIR/admin.conf

echo "==== Setup ssl certs ===="
# The nginx cert dir is excluded from backup in backup.sh
CERTIFICATE_DIR=$NGINX_CONFIG_DIR/cert
mkdir -p $CERTIFICATE_DIR
cd $CERTIFICATE_DIR
echo "$PROVISION_DATA" | $JSON tls.cert > host.cert
echo "$PROVISION_DATA" | $JSON tls.key > host.key

chown $USER:$USER -R /home/$USER

echo "=== Remove all containers ==="
# removing containers ensures containers are launched with latest config updates
# restore code in appatask does not delete old containers
EXISTING_CONTAINERS=$(docker ps -qa)
echo "Remove containers: $EXISTING_CONTAINERS"
if [ -n "$EXISTING_CONTAINERS" ]; then
    echo "$EXISTING_CONTAINERS" | xargs docker rm -f
fi

echo "=== Setup collectd and graphite ==="
$SRCDIR/postinstall/setup_collectd.sh

echo "=== Setup haraka mail relay ==="
docker rm -f haraka || true
docker pull girish/haraka:0.1
HARAKA_CONTAINER_ID=$(docker run --restart=always -d --name="haraka" --cap-add="NET_ADMIN"\
    -p 127.0.0.1:25:25 \
    -h $DOMAIN_NAME \
    -e DOMAIN_NAME=$DOMAIN_NAME \
    -v $HARAKA_DIR:/app/data girish/haraka:0.1)
echo "Haraka container id: $HARAKA_CONTAINER_ID"

echo "=== Setup MySQL addon ==="
docker rm -f mysql || true
MYSQL_ROOT_PASSWORD=$(pwgen -1 -s)
DOCKER0_IP=$( /sbin/ifconfig docker0 | grep "inet addr" | awk -F: '{print $2}' | awk '{print $1}')
docker pull girish/mysql:0.1
MYSQL_CONTAINER_ID=$(docker run --restart=always -d --name="mysql" \
    -p 127.0.0.1:3306:3306 \
    -h "$DOMAIN_NAME" \
    -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
    -e MYSQL_ROOT_HOST="$DOCKER0_IP" \
    -v "$MYSQL_DIR:/var/lib/mysql" girish/mysql:0.1)
echo "MySQL container id: $MYSQL_CONTAINER_ID"

echo "=== Setup Postgres addon ==="
docker rm -f postgresql || true
POSTGRESQL_ROOT_PASSWORD=$(pwgen -1 -s)
docker pull girish/postgresql:0.1
POSTGRESQL_CONTAINER_ID=$(docker run --restart=always -d --name="postgresql" \
    -p 127.0.0.1:5432:5432 \
    -h "$DOMAIN_NAME" \
    -e POSTGRESQL_ROOT_PASSWORD="$POSTGRESQL_ROOT_PASSWORD" \
    -v "$POSTGRESQL_DIR:/var/lib/mysql" girish/postgresql:0.1)
echo "PostgreSQL container id: $POSTGRESQL_CONTAINER_ID"

echo "=== Pulling Redis addon ==="
docker pull girish/redis:0.1

echo "==== Creating cloudron.conf ===="
sudo -u yellowtent -H bash <<EOF
set -e
set -x
echo "Creating cloudron.conf"
cat > "$CLOUDRON_CONF" <<CONF_END
{
    "token": "$PROVISION_TOKEN",
    "appServerUrl": "$PROVISION_APP_SERVER_URL",
    "fqdn": "$PROVISION_FQDN",
    "adminOrigin": "$ADMIN_ORIGIN",
    "boxVersionsUrl": "$PROVISION_BOX_VERSIONS_URL",
    "mailServer": "$MAIL_SERVER",
    "mailUsername": "admin@$DOMAIN_NAME",
    "addons": {
        "mysql": {
            "rootPassword": "$MYSQL_ROOT_PASSWORD"
        },
        "postgresql": {
            "rootPassword": "$POSTGRESQL_ROOT_PASSWORD"
        }
    }
}
CONF_END

echo "Marking apps for restore"
# TODO: do not auto-start stopped containers (httpPort might need fixing to start them)
sqlite3 "$CLOUDRON_SQLITE" 'UPDATE apps SET installationState = "pending_restore", healthy = NULL, runState = NULL, containerId = NULL, httpPort = NULL, installationProgress = NULL'

# Add webadmin oauth client
echo "Add webadmin oauth cient"
ADMIN_SCOPES="root,profile,users,apps,settings,roleAdmin"
ADMIN_ID=$(cat /proc/sys/kernel/random/uuid)
sqlite3 "$CLOUDRON_SQLITE" "INSERT OR REPLACE INTO clients (id, appId, clientId, clientSecret, name, redirectURI, scope) VALUES (\"\$ADMIN_ID\", \"webadmin\", \"cid-webadmin\", \"secret-webadmin\", \"WebAdmin\", \"$ADMIN_ORIGIN\", \"\$ADMIN_SCOPES\")"

EOF

echo "==== Setup supervisord ===="
$SRCDIR/postinstall/setup_supervisord.sh

