'use strict';

exports = module.exports = {
    setupAddons: setupAddons,
    teardownAddons: teardownAddons,
    backupAddons: backupAddons,
    restoreAddons: restoreAddons,

    getEnvironment: getEnvironment,
    getLinksSync: getLinksSync,
    getBindsSync: getBindsSync,
    getContainerNamesSync: getContainerNamesSync,

    // exported for testing
    _setupOauth: setupOauth,
    _teardownOauth: teardownOauth
};

var appdb = require('./appdb.js'),
    assert = require('assert'),
    async = require('async'),
    child_process = require('child_process'),
    clientdb = require('./clientdb.js'),
    config = require('./config.js'),
    DatabaseError = require('./databaseerror.js'),
    debug = require('debug')('box:addons'),
    docker = require('./docker.js').connection,
    fs = require('fs'),
    generatePassword = require('password-generator'),
    hat = require('hat'),
    MemoryStream = require('memorystream'),
    once = require('once'),
    path = require('path'),
    paths = require('./paths.js'),
    safe = require('safetydance'),
    shell = require('./shell.js'),
    spawn = child_process.spawn,
    util = require('util'),
    uuid = require('node-uuid');

var NOOP = function (app, options, callback) { return callback(); };

// setup can be called multiple times for the same app (configure crash restart) and existing data must not be lost
// teardown is destructive. app data stored with the addon is lost
var KNOWN_ADDONS = {
    ldap: {
        setup: setupLdap,
        teardown: teardownLdap,
        backup: NOOP,
        restore: setupLdap
    },
    localstorage: {
        setup: NOOP, // docker creates the directory for us
        teardown: NOOP,
        backup: NOOP, // no backup because it's already inside app data
        restore: NOOP
    },
    mongodb: {
        setup: setupMongoDb,
        teardown: teardownMongoDb,
        backup: backupMongoDb,
        restore: restoreMongoDb
    },
    mysql: {
        setup: setupMySql,
        teardown: teardownMySql,
        backup: backupMySql,
        restore: restoreMySql,
    },
    oauth: {
        setup: setupOauth,
        teardown: teardownOauth,
        backup: NOOP,
        restore: setupOauth
    },
    postgresql: {
        setup: setupPostgreSql,
        teardown: teardownPostgreSql,
        backup: backupPostgreSql,
        restore: restorePostgreSql
    },
    redis: {
        setup: setupRedis,
        teardown: teardownRedis,
        backup: backupRedis,
        restore: setupRedis // same thing
    },
    sendmail: {
        setup: setupSendMail,
        teardown: teardownSendMail,
        backup: NOOP,
        restore: setupSendMail
    },
    scheduler: {
        setup: NOOP,
        teardown: NOOP,
        backup: NOOP,
        restore: NOOP
    },
    simpleauth: {
        setup: setupSimpleAuth,
        teardown: teardownSimpleAuth,
        backup: NOOP,
        restore: setupSimpleAuth
    },
    _docker: {
        setup: NOOP,
        teardown: NOOP,
        backup: NOOP,
        restore: NOOP
    }
};

var RMAPPDIR_CMD = path.join(__dirname, 'scripts/rmappdir.sh');

function debugApp(app, args) {
    assert(!app || typeof app === 'object');

    var prefix = app ? (app.location || 'naked_domain') : '(no app)';
    debug(prefix + ' ' + util.format.apply(util, Array.prototype.slice.call(arguments, 1)));
}

function setupAddons(app, addons, callback) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');
    assert.strictEqual(typeof callback, 'function');

    if (!addons) return callback(null);

    debugApp(app, 'setupAddons: Settings up %j', Object.keys(addons));

    async.eachSeries(Object.keys(addons), function iterator(addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        debugApp(app, 'Setting up addon %s with options %j', addon, addons[addon]);

        KNOWN_ADDONS[addon].setup(app, addons[addon], iteratorCallback);
    }, callback);
}

function teardownAddons(app, addons, callback) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');
    assert.strictEqual(typeof callback, 'function');

    if (!addons) return callback(null);

    debugApp(app, 'teardownAddons: Tearing down %j', Object.keys(addons));

    async.eachSeries(Object.keys(addons), function iterator(addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        debugApp(app, 'Tearing down addon %s with options %j', addon, addons[addon]);

        KNOWN_ADDONS[addon].teardown(app, addons[addon], iteratorCallback);
    }, callback);
}

function backupAddons(app, addons, callback) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'backupAddons');

    if (!addons) return callback(null);

    debugApp(app, 'backupAddons: Backing up %j', Object.keys(addons));

    async.eachSeries(Object.keys(addons), function iterator (addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        KNOWN_ADDONS[addon].backup(app, addons[addon], iteratorCallback);
    }, callback);
}

function restoreAddons(app, addons, callback) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'restoreAddons');

    if (!addons) return callback(null);

    debugApp(app, 'restoreAddons: restoring %j', Object.keys(addons));

    async.eachSeries(Object.keys(addons), function iterator (addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        KNOWN_ADDONS[addon].restore(app, addons[addon], iteratorCallback);
    }, callback);
}

function getEnvironment(app, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof callback, 'function');

    appdb.getAddonConfigByAppId(app.id, callback);
}

function getLinksSync(app, addons) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');

    var links = [ ];

    if (!addons) return links;

    for (var addon in addons) {
        switch (addon) {
        case 'mysql': links.push('mysql:mysql'); break;
        case 'postgresql': links.push('postgresql:postgresql'); break;
        case 'sendmail': links.push('mail:mail'); break;
        case 'redis': links.push('redis-' + app.id + ':redis-' + app.id); break;
        case 'mongodb': links.push('mongodb:mongodb'); break;
        default: break;
        }
    }

    return links;
}

function getBindsSync(app, addons) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');

    var binds = [ ];

    if (!addons) return binds;

    for (var addon in addons) {
        switch (addon) {
        case '_docker': binds.push('/var/run/docker.sock:/var/run/docker.sock:rw'); break;
        case 'localstorage': binds.push(path.join(paths.DATA_DIR, app.id, 'data') + ':/app/data:rw'); break;
        default: break;
        }
    }

    return binds;
}

function getContainerNamesSync(app, addons) {
    assert.strictEqual(typeof app, 'object');
    assert(!addons || typeof addons === 'object');

    var names = [ ];

    if (!addons) return names;

    for (var addon in addons) {
        switch (addon) {
        case 'scheduler':
            // names here depend on how scheduler.js creates containers
            names = names.concat(Object.keys(addons.scheduler).map(function (taskName) { return app.id + '-' + taskName; }));
            break;
        default: break;
        }
    }

    return names;
}

function setupOauth(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var appId = app.id;
    var id = 'cid-' + uuid.v4();
    var clientSecret = hat(256);
    var redirectURI = 'https://' + config.appFqdn(app.location);
    var scope = 'profile';

    debugApp(app, 'setupOauth: id:%s clientSecret:%s', id, clientSecret);

    clientdb.delByAppIdAndType(appId, clientdb.TYPE_OAUTH, function (error) { // remove existing creds
        if (error && error.reason !== DatabaseError.NOT_FOUND) return callback(error);

        clientdb.add(id, appId, clientdb.TYPE_OAUTH, clientSecret, redirectURI, scope, function (error) {
            if (error) return callback(error);

            var env = [
                'OAUTH_CLIENT_ID=' + id,
                'OAUTH_CLIENT_SECRET=' + clientSecret,
                'OAUTH_ORIGIN=' + config.adminOrigin()
            ];

            debugApp(app, 'Setting oauth addon config to %j', env);

            appdb.setAddonConfig(appId, 'oauth', env, callback);
        });
    });
}

function teardownOauth(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'teardownOauth');

    clientdb.delByAppIdAndType(app.id, clientdb.TYPE_OAUTH, function (error) {
        if (error && error.reason !== DatabaseError.NOT_FOUND) console.error(error);

        appdb.unsetAddonConfig(app.id, 'oauth', callback);
    });
}

function setupSimpleAuth(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var appId = app.id;
    var id = 'cid-' + uuid.v4();
    var scope = 'profile';

    debugApp(app, 'setupSimpleAuth: id:%s', id);

    clientdb.delByAppIdAndType(app.id, clientdb.TYPE_SIMPLE_AUTH, function (error) { // remove existing creds
        if (error && error.reason !== DatabaseError.NOT_FOUND) return callback(error);

        clientdb.add(id, appId, clientdb.TYPE_SIMPLE_AUTH, '', '', scope, function (error) {
            if (error) return callback(error);

            var env = [
                'SIMPLE_AUTH_SERVER=172.17.0.1',
                'SIMPLE_AUTH_PORT=' + config.get('simpleAuthPort'),
                'SIMPLE_AUTH_URL=http://172.17.0.1:' + config.get('simpleAuthPort'), // obsolete, remove
                'SIMPLE_AUTH_ORIGIN=http://172.17.0.1:' + config.get('simpleAuthPort'),
                'SIMPLE_AUTH_CLIENT_ID=' + id
            ];

            debugApp(app, 'Setting simple auth addon config to %j', env);

            appdb.setAddonConfig(appId, 'simpleauth', env, callback);
        });
    });
}

function teardownSimpleAuth(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'teardownSimpleAuth');

    clientdb.delByAppIdAndType(app.id, clientdb.TYPE_SIMPLE_AUTH, function (error) {
        if (error && error.reason !== DatabaseError.NOT_FOUND) console.error(error);

        appdb.unsetAddonConfig(app.id, 'simpleauth', callback);
    });
}

function setupLdap(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var env = [
        'LDAP_SERVER=172.17.0.1',
        'LDAP_PORT=' + config.get('ldapPort'),
        'LDAP_URL=ldap://172.17.0.1:' + config.get('ldapPort'),
        'LDAP_USERS_BASE_DN=ou=users,dc=cloudron',
        'LDAP_GROUPS_BASE_DN=ou=groups,dc=cloudron',
        'LDAP_BIND_DN=cn='+ app.id + ',ou=apps,dc=cloudron',
        'LDAP_BIND_PASSWORD=' + hat(256) // this is ignored
    ];

    debugApp(app, 'Setting up LDAP');

    appdb.setAddonConfig(app.id, 'ldap', env, callback);
}

function teardownLdap(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'Tearing down LDAP');

    appdb.unsetAddonConfig(app.id, 'ldap', callback);
}

function setupSendMail(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var env = [
        'MAIL_SMTP_SERVER=mail',
        'MAIL_SMTP_PORT=2500', // if you change this, change the mail container
        'MAIL_SMTP_USERNAME=' + (app.location || app.id) + '-app', // use app.id for bare domains
        'MAIL_DOMAIN=' + config.fqdn()
    ];

    debugApp(app, 'Setting up sendmail');

    appdb.setAddonConfig(app.id, 'sendmail', env, callback);
}

function teardownSendMail(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'Tearing down sendmail');

    appdb.unsetAddonConfig(app.id, 'sendmail', callback);
}

function setupMySql(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'Setting up mysql');

    var container = docker.getContainer('mysql');
    var cmd = [ '/addons/mysql/service.sh', 'add', app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debugApp(app, data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debugApp(app, 'Setting mysql addon config to %j', env);
                appdb.setAddonConfig(app.id, 'mysql', env, callback);
            });
        });
    });
}

function teardownMySql(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var container = docker.getContainer('mysql');
    var cmd = [ '/addons/mysql/service.sh', 'remove', app.id ];

    debugApp(app, 'Tearing down mysql');

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var data = '';
            stream.on('error', callback);
            stream.on('data', function (d) { data += d.toString('utf8'); });
            stream.on('end', function () {
                appdb.unsetAddonConfig(app.id, 'mysql', callback);
            });
        });
    });
}

function backupMySql(app, options, callback) {
    debugApp(app, 'Backing up mysql');

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'mysqldump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'mysql', '/addons/mysql/service.sh', 'backup', app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debugApp(app, 'backupMySql: done. code:%s signal:%s', code, signal);
        if (!callback.called) callback(code ? 'backupMySql failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restoreMySql(app, options, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupMySql(app, options, function (error) {
        if (error) return callback(error);

        debugApp(app, 'restoreMySql');

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'mysqldump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'mysql', '/addons/mysql/service.sh', 'restore', app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debugApp(app, 'restoreMySql: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restoreMySql failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin).on('error', callback);
    });
}

function setupPostgreSql(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'Setting up postgresql');

    var container = docker.getContainer('postgresql');
    var cmd = [ '/addons/postgresql/service.sh', 'add', app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debugApp(app, data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debugApp(app, 'Setting postgresql addon config to %j', env);
                appdb.setAddonConfig(app.id, 'postgresql', env, callback);
            });
        });
    });
}

function teardownPostgreSql(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var container = docker.getContainer('postgresql');
    var cmd = [ '/addons/postgresql/service.sh', 'remove', app.id ];

    debugApp(app, 'Tearing down postgresql');

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var data = '';
            stream.on('error', callback);
            stream.on('data', function (d) { data += d.toString('utf8'); });
            stream.on('end', function () {
                appdb.unsetAddonConfig(app.id, 'postgresql', callback);
            });
        });
    });
}

function backupPostgreSql(app, options, callback) {
    debugApp(app, 'Backing up postgresql');

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'postgresqldump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'postgresql', '/addons/postgresql/service.sh', 'backup', app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debugApp(app, 'backupPostgreSql: done %s %s', code, signal);
        if (!callback.called) callback(code ? 'backupPostgreSql failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restorePostgreSql(app, options, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupPostgreSql(app, options, function (error) {
        if (error) return callback(error);

        debugApp(app, 'restorePostgreSql');

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'postgresqldump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'postgresql', '/addons/postgresql/service.sh', 'restore', app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debugApp(app, 'restorePostgreSql: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restorePostgreSql failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin).on('error', callback);
    });
}

function setupMongoDb(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    debugApp(app, 'Setting up mongodb');

    var container = docker.getContainer('mongodb');
    var cmd = [ '/addons/mongodb/service.sh', 'add', app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debugApp(app, data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debugApp(app, 'Setting mongodb addon config to %j', env);
                appdb.setAddonConfig(app.id, 'mongodb', env, callback);
            });
        });
    });
}

function teardownMongoDb(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var container = docker.getContainer('mongodb');
    var cmd = [ '/addons/mongodb/service.sh', 'remove', app.id ];

    debugApp(app, 'Tearing down mongodb');

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var data = '';
            stream.on('error', callback);
            stream.on('data', function (d) { data += d.toString('utf8'); });
            stream.on('end', function () {
                appdb.unsetAddonConfig(app.id, 'mongodb', callback);
            });
        });
    });
}

function backupMongoDb(app, options, callback) {
    debugApp(app, 'Backing up mongodb');

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'mongodbdump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'mongodb', '/addons/mongodb/service.sh', 'backup', app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debugApp(app, 'backupMongoDb: done %s %s', code, signal);
        if (!callback.called) callback(code ? 'backupMongoDb failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restoreMongoDb(app, options, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupMongoDb(app, options, function (error) {
        if (error) return callback(error);

        debugApp(app, 'restoreMongoDb');

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'mongodbdump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'mongodb', '/addons/mongodb/service.sh', 'restore', app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debugApp(app, 'restoreMongoDb: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restoreMongoDb failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin).on('error', callback);
    });
}


function forwardRedisPort(appId, callback) {
    assert.strictEqual(typeof appId, 'string');
    assert.strictEqual(typeof callback, 'function');

    docker.getContainer('redis-' + appId).inspect(function (error, data) {
        if (error) return callback(new Error('Unable to inspect container:' + error));

        var redisPort = parseInt(safe.query(data, 'NetworkSettings.Ports.6379/tcp[0].HostPort'), 10);
        if (!Number.isInteger(redisPort)) return callback(new Error('Unable to get container port mapping'));

        return callback(null);
    });
}

function stopAndRemoveRedis(container, callback) {
    function ignoreError(func) {
        return function (callback) {
            func(function (error) {
                if (error) debug('stopAndRemoveRedis: Ignored error:', error);
                callback();
            });
        };
    }

    // stopping redis with SIGTERM makes it commit the database to disk
    async.series([
        ignoreError(container.stop.bind(container, { t: 10 })),
        ignoreError(container.wait.bind(container)),
        ignoreError(container.remove.bind(container, { force: true, v: true }))
    ], callback);
}

// Ensures that app's addon redis container is running. Can be called when named container already exists/running
function setupRedis(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

    var redisPassword = generatePassword(64, false /* memorable */, /[\w\d_]/); // ensure no / in password for being sed friendly (and be uri friendly)
    var redisVarsFile = path.join(paths.ADDON_CONFIG_DIR, 'redis-' + app.id + '_vars.sh');
    var redisDataDir = path.join(paths.DATA_DIR, app.id + '/redis');

    if (!safe.fs.writeFileSync(redisVarsFile, 'REDIS_PASSWORD=' + redisPassword)) {
        return callback(new Error('Error writing redis config'));
    }

    if (!safe.fs.mkdirSync(redisDataDir) && safe.error.code !== 'EEXIST') return callback(new Error('Error creating redis data dir:' + safe.error));

    var createOptions = {
        name: 'redis-' + app.id,
        Hostname: 'redis-' + app.location,
        Tty: true,
        Image: 'cloudron/redis:0.8.0', // if you change this, fix setup/INFRA_VERSION as well
        Cmd: null,
        Volumes: {
            '/tmp': {},
            '/run': {}
        },
        VolumesFrom: [],
        HostConfig: {
            Binds: [
                redisVarsFile + ':/etc/redis/redis_vars.sh:ro',
                redisDataDir + ':/var/lib/redis:rw'
            ],
            Memory: 1024 * 1024 * 75, // 100mb
            MemorySwap: 1024 * 1024 * 75 * 2, // 150mb
            PortBindings: {
                '6379/tcp': [{ HostPort: '0', HostIp: '127.0.0.1' }]
            },
            ReadonlyRootfs: true,
            RestartPolicy: {
                'Name': 'always',
                'MaximumRetryCount': 0
            }
        }
    };

    var env = [
        'REDIS_URL=redis://redisuser:' + redisPassword + '@redis-' + app.id,
        'REDIS_PASSWORD=' + redisPassword,
        'REDIS_HOST=redis-' + app.id,
        'REDIS_PORT=6379'
    ];

    var redisContainer = docker.getContainer(createOptions.name);
    stopAndRemoveRedis(redisContainer, function () {
        docker.createContainer(createOptions, function (error) {
            if (error && error.statusCode !== 409) return callback(error); // if not already created

            redisContainer.start(function (error) {
                if (error && error.statusCode !== 304) return callback(error); // if not already running

                appdb.setAddonConfig(app.id, 'redis', env, function (error) {
                    if (error) return callback(error);

                    forwardRedisPort(app.id, callback);
                });
            });
        });
    });
}

function teardownRedis(app, options, callback) {
    assert.strictEqual(typeof app, 'object');
    assert.strictEqual(typeof options, 'object');
    assert.strictEqual(typeof callback, 'function');

   var container = docker.getContainer('redis-' + app.id);

   var removeOptions = {
       force: true, // kill container if it's running
       v: true // removes volumes associated with the container
   };

   container.remove(removeOptions, function (error) {
       if (error && error.statusCode !== 404) return callback(new Error('Error removing container:' + error));

       safe.fs.unlinkSync(paths.ADDON_CONFIG_DIR, 'redis-' + app.id + '_vars.sh');

        shell.sudo('teardownRedis', [ RMAPPDIR_CMD, app.id + '/redis' ], function (error, stdout, stderr) {
            if (error) return callback(new Error('Error removing redis data:' + error));

            appdb.unsetAddonConfig(app.id, 'redis', callback);
        });
   });
}

function backupRedis(app, options, callback) {
    debugApp(app, 'Backing up redis');

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var cp = spawn('/usr/bin/docker', [ 'exec', 'redis-' + app.id, '/addons/redis/service.sh', 'backup' ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debugApp(app, 'backupRedis: done. code:%s signal:%s', code, signal);
        if (!callback.called) callback(code ? 'backupRedis failed with status ' + code : null);
    });

    cp.stdout.pipe(process.stdout);
    cp.stderr.pipe(process.stderr);
}
