#!/usr/bin/env node

/* jslint node: true */

'use strict';

var announce = require('./announce.js'),
    assert = require('assert'),
    async = require('async'),
    debug = require('debug')('installer:server'),
    express = require('express'),
    fs = require('fs'),
    http = require('http'),
    HttpError = require('connect-lastmile').HttpError,
    https = require('https'),
    HttpSuccess = require('connect-lastmile').HttpSuccess,
    installer = require('./installer.js'),
    middleware = require('../middleware'),
    path = require('path'),
    superagent = require('superagent');

exports = module.exports = {
    start: start,
    stop: stop
};

var gHttpsServer = null, // provision server; used for install/restore
    gHttpServer = null; // update server; used for updates

function restore(req, res, next) {
    assert(typeof req.body === 'object');

    if (typeof req.body.token !== 'string') return next(new HttpError(400, 'No token provided'));
    if (typeof req.body.appServerUrl !== 'string') return next(new HttpError(400, 'No appServerUrl provided'));
    if (typeof req.body.fqdn !== 'string') return next(new HttpError(400, 'No fqdn provided'));
    if (typeof req.body.restoreUrl !== 'string') return next(new HttpError(400, 'No restoreUrl provided'));
    if (typeof req.body.version !== 'string') return next(new HttpError(400, 'No version provided'));
    if (typeof req.body.boxVersionsUrl !== 'string') return next(new HttpError(400, 'No boxVersionsUrl provided'));
    if (!('tls' in req.body)) return next(new HttpError(400, 'tls cert must be provided or be null'));

    debug('restore: received from appstore ', req.body);

    installer.restore(req.body, function (error) {
        if (error) console.error(error);

        // switch to update mode
        stopProvisionServer(function () { console.log('Provision server stopped'); });
        startUpdateServer(function () { console.log('Update server started'); });
    });

    announce.stop(function () { });

    next(new HttpSuccess(202, { }));
}

function provision(req, res, next) {
    assert(typeof req.body === 'object');

    if (typeof req.body.token !== 'string') return next(new HttpError(400, 'No token provided'));
    if (typeof req.body.appServerUrl !== 'string') return next(new HttpError(400, 'No appServerUrl provided'));
    if (typeof req.body.fqdn !== 'string') return next(new HttpError(400, 'No fqdn provided'));
    if (typeof req.body.version !== 'string') return next(new HttpError(400, 'No version provided'));
    if (typeof req.body.boxVersionsUrl !== 'string') return next(new HttpError(400, 'No boxVersionsUrl provided'));
    if (!('tls' in req.body)) return next(new HttpError(400, 'tls cert must be provided or be null'));

    debug('provision: received from appstore ' + req.body.appServerUrl);

    installer.provision(req.body, function (error) {
        if (error) console.error(error);

        // switch to update mode
        stopProvisionServer(function () { console.log('Provision server stopped'); });
        startUpdateServer(function () { console.log('Update server started'); });
    });

    announce.stop(function () { });

    next(new HttpSuccess(202, { }));
}

function update(req, res, next) {
    assert(typeof req.body === 'object');

    if (typeof req.body.token !== 'string') return next(new HttpError(400, 'No token provided'));
    if (typeof req.body.appServerUrl !== 'string') return next(new HttpError(400, 'No appServerUrl provided'));
    if (typeof req.body.fqdn !== 'string') return next(new HttpError(400, 'No fqdn provided'));
    if (typeof req.body.version !== 'string') return next(new HttpError(400, 'No version provided'));
    if (typeof req.body.boxVersionsUrl !== 'string') return next(new HttpError(400, 'No boxVersionsUrl provided'));
    if (!('tls' in req.body)) return next(new HttpError(400, 'tls cert must be provided or be null'));

    debug('update: started');

    installer.update(req.body, function (error) {
        if (error) console.error(error);
    });

    next(new HttpSuccess(202, { }));
}

function startUpdateServer(callback) {
    assert(typeof callback === 'function');

    debug('Starting update server');

    var app = express();

    var router = new express.Router();

    app.use(middleware.json({ strict: true }))
       .use(middleware.morgan({ format: 'dev', immediate: false }))
       .use(router)
       .use(middleware.lastMile());

    router.post('/api/v1/installer/update', update);

    gHttpServer = http.createServer(app);
    gHttpServer.on('error', console.error);

    gHttpServer.listen(2020, '127.0.0.1', callback);
}

function startProvisionServer(callback) {
    assert(typeof callback === 'function');

    debug('Starting provision server');

    var app = express();

    var router = new express.Router();

    app.use(middleware.json({ strict: true }))
       .use(middleware.morgan({ format: 'dev', immediate: false }))
       .use(router)
       .use(middleware.lastMile());

    router.post('/api/v1/installer/provision', provision);
    router.post('/api/v1/installer/restore', restore);

    var options = {
      key: fs.readFileSync(path.join(__dirname, 'cert/host.key')),
      cert: fs.readFileSync(path.join(__dirname, 'cert/host.cert'))
    };

    gHttpsServer = https.createServer(options, app);
    gHttpsServer.on('error', console.error);

    gHttpsServer.listen(process.env.NODE_ENV === 'test' ? 4443 : 443, '0.0.0.0', callback);
}

function stopProvisionServer(callback) {
    assert(typeof callback === 'function');

    debug('Stopping provision server');

    if (!gHttpsServer) return callback(null);

    gHttpsServer.close(callback);
    gHttpsServer = null;
}

function stopUpdateServer(callback) {
    assert(typeof callback === 'function');

    debug('Stopping update server');

    if (!gHttpServer) return callback(null);

    gHttpServer.close(callback);
    gHttpServer = null;
}

function start(mode, callback) {
    assert(mode === 'update-mode' || mode == 'provision-mode', 'invalid mode');
    assert(typeof callback === 'function');

    if (mode === 'update-mode') {
        debug('starting in update mode');
        return startUpdateServer(callback);
    }

    debug('starting in provision mode');

    superagent.get('http://169.254.169.254/metadata/v1.json').end(function (error, result) {
        if (error || result.statusCode !== 200) {
            console.error('Error getting metadata', error);
            return;
        }

        var appServerUrl = JSON.parse(result.body.user_data).appServerUrl;
        debug('Using appServerUrl from metadata: %s', appServerUrl);

        async.series([
            announce.start.bind(null, appServerUrl),
            startProvisionServer
        ], callback);
    });
}

function stop(callback) {
    assert(typeof callback === 'function');

    async.series([
        announce.stop,
        stopUpdateServer,
        stopProvisionServer
    ], callback);
}

if (require.main === module) {
    var mode = process.argv[2];

    if (!mode) mode = fs.existsSync('/home/yellowtent/box') ? 'update-mode' : 'provision-mode';

    start(mode, function (error) {
        if (error) console.error(error);
    });
}

