#!/bin/bash

set -v
set -e

USER_HOME=/home/yellowtent
SRCDIR=$USER_HOME/box
USER=yellowtent

echo "==== Create User $USER ===="
id $USER
if [[ $? -ne 0 ]]; then
    rm -rf /home/$USER
    useradd $USER -m
fi

# now exit on failure
set -e

echo "== Yellowtent base image preparation =="

export DEBIAN_FRONTEND=noninteractive

echo "==== Install project dependencies ===="
apt-get update


echo "==== Setup nodejs ===="
apt-get -y install nodejs npm
ln -sf /usr/bin/nodejs /usr/bin/node


echo "==== Setup git ===="
apt-get -y install git


echo "==== Setup docker ===="
# see http://idolstarastronomer.com/painless-docker.html
echo deb https://get.docker.io/ubuntu docker main > /etc/apt/sources.list.d/docker.list
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 36A1D7869245C8950F966E92D8576A8BA88D21E9
apt-get update
apt-get -y install lxc-docker
ln -sf /usr/bin/docker.io /usr/local/bin/docker
# now add the user to the docker group
usermod $USER -a -G docker


echo "==== Setup nginx ===="
apt-get -y install nginx-full
service nginx stop
update-rc.d -f nginx remove

echo "==== Setup build-essential ===="
apt-get -y install build-essential


echo "==== Setup sqlite3 ===="
apt-get -y install sqlite3


echo "==== Setup supervisor ===="
apt-get -y install supervisor
service supervisor stop
update-rc.d -f supervisor remove

echo "== Box bootstrapping =="


echo "==== Cloning box repo ===="
if [ -d "$SRCDIR/.git" ]; then
    echo "Updating the box repo"
    cd $SRCDIR
    git fetch
    git reset --hard origin/master
else
    echo "Cloning the box repo"
    rm -rf $SRCDIR
    mkdir -p $USER_HOME
    cd $USER_HOME
    git clone http://bootstrap:not4long@yellowtent.girish.in/yellowtent/box.git
    cd box
    git checkout -b master origin/master
fi

NPM_INSTALL="npm install --production"
rm -rf ./node_modules
eval $NPM_INSTALL
RET=$?
while [[ $RET -ne 0 ]]; do
    echo "[EE] npm install failed, try again"
    rm -rf ./node_modules
    eval $NPM_INSTALL
    RET=$?
done


echo "==== Make the user own his home ===="
chown $USER:$USER -R /home/$USER


echo "==== Install init script ===="
cat > /etc/init.d/bootstrap <<EOF
#!/bin/sh

LOG="/tmp/bootstrap"

exec 2>&1 1> \$LOG

echo "[II] Update to latest git revision..."
cd $SRCDIR
sudo -u $USER bash <<EOS
git fetch
git reset --hard origin/master
EOS
echo "[II] Done"

echo "[II] Run bootstrap script..."
/bin/bash $SRCDIR/scripts/bootstrap.sh https://appstore-dev.herokuapp.com
# /bin/bash $SRCDIR/scripts/bootstrap.sh https://nebulon.fwd.wf
echo "[II] Done"

echo "[II] Disable bootstrap init script"
update-rc.d bootstrap remove
echo "[II] Done"
EOF
chmod +x /etc/init.d/bootstrap
update-rc.d bootstrap defaults
