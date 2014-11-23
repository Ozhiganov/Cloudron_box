/* jslint node:true */

'use strict';

var appdb = require('./appdb.js'),
    assert = require('assert'),
    cloudron = require('./cloudron.js'),
    config = require('../config.js'),
    debug = require('debug')('box:updater'),
    execFile = require('child_process').execFile,
    fs = require('fs'),
    path = require('path'),
    paths = require('./paths.js'),
    safe = require('safetydance'),
    superagent = require('superagent');

var UPDATE_URL = 'http://127.0.0.1:2020/api/v1/installer/update';

var gCheckUpdatesTimeoutId = null,
    gAppUpdateInfo = null,
    gBoxUpdateInfo = null;

module.exports = exports = {
    initialize: initialize,
    uninitialize: uninitialize,

    getUpdateInfo: getUpdateInfo,
    update: update,
    isDev: isDev
};

function getUpdateInfo() {
    return {
        apps: gAppUpdateInfo,
        box: gBoxUpdateInfo
    };
};

function checkAppUpdates(callback) {
    debug('Checking app updates');
    appdb.getAppVersions(function (error, appVersions) {
        if (error) return callback(error);

        var appStoreIds = appVersions.map(function (appVersion) { return appVersion.appStoreId; });

        superagent.post(config.appServerUrl() + '/api/v1/appupdates').send({ appIds: appStoreIds }).end(function (error, result) {
            if (error) return callback(error);
            if (result.statusCode !== 200) return callback(new Error('Error checking app update: ' + result.statusCode + ' ' + result.body.message));

            debug('appupdate: %j', result.body);

            callback(null, result.body.appVersions);
        });
    });
}

function checkBoxUpdates(callback) {
    debug('checking for box update');

    superagent.get(config.get('boxVersionsUrl')).end(function (error, result) {
        if (error) return callback(error);
        if (result.status !== 200) return callback(new Error('Bad status:', result.status));

        debug('versions : %j', result.text);

        var versions = safe.JSON.parse(result.text);

        if (!versions) return callback(new Error('versions is not valid json:' + safe.error));

        var currentVersionInfo = versions[config.version()];
        if (!currentVersionInfo) return callback(new Error('Cloudron runs on unknown version %s', config.version()));

        var nextVersion = currentVersionInfo.next;
        var nextVersionInfo = nextVersion ? versions[nextVersion] : null;

        if (nextVersionInfo && nextVersionInfo.revision && nextVersionInfo.imageId) {
            debug('boxupdate: new version %s available. revision: %s, imageId: %d', nextVersion, nextVersionInfo.revision, nextVersionInfo.imageId);
            callback(null, { version: nextVersion, info: nextVersionInfo, upgrade: nextVersionInfo.imageId !== currentVersionInfo.imageId });
        } else {
            debug('boxupdate: no new version available.');
            callback(null, null);
        }
    });
};

function checkUpdates() {
    checkAppUpdates(function (error, appUpdateInfo) {
        if (error) debug('Error checkihg app updates: ', error);

        if (appUpdateInfo) gAppUpdateInfo = appUpdateInfo;

        checkBoxUpdates(function (error, result) {
            if (error) debug('Error checkihg box updates: ', error);

            if (result) gBoxUpdateInfo = result;

            gCheckUpdatesTimeoutId = setTimeout(checkUpdates, 60 * 1000);
        });
    });
}

function initialize(callback) {
    assert(typeof callback === 'function');

    gCheckUpdatesTimeoutId = setTimeout(checkUpdates, 10 * 1000);
    callback(null);
};

function uninitialize(callback) {
    assert(typeof callback === 'function');

    clearTimeout(gCheckUpdatesTimeoutId);
    gCheckUpdatesTimeoutId = null;

    callback(null);
};

function isDev() {
    return /dev/i.test(config.get('boxVersionsUrl'));
}

function update(callback) {
    assert(typeof callback === 'function');

    if (!isDev() && !gBoxUpdateInfo) {
        debug('update: no box update available');
        return callback(new Error('No update available'));
    }

    cloudron.backup(function (error) {
        if (error) return callback(error);

        if (gBoxUpdateInfo && gBoxUpdateInfo.upgrade) {
            debug('update: box needs upgrade');

            superagent.post(config.appServerUrl() + '/api/v1/boxes/' + config.fqdn() + '/upgrade')
                .query({ token: config.token() })
                .send({ imageId: gBoxUpdateInfo.imageId })
                .end(function (error, result) {
                if (error) return callback(new Error('Error making upgrade request: ' + error));
                if (result.status !== 202) return callback(new Error('Server not ready to upgrade: ' + result.body));

                callback(null);
            });

            return;
        }

        var args = {
            appServerUrl: config.appServerUrl(),
            fqdn: config.fqdn(),
            version: isDev() ? 'latest' : gBoxUpdateInfo.version,
            token: config.token(),
            tls: {
                cert: fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.cert'), 'utf8'),
                key: fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.key'), 'utf8')
            },
            boxVersionsUrl: config.get('boxVersionsUrl')
        };

        debug('updater: updating box %j', args);

        superagent.post(UPDATE_URL)
            .send(args)
            .end(function (error, result) {
                if (error) return callback(error);
                if (result.status !== 202) return callback(new Error('Error initiating update: ' + result.body));

                callback(null);
        });

        // Do not add any code here. The installer script will stop the box code any instant
    });
}

