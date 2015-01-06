#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -z "$DIGITAL_OCEAN_TOKEN" ]; then
    echo "Script requires DIGITAL_OCEAN_TOKEN env to be set"
    exit 1
fi

JSON="$SCRIPT_DIR/../node_modules/.bin/json"
CURL="curl -s -u $DIGITAL_OCEAN_TOKEN:"
UBUNTU_IMAGE_SLUG="ubuntu-14-04-x64" # ID=5141286
DATE=`date +%Y-%m-%d-%H%M%S`
BOX_REVISION=origin/master
BOX_REGION="sfo1"
BOX_SIZE="512mb"

ARGS=$(getopt -o "" -l "revision:,region:,size:" -n "$0" -- "$@")
eval set -- "$ARGS"

while true; do
    case "$1" in
    --revision) BOX_REVISION="$2";;
    --region) BOX_REGION="$2";;
    --size) BOX_SIZE="$2";;
    --) break;;
    *) echo "Unknown option $1"; exit 1;;
    esac

    shift 2
done

function get_pretty_revision() {
    local GIT_REV="$1"
    local SHA1=$(git rev-parse --short "$GIT_REV" 2>/dev/null)

    local NAME=$(git name-rev --name-only --tags "$SHA1" 2>/dev/null)
    if [[ -z "$NAME" ]]; then
        echo "Unable to resolve $1"
        exit 1
    fi

    # fallback to sha1 if we cannot find a tag
    if [[ "$NAME" = "undefined" ]]; then
        echo $SHA1
    else
        echo $NAME
    fi
}

PRETTY_REVISION=$(get_pretty_revision $BOX_REVISION)
BOX_NAME="box-$PRETTY_REVISION-$DATE" # remove slashes
SNAPSHOT_NAME="box-$PRETTY_REVISION-$DATE"

function get_ssh_key_id() {
    $CURL "https://api.digitalocean.com/v2/account/keys" \
        | $JSON ssh_keys \
        | $JSON -c "this.name === \"$1\"" \
        | $JSON 0.id
}

function create_droplet() {
    local SSH_KEY_ID="$1"
    local BOX_NAME="$2"

    local DATA="{\"name\":\"$BOX_NAME\",\"size\":\"$BOX_SIZE\",\"region\":\"$BOX_REGION\",\"image\":\"$UBUNTU_IMAGE_SLUG\",\"ssh_keys\":[ $SSH_KEY_ID ],\"backups\":false}"

    $CURL -X POST -H 'Content-Type: application/json' -d "$DATA" "https://api.digitalocean.com/v2/droplets" | $JSON droplet.id
}

function get_droplet_ip() {
    local DROPLET_ID="$1"
    $CURL "https://api.digitalocean.com/v2/droplets/$DROPLET_ID" | $JSON "droplet.networks.v4[0].ip_address"
}

function power_off_droplet() {
    local DROPLET_ID="$1"
    local DATA='{"type":"power_off"}'
    local EVENT_ID=`$CURL -X POST -H 'Content-Type: application/json' -d "$DATA" "https://api.digitalocean.com/v2/droplets/$DROPLET_ID/actions" | $JSON action.id`

    echo "Powered off droplet. Event id: $EVENT_ID"
    echo -n "Waiting for droplet to power off"

    while true; do
        local EVENT_STATUS=`$CURL "https://api.digitalocean.com/v2/droplets/$DROPLET_ID/actions/$EVENT_ID" | $JSON action.status`
        if [ "$EVENT_STATUS" == "completed" ]; then
            break
        fi
        echo -n "."
        sleep 10
    done
    echo ""
}

function snapshot_droplet() {
    local DROPLET_ID="$1"
    local SNAPSHOT_NAME="$2"
    local DATA="{\"type\":\"snapshot\",\"name\":\"$SNAPSHOT_NAME\"}"
    local EVENT_ID=`$CURL -X POST -H 'Content-Type: application/json' -d "$DATA" "https://api.digitalocean.com/v2/droplets/$DROPLET_ID/actions" | $JSON action.id`

    echo "Droplet snapshotted as $SNAPSHOT_NAME. Event id: $EVENT_ID"
    echo -n "Waiting for snapshot to complete"

    while true; do
        local EVENT_STATUS=`$CURL "https://api.digitalocean.com/v2/droplets/$DROPLET_ID/actions/$EVENT_ID" | $JSON action.status`
        if [ "$EVENT_STATUS" == "completed" ]; then
            break
        fi
        echo -n "."
        sleep 10
    done
    echo ""
}

function destroy_droplet() {
    local DROPLET_ID="$1"
    # TODO: check for 204 status
    $CURL -X DELETE "https://api.digitalocean.com/v2/droplets/$DROPLET_ID"
    echo "Droplet destroyed"
    echo ""
}

function get_image_id() {
    local SNAPSHOT_NAME="$1"
    $CURL "https://api.digitalocean.com/v2/images" \
        | $JSON images \
        | $JSON -c "this.name === \"$SNAPSHOT_NAME\"" 0.id
}

# SCRIPT BEGIN

YELLOWTENT_SSH_KEY_ID=$(get_ssh_key_id "yellowtent")
if [ -z "$YELLOWTENT_SSH_KEY_ID" ]; then
    echo "Could not query yellowtent ssh key"
    exit 1
fi
echo "Detected yellowtent ssh key id: $YELLOWTENT_SSH_KEY_ID" # 124654 for yellowtent key

echo "Creating Droplet with name [$BOX_NAME]"
DROPLET_ID=$(create_droplet $YELLOWTENT_SSH_KEY_ID $BOX_NAME)
if [ -z "$DROPLET_ID" ]; then
    echo "Failed to create droplet"
    exit 1
fi
echo "Created droplet with id: $DROPLET_ID"

# Query DO until we get an IP
while true; do
    echo "Trying to get the droplet IP"
    DROPLET_IP=$(get_droplet_ip $DROPLET_ID)
    if [[ "$DROPLET_IP" != "" ]]; then
        echo "Droplet IP : [$DROPLET_IP]"
        break
    fi
    echo "Timedout, trying again in 10 seconds"
    sleep 10
done

# If we run scripts overenthusiastically without the wait, setup script randomly fails
echo -n "Waiting 120 seconds for droplet creation"
for i in $(seq 1 24); do
    echo -n "."
    sleep 5
done
echo ""

chmod o-rw,g-rw,u-w $SCRIPT_DIR/ssh/*
while true; do
    echo "Trying to copy init script to droplet"
    scp -o ConnectTimeout=10 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i $SCRIPT_DIR/ssh/id_rsa_yellowtent $SCRIPT_DIR/initializeBaseUbuntuImage.sh root@$DROPLET_IP:.
    if [ $? -eq 0 ]; then
        break
    fi
    echo "Timedout, trying again in 30 seconds"
    sleep 30
done

echo "Executing init script"
ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i $SCRIPT_DIR/ssh/id_rsa_yellowtent root@$DROPLET_IP "/bin/bash /root/initializeBaseUbuntuImage.sh $BOX_REVISION"
if [ $? -ne 0 ]; then
    echo "Init script failed"
    exit 1
fi

echo "Shutting down droplet with id : $DROPLET_ID"
ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i $SCRIPT_DIR/ssh/id_rsa_yellowtent root@$DROPLET_IP "shutdown -f now"

# wait 10 secs for actual shutdown
echo "Waiting for 10 seconds for droplet to shutdown"
sleep 30

echo "Powering off droplet"
(power_off_droplet $DROPLET_ID)

echo "Snapshotting as $SNAPSHOT_NAME"
(snapshot_droplet $DROPLET_ID $SNAPSHOT_NAME)

IMAGE_ID=$(get_image_id $SNAPSHOT_NAME)
echo "Image id is $IMAGE_ID"

echo "Destroying droplet"
(destroy_droplet $DROPLET_ID)

echo "Image id is $IMAGE_ID"

