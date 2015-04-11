'use strict';

var appdb = require('./appdb.js'),
    assert = require('assert'),
    async = require('async'),
    child_process = require('child_process'),
    clientdb = require('./clientdb.js'),
    config = require('../config.js'),
    DatabaseError = require('./databaseerror.js'),
    debug = require('debug')('box:addons'),
    docker = require('./docker.js'),
    fs = require('fs'),
    generatePassword = require('password-generator'),
    MemoryStream = require('memorystream'),
    once = require('once'),
    os = require('os'),
    path = require('path'),
    paths = require('./paths.js'),
    safe = require('safetydance'),
    spawn = child_process.spawn,
    util = require('util'),
    uuid = require('node-uuid'),
    hat = require('hat'),
    vbox = require('./vbox.js'),
    _ = require('underscore');

exports = module.exports = {
    setupAddons: setupAddons,
    teardownAddons: teardownAddons,
    updateAddons: updateAddons,
    backupAddons: backupAddons,
    restoreAddons: restoreAddons,

    getEnvironment: getEnvironment,
    getLinksSync: getLinksSync,

    // exported for testing
    _allocateOAuthCredentials: allocateOAuthCredentials,
    _removeOAuthCredentials: removeOAuthCredentials
};

// setup can be called multiple times for the same app (configure crash restart) and existing data must not be lost
// teardown is destructive. app data stored with the addon is lost
var KNOWN_ADDONS = {
    oauth: {
        setup: allocateOAuthCredentials,
        teardown: removeOAuthCredentials
    },
    sendmail: {
        setup: setupSendMail,
        teardown: teardownSendMail
    },
    mysql: {
        setup: setupMySql,
        teardown: teardownMySql,
        backup: backupMySql,
        restore: restoreMySql,
    },
    postgresql: {
        setup: setupPostgreSql,
        teardown: teardownPostgreSql,
        backup: backupPostgreSql,
        restore: restorePostgreSql
    },
    mongodb: {
        setup: setupMongoDb,
        teardown: teardownMongoDb,
        backup: backupMongoDb,
        restore: restoreMongoDb
    },
    redis: {
        setup: setupRedis,
        teardown: teardownRedis,
        backup: null, // no backup because we store redis as part of app's volume
        restore: setupRedis // same thing
    }
};

var SUDO = '/usr/bin/sudo',
    RMAPPDIR_CMD = path.join(__dirname, 'scripts/rmappdir.sh');

function execFile(tag, file, args, callback) {
    assert(typeof tag === 'string');
    assert(typeof file === 'string');
    assert(util.isArray(args));
    assert(typeof callback === 'function');

    var options = { timeout: 0, encoding: 'utf8' };

    child_process.execFile(file, args, options, function (error, stdout, stderr) {
        debug(tag + ' execFile: %s %s', file, args.join(' '));
        debug(tag + ' (stdout): %s', stdout.toString('utf8'));
        debug(tag + ' (stderr): %s', stderr.toString('utf8'));

        if (error) debug(tag + ' code: %s, signal: %s', error.code, error.signal);

        callback(error);
    });
}

function setupAddons(app, callback) {
    assert(typeof app === 'object');
    assert(!app.manifest.addons || util.isArray(app.manifest.addons));
    assert(typeof callback === 'function');

    if (!app.manifest.addons) return callback(null);

    async.eachSeries(app.manifest.addons, function iterator(addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        debug('Setting up addon %s of appId:%s', addon, app.id);

        KNOWN_ADDONS[addon].setup(app, iteratorCallback);
    }, callback);
}

function teardownAddons(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    if (!app.manifest) return callback(null);

    assert(!app.manifest.addons || util.isArray(app.manifest.addons));

    if (!app.manifest.addons) return callback(null);

    async.eachSeries(app.manifest.addons, function iterator(addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        debug('Tearing down addon %s of appId:%s', addon, app.id);

        KNOWN_ADDONS[addon].teardown(app, iteratorCallback);
    }, callback);
}

function updateAddons(app, oldManifest, callback) {
    assert(typeof app === 'object');
    assert(!oldManifest || typeof oldManifest === 'object');
    assert(typeof callback === 'function');

    setupAddons(app, function (error) {
        if (error) return callback(error);

        if (!oldManifest) return callback(null);

        // teardown the old addons
        async.eachSeries(_.difference(oldManifest.addons, app.manifest.addons), function iterator(addon, iteratorCallback) {
            if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

            KNOWN_ADDONS[addon].teardown(app, iteratorCallback);
        }, callback);
    });
}

function backupAddons(app, callback) {
    assert(typeof app === 'object');
    assert(!app.manifest.addons || util.isArray(app.manifest.addons));
    assert(typeof callback === 'function');

    debug('backupAddons: %s (%s)', app.id, app.manifest.title);

    if (!app.manifest.addons) return callback(null);

    async.eachSeries(app.manifest.addons, function iterator (addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        if (!KNOWN_ADDONS[addon].backup) return iteratorCallback(null);

        KNOWN_ADDONS[addon].backup(app, iteratorCallback);
    }, callback);
}

function restoreAddons(app, callback) {
    assert(typeof app === 'object');
    assert(!app.manifest.addons || util.isArray(app.manifest.addons));
    assert(typeof callback === 'function');

    debug('restoreAddons: %s (%s)', app.id, app.manifest.title);

    if (!app.manifest.addons) return callback(null);

    async.eachSeries(app.manifest.addons, function iterator (addon, iteratorCallback) {
        if (!(addon in KNOWN_ADDONS)) return iteratorCallback(new Error('No such addon:' + addon));

        if (!KNOWN_ADDONS[addon].restore) return iteratorCallback(null);

        KNOWN_ADDONS[addon].restore(app, iteratorCallback);
    }, callback);
}

function getEnvironment(appId, callback) {
    assert(typeof appId === 'string');
    assert(typeof callback === 'function');

    appdb.getAddonConfigByAppId(appId, callback);
}

function getLinksSync(app) {
    assert(typeof app === 'object');
    assert(!app.manifest.addons || util.isArray(app.manifest.addons));

    var links = [ ];

    if (!app.manifest.addons) return links;

    for (var i = 0; i < app.manifest.addons.length; i++) {
        switch (app.manifest.addons[i]) {
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

function allocateOAuthCredentials(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    var appId = app.id;
    var id = 'cid-addon-' + uuid.v4();
    var clientSecret = hat();
    var redirectURI = 'https://' + config.appFqdn(app.location);
    var scope = 'profile,roleUser';

    debug('allocateOAuthCredentials: id:%s clientSecret:%s', id, clientSecret);

    clientdb.delByAppId('addon-' + appId, function (error, result) { // remove existing creds
        if (error && error.reason !== DatabaseError.NOT_FOUND) return callback(error);

        clientdb.add(id, 'addon-' + appId, clientSecret, redirectURI, scope, function (error) {
            if (error) return callback(error);

            var env = [
                'OAUTH_CLIENT_ID=' + id,
                'OAUTH_CLIENT_SECRET=' + clientSecret
            ];

            debug('Setting oauth addon config of %s to to %j', appId, env);

            appdb.setAddonConfig(appId, 'oauth', env, callback);
        });
    });
}

function removeOAuthCredentials(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    debug('removeOAuthCredentials: %s', app.id);

    clientdb.delByAppId('addon-' + app.id, function (error) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null);
        if (error) console.error(error);

        appdb.unsetAddonConfig(app.id, 'oauth', callback);
    });
}

function setupSendMail(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    var env = [
        'MAIL_SMTP_SERVER=mail',
        'MAIL_SMTP_PORT=25',
        'MAIL_SMTP_USERNAME=' + app.location,
        'MAIL_DOMAIN=' + config.fqdn()
    ];

    debug('Setting up sendmail for %s', app.id);

    appdb.setAddonConfig(app.id, 'sendmail', env, callback);
}

function teardownSendMail(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    debug('Tearing down sendmail for %s', app.id);

    appdb.unsetAddonConfig(app.id, 'sendmail', callback);
}

function setupMySql(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    debug('Setting up mysql for %s', app.id);

    var container = docker.getContainer('mysql');
    var cmd = [ '/addons/mysql/service.sh', 'add', config.get('addons.mysql.rootPassword'), app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debug(data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debug('Setting mysql addon config of %s to %j', app.id, env);
                appdb.setAddonConfig(app.id, 'mysql', env, callback);
            });
        });
    });
}

function teardownMySql(app, callback) {
    var container = docker.getContainer('mysql');
    var cmd = [ '/addons/mysql/service.sh', 'remove', config.get('addons.mysql.rootPassword'), app.id ];

    debug('Tearing down mysql for %s', app.id);

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

function backupMySql(app, callback) {
    debug('Backin up mysql for %s', app.id);

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'mysqldump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'mysql', '/addons/mysql/service.sh', 'backup', config.get('addons.mysql.rootPassword'), app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debug('backupMySql: done %s %s', code, signal);
        if (!callback.called) callback(code ? 'backupMySql failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restoreMySql(app, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupMySql(app, function (error) {
        if (error) return callback(error);

        debug('restoreMySql: %s (%s)', app.id, app.manifest.title);

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'mysqldump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'mysql', '/addons/mysql/service.sh', 'restore', config.get('addons.mysql.rootPassword'), app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debug('restoreMySql: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restoreMySql failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin);
    });
}

function setupPostgreSql(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    debug('Setting up postgresql for %s', app.id);

    var container = docker.getContainer('postgresql');
    var cmd = [ '/addons/postgresql/service.sh', 'add', config.get('addons.postgresql.rootPassword'), app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debug(data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debug('Setting postgresql addon config of %s to %j', app.id, env);
                appdb.setAddonConfig(app.id, 'postgresql', env, callback);
            });
        });
    });
}

function teardownPostgreSql(app, callback) {
    var container = docker.getContainer('postgresql');
    var cmd = [ '/addons/postgresql/service.sh', 'remove', config.get('addons.postgresql.rootPassword'), app.id ];

    debug('Tearing down postgresql for %s', app.id);

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

function backupPostgreSql(app, callback) {
    debug('Backin up postgresql for %s', app.id);

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'postgresqldump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'postgresql', '/addons/postgresql/service.sh', 'backup', config.get('addons.postgresql.rootPassword'), app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debug('backupPostgreSql: done %s %s', code, signal);
        if (!callback.called) callback(code ? 'backupPostgreSql failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restorePostgreSql(app, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupPostgreSql(app, function (error) {
        if (error) return callback(error);

        debug('restorePostgreSql: %s (%s)', app.id, app.manifest.title);

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'postgresqldump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'postgresql', '/addons/postgresql/service.sh', 'restore', config.get('addons.postgresql.rootPassword'), app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debug('restorePostgreSql: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restorePostgreSql failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin);
    });
}

function setupMongoDb(app, callback) {
    assert(typeof app === 'object');
    assert(typeof callback === 'function');

    debug('Setting up mongodb for %s', app.id);

    var container = docker.getContainer('mongodb');
    var cmd = [ '/addons/mongodb/service.sh', 'add', config.get('addons.mongodb.rootPassword'), app.id ];

    container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, function (error, execContainer) {
        if (error) return callback(error);

        execContainer.start(function (error, stream) {
            if (error) return callback(error);

            var stdout = new MemoryStream();
            var stderr = new MemoryStream();

            execContainer.modem.demuxStream(stream, stdout, stderr);
            stderr.on('data', function (data) { debug(data.toString('utf8')); }); // set -e output

            var chunks = [ ];
            stdout.on('data', function (chunk) { chunks.push(chunk); });

            stream.on('error', callback);
            stream.on('end', function () {
                var env = Buffer.concat(chunks).toString('utf8').split('\n').slice(0, -1); // remove trailing newline
                debug('Setting mongodb addon config of %s to %j', app.id, env);
                appdb.setAddonConfig(app.id, 'mongodb', env, callback);
            });
        });
    });
}

function teardownMongoDb(app, callback) {
    var container = docker.getContainer('mongodb');
    var cmd = [ '/addons/mongodb/service.sh', 'remove', config.get('addons.mongodb.rootPassword'), app.id ];

    debug('Tearing down mongodb for %s', app.id);

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

function backupMongoDb(app, callback) {
    debug('Backin up mongodb for %s', app.id);

    callback = once(callback); // ChildProcess exit may or may not be called after error

    var output = fs.createWriteStream(path.join(paths.DATA_DIR, app.id, 'mongodbdump'));
    output.on('error', callback);

    var cp = spawn('/usr/bin/docker', [ 'exec', 'mongodb', '/addons/mongodb/service.sh', 'backup', config.get('addons.mongodb.rootPassword'), app.id ]);
    cp.on('error', callback);
    cp.on('exit', function (code, signal) {
        debug('backupMongoDb: done %s %s', code, signal);
        if (!callback.called) callback(code ? 'backupMongoDb failed with status ' + code : null);
    });

    cp.stdout.pipe(output);
    cp.stderr.pipe(process.stderr);
}

function restoreMongoDb(app, callback) {
    callback = once(callback); // ChildProcess exit may or may not be called after error

    setupMongoDb(app, function (error) {
        if (error) return callback(error);

        debug('restoreMongoDb: %s (%s)', app.id, app.manifest.title);

        var input = fs.createReadStream(path.join(paths.DATA_DIR, app.id, 'mongodbdump'));
        input.on('error', callback);

        // cannot get this to work through docker.exec
        var cp = spawn('/usr/bin/docker', [ 'exec', '-i', 'mongodb', '/addons/mongodb/service.sh', 'restore', config.get('addons.mongodb.rootPassword'), app.id ]);
        cp.on('error', callback);
        cp.on('exit', function (code, signal) {
            debug('restoreMongoDb: done %s %s', code, signal);
            if (!callback.called) callback(code ? 'restoreMongoDb failed with status ' + code : null);
        });

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);
        input.pipe(cp.stdin);
    });
}


function forwardRedisPort(appId, callback) {
    assert(typeof appId === 'string');
    assert(typeof callback === 'function');

    docker.getContainer('redis-' + appId).inspect(function (error, data) {
        if (error) return callback(new Error('Unable to inspect container:' + error));

        var redisPort = parseInt(safe.query(data, 'NetworkSettings.Ports.6379/tcp[0].HostPort'), 10);
        if (!Number.isInteger(redisPort)) return callback(new Error('Unable to get container port mapping'));

        vbox.forwardFromHostToVirtualBox('redis-' + appId, redisPort);

        return callback(null);
    });
}

// Ensures that app's addon redis container is running. Can be called when named container already exists/running
function setupRedis(app, callback) {
    var redisPassword = generatePassword(64, false /* memorable */);
    var redisVarsFile = path.join(paths.ADDON_CONFIG_DIR, 'redis-' + app.id + '_vars.sh');
    var redisDataDir = path.join(paths.DATA_DIR, app.id + '/redis');

    if (!safe.fs.writeFileSync(redisVarsFile, 'REDIS_PASSWORD=' + redisPassword)) {
        return callback(new Error('Error writing redis config'));
    }

    if (!safe.fs.mkdirSync(redisDataDir) && safe.error.code !== 'EEXIST') return callback(new Error('Error creating redis data dir:' + safe.error));

    var createOptions = {
        name: 'redis-' + app.id,
        Hostname: config.appFqdn(app.location),
        Tty: true,
        Image: 'girish/redis:0.1.0',
        Cmd: null,
        Volumes: { },
        VolumesFrom: ''
    };

    var isMac = os.platform() === 'darwin';

    var startOptions = {
        Binds: [
            redisVarsFile + ':/etc/redis/redis_vars.sh:r',
            redisDataDir + ':/var/lib/redis:rw'
        ],
        // On Mac (boot2docker), we have to export the port to external world for port forwarding from Mac to work
        // On linux, export to localhost only for testing purposes and not for the app itself
        PortBindings: {
            '6379/tcp': [{ HostPort: '0', HostIp: isMac ? '0.0.0.0' : '127.0.0.1' }]
        },
        RestartPolicy: {
            'Name': 'always',
            'MaximumRetryCount': 0
        }
    };

    var env = [
        'REDIS_URL=redis://redisuser:' + redisPassword + '@redis-' + app.id,
        'REDIS_PASSWORD=' + redisPassword,
        'REDIS_HOST=redis-' + app.id,
        'REDIS_PORT=6379'
    ];

    var redisContainer = docker.getContainer(createOptions.name);
    redisContainer.remove({ force: true, v: false }, function (ignoredError) {
        docker.createContainer(createOptions, function (error) {
            if (error && error.statusCode !== 409) return callback(error); // if not already created

            redisContainer.start(startOptions, function (error) {
                if (error && error.statusCode !== 304) return callback(error); // if not already running

                appdb.setAddonConfig(app.id, 'redis', env, function (error) {
                    if (error) return callback(error);

                    forwardRedisPort(app.id, callback);
                });
            });
        });
    });
}

function teardownRedis(app, callback) {
   var container = docker.getContainer('redis-' + app.id);

   var removeOptions = {
       force: true, // kill container if it's running
       v: false // removes volumes associated with the container
   };

   container.remove(removeOptions, function (error) {
       if (error && error.statusCode !== 404) return callback(new Error('Error removing container:' + error));

       vbox.unforwardFromHostToVirtualBox('redis-' + app.id);

       safe.fs.unlinkSync(paths.ADDON_CONFIG_DIR, 'redis-' + app.id + '_vars.sh');

        execFile('teardownRedis', SUDO, [ RMAPPDIR_CMD, app.id + '/redis' ], function (error, stdout, stderr) {
            if (error) return callback(new Error('Error removing redis data:' + error));

            appdb.unsetAddonConfig(app.id, 'redis', callback);
        });
   });
}

