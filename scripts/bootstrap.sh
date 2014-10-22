#!/bin/sh
# This script is executed once on startup

exec > >(tee "/var/log/cloudron/bootstrap.log-$$-$BASHPID")
exec 2>&1

set -e

echo "Box bootstrapping"

USER=yellowtent
SRCDIR=/home/$USER/box
DATA_DIR=/home/$USER/data

# we get the appstore origin from the caller which is baked into the image
APP_SERVER_URL=$1
BOX_REVISION=$2

echo "==== Sudoers file for app removal ===="
cat > /etc/sudoers.d/yellowtent <<EOF
Defaults!$SRCDIR/src/scripts/rmappdir.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/rmappdir.sh

Defaults!$SRCDIR/src/scripts/reloadnginx.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reloadnginx.sh

Defaults!$SRCDIR/src/scripts/update.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/update.sh

Defaults!$SRCDIR/src/scripts/backup.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/backup.sh

Defaults!$SRCDIR/src/scripts/restore.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/restore.sh

Defaults!$SRCDIR/src/scripts/reboot.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reboot.sh

Defaults!$SRCDIR/src/scripts/reloadcollectd.sh env_keep=HOME
$USER ALL=(root) NOPASSWD: $SRCDIR/src/scripts/reloadcollectd.sh

EOF


echo "==== Setup yellowtent ===="
sudo -u $USER -H bash <<EOF
cd $SRCDIR
while true; do
    timeout 3m npm install --production --loglevel verbose && break
    echo "npm install timedout, trying again"
done
PATH=$PATH:$SRCDIR/node_modules/.bin npm run-script postinstall
EOF

echo "==== Setup nginx ===="
cd $SRCDIR
mkdir -p $DATA_DIR/nginx/applications
cp nginx/nginx.conf $DATA_DIR/nginx/nginx.conf
cp nginx/mime.types $DATA_DIR/nginx/mime.types
cp nginx/certificates.conf $DATA_DIR/nginx/certificates.conf
touch $DATA_DIR/nginx/naked_domain.conf
FQDN=`hostname -f`
sed -e "s/##ADMIN_FQDN##/admin-$FQDN/" -e "s|##SRCDIR##|$SRCDIR|" nginx/admin.conf_template > $DATA_DIR/nginx/applications/admin.conf

echo "==== Setup ssl certs ===="
# The nginx cert dir is excluded from backup in backup.sh
CERTIFICATE_DIR=$DATA_DIR/nginx/cert
mkdir -p $CERTIFICATE_DIR
cd $CERTIFICATE_DIR
/bin/bash $SRCDIR/scripts/generate_certificate.sh US California 'San Francisco' CloudronInc Cloudron `hostname -f` cert@cloudron.io .
tar xf cert.tar

chown $USER:$USER -R $DATA_DIR

echo "=== Setup collectd and graphite ==="
$SRCDIR/scripts/bootstrap/setup_collectd.sh

echo "=== Setup haraka mail relay ==="
$SRCDIR/scripts/bootstrap/setup_haraka.sh

echo "==== Setup supervisord ===="
rm -rf /etc/supervisor
mkdir -p /etc/supervisor
mkdir -p /etc/supervisor/conf.d
cp $SRCDIR/supervisor/supervisord.conf /etc/supervisor/

echo "Writing box supervisor config..."
cat > /etc/supervisor/conf.d/nginx.conf <<EOF
[program:nginx]
command=nginx -c "$DATA_DIR/nginx/nginx.conf" -p /var/log/nginx/
autostart=true
autorestart=true
redirect_stderr=true
EOF
echo "Done"

echo "Writing nginx supervisor config..."
cat > /etc/supervisor/conf.d/box.conf <<EOF
[program:box]
command=node app.js
autostart=true
autorestart=true
redirect_stderr=true
directory=$SRCDIR
user=yellowtent
environment=HOME="/home/yellowtent",CLOUDRON="1",USER="yellowtent",DEBUG="box*",APP_SERVER_URL="$APP_SERVER_URL"
EOF
echo "Done"

update-rc.d supervisor defaults
/etc/init.d/supervisor start
