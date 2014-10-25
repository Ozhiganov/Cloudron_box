#!/bin/bash

set -e

if [ $EUID -ne 0 ]; then
    echo "This script should be run as root." > /dev/stderr
    exit 1
fi

if [ "$1" == "--check" ]; then
    echo "OK"
    exit 2
fi

if [[ "$#" != "3" ]]; then
    echo "Usage: update.sh <version> <revision/tag/branch> <backup url>"
    exit 1
fi

VERSION="$1"
REVISION="$2"
BACKUP_URL="$3"

SRCDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

exec > >(tee /var/log/cloudron/update.log)
exec 2>&1

echo "Updating $SRCDIR to Version:$1 to Revision:$REVISION from Backup:$BACKUP_URL\n"

cd "$SRCDIR"

echo "Perform backup first"
if ! ./src/scripts/backup.sh "$BACKUP_URL" ; then
    echo "Backup failed."
    exit 1
fi

echo "Fetch latest code..."
if ! git fetch ; then
    echo "Fetch failed."
    exit 1
fi

echo "Reset repo to latest code..."
git reset --hard $REVISION

echo "Updating npm modules"
if ! npm install --production ; then
    echo "Failed to update npm modules."
    exit 1
fi

PATH=$PATH:$SRCDIR/node_modules/.bin npm run-script migrate_data

# FIXME: should instead run above commands as user but I cannot figure
# how to get log redirection to work
chown -R yellowtent:yellowtent "$SRCDIR"

echo "Run release update script..."
UPDATE_FILE="$SRCDIR/updates/${VERSION}.sh"
if [ -x "$UPDATE_FILE" ]; then
    /bin/bash "$UPDATE_FILE" 2>&1
    if [[ $? != 0 ]]; then
        echo "Failed to run $UPDATE_FILE"
    else
        echo "Successfully ran $UPDATE_FILE"
    fi
else
    echo "No update script to run"
fi

echo "Starting box..."
OUT=`supervisorctl start box`
RESULT=`echo $OUT | grep echo`
if [[ $RESULT != "" ]]; then
    echo "Failed to start box"
    echo "$OUT"
    exit 1;
fi
echo "Done"

echo "Restarting nginx..."
OUT=`supervisorctl restart nginx`
RESULT=`echo $OUT | grep echo`
if [[ $RESULT != "" ]]; then
    echo "Failed to restart nginx"
    echo "$OUT"
    exit 1;
fi

echo "Update successful."
