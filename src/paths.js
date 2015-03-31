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

    COLLECTD_APPCONFIG_DIR: path.join(config.baseDir(), 'configs/collectd/collectd.conf.d'),

    DATA_DIR: path.join(config.baseDir(), 'data'),
    BOX_DATA_DIR: path.join(config.baseDir(), 'data/box'),
    APPICONS_DIR: path.join(config.baseDir(), 'data/box/appicons'),
    MAIL_DATA_DIR: path.join(config.baseDir(), 'data/box/mail')
};

