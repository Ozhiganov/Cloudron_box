'use strict';

var apps = require('./apps.js'),
    AppsError = apps.AppsError,
    assert = require('assert'),
    async = require('async'),
    constants = require('../constants.js'),
    settingsdb = require('./settingsdb.js'),
    util = require('util');

exports = module.exports = {
    SettingsError: SettingsError,

    getNakedDomain: getNakedDomain,
    setNakedDomain: setNakedDomain
};

function SettingsError(reason, errorOrMessage) {
    assert(typeof reason === 'string');
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
util.inherits(SettingsError, Error);
SettingsError.INTERNAL_ERROR = 'Internal Error';
SettingsError.NOT_FOUND = 'Not Found';

function getNakedDomain(callback) {
    assert(typeof callback === 'function');

    settingsdb.getNakedDomain(function (error, nakedDomain) {
        if (error) return callback(error);

        callback(null, nakedDomain);
    });
}

function getApp(appId, callback) {
    if (appId === constants.ADMIN_APPID) return callback(null, null);

    apps.get(appId, callback);
}

function setNakedDomain(appId, callback) {
    assert(typeof appId === 'string');
    assert(typeof callback === 'function');

    var apptask = require('./apptask.js'); // TODO: here to avoid circular dep

    getApp(appId, function (error, app) {
        if (error && error.reason === AppsError.NOT_FOUND) return callback(new SettingsError(SettingsError.NOT_FOUND));

        async.series([
            apptask.writeNginxNakedDomainConfig.bind(null, app),
            settingsdb.setNakedDomain.bind(null, appId)
        ], function (error) {
            if (error) return callback(new SettingsError(SettingsError.INTERNAL_ERROR, error));

            callback(null);
        });
    });
}

