/* jslint node:true */

'use strict';

var config = require('../config.js'),
    path = require('path');

// keep these values in sync with start.sh
exports = module.exports = {
    NGINX_CONFIG_DIR: path.join(config.baseDir(), 'configs/nginx'),
    NGINX_APPCONFIG_DIR: path.join(config.baseDir(), 'configs/nginx/applications'),
    NGINX_CERT_DIR: path.join(config.baseDir(), 'configs/nginx/cert'),

    ADDON_CONFIG_DIR: path.join(config.baseDir(), 'configs/addons'),

    APPLOGS_DIR: path.join(config.baseDir(), 'logs'),

    MAIL_DATA_DIR: path.join(config.baseDir(), 'data/mail'),

    COLLECTD_APPCONFIG_DIR: path.join(config.baseDir(), 'configs/collectd/collectd.conf.d'),

    DATA_DIR: path.join(config.baseDir(), 'data'),
    APPDATA_DIR: path.join(config.baseDir(), 'data/appdata'),
    DATABASE_FILENAME: path.join(config.baseDir(), 'data/cloudron.sqlite'),

    APPICONS_DIR: path.join(config.baseDir(), 'data/appicons')
};

