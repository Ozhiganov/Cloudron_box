'use strict';

exports = module.exports = {
    BackupsError: BackupsError,

    getAllPaged: getAllPaged,

    getBackupUrl: getBackupUrl,
    getRestoreUrl: getRestoreUrl,

    copyLastBackup: copyLastBackup
};

var assert = require('assert'),
    caas = require('./storage/caas.js'),
    config = require('./config.js'),
    debug = require('debug')('box:backups'),
    s3 = require('./storage/s3.js'),
    settings = require('./settings.js'),
    superagent = require('superagent'),
    util = require('util');

function BackupsError(reason, errorOrMessage) {
    assert.strictEqual(typeof reason, 'string');
    assert(errorOrMessage instanceof Error || typeof errorOrMessage === 'string' || typeof errorOrMessage === 'undefined');

    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.reason = reason;
    if (typeof errorOrMessage === 'undefined') {
        this.message = reason;
    } else if (typeof errorOrMessage === 'string') {
        this.message = errorOrMessage;
    } else {
        this.message = 'Internal error';
        this.nestedError = errorOrMessage;
    }
}
util.inherits(BackupsError, Error);
BackupsError.EXTERNAL_ERROR = 'external error';
BackupsError.INTERNAL_ERROR = 'internal error';
BackupsError.MISSING_CREDENTIALS = 'missing credentials';

// choose which storage backend we use for test purpose we use s3
function api(provider) {
    switch (provider) {
        case 'caas': return caas;
        case 's3': return s3;
        default: return null
    }
}

function getAllPaged(page, perPage, callback) {
    assert.strictEqual(typeof page, 'number');
    assert.strictEqual(typeof perPage, 'number');
    assert.strictEqual(typeof callback, 'function');

    var url = config.apiServerOrigin() + '/api/v1/boxes/' + config.fqdn() + '/backups';

    settings.getBackupConfig(function (error, backupConfig) {
        if (error) return callback(new BackupsError(BackupsError.INTERNAL_ERROR, error));

        superagent.get(url).query({ token: backupConfig.token }).end(function (error, result) {
            if (error) return callback(new BackupsError(BackupsError.EXTERNAL_ERROR, error));
            if (result.statusCode !== 200) return callback(new BackupsError(BackupsError.EXTERNAL_ERROR, result.text));
            if (!result.body || !util.isArray(result.body.backups)) return callback(new BackupsError(BackupsError.EXTERNAL_ERROR, 'Unexpected response'));

            // [ { creationTime, boxVersion, restoreKey, dependsOn: [ ] } ] sorted by time (latest first)
            return callback(null, result.body.backups);
        });
    });
}

function getBackupUrl(app, callback) {
    assert(!app || typeof app === 'object');
    assert.strictEqual(typeof callback, 'function');

    var filename = '';
    if (app) {
        filename = util.format('appbackup_%s_%s-v%s.tar.gz', app.id, (new Date()).toISOString(), app.manifest.version);
    } else {
        filename = util.format('backup_%s-v%s.tar.gz', (new Date()).toISOString(), config.version());
    }

    settings.getBackupConfig(function (error, backupConfig) {
        if (error) return callback(new BackupsError(BackupsError.INTERNAL_ERROR, error));

        api(backupConfig.provider).getSignedUploadUrl(backupConfig, filename, function (error, result) {
            if (error) return callback(error);

            var obj = {
                id: filename,
                url: result.url,
                sessionToken: result.sessionToken,
                backupKey: backupConfig.key
            };

            debug('getBackupUrl: id:%s url:%s sessionToken:%s backupKey:%s', obj.id, obj.url, obj.sessionToken, obj.backupKey);

            callback(null, obj);
        });
    });
}

// backupId is the s3 filename. appbackup_%s_%s-v%s.tar.gz
function getRestoreUrl(backupId, callback) {
    assert.strictEqual(typeof backupId, 'string');
    assert.strictEqual(typeof callback, 'function');

    settings.getBackupConfig(function (error, backupConfig) {
        if (error) return callback(new BackupsError(BackupsError.INTERNAL_ERROR, error));

        api(backupConfig.provider).getSignedDownloadUrl(backupConfig, backupId, function (error, result) {
            if (error) return callback(error);

            var obj = {
                id: backupId,
                url: result.url,
                sessionToken: result.sessionToken,
                backupKey: backupConfig.key
            };

            debug('getRestoreUrl: id:%s url:%s sessionToken:%s backupKey:%s', obj.id, obj.url, obj.sessionToken, obj.backupKey);

            callback(null, obj);
        });
    });
}

function copyLastBackup(app, callback) {
    assert(app && typeof app === 'object');
    assert.strictEqual(typeof app.lastBackupId, 'string');
    assert.strictEqual(typeof callback, 'function');

    var toFilename = util.format('appbackup_%s_%s-v%s.tar.gz', app.id, (new Date()).toISOString(), app.manifest.version);

    settings.getBackupConfig(function (error, backupConfig) {
        if (error) return callback(new BackupsError(BackupsError.INTERNAL_ERROR, error));

        api(backupConfig.provider).copyObject(backupConfig, app.lastBackupId, toFilename, function (error) {
            if (error) return callback(new BackupsError(BackupsError.EXTERNAL_ERROR, error));

            return callback(null, toFilename);
        });
    });
}
