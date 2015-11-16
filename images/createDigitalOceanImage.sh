#!/bin/bash

set -eu -o pipefail

assertNotEmpty() {
    : "${!1:? "$1 is not set."}"
}

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
readonly JSON="${INSTALLER_DIR}/node_modules/.bin/json"

installer_revision=$(git rev-parse HEAD)
box_size="512mb"
image_regions=(sfo1 ams3)
box_name=""
droplet_id=""
droplet_ip=""
destroy_droplet="yes"
deploy_env="dev"

# Only GNU getopt supports long options. OS X comes bundled with the BSD getopt
# brew install gnu-getopt to get the GNU getopt on OS X
[[ $(uname -s) == "Darwin" ]] && GNU_GETOPT="/usr/local/opt/gnu-getopt/bin/getopt" || GNU_GETOPT="getopt"
readonly GNU_GETOPT

args=$(${GNU_GETOPT} -o "" -l "revision:,regions:,size:,box:,no-destroy,env:" -n "$0" -- "$@")
eval set -- "${args}"

while true; do
    case "$1" in
    --env) deploy_env="$2"; shift 2;;
    --revision) installer_revision="$2"; shift 2;;
    --regions) image_regions=("$2"); shift 2;; # parse as whitespace separated array
    --size) box_size="$2"; shift 2;;
    --box) box_name="$2"; destroy_droplet="no"; shift 2;;
    --no-destroy) destroy_droplet="no"; shift 2;;
    --) break;;
    *) echo "Unknown option $1"; exit 1;;
    esac
done

# set DO token, picked up by digitalOceanFunctions.sh
if [[ "${deploy_env}" == "staging" ]]; then
    assertNotEmpty DIGITAL_OCEAN_TOKEN_STAGING
    readonly DIGITAL_OCEAN_TOKEN="${DIGITAL_OCEAN_TOKEN_STAGING}"
elif [[ "${deploy_env}" == "dev" ]]; then
    assertNotEmpty DIGITAL_OCEAN_TOKEN_DEV
    readonly DIGITAL_OCEAN_TOKEN="${DIGITAL_OCEAN_TOKEN_DEV}"
elif [[ "${deploy_env}" == "prod" ]]; then
    assertNotEmpty DIGITAL_OCEAN_TOKEN_PROD
    readonly DIGITAL_OCEAN_TOKEN="${DIGITAL_OCEAN_TOKEN_PROD}"
else
    echo "No such env ${deploy_env}."
    exit 1
fi
source "${SCRIPT_DIR}/digitalOceanFunctions.sh"

readonly ssh_keys="${HOME}/.ssh/id_rsa_caas_${deploy_env}"
readonly scp202="scp -P 202 -o ConnectTimeout=10 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i ${ssh_keys}"
readonly scp22="scp -o ConnectTimeout=10 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i ${ssh_keys}"

readonly ssh202="ssh -p 202 -o IdentitiesOnly=yes -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i ${ssh_keys}"
readonly ssh22="ssh -o IdentitiesOnly=yes -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i ${ssh_keys}"

if [[ ! -f "${ssh_keys}" ]]; then
    echo "caas ssh key is missing at ${ssh_keys} (pick it up from secrets repo)"
    exit 1
fi

function get_pretty_revision() {
    local git_rev="$1"
    local sha1=$(git rev-parse --short "${git_rev}" 2>/dev/null)

    echo "${sha1}"
}

now=$(date "+%Y-%m-%d-%H%M%S")
pretty_revision=$(get_pretty_revision "${installer_revision}")

if [[ -z "${box_name}" ]]; then
    # if you change this, change the regexp is appstore/janitor.js
    box_name="box-${deploy_env}-${pretty_revision}-${now}" # remove slashes

    # create a new droplet if no name given
    caas_ssh_key_id=$(get_ssh_key_id "caas")
    if [[ -z "${caas_ssh_key_id}" ]]; then
        echo "Could not query caas ssh key"
        exit 1
    fi
    echo "Detected yellowtent ssh key id: ${caas_ssh_key_id}"

    echo "Creating Droplet with name [${box_name}] at [${image_regions[0]}] with size [${box_size}]"
    droplet_id=$(create_droplet ${caas_ssh_key_id} ${box_name} ${box_size} ${image_regions[0]})
    if [[ -z "${droplet_id}" ]]; then
        echo "Failed to create droplet"
        exit 1
    fi
    echo "Created droplet with id: ${droplet_id}"

    # If we run scripts overenthusiastically without the wait, setup script randomly fails
    echo -n "Waiting 120 seconds for droplet creation"
    for i in $(seq 1 24); do
        echo -n "."
        sleep 5
    done
    echo ""
else
    droplet_id=$(get_droplet_id "${box_name}")
    echo "Reusing droplet with id: ${droplet_id}"

    power_on_droplet "${droplet_id}"
fi

# Query DO until we get an IP
while true; do
    echo "Trying to get the droplet IP"
    droplet_ip=$(get_droplet_ip "${droplet_id}")
    if [[ "${droplet_ip}" != "" ]]; then
        echo "Droplet IP : [${droplet_ip}]"
        break
    fi
    echo "Timedout, trying again in 10 seconds"
    sleep 10
done

while true; do
    echo "Trying to copy init script to droplet"
    if $scp22 "${SCRIPT_DIR}/initializeBaseUbuntuImage.sh" root@${droplet_ip}:.; then
        break
    fi
    echo "Timedout, trying again in 30 seconds"
    sleep 30
done

echo "Copying INFRA_VERSION"
$scp22 "${SCRIPT_DIR}/../../box/setup/INFRA_VERSION" root@${droplet_ip}:.

echo "Copying installer source"
cd "${INSTALLER_DIR}"
git archive --format=tar HEAD | $ssh22 "root@${droplet_ip}" "cat - > /root/installer.tar"

echo "Executing init script"
if ! $ssh22 "root@${droplet_ip}" "/bin/bash /root/initializeBaseUbuntuImage.sh ${installer_revision}"; then
    echo "Init script failed"
    exit 1
fi

echo "Copy over certs"
cd "${SCRIPT_DIR}/../../secrets"
blackbox_cat installer/server.crt.gpg | $ssh202 "root@${droplet_ip}" "cat - > /home/yellowtent/installer/src/certs/server.crt"
blackbox_cat installer/server.key.gpg | $ssh202 "root@${droplet_ip}" "cat - > /home/yellowtent/installer/src/certs/server.key"
blackbox_cat installer_ca/ca.crt.gpg  | $ssh202 "root@${droplet_ip}" "cat - > /home/yellowtent/installer/src/certs/ca.crt"

echo "Shutting down droplet with id : ${droplet_id}"
$ssh202 "root@${droplet_ip}" "shutdown -f now" || true # shutdown sometimes terminates ssh connection immediately making this command fail

# wait 10 secs for actual shutdown
echo "Waiting for 10 seconds for droplet to shutdown"
sleep 30

echo "Powering off droplet"
power_off_droplet "${droplet_id}"

snapshot_name="box-${deploy_env}-${pretty_revision}-${now}"
echo "Snapshotting as ${snapshot_name}"
snapshot_droplet "${droplet_id}" "${snapshot_name}"

image_id=$(get_image_id "${snapshot_name}")
echo "Image id is ${image_id}"

if [[ "${destroy_droplet}" == "yes" ]]; then
    echo "Destroying droplet"
    destroy_droplet "${droplet_id}"
else
    echo "Skipping droplet destroy"
fi

echo "Transferring image to other regions"
xfer_events=()
# skip the first region, as the image was created there
for image_region in ${image_regions[@]:1}; do
    xfer_event=$(transfer_image ${image_id} ${image_region})
    echo "Image transfer to ${image_region} initiated. Event id: ${xfer_event}"
    xfer_events+=("${xfer_event}")
    sleep 1
done

echo "Image transfer initiated, but they will take some time to get transferred."

for xfer_event in ${xfer_events[@]}; do
    wait_for_image_event "${image_id}" "${xfer_event}"
done

echo "Done."

