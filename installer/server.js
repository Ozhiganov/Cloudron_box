#!/usr/bin/env node

/* jslint node: true */

'use strict';

var assert = require('assert'),
    debug = require('debug')('box:install/server'),
    express = require('express'),
    fs = require('fs'),
    https = require('https'),
    installer = require('./installer.js'),
    middleware = require('../middleware'),
    os = require('os'),
    path = require('path'),
    superagent = require('superagent');

exports = module.exports = {
    start: start,
    stop: stop
};

var gAnnounceTimerId = null,
    gHttpsServer = null;

function restore(req, res, next) {
    if (!req.body.token) return res.status(400).send('No token provided');
    if (!req.body.appServerUrl) return res.send(400).send('No appServerUrl provided');
    if (!req.body.fqdn) return res.status(400).send('No fqdn provided');
    if (!req.body.restoreUrl) return res.status(400).send('No restoreUrl provided');
    if (!req.body.revision) return res.status(400).send('No revision provided');
    if (!req.body.boxVersionsUrl) return res.status(400).send('No boxVersionsUrl provided');
    if (!('tls' in req.body)) return res.status(400).send('tls cert must be provided or be null');

    debug('restore: received from appstore ', req.body);

    installer.restore(req.body, function (error) {
        if (error) console.error(error);

        stop();
    });

    stopAnnounce();

    res.status(200).send({ });
}

function provision(req, res, next) {
    if (!req.body.token) return res.status(400).send('No token provided');
    if (!req.body.appServerUrl) return res.status(400).send('No appServerUrl provided');
    if (!req.body.fqdn) return res.status(400).send('No fqdn provided');
    if (!req.body.revision) return res.status(400).send('No revision provided');
    if (!req.body.boxVersionsUrl) return res.status(400).send('No boxVersionsUrl provided');
    if (!('tls' in req.body)) return res.status(400).send('tls cert must be provided or be null');

    debug('provision: received from appstore ' + req.body.appServerUrl);

    installer.provision(req.body, function (error) {
        if (error) console.error(error);

        stop();
    });

    stopAnnounce();

    res.status(201).send({ });
}

function start(appServerUrl, callback) {
    assert(typeof appServerUrl === 'string');
    assert(!callback || typeof callback === 'function');

    var app = express();

    var router = new express.Router();

    app.use(middleware.json({ strict: true }))
       .use(middleware.morgan({ format: 'dev', immediate: false }))
       .use(router);

    router.post('/api/v1/provision', provision);
    router.post('/api/v1/restore', restore);

    var options = {
      key: fs.readFileSync(path.join(__dirname, 'cert/host.key')),
      cert: fs.readFileSync(path.join(__dirname, 'cert/host.cert'))
    };

    gHttpsServer = https.createServer(options, app);
    gHttpsServer.on('error', console.error);
    gHttpsServer.listen(process.env.NODE_ENV === 'test' ? 4443: 443, callback);

    startAnnounce(appServerUrl);
}

function stop(callback) {
    assert(!callback || typeof callback === 'function');
    callback = callback || function () { };

    if (!gHttpsServer) return callback(null);

    debug('Stopping');

    stopAnnounce();

    gHttpsServer.close(callback);
    gHttpsServer = null;
}

function startAnnounce(appServerUrl) {
    var ANNOUNCE_INTERVAL = parseInt(process.env.ANNOUNCE_INTERVAL, 10) || 60000; // exported for testing

    // On Digital Ocean, the only value which we can give a new droplet is the hostname.
    // We use that value to identify the droplet by the appstore server when the droplet
    // announce itself. This identifier can look different for other box providers.
    var hostname = os.hostname();
    var url = appServerUrl + '/api/v1/boxes/' + hostname + '/announce';
    debug('announce: box with %s.', url);

    superagent.get(url).end(function (error, result) {
        if (error || result.statusCode !== 200) {
            debug('announce: unable to announce to app server, try again.', error);
            gAnnounceTimerId = setTimeout(startAnnounce.bind(null, appServerUrl), ANNOUNCE_INTERVAL);
            return;
        }

        gAnnounceTimerId = setTimeout(startAnnounce.bind(null, appServerUrl), ANNOUNCE_INTERVAL * 2);

        debug('announce: success');
    });
};

function stopAnnounce() {
    clearTimeout(gAnnounceTimerId);
    gAnnounceTimerId = null;
}

if (require.main === module) {
    if (process.argv.length > 2) {
        start(process.argv[2]);
        return;
    }

    superagent.get('http://169.254.169.254/metadata/v1.json').end(function (error, result) {
        if (error || result.statusCode !== 200) {
            console.error('Error getting metadata', error);
            return;
        }

        var appServerUrl = JSON.parse(result.body.user_data).appServerUrl;
        debug('Using appServerUrl from metadata: ', appServerUrl);
        start(appServerUrl);
    });
}

