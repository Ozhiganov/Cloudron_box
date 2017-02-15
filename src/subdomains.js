'use strict';

module.exports = exports = {
    remove: remove,
    upsert: upsert,
    get: get,
    waitForDns: waitForDns,
    verifyDnsConfig: verifyDnsConfig,

    SubdomainError: SubdomainError
};

var assert = require('assert'),
    config = require('./config.js'),
    settings = require('./settings.js'),
    util = require('util');

function SubdomainError(reason, errorOrMessage) {
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
util.inherits(SubdomainError, Error);

SubdomainError.NOT_FOUND = 'No such domain';
SubdomainError.EXTERNAL_ERROR = 'External error';
SubdomainError.BAD_FIELD = 'Bad Field';
SubdomainError.STILL_BUSY = 'Still busy';
SubdomainError.MISSING_CREDENTIALS = 'Missing credentials';
SubdomainError.INTERNAL_ERROR = 'Internal error';
SubdomainError.ACCESS_DENIED = 'Access denied';
SubdomainError.INVALID_PROVIDER = 'provider must be route53, digitalocean, noop, manual or caas';

// choose which subdomain backend we use for test purpose we use route53
function api(provider) {
    assert.strictEqual(typeof provider, 'string');

    switch (provider) {
        case 'caas': return require('./dns/caas.js');
        case 'route53': return require('./dns/route53.js');
        case 'digitalocean': return require('./dns/digitalocean.js');
        case 'noop': return require('./dns/noop.js');
        case 'manual': return require('./dns/manual.js');
        default: return null;
    }
}

function get(subdomain, type, callback) {
    assert.strictEqual(typeof subdomain, 'string');
    assert.strictEqual(typeof type, 'string');
    assert.strictEqual(typeof callback, 'function');

    settings.getDnsConfig(function (error, dnsConfig) {
        if (error) return callback(new SubdomainError(SubdomainError.INTERNAL_ERROR, error));

        api(dnsConfig.provider).get(dnsConfig, config.zoneName(), subdomain, type, function (error, values) {
            if (error) return callback(error);

            callback(null, values);
        });
    });
}

function upsert(subdomain, type, values, callback) {
    assert.strictEqual(typeof subdomain, 'string');
    assert.strictEqual(typeof type, 'string');
    assert(util.isArray(values));
    assert.strictEqual(typeof callback, 'function');

    settings.getDnsConfig(function (error, dnsConfig) {
        if (error) return callback(new SubdomainError(SubdomainError.INTERNAL_ERROR, error));

        api(dnsConfig.provider).upsert(dnsConfig, config.zoneName(), subdomain, type, values, function (error, changeId) {
            if (error) return callback(error);

            callback(null, changeId);
        });
    });
}

function remove(subdomain, type, values, callback) {
    assert.strictEqual(typeof subdomain, 'string');
    assert.strictEqual(typeof type, 'string');
    assert(util.isArray(values));
    assert.strictEqual(typeof callback, 'function');

    settings.getDnsConfig(function (error, dnsConfig) {
        if (error) return callback(new SubdomainError(SubdomainError.INTERNAL_ERROR, error));

        api(dnsConfig.provider).del(dnsConfig, config.zoneName(), subdomain, type, values, function (error) {
            if (error && error.reason !== SubdomainError.NOT_FOUND) return callback(error);

            callback(null);
        });
    });
}

function waitForDns(domain, value, type, options, callback) {
    assert.strictEqual(typeof domain, 'string');
    assert(typeof value === 'string' || util.isRegExp(value));
    assert(type === 'A' || type === 'CNAME' || type === 'TXT');
    assert(options && typeof options === 'object'); // { interval: 5000, times: 50000 }
    assert.strictEqual(typeof callback, 'function');

    settings.getDnsConfig(function (error, dnsConfig) {
        if (error) return callback(new SubdomainError(SubdomainError.INTERNAL_ERROR, error));

        api(dnsConfig.provider).waitForDns(domain, value, type, options, callback);
    });
}

function verifyDnsConfig(dnsConfig, domain, ip, callback) {
    assert(dnsConfig && typeof dnsConfig === 'object'); // the dns config to test with
    assert(typeof dnsConfig.provider === 'string');
    assert.strictEqual(typeof domain, 'string');
    assert.strictEqual(typeof ip, 'string');
    assert.strictEqual(typeof callback, 'function');

    var backend = api(dnsConfig.provider);
    if (!backend) return callback(new SubdomainError(SubdomainError.INVALID_PROVIDER));

    api(dnsConfig.provider).verifyDnsConfig(dnsConfig, domain, ip, callback);
}
