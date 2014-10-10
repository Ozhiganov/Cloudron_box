#!/bin/bash

if [ $EUID -ne 0 ]; then
    echo "This script should be run as root." > /dev/stderr
    exit 1
fi

if [ "$1" == "--check" ]; then
    echo "OK"
    exit 0
fi

NOW=$(date +%Y%m%dT%H%M%S)
LOG=/var/log/cloudron/restore-${NOW}.log
exec 2>&1 1> $LOG

if [ $# -lt 1 ]; then
    echo "No arguments supplied"
    exit 1
fi

RESTORE_URL=$1

echo "Arguments: $@"

# Stop the box
echo "Stopping box"
supervisorctl stop box

DATE_HEADER=$(date "+%a, %d %b %Y %T %z") # Tue, 27 Mar 2007 19:36:42 +0000

echo "Downloading backup: $RESTORE_URL"
curl -X GET \
    -H "Date: ${DATE_HEADER}" \
    -o /tmp/restore.tar.gz \
    "$RESTORE_URL"

rm -rf $HOME/box $HOME/.yellowtent

# move somewhere else since we blow away the current dir
cd /

# FIXME userid should be constants across restores
tar zxvf /tmp/restore.tar.gz -C $HOME

# really move somewhere else
cd /

# Do not use json node binary. Seems to have some bug resulting in empty cloudron.conf
# in heredocs, single quotes preserves the quotes _and_ does variable expansion
REPLACE_TOKEN_JS=$(cat <<EOF
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('$HOME/.yellowtent/cloudron.conf', 'utf8'));
config.token = '$TOKEN';
fs.writeFileSync('$HOME/.yellowtent/cloudron.conf', JSON.stringify(config, null, 4));
EOF
)
echo "token replacer script: $REPLACE_TOKEN_JS"

sudo -u yellowtent -H bash <<EOF
node -e "$REPLACE_TOKEN_JS"
# TODO: do not auto-start stopped containers (httpPort might need fixing to start them)
sqlite3 $HOME/.yellowtent/config/config.sqlite.db 'UPDATE apps SET installationState = "pending_restore", healthy = NULL, runState = NULL, containerId = NULL, httpPort = NULL, installationProgress = NULL'
EOF

echo "Restart nginx"
supervisorctl restart nginx

echo "Starting box"
supervisorctl start box

echo "Restore over"

