/* jslint node:true */

'use strict';

var DatabaseError = require('./databaseerror.js'),
    util = require('util'),
    debug = require('debug')('box:apps'),
    assert = require('assert'),
    safe = require('safetydance'),
    appdb = require('./appdb.js'),
    child_process = require('child_process'),
    config = require('../config.js');

exports = module.exports = {
    AppsError: AppsError,

    initialize: initialize,
    uninitialize: uninitialize,
    get: get,
    getBySubdomain: getBySubdomain,
    getAll: getAll,
    install: install,
    uninstall: uninstall,

    appFqdn: appFqdn
};

var tasks = { }, appHealthTask = null;

function initialize() {
    appHealthTask = child_process.fork(__dirname + '/apphealthtask.js');

    resume();
}

// resume install and uninstalls
function resume() {
    appdb.getAll(function (error, apps) {
        if (error) throw error;
        apps.forEach(function (app) {
            if (app.installationState === appdb.ISTATE_INSTALLED) return;
            debug('Creating process for ' + app.id + ' with state ' + app.installationState);
            tasks[app.id] = child_process.fork(__dirname + '/apptask.js', [ app.id ]);
        });
    });
}

function uninitialize() {
    appHealthTask.kill();
    for (var appId in tasks) {
        tasks[appId].kill();
    }
}

// http://dustinsenos.com/articles/customErrorsInNode
// http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
function AppsError(err, reason) {
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.message = safe.JSON.stringify(err);
    this.code = err ? err.code : null;
    this.reason = reason || AppsError.INTERNAL_ERROR;
}
util.inherits(AppsError, Error);
AppsError.INTERNAL_ERROR = 1;
AppsError.ALREADY_EXISTS = 2;
AppsError.NOT_FOUND = 3;

function appFqdn(location) {
    return location + '-' + config.fqdn;
}

function get(appId, callback) {
    assert(typeof appId === 'string');

    appdb.get(appId, function (error, app) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return callback(new AppsError('No such app', AppsError.NOT_FOUND));
        if (error) return callback(new AppsError('Internal error:' + error.message, AppsError.INTERNAL_ERROR));

        callback(null, app);
    });
}

function getBySubdomain(subdomain, callback) {
    assert(typeof subdomain === 'string');

    appdb.getBySubdomain(subdomain, function (error, app) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return callback(new AppsError('No such app', AppsError.NOT_FOUND));
        if (error) return callback(new AppsError('Internal error:' + error.message, AppsError.INTERNAL_ERROR));

        callback(null, app);
    });
}

function getAll(callback) {
    appdb.getAll(function (error, apps) {
        if (error) return callback(new AppsError('Internal error:' + error.message, AppsError.INTERNAL_ERROR));

        apps.forEach(function (app) {
            app.iconUrl = config.appServerUrl + '/api/v1/app/' + app.id + '/icon';
            app.url = 'https://' + appFqdn(app.location);
        });

        callback(null, apps);
    });
}

function startTask(appId) {
    tasks[appId] = child_process.fork(__dirname + '/apptask.js', [ appId ]);
    tasks[appId].once('exit', function (code, signal) {
        debug('Task completed :' + appId);
        delete tasks[appId];
    });
}

function stopTask(appId) {
    if (tasks[appId]) {
        debug('Killing existing task : ' + tasks[appId].pid);
        tasks[appId].kill();
        delete tasks[appId];
    }
}

function install(appId, username, password, location, portBindings, callback) {
    assert(typeof appId === 'string');
    assert(typeof username === 'string');
    assert(typeof password === 'string');
    assert(typeof location === 'string');

    stopTask(appId);

    appdb.add(appId, appdb.ISTATE_PENDING_INSTALL, location, portBindings, function (error) {
        if (error && error.reason === DatabaseError.ALREADY_EXISTS) return callback(new AppsError('Already installed or installing', AppsError.ALREADY_EXISTS));
        if (error) return callback(new AppsError('Internal error:' + error.message, AppsError.INTERNAL_ERROR));

        debug('Will install app with id : ' + appId);

        startTask(appId);

        callback(null);
    });
}

function uninstall(appId, callback) {
    assert(typeof appId === 'string');

    stopTask(appId);

    appdb.update(appId, { installationState: appdb.ISTATE_PENDING_UNINSTALL }, function (error) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return callback(new AppsError('No such app', AppsError.NOT_FOUND));
        if (error) return callback(new AppsError('Internal error:' + error.message, AppsError.INTERNAL_ERROR));

        debug('Will uninstall app with id : ' + appId);

        startTask(appId);

        callback(null);
    });
}

