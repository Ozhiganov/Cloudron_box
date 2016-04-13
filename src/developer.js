/* jslint node: true */

'use strict';

exports = module.exports = {
    DeveloperError: DeveloperError,

    enabled: enabled,
    setEnabled: setEnabled,
    issueDeveloperToken: issueDeveloperToken,
    getNonApprovedApps: getNonApprovedApps
};

var assert = require('assert'),
    config = require('./config.js'),
    debug = require('debug')('box:developer'),
    tokendb = require('./tokendb.js'),
    settings = require('./settings.js'),
    superagent = require('superagent'),
    util = require('util');

function DeveloperError(reason, errorOrMessage) {
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
util.inherits(DeveloperError, Error);
DeveloperError.INTERNAL_ERROR = 'Internal Error';
DeveloperError.EXTERNAL_ERROR = 'External Error';

function enabled(callback) {
    assert.strictEqual(typeof callback, 'function');

    settings.getDeveloperMode(function (error, enabled) {
        if (error) return callback(new DeveloperError(DeveloperError.INTERNAL_ERROR, error));
        callback(null, enabled);
    });
}

function setEnabled(enabled, callback) {
    assert.strictEqual(typeof enabled, 'boolean');
    assert.strictEqual(typeof callback, 'function');

    settings.setDeveloperMode(enabled, function (error) {
        if (error) return callback(new DeveloperError(DeveloperError.INTERNAL_ERROR, error));
        callback(null);
    });
}

function issueDeveloperToken(user, callback) {
    assert.strictEqual(typeof user, 'object');
    assert.strictEqual(typeof callback, 'function');

    var token = tokendb.generateToken();
    var expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 1 day

    tokendb.add(token, tokendb.PREFIX_DEV + user.id, '', expiresAt, 'developer,apps,settings,users,profile', function (error) {
        if (error) return callback(new DeveloperError(DeveloperError.INTERNAL_ERROR, error));

        callback(null, { token: token, expiresAt: expiresAt });
    });
}

function getNonApprovedApps(callback) {
    assert.strictEqual(typeof callback, 'function');

    var url = config.apiServerOrigin() + '/api/v1/boxes/' + config.fqdn() + '/apps';
    superagent.get(url).query({ token: config.token(), boxVersion: config.version() }).end(function (error, result) {
        if (error && !error.response) return callback(new DeveloperError(DeveloperError.EXTERNAL_ERROR, error));
        if (result.statusCode === 401) {
            debug('Failed to list apps in development. Appstore token invalid or missing. Returning empty list.', result.body);
            return callback(null, []);
        }
        if (result.statusCode !== 200) return callback(new DeveloperError(DeveloperError.EXTERNAL_ERROR, util.format('App listing failed. %s %j', result.status, result.body)));

        callback(null, result.body.apps || []);
    });
}
