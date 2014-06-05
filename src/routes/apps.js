/* jslint node:true */

'use strict';

var HttpError = require('../httperror.js'),
    HttpSuccess = require('../httpsuccess.js'),
    debug = require('debug')('routes/apps'),
    apps = require('../apps.js'),
    AppsError = apps.AppsError;

exports = module.exports = {
    initialize: initialize,
    getApp: getApp,
    getApps: getApps,
    installApp: installApp,
    uninstallApp: uninstallApp
};

function initialize(config) {
}

function getApp(req, res, next) {
    if (typeof req.param.id !== 'string') return next(new HttpError(400, 'appid is required'));

    apps.get(req.params.id, function (error, app) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'No such app'));
        if (error) return next(new HttpError(500, 'Internal error:' + error));

        next(new HttpSuccess(200, app));
    });
}

function getApps(req, res, next) {
    apps.getAll(function (error, allApps) {
        if (error) return next(new HttpError(500, 'Internal error:' + error));
        next(new HttpSuccess(200, { apps: allApps }));
    });
}

function installApp(req, res, next) {
    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (!data.app_id) return next(new HttpError(400, 'app_id is required'));
    if (!data.password) return next(new HttpError(400, 'password is required'));
    if (!data.location) return next(new HttpError(400, 'location is required'));
    if (data.portBindings !== null && typeof data.portBindings !== 'object') return next(new HttpError(400, 'portBindings must be an object'));

    // validate the port bindings
    for (var internalPort in data.portBindings) {
        var port = parseInt(internalPort, 10);
        if (isNaN(port) || port <= 0 || port > 65535) return next(new HttpError(400, internalPort + ' is not a valid port'));
        var externalPort = data.portBindings[internalPort];
        port = parseInt(externalPort, 10);
        if (isNaN(port) || port <= 1024 || port > 65535) return next(new HttpError(400, externalPort + ' is not a valid port'));
    }

    debug('will install app with id ' + data.app_id + ' @ ' + data.location + ' with ' + JSON.stringify(data.portBindings));

    apps.install(data.app_id, req.user.username, data.password, data.location, data.portBindings, function (error) {
        if (error && error.reason === AppsError.ALREADY_EXISTS) return next(new HttpError(409, 'Error installing app: ' + error));
        if (error) return next(new HttpError(500, 'Internal error:' + error));

        next(new HttpSuccess(200, { status: 'ok' } ));
    });
}

function uninstallApp(req, res, next) {
    if (typeof req.params.id !== 'string') return next(new HttpError(400, 'appid is required'));

    debug('will uninstall app with id ' + req.param.id);

    apps.uninstall(req.params.id, function (error) {
        if (error && error.reason === AppsError.NOT_FOUND) return next(new HttpError(404, 'Error uninstalling app' + error));
        if (error) return next(new HttpError(500, 'Internal error: ' + error));

        next(new HttpSuccess(200, { status: 'ok' }));
    });
}
