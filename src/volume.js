'use strict';

var fs = require('fs'),
    User = require('./user.js'),
    debug = require('debug')('box:volume'),
    encfs = require('encfs'),
    rimraf = require('rimraf'),
    path = require('path'),
    assert = require('assert'),
    uuid = require('node-uuid'),
    aes = require('./aes-helper.js'),
    ursa = require('ursa'),
    async = require('async'),
    util = require('util'),
    VolumeConfig = require('./volumeconfig.js'),
    safe = require('safetydance');

exports = module.exports = {
    Volume: Volume,
    VolumeError: VolumeError,
    list: listVolumes,
    create: createVolume,
    get: getVolume,
    getByName: getVolumeByName
};

var VOLUME_META_FILENAME = '.meta';

function ensureArgs(args, expected) {
    assert(args.length === expected.length);

    for (var i = 0; i < args.length; ++i) {
        if (expected[i]) {
            assert(typeof args[i] === expected[i]);
        }
    }
}

// http://dustinsenos.com/articles/customErrorsInNode
// http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
function VolumeError(err, reason) {
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.message = safe.JSON.stringify(err);
    this.code = err ? err.code : null;
    this.reason = reason || VolumeError.INTERNAL_ERROR;
    this.statusCode = 500; // any db error is a server error
}
util.inherits(VolumeError, Error);
VolumeError.INTERNAL_ERROR = 1;
VolumeError.NOT_MOUNTED = 2;
VolumeError.READ_ERROR = 3;
VolumeError.ALREADY_EXISTS = 4;
VolumeError.NO_SUCH_VOLUME = 5;
VolumeError.NO_SUCH_USER = 6;
VolumeError.WRONG_USER_PASSWORD = 7;
VolumeError.EMPTY_PASSWORD = 8;
VolumeError.MOUNTED = 9;

// TODO is this even a good password generator? - Johannes
function generateNewVolumePassword() {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*()_+?{}[]|:;"~`<>,.-=';
    var charsLength = chars.length;
    var password = '';

    for (var i = 0; i < 64; ++i) {
        password += chars.charAt(Math.floor(Math.random() * charsLength));
    }

    return password;
}

function Volume(id, options) {
    ensureArgs(arguments, ['string', 'object']);
    assert(options.volumesDataRoot);
    assert(options.volumesMountRoot);

    this._configDataRoot = options.volumesDataRoot;
    this._configMountRoot = options.volumesMountRoot;

    this.id = id;
    this.dataPath = this._resolveVolumeRootPath();
    this.mountPoint = this._resolveVolumeMountPoint();
    this.tmpPath = path.join(this.mountPoint, 'tmp');
    this.encfs = new encfs.Root(this.dataPath, this.mountPoint);
    this.config = new VolumeConfig(VOLUME_META_FILENAME, this.dataPath);
}

Volume.prototype._resolveVolumeRootPath = function () {
    return path.join(this._configDataRoot, this.id);
};

Volume.prototype._resolveVolumeMountPoint = function () {
    return path.join(this._configMountRoot, this.id);
};

Volume.prototype.setName = function (name) {
    ensureArgs(arguments, ['string']);
    this.config.set('name', name);
};

Volume.prototype.name = function () {
    return this.config.get('name', null);
};

Volume.prototype.isMounted = function (callback) {
    ensureArgs(arguments, ['function']);

    this.encfs.isMounted(function (error, mounted) {
        if (error) {
            debug('Error checking if encfs volume is mounted', error);
            return callback(error);
        }

        return callback(null, mounted);
    });
};

Volume.prototype.open = function (username, password, callback) {
    ensureArgs(arguments, ['string', 'string', 'function']);

    var that = this;

    this.encfs.isMounted(function (error, mounted) {
        if (error) return callback(new VolumeError(error, VolumeError.INTERNAL_ERROR));

        if (mounted) {
            return callback();
        }

        var record = that.config.hget('users', username, null);
        if (record === null) {
            debug('Unable to get user from meta db. ' + safe.JSON.stringify(error));
            return callback(new VolumeError(error, VolumeError.NO_SUCH_USER));
        }

        User.verify(username, password, function (error, user) {
            if (error) {
                debug('Unable to get user from meta db. ' + safe.JSON.stringify(error));
                return callback(new VolumeError(error, VolumeError.WRONG_USER_PASSWORD));
            }

            var saltBuffer = new Buffer(user._salt, 'hex');
            var privateKeyPem = aes.decrypt(user._privatePemCipher, password, saltBuffer);
            var keyPair = ursa.createPrivateKey(privateKeyPem, password, 'utf8');
            var volPassword = keyPair.decrypt(record.passwordCipher, 'hex', 'utf8');

            if (!volPassword) {
                return callback(new VolumeError(error, VolumeError.WRONG_USER_PASSWORD));
            }

            that.encfs.mount(volPassword, function (error, result) {
                if (error) return callback(new VolumeError(error, VolumeError.INTERNAL_ERROR));
                callback();
            });
        });
    });
};

Volume.prototype.close = function (callback) {
    ensureArgs(arguments, ['function']);

    var that = this;

    this.encfs.isMounted(function (error, mounted) {
        if (error) {
            return callback(error);
        }

        if (!mounted) {
            return callback();
        }

        that.encfs.unmount(function (error, result) {
            if (error) {
                return callback(error);
            }

            callback();
        });
    });
};

Volume.prototype.destroy = function (callback) {
    ensureArgs(arguments, ['function']);

    var that = this;

    function cleanupFolders() {
        rimraf(that.dataPath, function (error) {
            if (error) {
                debug('Failed to delete volume root path.', error);
                return callback(new VolumeError(error, VolumeError.INTERNAL_ERROR));
            }

            rimraf(that.mountPoint, function (error) {
                if (error) {
                    debug('Failed to delete volume mount point.', error);
                    return callback(new VolumeError(error, VolumeError.INTERNAL_ERROR));
                }

                debug('Volume ' + that.id + ' successfully deleted.');
                callback();
            });
        });
    }

    that.encfs.isMounted(function (error, mounted) {
        if (!mounted) {
            cleanupFolders();
            return;
        }

        that.encfs.unmount(function (error) {
            if (error) {
                debug('Error unmounting the volume. Non fatal.', error);
                return callback(new VolumeError(error, VolumeError.MOUNTED));
            }

            cleanupFolders();
        });
    });
};

Volume.prototype.listFiles = function (dir, callback) {
    ensureArgs(arguments, ['string', 'function']);

    var that = this;

    this.encfs.isMounted(function (error, mounted) {
        if (error) {
            debug('Error checking if encfs for volume "' + that.id + '" is mounted.');
            return callback(error);
        }

        if (!mounted) {
            debug('Encfs for volume "' + that.id + '" is not mounted.');
            return callback(new VolumeError(null, VolumeError.NOT_MOUNTED));
        }

        var absoluteDirPath = path.join(that.mountPoint, dir);
        fs.readdir(absoluteDirPath, function (error, filenames) {
            if (error) {
                debug('Unable to read directory "' + absoluteDirPath + '" for volume "' + that.id + '".');
                return callback(new VolumeError(error, VolumeError.READ_ERROR));
            }

            var fileInfos = [ ];

            for (var i = 0; i < filenames.length; i++) {
                var filename = filenames[i];

                var fileInfo = {
                    name: filename,
                    path: path.join(dir, filename)
                };

                var stat = safe.fs.statSync(path.join(absoluteDirPath, filename));
                if (stat !== null) {
                    fileInfo.mtime = stat.mtime.getTime();
                    fileInfo.size = stat.size;
                    fileInfo.mode = stat.mode;
                } else {
                    debug('Error getting file information:' + safe.error.message);
                }

                fileInfos.push(fileInfo);
            }

            callback(null, { entries: fileInfos });
        });
    });
};

Volume.prototype.addUser = function (newUser, owner, password, callback) {
    ensureArgs(arguments, ['object', 'object', 'string', 'function']);

    if(this.config.hexists('users', newUser.username)) {
        debug('User ' + newUser.username + ' has already access to the volume');
        return callback(new VolumeError(null, VolumeError.WRONG_USER_PASSWORD));
    }

    var ownerRecord = this.config.hget('users', owner.username, null);
    if (ownerRecord === null) {
        debug('Unable to verify the old user for the volume.');
        return callback(new VolumeError(null, VolumeError.NO_SUCH_USER));
    }

    // retrieve the keypair from the authorized user
    var saltBuffer = new Buffer(owner._salt, 'hex');
    var keyPair = null;
    try {
        var privateKeyPem = aes.decrypt(owner._privatePemCipher, password, saltBuffer);
        keyPair = ursa.createPrivateKey(privateKeyPem, password, 'utf8');
    } catch (e) {
        debug('Error decrypting key pair.', e);
        return callback(new VolumeError(null, VolumeError.WRONG_USER_PASSWORD));
    }

    // retrieve the volume password from the authorized user
    var volumePassword = keyPair.decrypt(ownerRecord.passwordCipher, 'hex', 'utf8');

    if (!volumePassword) {
        debug('Unable to decrypt volume master password');
        return callback(new VolumeError(null, VolumeError.WRONG_USER_PASSWORD));
    }

    var publicKey = ursa.createPublicKey(new Buffer(newUser.publicPem, 'hex'));
    var record = {
        username: newUser.username,
        passwordCipher: publicKey.encrypt(volumePassword, 'utf8', 'hex')
    };

    if (!this.config.hset('users', newUser.username, record)) {
        debug('Unable to add user to meta db.');
        return callback(new VolumeError(null, VolumeError.INTERNAL_ERROR));
    }

    return callback(null, record);
};

Volume.prototype.removeUser = function (user, callback) {
    ensureArgs(arguments, ['object', 'function']);

    if (!this.config.hdel('users', user.username)) {
        return callback(new VolumeError(null, VolumeError.NO_SUCH_USER));
    }

    callback(null);
};

Volume.prototype.verifyUser = function (user, password, callback) {
    ensureArgs(arguments, ['object', 'string', 'function']);

    var record = this.config.hget('users', user.username, null);
    if (record === null) {
        debug('Unable to get user from meta db.');
        return callback(new VolumeError(null, VolumeError.NO_SUCH_USER));
    }

    User.verify(user.username, password, function (error, userRecord) {
        if (error) {
            debug('Unable to get user from meta db. ' + safe.JSON.stringify(error));
            return callback(new VolumeError(error, VolumeError.WRONG_USER_PASSWORD));
        }

        var saltBuffer = new Buffer(userRecord._salt, 'hex');
        var privateKeyPem = aes.decrypt(userRecord._privatePemCipher, password, saltBuffer);
        var keyPair = ursa.createPrivateKey(privateKeyPem, password, 'utf8');
        var volumePassword = keyPair.decrypt(record.passwordCipher, 'hex', 'utf8');

        if (!volumePassword) {
            debug('Unable to decrypt volume master password');
            return callback(new VolumeError(null, VolumeError.WRONG_USER_PASSWORD));
        }

        callback(null);
    });
};

Volume.prototype.hasUserByName = function (username, callback) {
    ensureArgs(arguments, ['string', 'function']);

    var record = this.config.hget('users', username, null);
    debug('Check if user ' + username + ' has access to volume ' + this.name() + ' ' + JSON.stringify(record));
    return callback(null, (record !== null));
};

Volume.prototype.users = function (callback) {
    ensureArgs(arguments, ['function']);

    var users = this.config.get('users', null);
    if (users === null) return callback(new VolumeError(VolumeError.INTERNAL_ERROR));

    var usersArray = [];
    for (var user in users) {
        if (users.hasOwnProperty(user)) {
            usersArray.push(user);
        }
    }

    return callback(null, usersArray);
};

function listVolumes(username, config, callback) {
    ensureArgs(arguments, ['string', 'object', 'function']);
    assert(config.volumesDataRoot);
    assert(config.volumesMountRoot);

    fs.readdir(config.volumesDataRoot, function (error, files) {
        if (error) {
            debug('Unable to list volumes.' + safe.JSON.stringify(error));
            return callback(new VolumeError(error, VolumeError.READ_ERROR));
        }

        var ret = [];

        async.each(files, function (file, callback) {
            fs.stat(path.join(config.volumesDataRoot, file), function (error, stat) {
                if (error) {
                    debug('Unable to stat "' + file + '".', error);
                    return callback(null);
                }

                // ignore everythin else than directories
                if (!stat.isDirectory()) {
                    return callback(null);
                }

                getVolume(file, username, config, function (error, result) {
                    if (!error) {
                        debug('Detected volume with repo: "' + file + '".');
                        ret.push(result);
                    }

                    callback(null);
                });
            });
        }, function (error) {
            if (error) debug('This should never happen.');
            callback(null, ret);
        });
    });
}

function createVolume(name, user, password, options, callback) {
    ensureArgs(arguments, ['string', 'object', 'string', 'object', 'function']);

    getVolumeByName(name, user.username, options, function (error, result) {
        if (!error) {
            debug('Volume by name ' + name + ' already exists.');
            return callback(new VolumeError(null, VolumeError.ALREADY_EXISTS));
        }

        var vol = new Volume(uuid.v4(), options);
        vol.setName(name);
        var volPassword = generateNewVolumePassword();

        encfs.create(vol.dataPath, vol.mountPoint, volPassword, function (error, result) {
            if (error) {
                debug('Unable to create encfs container for volume "' + name + '". ' + safe.JSON.stringify(error));
                return callback(new VolumeError(error, VolumeError.INTERNAL_ERROR));
            }

            var publicKey = ursa.createPublicKey(new Buffer(user.publicPem, 'hex'));
            var record = {
                username: user.username,
                passwordCipher: publicKey.encrypt(volPassword, 'utf8', 'hex')
            };

            if (!vol.config.hset('users', user.username, record)) {
                debug('Unable to add user to meta db.');
                return callback(new VolumeError(null, VolumeError.INTERNAL_ERROR));
            }

            callback(null, vol);
        });
    });
}

function getVolumeByName(name, username, options, callback) {
    ensureArgs(arguments, ['string', 'string', 'object', 'function']);
    assert(options.volumesDataRoot);
    assert(options.volumesMountRoot);

    listVolumes(username, options, function (error, volumes) {
        if (error) {
            debug('Unable to list volumes. ' + JSON.stringify(error));
            return callback(new VolumeError(null, VolumeError.INTERNAL_ERROR));
        }

        for (var volume in volumes) {
            if (volumes.hasOwnProperty(volume)) {
                if (volumes[volume].name() === name) {
                    debug('Found volume by name ' + name + '. Volume id is ' + volume);
                    return callback(null, volumes[volume]);
                }
            }
        }

        return callback(new VolumeError(null, VolumeError.NO_SUCH_VOLUME));
    });
}

function getVolume(id, username, options, callback) {
    ensureArgs(arguments, ['string', 'string', 'object', 'function']);

    var vol = new Volume(id, options);
    if (!safe.fs.existsSync(vol.dataPath)) {
        debug('No volume "' + id + '" for user "' + username + '". ' + safe.JSON.stringify(safe.error));
        return callback(new VolumeError({}, VolumeError.INTERNAL_ERROR));
    }

    vol.hasUserByName(username, function (error, result) {
        if (error || !result) {
            debug('User "' + username + '" has no access to volume "' + id + '".');
            return callback(new VolumeError(error, VolumeError.NO_SUCH_USER));
        }

        callback(null, vol);
    });
}
