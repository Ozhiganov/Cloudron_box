'use strict';

var config = require('./config.js'),
    path = require('path');

// keep these values in sync with start.sh
exports = module.exports = {
    NGINX_CONFIG_DIR: path.join(config.baseDir(), 'data/nginx'),
    NGINX_APPCONFIG_DIR: path.join(config.baseDir(), 'data/nginx/applications'),
    NGINX_CERT_DIR: path.join(config.baseDir(), 'data/nginx/cert'),

    ADDON_CONFIG_DIR: path.join(config.baseDir(), 'data/addons'),

    COLLECTD_APPCONFIG_DIR: path.join(config.baseDir(), 'data/collectd/collectd.conf.d'),

    DATA_DIR: path.join(config.baseDir(), 'data'),
    BOX_DATA_DIR: path.join(config.baseDir(), 'data/box'),
    // this is not part of appdata because an icon may be set before install
    APPICONS_DIR: path.join(config.baseDir(), 'data/box/appicons'),
    APP_CERTS_DIR: path.join(config.baseDir(), 'data/box/certs'),
    MAIL_DATA_DIR: path.join(config.baseDir(), 'data/mail'),

    CLOUDRON_AVATAR_FILE: path.join(config.baseDir(), 'data/box/avatar.png'),
    CLOUDRON_DEFAULT_AVATAR_FILE: path.join(__dirname + '/../assets/avatar.png'),
    FIRST_RUN_FILE: path.join(config.baseDir(), 'data/box/first_run'),

    UPDATE_CHECKER_FILE: path.join(config.baseDir(), 'data/box/updatechecker.json'),

    ACME_CHALLENGES_DIR: path.join(config.baseDir(), 'data/acme'),
    ACME_ACCOUNT_KEY_FILE: path.join(config.baseDir(), 'data/box/acme/acme.key'),

    INFRA_VERSION_FILE: path.join(config.baseDir(), 'data/INFRA_VERSION')
};
