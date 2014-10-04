#!/bin/bash

if [ $EUID -ne 0 ]; then
    echo "This script should be run as root." > /dev/stderr
    exit 1
fi

if [ "$1" == "--check" ]; then
    echo "OK"
    exit 0
fi

set -e

# http://tmont.com/blargh/2014/1/uploading-to-s3-in-bash
# http://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html

NOW=$(date +%Y-%m-%dT%H:%M:%S)
LOG=/var/log/cloudron/backup-${NOW}.log
exec 2>&1 1> $LOG

if [ $# -lt 4 ]; then
    echo "Usage: backup.sh <S3 Key> <S3 Secret> <S3 Prefix> <S3 Bucket> [restart_box_code_flag]"
    exit 1
fi

S3_KEY=$1
S3_SECRET=$2
S3_PREFIX=$3
S3_BUCKET=$4

# Stop the box
echo "Stopping box"
supervisorctl stop box

CONTAINER_IDS=$(docker ps -q)

# Stop all containers
echo "Stopping all running containers"
docker stop $CONTAINER_IDS

DATE_HEADER=$(date "+%a, %d %b %Y %T %z") # Tue, 27 Mar 2007 19:36:42 +0000
FILE="backup_${NOW}.tar.gz"

RESOURCE="/${S3_BUCKET}/${S3_PREFIX}/${FILE}"
CONTENT_TYPE="application/x-compressed-tar"
STRING_TO_SIGN="PUT\n\n${CONTENT_TYPE}\n${DATE_HEADER}\n${RESOURCE}"
SIGNATURE=`echo -en ${STRING_TO_SIGN} | openssl sha1 -hmac ${S3_SECRET} -binary | base64`

echo "Uploading backup: $RESOURCE"
cd $HOME && tar czf /tmp/$FILE box .yellowtent
curl -X PUT -T "/tmp/${FILE}" \
    -H "Host: ${S3_BUCKET}.s3.amazonaws.com" \
    -H "Date: ${DATE_HEADER}" \
    -H "Content-Type: ${CONTENT_TYPE}" \
    -H "Authorization: AWS ${S3_KEY}:${SIGNATURE}" \
    https://${S3_BUCKET}.s3.amazonaws.com/${S3_PREFIX}/${FILE}

rm /tmp/${FILE}

echo "Starting all containers"
MAIL_SERVER="172.17.120.120"
arp -d $MAIL_SERVER || echo "ARP does not have mail server entry"
docker start $CONTAINER_IDS

# skip restarting the box code if a 5th argument is provided, this is for the update case
if [[ ! $5 ]]; then
    echo "Starting box"
    supervisorctl start box
fi

echo "Backup over"

