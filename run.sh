#!/bin/sh

echo
echo "Starting YellowTent server at port 443..."
echo

BASEDIR=$(dirname $0)
#### When using it as a future start suite
# if [[ `whoami` == root ]]; then
#     echo "Do not run the script as root!"
#     echo "This script spawns nginx with sudo as well as unprivileged servers."
#     echo
#     exit 1;
# fi

sudo mkdir -p /var/log/supervisord
sudo NGINX_ROOT=$BASEDIR supervisord -n -c supervisor/supervisord.conf

