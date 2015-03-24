/* jslint node:true */

'use strict';

var assert = require('assert'),
    async = require('async'),
    database = require('./database.js'),
    DatabaseError = require('./databaseerror'),
    debug = require('debug')('box:appdb'),
    safe = require('safetydance'),
    util = require('util');

exports = module.exports = {
    get: get,
    getBySubdomain: getBySubdomain,
    getByHttpPort: getByHttpPort,
    add: add,
    exists: exists,
    del: del,
    update: update,
    getAll: getAll,
    getPortBindings: getPortBindings,

    setAddonConfig: setAddonConfig,
    getAddonConfig: getAddonConfig,
    getAddonConfigByAppId: getAddonConfigByAppId,
    unsetAddonConfig: unsetAddonConfig,
    unsetAddonConfigByAppId: unsetAddonConfigByAppId,

    setHealth: setHealth,
    setInstallationCommand: setInstallationCommand,
    setRunCommand: setRunCommand,
    getAppStoreIds: getAppStoreIds,

    // installation codes (keep in sync in UI)
    ISTATE_PENDING_INSTALL: 'pending_install',
    ISTATE_PENDING_CONFIGURE: 'pending_configure',
    ISTATE_PENDING_UNINSTALL: 'pending_uninstall',
    ISTATE_PENDING_RESTORE: 'pending_restore',
    ISTATE_PENDING_UPDATE: 'pending_update',
    ISTATE_ERROR: 'error',
    ISTATE_INSTALLED: 'installed',

    // run codes (keep in sync in UI)
    RSTATE_RUNNING: 'running',
    RSTATE_PENDING_START: 'pending_start',
    RSTATE_PENDING_STOP: 'pending_stop',
    RSTATE_STOPPED: 'stopped', // app stopped by user

    HEALTH_HEALTHY: 'healthy',
    HEALTH_UNHEALTHY: 'unhealthy',
    HEALTH_ERROR: 'error',
    HEALTH_DEAD: 'dead',

    _clear: clear
};

var APPS_FIELDS = [ 'id', 'appStoreId', 'installationState', 'installationProgress', 'runState',
    'health', 'containerId', 'manifestJson', 'httpPort', 'location', 'dnsRecordId', 'accessRestriction' ].join(',');

var APPS_FIELDS_PREFIXED = [ 'apps.id', 'apps.appStoreId', 'apps.installationState', 'apps.installationProgress', 'apps.runState',
    'apps.health', 'apps.containerId', 'apps.manifestJson', 'apps.httpPort', 'apps.location', 'apps.dnsRecordId', 'apps.accessRestriction' ].join(',');

var PORT_BINDINGS_FIELDS = [ 'hostPort', 'environmentVariable', 'appId' ].join(',');

function postProcess(result) {
    assert(typeof result === 'object');

    assert(result.manifestJson === null || typeof result.manifestJson === 'string');

    result.manifest = safe.JSON.parse(result.manifestJson);
    delete result.manifestJson;

    assert(result.hostPorts === null || typeof result.hostPorts === 'string');
    assert(result.environmentVariables === null || typeof result.environmentVariables === 'string');

    result.portBindings = { };
    var hostPorts = result.hostPorts === null ? [ ] : result.hostPorts.split(',');
    var environmentVariables = result.environmentVariables === null ? [ ] : result.environmentVariables.split(',');

    delete result.hostPorts;
    delete result.environmentVariables;

    for (var i = 0; i < environmentVariables.length; i++) {
        result.portBindings[environmentVariables[i]] = parseInt(hostPorts[i], 10);
    }
}

function get(id, callback) {
    assert(typeof id === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT ' + APPS_FIELDS_PREFIXED + ','
        + 'GROUP_CONCAT(CAST(appPortBindings.hostPort AS CHAR(6))) AS hostPorts, GROUP_CONCAT(appPortBindings.environmentVariable) AS environmentVariables'
        + ' FROM apps LEFT OUTER JOIN appPortBindings ON apps.id = appPortBindings.appId WHERE apps.id = ? GROUP BY apps.id', [ id ], function (error, result) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        if (result.length === 0) return callback(new DatabaseError(DatabaseError.NOT_FOUND));

        postProcess(result[0]);

        callback(null, result[0]);
    });
}

function getBySubdomain(subdomain, callback) {
    assert(typeof subdomain === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT ' + APPS_FIELDS_PREFIXED + ','
        + 'GROUP_CONCAT(CAST(appPortBindings.hostPort AS CHAR(6))) AS hostPorts, GROUP_CONCAT(appPortBindings.environmentVariable) AS environmentVariables'
        + '  FROM apps LEFT OUTER JOIN appPortBindings ON apps.id = appPortBindings.appId WHERE location = ? GROUP BY apps.id', [ subdomain ], function (error, result) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        if (result.length === 0) return callback(new DatabaseError(DatabaseError.NOT_FOUND));

        postProcess(result[0]);

        callback(null, result[0]);
    });
}

function getByHttpPort(httpPort, callback) {
    assert(typeof httpPort === 'number');
    assert(typeof callback === 'function');

    database.query('SELECT ' + APPS_FIELDS_PREFIXED + ','
        + 'GROUP_CONCAT(CAST(appPortBindings.hostPort AS CHAR(6))) AS hostPorts, GROUP_CONCAT(appPortBindings.environmentVariable) AS environmentVariables'
        + '  FROM apps LEFT OUTER JOIN appPortBindings ON apps.id = appPortBindings.appId WHERE httpPort = ? GROUP BY apps.id', [ httpPort ], function (error, result) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        if (result.length === 0) return callback(new DatabaseError(DatabaseError.NOT_FOUND));

        postProcess(result[0]);

        callback(null, result[0]);
    });
}

function getAll(callback) {
    assert(typeof callback === 'function');

    database.query('SELECT ' + APPS_FIELDS_PREFIXED + ','
        + 'GROUP_CONCAT(CAST(appPortBindings.hostPort AS CHAR(6))) AS hostPorts, GROUP_CONCAT(appPortBindings.environmentVariable) AS environmentVariables'
        + ' FROM apps LEFT OUTER JOIN appPortBindings ON apps.id = appPortBindings.appId'
        + ' GROUP BY apps.id ORDER BY apps.id', function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        results.forEach(postProcess);

        callback(null, results);
    });
}

function add(id, appStoreId, manifest, location, portBindings, accessRestriction, callback) {
    assert(typeof id === 'string');
    assert(typeof appStoreId === 'string');
    assert(manifest && typeof manifest === 'object');
    assert(typeof manifest.version === 'string');
    assert(typeof location === 'string');
    assert(typeof portBindings === 'object');
    assert(typeof accessRestriction === 'string');
    assert(typeof callback === 'function');

    portBindings = portBindings || { };

    var manifestJson = JSON.stringify(manifest);

    var queries = [ ];
    queries.push({
        query: 'INSERT INTO apps (id, appStoreId, manifestJson, installationState, location, accessRestriction) VALUES (?, ?, ?, ?, ?, ?)',
        args: [ id, appStoreId, manifestJson, exports.ISTATE_PENDING_INSTALL, location, accessRestriction ]
    });

    Object.keys(portBindings).forEach(function (env) {
        queries.push({
            query: 'INSERT INTO appPortBindings (environmentVariable, hostPort, appId) VALUES (?, ?, ?)',
            args: [ env, portBindings[env], id ]
        });
    });

    database.transaction(queries, function (error, results) {
        if (error && error.code === 'ER_DUP_ENTRY') return callback(new DatabaseError(DatabaseError.ALREADY_EXISTS, error.message));
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        callback(null);
    });
}

function exists(id, callback) {
    assert(typeof id === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT 1 FROM apps WHERE id=?', [ id ], function (error, result) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        return callback(null, result.length !== 0);
    });
}

function getPortBindings(id, callback) {
    assert(typeof id === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT ' + PORT_BINDINGS_FIELDS + ' FROM appPortBindings WHERE appId = ?', [ id ], function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        var portBindings = { };
        for (var i = 0; i < results.length; i++) {
            portBindings[results[i].environmentVariable] = results[i].hostPort;
        }

        callback(null, portBindings);
    });
}

function del(id, callback) {
    assert(typeof id === 'string');
    assert(typeof callback === 'function');

    var queries = [
        { query: 'DELETE FROM appPortBindings WHERE appId = ?', args: [ id ] },
        { query: 'DELETE FROM apps WHERE id = ?', args: [ id ] }
    ];

    database.transaction(queries, function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        if (results[1].affectedRows !== 1) return callback(new DatabaseError(DatabaseError.NOT_FOUND));

        callback(null);
    });
}

function clear(callback) {
    assert(typeof callback === 'function');

    async.series([
        database.query.bind(null, 'DELETE FROM appPortBindings'),
        database.query.bind(null, 'DELETE FROM appAddonConfigs'),
        database.query.bind(null, 'DELETE FROM apps')
    ], function (error) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        return callback(null);
    });
}

function update(id, app, callback) {
    updateWithConstraints(id, app, '', callback);
}

function updateWithConstraints(id, app, constraints, callback) {
    assert(typeof id === 'string');
    assert(typeof app === 'object');
    assert(typeof constraints === 'string');
    assert(typeof callback === 'function');
    assert(!('portBindings' in app) || typeof app.portBindings === 'object');

    var queries = [ ];

    if ('portBindings' in app) {
        var portBindings = app.portBindings || { };
        // replace entries by app id
        queries.push({ query: 'DELETE FROM appPortBindings WHERE appId = ?', args: [ id ] });
        Object.keys(portBindings).forEach(function (env) {
            var values = [ portBindings[env], env, id ];
            queries.push({ query: 'INSERT INTO appPortBindings (hostPort, environmentVariable, appId) VALUES(?, ?, ?)', args: values });
        });
    }

    var fields = [ ], values = [ ];
    for (var p in app) {
        if (p === 'manifest') {
            fields.push('manifestJson = ?');
            values.push(JSON.stringify(app[p]));
        } else if (p !== 'portBindings') {
            fields.push(p + ' = ?');
            values.push(app[p]);
        }
    }

    if (values.length !== 0) {
        values.push(id);
        queries.push({ query: 'UPDATE apps SET ' + fields.join(', ') + ' WHERE id = ? ' + constraints, args: values });
    }

    database.transaction(queries, function (error, results) {
        if (error && error.code === 'ER_DUP_ENTRY') return callback(new DatabaseError(DatabaseError.ALREADY_EXISTS, error.message));
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));
        if (results[results.length - 1].affectedRows !== 1) return callback(new DatabaseError(DatabaseError.NOT_FOUND));

        return callback(null);
    });
}

// not sure if health should influence runState
function setHealth(appId, health, callback) {
    assert(typeof appId === 'string');
    assert(typeof health === 'string');
    assert(typeof callback === 'function');

    var values = { health: health };

    var constraints = 'AND runState NOT LIKE "pending_%" AND installationState = "installed"';

    updateWithConstraints(appId, values, constraints, callback);
}

function setInstallationCommand(appId, installationState, values, callback) {
    assert(typeof appId === 'string');
    assert(typeof installationState === 'string');

    if (typeof values === 'function') {
        callback = values;
        values = { };
    } else {
        assert(typeof values === 'object');
        assert(typeof callback === 'function');
    }

    values.installationState = installationState;

    if (installationState === exports.ISTATE_PENDING_UNINSTALL) {
        updateWithConstraints(appId, values, '', callback);
    } else {
        updateWithConstraints(appId, values, 'AND installationState NOT LIKE "pending_%"', callback);
    }
}

function setRunCommand(appId, runState, callback) {
    assert(typeof appId === 'string');
    assert(typeof runState === 'string');
    assert(typeof callback === 'function');

    var values = { runState: runState };
    updateWithConstraints(appId, values, 'AND runState NOT LIKE "pending_%" AND installationState = "installed"', callback);
}

function getAppStoreIds(callback) {
    assert(typeof callback === 'function');

    database.query('SELECT id, appStoreId FROM apps', function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        callback(null, results);
    });
}

function setAddonConfig(appId, addonId, env, callback) {
    assert(typeof appId === 'string');
    assert(typeof addonId === 'string');
    assert(util.isArray(env));
    assert(typeof callback === 'function');

    unsetAddonConfig(appId, addonId, function (error) {
        if (error) return callback(error);

        if (env.length === 0) return callback(null);

        var query = 'INSERT INTO appAddonConfigs(appId, addonId, value) VALUES ';
        var args = [ ], queryArgs = [ ];
        for (var i = 0; i < env.length; i++) {
            args.push(appId, addonId, env[i]);
            queryArgs.push('(?, ?, ?)');
        }

        database.query(query + queryArgs.join(','), args, function (error, result) {
            if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

            return callback(null);
        });
    });
}

function unsetAddonConfig(appId, addonId, callback) {
    assert(typeof appId === 'string');
    assert(typeof addonId === 'string');
    assert(typeof callback === 'function');

    database.query('DELETE FROM appAddonConfigs WHERE appId = ? AND addonId = ?', [ appId, addonId ], function (error) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        callback(null);
    });
}

function unsetAddonConfigByAppId(appId, callback) {
    assert(typeof appId === 'string');
    assert(typeof callback === 'function');

    database.query('DELETE FROM appAddonConfigs WHERE appId = ?', [ appId ], function (error) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        callback(null);
    });
}

function getAddonConfig(appId, addonId, callback) {
    assert(typeof appId === 'string');
    assert(typeof addonId === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT value FROM appAddonConfigs WHERE appId = ? AND addonId = ?', [ appId, addonId ], function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        var config = [ ];
        results.forEach(function (v) { config.push(v.value); });

        callback(null, config);
    });
}

function getAddonConfigByAppId(appId, callback) {
    assert(typeof appId === 'string');
    assert(typeof callback === 'function');

    database.query('SELECT value FROM appAddonConfigs WHERE appId = ?', [ appId ], function (error, results) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        var config = [ ];
        results.forEach(function (v) { config.push(v.value); });

        callback(null, config);
    });
}

