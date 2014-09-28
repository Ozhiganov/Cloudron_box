#!/bin/bash

set -e

CLOUDRON_CONF="/home/yellowtent/.yellowtent/cloudron.conf"
DOMAIN_NAME=`hostname -f`
HARAKA_DIR="/home/yellowtent/.yellowtent/haraka"

CONTAINER_ID=$(docker run -d --name="haraka" \
    -p 127.0.0.1:25:25 \
    -h $DOMAIN_NAME \
    -e DOMAIN_NAME=$DOMAIN_NAME \
    -v $HARAKA_DIR:/app/data girish/haraka:0.1)

MAIL_SERVER=$(docker inspect --format="{{ .NetworkSettings.IPAddress }}" $CONTAINER_ID)

cat > /tmp/script.js <<EOF
var fs = require('fs');
var data = fs.existsSync("$CLOUDRON_CONF")
    ? JSON.parse(fs.readFileSync("$CLOUDRON_CONF", 'utf8'))
    : { };
data.mailServer = "$MAIL_SERVER";
fs.writeFileSync("$CLOUDRON_CONF", JSON.stringify(data));
EOF

node /tmp/script.js
rm /tmp/script.js

