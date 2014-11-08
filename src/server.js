/* jslint node: true */

'use strict';

var apps = require('./apps'),
    assert = require('assert'),
    auth = require('./auth.js'),
    cloudron = require('./cloudron.js'),
    config = require('../config.js'),
    csrf = require('csurf'),
    database = require('./database.js'),
    debug = require('debug')('box:server'),
    express = require('express'),
    http = require('http'),
    HttpError = require('./httperror.js'),
    HttpSuccess = require('./httpsuccess.js'),
    installer = require('../installer/installer.js'),
    mailer = require('./mailer.js'),
    middleware = require('../middleware'),
    mkdirp = require('mkdirp'),
    passport = require('passport'),
    path = require('path'),
    paths = require('./paths.js'),
    routes = require('./routes/index.js'),
    updater = require('./updater.js'),
    url = require('url'),
    userdb = require('./userdb.js');

exports = module.exports = Server;

function Server() {
    this.httpServer = null; // http server
    this.app = null; // express
}

// Success handler
Server.prototype._successHandler = function (success, req, res, next) {
    if (!(success instanceof HttpSuccess)) return next(success);

    if (success.body) {
        res.setHeader('Content-Type', 'application/json');
        res.status(success.status).send(success.body);
    } else {
        res.status(success.status).end();
    }
};

// Error handlers. These are called until one of them sends headers
Server.prototype._clientErrorHandler = function (err, req, res, next) {
    var status = err.status; // connect/express or our app

    // if the request took too long, assume it's a problem on the client
    if (err.timeout && err.status == 503) { // timeout() middleware
        status = 408;
    }

    if (status >= 400 && status <= 499) {
        res.send(status, { status: http.STATUS_CODES[status], message: err.message });
        debug(http.STATUS_CODES[status] + ' : ' + err.message);
    } else {
        next(err);
    }
};

Server.prototype._serverErrorHandler = function (err, req, res, next) {
    var status = err.status || 500;
    res.status(status).send({ status: http.STATUS_CODES[status], message: err.message || 'Internal Server Error' });
    console.error(status, err, err.internalError);
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
Server.prototype._firstTime = function (req, res) {
    userdb.count(function (error, count) {
        if (error) return res.send(500, { status: http.STATUS_CODES[500], message: error.message || 'Internal Server error' });

        return res.send(200, { activated: count !== 0, version: config.version() });
    });
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
Server.prototype._getVersion = function (req, res) {
    res.send(200, { version: config.version() });
};

/*
    Middleware which makes the route only accessable for the admin user.
*/
Server.prototype._requireAdmin = function (req, res, next) {
    assert(typeof req.user === 'object');

    if (!req.user.admin) return next(new HttpError(403, 'API call requires the admin rights.'));
    next();
};

Server.prototype._initializeExpressSync = function () {
    this.app = express();

    var QUERY_LIMIT = '10mb', // max size for json and urlencoded queries
        FIELD_LIMIT = 2 * 1024, // max fields that can appear in multipart
        FILE_SIZE_LIMIT = '521mb', // max file size that can be uploaded
        UPLOAD_LIMIT = '521mb'; // catch all max size for any type of request

    var REQUEST_TIMEOUT = 10000, // timeout for all requests
        FILE_TIMEOUT = 3 * 60 * 1000; // increased timeout for file uploads (3 mins)

    var json = middleware.json({ strict: true, limit: QUERY_LIMIT }), // application/json
        urlencoded = middleware.urlencoded({ limit: QUERY_LIMIT }), // application/x-www-form-urlencoded
        csurf = csrf(); // Cross-site request forgery protection middleware for login form

    var graphiteProxy = middleware.proxy(url.parse('http://127.0.0.1:8000'));
    var graphiteMiddleware = function (req, res, next) {
        // remove any senstive info
        var parsedUrl = url.parse(req.url, true /* parseQueryString */);
        delete parsedUrl.query['access_token'];
        delete req.headers['authorization']
        req.url = url.format({ pathname: parsedUrl.pathname, query: parsedUrl.query });
        graphiteProxy(req, res, next);
    };

    // Passport configuration
    auth.initialize();

    this.app.set('views', path.join(__dirname, 'oauth2views'));
    this.app.set('view options', { layout: true, debug: true });
    this.app.set('view engine', 'ejs');

    if (config.get('logApiRequests')) {
        this.app.use(middleware.morgan({ format: 'dev', immediate: false }));
    }

    if (process.env.NODE_ENV === 'test') {
       this.app.use(express.static(path.join(__dirname, '/../webadmin')));
    }

    var router = new express.Router();
    router.del = router.delete; // amend router.del for readability further on

    this.app
      // .use(require('delay')(500))
       .use(middleware.timeout(REQUEST_TIMEOUT))
//       .use(express.limit(UPLOAD_LIMIT))
       .use(json)
       .use(urlencoded)
       .use(middleware.cookieParser())
       .use(middleware.favicon(__dirname + '/../assets/favicon.ico'))
       .use(middleware.cors({ origins: [ '*' ], allowCredentials: true }))
       .use(middleware.session({ secret: 'yellow is blue' }))
       .use(passport.initialize())
       .use(passport.session())
       .use(router)
       .use(this._successHandler.bind(this))
       .use(this._clientErrorHandler.bind(this))
       .use(this._serverErrorHandler.bind(this));

    // middleware shortcuts for authentification
    var bearer = passport.authenticate(['bearer'], { session: false });
    var basic = passport.authenticate(['basic'], { session: false });
    var both = passport.authenticate(['basic', 'bearer'], { session: false });

    // scope middleware implicitly also adds bearer token verification
    var rootScope = routes.oauth2.scope('root');
    var profileScope = routes.oauth2.scope('profile');
    var usersScope = routes.oauth2.scope('users');
    var appsScope = routes.oauth2.scope('apps');
    var settingsScope = routes.oauth2.scope('settings');

    // middleware to ensure the calling user is admin
    var admin = this._requireAdmin.bind(this);

    // public routes
    router.get ('/api/v1/version', this._getVersion.bind(this));
    router.get ('/api/v1/firsttime', this._firstTime.bind(this));
    router.post('/api/v1/createadmin', routes.user.createAdmin);    // FIXME any number of admins can be created without auth!

    router.get ('/api/v1/config', rootScope, routes.cloudron.getConfig);
    router.get ('/api/v1/update', rootScope, routes.cloudron.update);
    router.get ('/api/v1/reboot', rootScope, routes.cloudron.reboot);
    router.get ('/api/v1/stats', rootScope, routes.cloudron.getStats);
    router.post('/api/v1/backups', rootScope, routes.cloudron.createBackup);
    router.get ('/api/v1/profile', profileScope, routes.user.info);
    router.get ('/api/v1/graphs', rootScope, function (req, res, next) { req.url = req.url.replace(/^\/api\/v1\/graphs(\?.*)/, '/render$1'); next(); }, graphiteMiddleware);

    router.get ('/api/v1/users', usersScope, routes.user.list);
    router.post('/api/v1/users', usersScope, admin, routes.user.create);
    router.get ('/api/v1/users/:userName', usersScope, routes.user.info);
    router.del ('/api/v1/users/:userName', usersScope, admin, routes.user.remove);
    router.post('/api/v1/users/:userName/password', usersScope, routes.user.changePassword); // changePassword verifies password
    router.post('/api/v1/users/:userName/admin', usersScope, admin, routes.user.changeAdmin);

    router.get ('/api/v1/users/:userName/login', basic, routes.user.createToken);    // FIXME this should not be needed with OAuth
    router.get ('/api/v1/users/:userName/logout', bearer, routes.user.logout);       // FIXME this should not be needed with OAuth

    // form based login routes used by oauth2 frame
    router.get ('/api/v1/session/login', csurf, routes.oauth2.loginForm);
    router.post('/api/v1/session/login', csurf, routes.oauth2.login);
    router.get ('/api/v1/session/logout', routes.oauth2.logout);
    router.get ('/api/v1/session/callback', routes.oauth2.callback);
    router.get ('/api/v1/session/error', routes.oauth2.error);
    router.get ('/api/v1/session/password/resetRequest.html', csurf, routes.oauth2.passwordResetRequestSite);
    router.post('/api/v1/session/password/resetRequest', csurf, routes.oauth2.passwordResetRequest);
    router.get ('/api/v1/session/password/sent.html', routes.oauth2.passwordSentSite);
    router.get ('/api/v1/session/password/reset.html', csurf, routes.oauth2.passwordResetSite);
    router.post('/api/v1/session/password/reset', csurf, routes.oauth2.passwordReset);

    // oauth2 routes
    router.get ('/api/v1/oauth/dialog/authorize', routes.oauth2.authorization);
    router.post('/api/v1/oauth/dialog/authorize/decision', csurf, routes.oauth2.decision);
    router.post('/api/v1/oauth/token', routes.oauth2.token);
    router.get ('/api/v1/oauth/yellowtent.js', routes.oauth2.library);
    router.get ('/api/v1/oauth/clients', settingsScope, routes.oauth2.getClients);
    router.get ('/api/v1/oauth/clients/:clientId/tokens', settingsScope, routes.oauth2.getClientTokens);
    router.del ('/api/v1/oauth/clients/:clientId/tokens', settingsScope, routes.oauth2.delClientTokens);
    router.all ('/api/v1/oauth/proxy*', csurf, routes.oauth2.proxy);

    // app routes
    router.get ('/api/v1/apps', appsScope, routes.apps.getApps);
    router.get ('/api/v1/app/:id', appsScope, routes.apps.getApp);
    router.post('/api/v1/app/:id/uninstall', appsScope, routes.apps.uninstallApp); // FIXME does this require password?
    router.post('/api/v1/app/install', appsScope, routes.user.verifyPassword, routes.apps.installApp);
    router.post('/api/v1/app/:id/configure', appsScope, routes.user.verifyPassword, routes.apps.configureApp);
    router.post('/api/v1/app/:id/update', appsScope, routes.apps.updateApp);
    router.post('/api/v1/app/:id/stop', appsScope, routes.apps.stopApp);
    router.post('/api/v1/app/:id/start', appsScope, routes.apps.startApp);
    router.get ('/api/v1/app/:id/icon', routes.apps.getAppIcon);
    router.get ('/api/v1/app/:id/logstream', appsScope, routes.apps.getLogStream);
    router.get ('/api/v1/app/:id/logs', appsScope, routes.apps.getLogs);

    // subdomain routes
    router.get ('/api/v1/subdomains/:subdomain', routes.apps.getAppBySubdomain);

    // settings routes
    router.get ('/api/v1/settings/naked_domain', settingsScope, routes.settings.getNakedDomain);
    router.post('/api/v1/settings/naked_domain', settingsScope, routes.settings.setNakedDomain);

    // graphite calls
    router.get([ '/graphite/*', '/content/*', '/metrics/*', '/dashboard/*', '/render/*', '/browser/*', '/composer/*' ], graphiteMiddleware);
};

Server.prototype.start = function (callback) {
    assert(typeof callback === 'function');
    assert(this.app === null, 'Server is already up and running.');

    mkdirp.sync(paths.APPICONS_DIR);
    mkdirp.sync(paths.NGINX_APPCONFIG_DIR);
    mkdirp.sync(paths.APPDATA_DIR);
    mkdirp.sync(paths.COLLECTD_APPCONFIG_DIR);
    mkdirp.sync(paths.HARAKA_CONFIG_DIR);

    var that = this;

    this._initializeExpressSync();

    database.initialize(function (err) {
        if (err) return callback(err);

        apps.initialize();
        cloudron.initialize();
        installer.initialize();
        updater.initialize();
        mailer.initialize();

        that.httpServer = http.createServer(that.app);
        that.httpServer.listen(config.get('port'), '127.0.0.1', callback);
    });
};

Server.prototype.stop = function (callback) {
    assert(typeof callback === 'function');

    var that = this;

    if (!this.httpServer) {
        return callback(null);
    }

    cloudron.uninitialize();
    installer.uninitialize();
    updater.uninitialize();
    apps.uninitialize();
    mailer.uninitialize();
    database.uninitialize();

    this.httpServer.close(function () {
        that.httpServer.unref();
        that.app = null;

        callback(null);
    });
};
