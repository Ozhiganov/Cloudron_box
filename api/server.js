'use strict';

var express = require('express'),
    http = require('http'),
    https = require('https'),
    HttpError = require('./httperror'),
    HttpSuccess = require('./httpsuccess'),
    path = require('path'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    db = require('./database.js'),
    routes = require('./routes'),
    debug = require('debug')('server:server'),
    Ssdp = require('upnp-ssdp'),
    assert = require('assert'),
    util = require('util'),
    pkg = require('./../package.json');

exports = module.exports = Server;

function Server(config) {
    assert(typeof config === 'object');

    this.config = config;
    this.app = null;
}


// Success handler
Server.prototype._successHandler = function (success, req, res, next) {
    if (success instanceof HttpSuccess) {
        debug('Send response with status', success.statusCode, 'and body', success.body);
        res.send(success.statusCode, success.body);
    } else {
        next(success);
    }
};


// Error handlers. These are called until one of them sends headers
Server.prototype._clientErrorHandler = function (err, req, res, next) {
    var status = err.status || err.statusCode; // connect/express or our app
    if (status >= 400 && status <= 499) {
        res.send(status, { status: http.STATUS_CODES[status], message: err.message });
        debug(http.STATUS_CODES[status] + ' : ' + err.message);
        debug(err.stack);
    } else {
        next(err);
    }
};

Server.prototype._serverErrorHandler = function (err, req, res, next) {
    var status = err.status || err.statusCode || 500;
    res.send(status, { status: http.STATUS_CODES[status], message: err.message });
    console.error(http.STATUS_CODES[status] + ' : ' + err.message);
    console.error(err.stack);
};

/**
 * @api {get} /api/v1/firsttime firstTime
 * @apiName firstTime
 * @apiGroup generic
 * @apiDescription
 * Ask the device if it is already activated. The device only leaves the activation mode when a device administrator is created.
 *
 * @apiSuccess {Boolean} activated True if the device was already activated otherwise false.
 * @apiSuccess {String} version The current version string of the device.
 */
Server.prototype._firstTime = function (req, res, next) {
    if (req.method !== 'GET') {
        return next(new HttpError(405, 'Only GET allowed'));
    }

    return res.send(200, { activated: !db.firstTime(), version: pkg.version });
};

/**
 * @api {get} /api/v1/version version
 * @apiName version
 * @apiGroup generic
 * @apiDescription
 *  Get the device's software version. Same string as in the <code>package.json</code>
 *
 * @apiSuccess {String} version The current version string of the device.
 */
Server.prototype._getVersion = function (req, res, next) {
    if (req.method !== 'GET') return next(new HttpError(405, 'Only GET supported'));
    res.send(200, { version: pkg.version });
};

/*
    Middleware which makes the route require a password in the body besides a token.
*/
Server.prototype._requirePassword = function (req, res, next) {
    if (!req.body.password) return next(new HttpError(400, 'API call requires the users password.'));
    next();
};


/*
    Middleware which makes the route only accessable for the admin user.
*/
Server.prototype._requireAdmin = function (req, res, next) {
    if (!req.user.admin) return next(new HttpError(403, 'API call requires the admin rights.'));
    next();
};

Server.prototype._loadMiddleware = function () {
    var middleware = { };
    // TODO that folder lookup is a bit silly maybe with the '../' - Johannes
    fs.readdirSync(__dirname + '/../middleware').forEach(function (filename) {
        if (!/\.js$/.test(filename)) return;
        var name = path.basename(filename, '.js');
        function load() { return require('./../middleware/' + name); }
        middleware.__defineGetter__(name, load);
    });
    return middleware;
};

Server.prototype._initialize = function (callback) {
    var that = this;
    var middleware = this._loadMiddleware();
    this.app = express();

    this.app.configure(function () {
        var QUERY_LIMIT = '10mb', // max size for json and urlencoded queries
            FIELD_LIMIT = 2 * 1024, // max fields that can appear in multipart
            FILE_SIZE_LIMIT = '521mb', // max file size that can be uploaded
            UPLOAD_LIMIT = '521mb'; // catch all max size for any type of request

        var REQUEST_TIMEOUT = 10000, // timeout for all requests
            FILE_TIMEOUT = 3 * 60 * 1000; // increased timeout for file uploads (3 mins)

        var json = express.json({ strict: true, limit: QUERY_LIMIT }), // application/json
            urlencoded = express.urlencoded({ limit: QUERY_LIMIT }); // application/x-www-form-urlencoded

        if (!that.config.silent) {
            that.app.use(express.logger({ format: 'dev', immediate: false }));
        }

        that.app
           .use(express.timeout(REQUEST_TIMEOUT))
           .use(express.limit(UPLOAD_LIMIT))
           .use('/', express.static(__dirname + '/../webadmin')) // use '/' for now so cookie is not restricted to '/webadmin'
           .use(json)
           .use(urlencoded)
           .use(express.cookieParser())
           .use(express.favicon(__dirname + '/../assets/favicon.ico'))
           // API calls that do not require authorization
           .use(middleware.cors({ origins: [ '*' ], allowCredentials: true }))
           .use(middleware.contentType('application/json'))
           .use('/api/v1/version', that._getVersion.bind(that))
           .use('/api/v1/firsttime', that._firstTime.bind(that))
           .use('/api/v1/createadmin', routes.user.createAdmin) // ## FIXME: allow this before auth for now
           .use(routes.user.authenticate)
           .use(that.app.router)
           .use(that._successHandler.bind(that))
           .use(that._clientErrorHandler.bind(that))
           .use(that._serverErrorHandler.bind(that));

        // routes controlled by app.router
        that.app.post('/api/v1/token', routes.user.createToken);        // TODO remove that route
        that.app.get('/api/v1/user/token', routes.user.createToken);
        that.app.get('/api/v1/logout', routes.user.logout);             // TODO remove that route
        that.app.get('/api/v1/user/logout', routes.user.logout);
        that.app.post('/api/v1/user/create', that._requireAdmin.bind(that), routes.user.create);
        that.app.post('/api/v1/user/remove', that._requireAdmin.bind(that), routes.user.remove);
        that.app.post('/api/v1/user/password', that._requirePassword.bind(that), routes.user.changePassword);
        that.app.get('/api/v1/user/info', routes.user.info);
        that.app.get('/api/v1/user/list', routes.user.list);

        that.app.param('volume', routes.volume.attachVolume);

        that.app.post('/api/v1/sync/:volume/diff', routes.volume.requireMountedVolume, routes.sync.diff);
        that.app.post('/api/v1/sync/:volume/delta', routes.volume.requireMountedVolume, routes.sync.delta);

        that.app.get('/api/v1/revisions/:volume/*', routes.volume.requireMountedVolume, routes.file.revisions);
        that.app.get('/api/v1/file/:volume/*', routes.volume.requireMountedVolume, routes.file.read);
        that.app.get('/api/v1/metadata/:volume/*', routes.volume.requireMountedVolume, routes.file.metadata);
        that.app.put('/api/v1/file/:volume/*', routes.volume.requireMountedVolume,
                                               routes.file.multipart({ maxFieldsSize: FIELD_LIMIT, limit: FILE_SIZE_LIMIT, timeout: FILE_TIMEOUT }),
                                               routes.file.putFile);

        that.app.post('/api/v1/fileops/:volume/copy', routes.volume.requireMountedVolume, express.json({ strict: true }), routes.fileops.copy);
        that.app.post('/api/v1/fileops/:volume/move', routes.volume.requireMountedVolume, express.json({ strict: true }), routes.fileops.move);
        that.app.post('/api/v1/fileops/:volume/delete', routes.volume.requireMountedVolume, express.json({ strict: true }), routes.fileops.remove);

        that.app.get('/api/v1/volume/:volume/list', routes.volume.requireMountedVolume, routes.volume.listFiles);
        that.app.get('/api/v1/volume/:volume/list/*', routes.volume.requireMountedVolume, routes.volume.listFiles);
        that.app.get('/api/v1/volume/list', routes.volume.listVolumes);
        that.app.post('/api/v1/volume/create', that._requirePassword.bind(that), routes.volume.createVolume);
        that.app.post('/api/v1/volume/:volume/delete', that._requirePassword.bind(that), routes.volume.deleteVolume);
        that.app.post('/api/v1/volume/:volume/mount', that._requirePassword.bind(that), routes.volume.mount);
        that.app.post('/api/v1/volume/:volume/unmount', routes.volume.unmount);
        that.app.get('/api/v1/volume/:volume/ismounted', routes.volume.isMounted);
    });

    this.app.set('port', that.config.port);

    if (!that.config.silent) {
        var scheme = this.config.certificateDir ? 'HTTPS' : 'HTTP';
        console.log(scheme + ' Server listening on port ' + this.app.get('port'));
        console.log('Using data root:', that.config.dataRoot);
        console.log('Using config root:', that.config.configRoot);
        console.log('Using mount root:', that.config.mountRoot);
    }

    // ensure data/config/mount paths
    mkdirp.sync(that.config.dataRoot);
    mkdirp.sync(that.config.configRoot);
    mkdirp.sync(that.config.mountRoot);

    if (!db.initialize(that.config)) {
        return callback(new Error('Error initializing database'));
    }

    routes.sync.initialize(that.config);
    routes.volume.initialize(that.config);
    routes.user.initialize(that.config);

    callback(null);
};

// TODO maybe we can get rid of that function and inline it - Johannes
Server.prototype._listen = function (callback) {
    if (typeof this.config.certificateDir === 'string') {
        var options = {
            cert: fs.readFileSync(path.join(this.config.certificateDir, 'cert.pem')),
            key: fs.readFileSync(path.join(this.config.certificateDir, 'key.pem'))
        };
        this.app.httpServer = https.createServer(options, this.app);
    } else {
        this.app.httpServer = http.createServer(this.app);
    }

    function callbackWrapper(error) {
        if (callback) {
            callback(error);
            callback = null;
        } else {
            console.error('Try to call back twice', error);
        }
    }

    this.app.httpServer.listen(this.app.get('port'), function (err) {
        if (err) return callbackWrapper(err);
        callbackWrapper();
    });

    this.app.httpServer.on('error', function (err) {
        callbackWrapper(err);
    });
};

Server.prototype._announce = function (callback) {
    var ssdp = new Ssdp();

    ssdp.announce({
        name: 'yellowtent:server',
        port: this.app.get('port')
    });

    ssdp.on('error', function (error) {
        console.error('Unable to announce the device.', error);
    });

    ssdp.on('reply', function (rinfo) {
        debug('Sent SSDP response to ' + rinfo.address + ':' + rinfo.port);
    });

    callback();
};

Server.prototype.start = function (callback) {
    assert(typeof callback === 'function');

    var that = this;

    if (this.app) {
        return callback(new Error('Server is already up and running.'));
    }

    this._initialize(function (err) {
        if (err) return callback(err);

        that._listen(function (err) {
            if (err) return callback(err);

            that._announce(function (err) {
                if (err) return callback(err);

                callback(null);
            });
        });
    });
};

Server.prototype.stop = function (callback) {
    // Any other way to check if app is an object we expect?
    assert(typeof callback === 'function');

    var that = this;

    if (!this.app.httpServer) {
        return callback();
    }

    this.app.httpServer.close(function () {
        that.app.httpServer.unref();
        // TODO should delete the app variable
        that.app = null;

        callback();
    });
};
