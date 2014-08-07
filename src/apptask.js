#!/usr/bin/env node

/* jslint node:true */

'use strict';

require('supererror');

var assert = require('assert'),
    Docker = require('dockerode'),
    superagent = require('superagent'),
    async = require('async'),
    os = require('os'),
    safe = require('safetydance'),
    appdb = require('./appdb.js'),
    debug = require('debug')('box:apptask'),
    fs = require('fs'),
    child_process = require('child_process'),
    path = require('path'),
    net = require('net'),
    config = require('../config.js'),
    database = require('./database.js'),
    ejs = require('ejs'),
    appFqdn = require('./apps').appFqdn;

exports = module.exports = {
    initialize: initialize,
    start: start,
    setNakedDomain: setNakedDomain,

    // exported for testing
    _getFreePort: getFreePort,
    _configureNginx: configureNginx,
    _unconfigureNginx: unconfigureNginx,
    _setNakedDomain: setNakedDomain,
    _createVolume: createVolume,
    _deleteVolume: deleteVolume,
    _downloadManifest: downloadManifest,
    _registerSubdomain: registerSubdomain,
    _unregisterSubdomain: unregisterSubdomain,
    _reloadNginx: reloadNginx
};

var docker = null,
    NGINX_APPCONFIG_EJS = fs.readFileSync(__dirname + '/../nginx/appconfig.ejs', { encoding: 'utf8' }),
    RELOAD_NGINX_CMD = 'sudo ' + __dirname + '/reloadnginx.sh';

function initialize(callback) {
    if (os.platform() === 'linux') {
        docker = new Docker({socketPath: '/var/run/docker.sock'});
    } else {
        docker = new Docker({ host: 'http://localhost', port: 2375 });
    }

    database.initialize(callback);
}

function getFreePort(callback) {
    var server = net.createServer();
    server.listen(0, function () {
        var port = server.address().port;
        server.close(function () {
            return callback(null, port);
        });
    });
}

function forwardFromHostToVirtualBox(rulename, port) {
    if (os.platform() === 'darwin') {
        debug('Setting up VirtualBox port forwarding for '+ rulename + ' at ' + port);
        child_process.exec(
            'VBoxManage controlvm boot2docker-vm natpf1 delete ' + rulename + ';'
            + 'VBoxManage controlvm boot2docker-vm natpf1 ' + rulename + ',tcp,127.0.0.1,' + port + ',,' + port);
    }
}

function reloadNginx(callback) {
    child_process.exec(RELOAD_NGINX_CMD, { timeout: 10000 }, callback);
}

function configureNginx(app, httpPort, callback) {
    var nginxConf = ejs.render(NGINX_APPCONFIG_EJS, { vhost: appFqdn(app.location), port: httpPort });

    var nginxConfigFilename = path.join(config.nginxAppConfigDir, app.location + '.conf');
    debug('writing config to ' + nginxConfigFilename);

    fs.writeFile(nginxConfigFilename, nginxConf, function (error) {
        if (error) return callback(error);

        exports._reloadNginx(callback);

        forwardFromHostToVirtualBox(app.id + '-http', httpPort);
    });
}

function unconfigureNginx(app, callback) {
    var nginxConfigFilename = path.join(config.nginxAppConfigDir, app.location + '.conf');
    if (!safe.fs.unlinkSync(nginxConfigFilename)) {
        console.error('Error removing nginx configuration ' + safe.error);
        return callback(safe.error);
    }

    exports._reloadNginx(callback);
}

function setNakedDomain(app, callback) {
    var nginxConf = app ? ejs.render(NGINX_APPCONFIG_EJS, { vhost: config.fqdn, port: app.httpPort }) : '';

    var nginxNakedDomainFilename = path.join(config.nginxConfigDir, 'naked_domain.conf');
    debug('writing naked domain config to ' + nginxNakedDomainFilename);

    fs.writeFile(nginxNakedDomainFilename, nginxConf, function (error) {
        if (error) return callback(error);

        exports._reloadNginx(callback);
    });
}

function downloadImage(app, callback) {
    debug('Will download app now');

    var manifest = app.manifest;
    if (manifest === null) return callback(new Error('Manifest parse error:' + safe.error));

    if (!manifest.health_check_url || !manifest.docker_image || !manifest.http_port) {
        return callback(new Error('Manifest missing mandatory parameters'));
    }

    docker.pull(manifest.docker_image, function (err, stream) {
        if (err) return callback(new Error('Error connecting to docker'));

        // https://github.com/dotcloud/docker/issues/1074 says each status message
        // is emitted as a chunk
        stream.on('data', function (chunk) {
            var data = safe.JSON.parse(chunk) || { };
            debug('downloadImage:', JSON.stringify(data));

            // The information here is useless because this is per layer as opposed to per image
            if (data.status) {
                debug('Progress: ' + data.status); // progressDetail { current, total }
            } else if (data.error) {
                console.error('Error detail:' + data.errorDetail.message);
            }
        });

        stream.on('end', function () {
            debug('pulled successfully');

            var image = docker.getImage(manifest.docker_image);

            image.inspect(function (err, data) {
                if (err || !data || !data.Config) {
                    return callback(new Error('Error inspecting image'));
                }

                if (!data.Config.Entrypoint && !data.Config.Cmd) {
                    return callback(new Error('Only images with entry point are allowed'));
                }

                debug('This image exposes ports: ' + JSON.stringify(data.Config.ExposedPorts));
                return callback(null);
            });
        });
    });
}

function createContainer(app, portConfigs, callback) {
    var manifest = app.manifest;

    var env = [ ];
    if (typeof manifest.tcp_ports === 'object') {
        portConfigs.forEach(function (portConfig) {
            if (!(portConfig.containerPort in manifest.tcp_ports)) return;
            env.push(manifest.tcp_ports[portConfig.containerPort].environment_variable + '=' + portConfig.hostPort);
        });
    }

    var containerOptions = {
        Hostname: appFqdn(app.location),
        Tty: true,
        Image: manifest.docker_image,
        Cmd: null,
        Volumes: { },
        VolumesFrom: '',
        Env: env
    };

    debug('Creating container for ' + manifest.docker_image);

    docker.createContainer(containerOptions, function (error, container) {
        if (error) return callback(new Error('Error creating container:' + error));

        return callback(null, container.id);
    });
}

function deleteContainer(app, callback) {
    var container = docker.getContainer(app.containerId);

    var removeOptions = {
        force: true, // kill container if it's running
        v: true // removes volumes associated with the container
    };

    container.remove(removeOptions, function (error) {
        if (error) debug('Error removing container', error);
        callback(error);
    });
}

function createVolume(app, callback) {
    var appDataDir = path.join(config.appDataRoot, app.id);

    if (!safe.fs.mkdirSync(appDataDir)) {
        return callback(new Error('Error creating app data directory ' + appDataDir + ' ' + safe.error));
    }

    return callback(null);
}

function deleteVolume(app, callback) {
    child_process.exec('sudo ' + __dirname + '/rmappdir.sh ' + app.id, function (error, stdout, stderr) {
        if (error) console.error('Error removing volume', error);
        return callback(error);
    });
}

function startContainer(app, portConfigs, callback) {
    var manifest = app.manifest;
    var appDataDir = path.join(config.appDataRoot, app.id);

    var portBindings = { };
    portBindings[manifest.http_port + '/tcp'] = [ { HostPort: app.httpPort + '' } ];
    if (typeof manifest.tcp_ports === 'object') {
        portConfigs.forEach(function (portConfig) {
            if (!(portConfig.containerPort in manifest.tcp_ports)) return;
            portBindings[portConfig.containerPort + '/tcp'] = [ { HostPort: portConfig.hostPort + '' } ];
            forwardFromHostToVirtualBox(app.id + '-tcp' + portConfig.containerPort, portConfig.hostPort);
        });
    }

    var startOptions = {
        Binds: [ appDataDir + ':/app/data:rw' ],
        PortBindings: portBindings,
        PublishAllPorts: false
    };

    var container = docker.getContainer(app.containerId);
    debug('Starting container ' + container.id + ' with options: ' + JSON.stringify(startOptions));

    container.start(startOptions, function (error, data) {
        if (error) return callback(new Error('Error starting container:' + error));

        return callback(null);
    });
}

function downloadManifest(app, callback) {
    debug('Downloading manifest for :', app.id);

    superagent
        .get(config.appServerUrl + '/api/v1/app/' + app.id + '/manifest')
        .set('Accept', 'application/json')
        .end(function (error, res) {
            if (error) return callback(error);

            if (res.status !== 200) return callback(new Error('Error downloading manifest. Status' + res.status + '. ' + JSON.stringify(res.body)));

            debug('Downloaded application manifest: ' + res.text);
            return callback(null, res.text);
        });
}

function registerSubdomain(app, callback) {
    if (!config.token) {
        debug('Skipping subdomain registration for development');
        return callback(null);
    }

    debug('Registering subdomain for ' + app.id + ' at ' + app.location);

    superagent
        .post(config.appServerUrl + '/api/v1/subdomains')
        .set('Accept', 'application/json')
        .query({ token: config.token })
        .send({ subdomain: app.location })
        .end(function (error, res) {
            if (error) return callback(error);

            if (res.status !== 201) return callback(new Error('Subdomain Registration failed. Status:' + res.status + '. ' + JSON.stringify(res.body)));

            debug('Registered subdomain for ' + app.id);

            return callback(null);
        });
}

function unregisterSubdomain(app, callback) {
    if (!config.token) {
        debug('Skipping subdomain unregistration for development');
        return callback(null);
    }

    debug('Unregistering subdomain for ' + app.id + ' at ' + app.location);
    superagent
        .del(config.appServerUrl + '/api/v1/subdomains/' + app.location)
        .query({ token: config.token })
        .end(function (error, res) {
            if (error) {
                console.error('Error making request: ', error);
            } else if (res.status !== 200) {
                console.error('Error unregistering subdomain:', res.status, res.body);
            }

            callback(null);
        });
}

// updates the app object and the database
function updateApp(app, values, callback) {
    for (var value in values) {
        app[value] = values[value];
    }

    debug(app.id + ' code:' + app.installationState);

    appdb.update(app.id, values, callback);
}

function install(app, callback) {
    async.series([
        // configure nginx
        function (callback) {
            getFreePort(function (error, freePort) {
                if (error) return callback(error);
                configureNginx(app, freePort, function (error) {
                    if (error) return callback(error);

                    updateApp(app, { httpPort: freePort }, callback);
                });
            });
        },

        // register subdomain
        function (callback) {
            updateApp(app, { installationState: appdb.ISTATE_REGISTERING_SUBDOMAIN }, function (error) {
                if (error) return callback(error);

                registerSubdomain(app, function (error) {
                    if (error) return callback(error);

                    callback(null);
                });
            });
        },

        // download manifest
        function (callback) {
            updateApp(app, { installationState: appdb.ISTATE_DOWNLOADING_MANIFEST }, function (error) {
                if (error) return callback(error);

                downloadManifest(app, function (error, manifestJson) {
                    if (error) return callback(error);

                    var manifest = safe.JSON.parse(manifestJson);
                    if (!manifest) return callback(new Error('Error parsing manifest:' + safe.error));

                    updateApp(app, { manifest: manifest }, callback);
                });
            });
        },

        // download the image
        function (callback) {
            updateApp(app, { installationState: appdb.ISTATE_DOWNLOADING_IMAGE }, function (error) {
                if (error) return callback(error);

                downloadImage(app, function (error) {
                    if (error) return callback(error);

                    callback(null);
                });
            });
        },

        // create container
        function (callback) {
            appdb.getPortBindings(app.id, function (error, portBindings) {
                if (error) return callback(error);

                updateApp(app, { installationState: appdb.ISTATE_CREATING_CONTAINER }, function (error) {
                    if (error) return callback(error);

                    createContainer(app, portBindings, function (error, containerId) {
                        if (error) return callback(error);

                        updateApp(app, { containerId: containerId }, callback);
                    });
                });
            });
        },

        // create data volume
        function (callback) {
            updateApp(app, { installationState: appdb.ISTATE_CREATING_VOLUME }, function (error) {
                if (error) return callback(error);

                createVolume(app, function (error) {
                    if (error) return callback(error);

                    callback(null);
                });
            });
        },

        // done!
        function (callback) {
            debug('App ' + app.id + ' installed');
            updateApp(app, { installationState: appdb.ISTATE_INSTALLED }, callback);
        }
    ], callback);
}

function uninstall(app, callback) {
   debug('uninstalling ' + app.id);

    // TODO: figure what happens if one of the steps fail
    async.series([
        // unset naked domain
        function (callback) {
            if (config.naked_domain !== app.id) return callback(null);

            config.set('naked_domain', null);
            callback(null);
        },

        // unconfigure nginx
        function (callback) {
            unconfigureNginx(app, function (error) { callback(null); });
        },

        // delete the container
        function (callback) {
            deleteContainer(app, function (error) { callback(null); });
        },

        // delete volume
        function (callback) {
            deleteVolume(app, function (error) { callback(null); });
        },

        // unregister subdomain
        function (callback) {
            unregisterSubdomain(app, function (error) { callback(null); });
        },

        // delete app from db
        function (callback) {
            appdb.del(app.id, callback);
        },
    ], callback);
}


function runApp(app, callback) {
    appdb.getPortBindings(app.id, function (error, portBindings) {
        if (error) return callback(error);

        startContainer(app, portBindings, function (error) {
            if (error) {
                console.error('Error creating container:' + error);
                return updateApp(app, { runState: appdb.RSTATE_ERROR }, callback);
            }

            updateApp(app, { runState: appdb.RSTATE_RUNNING }, callback);
        });
    });
}

// callback is called with error for fatal errors (and not for install errors)
function start(appId, callback) {
    appdb.get(appId, function (error, app) {
        if (error) return callback(error);

        if (app.installationState === appdb.ISTATE_PENDING_UNINSTALL) {
            uninstall(app, callback);
            return;
        }

        install(app, function (error) {
            if (error) {
                console.error('Error installing app:', error);
                return updateApp(app, { installationState: appdb.ISTATE_ERROR }, callback);
            }

            runApp(app, callback);
        });
    });
}

if (require.main === module) {
    assert(process.argv.length === 3, 'Pass the appid as argument');

    // FIXME: For some reason our selfhost.io certificate doesn't work with
    // superagent and fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE
    // Important to remove this before we release
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;


    debug('Apptask for ' + process.argv[2]);

    initialize(function (error) {
        if (error) throw error;

        start(process.argv[2], function (error) {
            debug('Apptask completed for ' + process.argv[2] + ' ' + error);
            process.exit(error ? 1 : 0);
        });
    });
}

