/* jslint node:true */

'use strict';

var apps = require('../apps.js'),
    AppsError = apps.AppsError,
    assert = require('assert'),
    config = require('../../config.js'),
    debug = require('debug')('box:routes/apps'),
    fs = require('fs'),
    HttpError = require('connect-lastmile').HttpError,
    HttpSuccess = require('connect-lastmile').HttpSuccess,
    paths = require('../paths.js'),
    uuid = require('node-uuid');

exports = module.exports = {
    getApp: getApp,
    getAppBySubdomain: getAppBySubdomain,
    getApps: getApps,
    getAppIcon: getAppIcon,
    installApp: installApp,
    configureApp: configureApp,
    uninstallApp: uninstallApp,
    updateApp: updateApp,
    getLogs: getLogs,
    getLogStream: getLogStream,

    stopApp: stopApp,
    startApp: startApp
};

/*
 * Get installed (or scheduled to be installed) app
 */
function getApp(req, res, next) {
    assert(typeof req.params.id === 'string');

    apps.get(req.params.id, function (error, app) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(200, app));
    });
}

/*
 * Get the app installed in the subdomain
 */
function getAppBySubdomain(req, res, next) {
    assert(typeof req.params.subdomain === 'string');

    apps.getBySubdomain(req.params.subdomain, function (error, app) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such subdomain'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(200, app));
    });
}

/*
 * Get installed (or scheduled to be installed) apps
 */
function getApps(req, res, next) {
    apps.getAll(function (error, allApps) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { apps: allApps }));
    });
}

/*
 * Get the app icon
 */
function getAppIcon(req, res, next) {
    assert(typeof req.params.id === 'string');

    var iconPath = paths.APPICONS_DIR + '/' + req.params.id + '.png';
    fs.exists(iconPath, function (exists) {
        if (!exists) return next(new HttpError(404, 'No such icon'));
        res.sendfile(iconPath);
    });
}

/*
 * Installs an app
 * @bodyparam {string} appStoreId The id of the app to be installed
 * @bodyparam {manifest} manifest The app manifest
 * @bodyparam {string} password The user's password
 * @bodyparam {string} location The subdomain where the app is to be installed
 * @bodyparam {object} portConfigs map from environment variable name to (public) host port. can be null.
 */
function installApp(req, res, next) {
    assert(typeof req.body === 'object');

    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (typeof data.password !== 'string') return next(new HttpError(401, 'password is missing'));
    if (!data.manifest || typeof data.manifest !== 'object') return next(new HttpError(400, 'manifest is required'));
    if (typeof data.appStoreId !== 'string') return next(new HttpError(400, 'appStoreId is required'));
    if (typeof data.location !== 'string') return next(new HttpError(400, 'location is required'));
    if (('portConfigs' in data) && typeof data.portConfigs !== 'object') return next(new HttpError(400, 'portConfigs must be an object'));
    if (typeof data.accessRestriction !== 'string') return next(new HttpError(400, 'accessRestriction is required'));

    // allow tests to provide an appId for testing
    var appId = (process.env.NODE_ENV === 'test' && typeof data.appId === 'string') ? data.appId : uuid.v4();

    debug('Installing app id:%s storeid:%s loc:%s port:%j restrict:%s manifest:%j', appId, data.appStoreId, data.location, data.portConfigs, data.accessRestriction, data.manifest);

    apps.install(appId, data.appStoreId, data.manifest, data.location, data.portConfigs, data.accessRestriction, function (error) {
        if (error && error.reason === AppsError.ALREADY_EXISTS) return next(new HttpError(409, 'App already exists'));
        if (error && error.reason === AppsError.BAD_FIELD) return next(new HttpError(400, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { id: appId } ));
    });
}

/*
 * Configure an app
 * @bodyparam {string} appId The id of the app to be installed
 * @bodyparam {string} password The user's password
 * @bodyparam {string} location The subdomain where the app is to be installed
 * @bodyparam {object} portConfigs map from env to (public) host port. can be null.
 */
function configureApp(req, res, next) {
    assert(typeof req.body === 'object');

    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (typeof data.password !== 'string') return next(new HttpError(401, 'password is missing'));
    if (typeof data.appId !== 'string') return next(new HttpError(400, 'appId is required'));
    if (('portConfigs' in data) && typeof data.portConfigs !== 'object') return next(new HttpError(400, 'portConfigs must be an object'));
    if (typeof data.accessRestriction !== 'string') return next(new HttpError(400, 'accessRestriction is required'));

    debug('Configuring app id:%s location:%s bindings:%j', data.appId, data.location, data.portConfigs);

    apps.configure(data.appId, data.location, data.portConfigs, data.accessRestriction, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error && error.reason === AppsError.BAD_FIELD) return next(new HttpError(400, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { }));
    });
}

/*
 * Uninstalls an app
 * @bodyparam {string} id The id of the app to be uninstalled
 */
function uninstallApp(req, res, next) {
    assert(typeof req.params.id === 'string');

    debug('Uninstalling app id:%s', req.params.id);

    apps.uninstall(req.params.id, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { }));
    });
}

function startApp(req, res, next) {
    assert(typeof req.params.id === 'string');

    debug('Start app id:%s', req.params.id);

    apps.start(req.params.id, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { }));
    });
}

function stopApp(req, res, next) {
    assert(typeof req.params.id === 'string');

    debug('Stop app id:%s', req.params.id);

    apps.stop(req.params.id, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { }));
    });
}

function updateApp(req, res, next) {
    assert(typeof req.params.id === 'string');
    assert(typeof req.body === 'object');

    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (!data.manifest || typeof data.manifest !== 'object') return next(new HttpError(400, 'manifest is required'));

    debug('Update app id:%s to manifest:%j', req.params.id, data.manifest);

    apps.update(req.params.id, data.manifest, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(202, { }));
    });
}

function getLogStream(req, res, next) {
    assert(typeof req.params.id === 'string');

    debug('Getting logstream of app id:%s', req.params.id);

    var fromLine = parseInt(req.query.fromLine || 0, 10);

    function sse(id, data) { return 'id: ' + id + '\ndata: ' + data + '\n\n'; };

    if (req.headers.accept !== 'text/event-stream') return next(new HttpError(400, 'This API call requires EventStream'));

    var fromLine = (parseInt(req.headers['last-event-id'], 10) + 1) || 1;

    apps.getLogStream(req.params.id, { fromLine: fromLine }, function (error, logStream) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error) return next(new HttpError(500, error));

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // disable nginx buffering
            'Access-Control-Allow-Origin': '*'
        });
        res.write('retry: 3000\n');
        res.on('close', logStream.close);
        logStream.on('data', function (data) {
            var obj = JSON.parse(data);
            res.write(sse(obj.lineNumber, obj.log));
        });
        logStream.on('end', res.end.bind(res));
        logStream.on('error', res.end.bind(res, null));
    });
}

function getLogs(req, res, next) {
    assert(typeof req.params.id === 'string');

    debug('Getting logs of app id:%s', req.params.id);

    apps.getLogs(req.params.id, function (error, logStream) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error && error.reason === AppsError.BAD_STATE) return next(new HttpError(409, error.message));
        if (error) return next(new HttpError(500, error));

        res.writeHead(200, {
            'Content-Type': 'application/x-logs',
            'Content-Disposition': 'attachment; filename="log.txt"',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no' // disable nginx buffering
        });
        logStream.pipe(res);
    });
}

