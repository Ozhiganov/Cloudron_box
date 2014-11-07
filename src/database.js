/* jslint node:true */

'use strict';

var assert = require('assert'),
    async = require('async'),
    config = require('../config.js'),
    DatabaseError = require('./databaseerror.js'),
    debug = require('debug')('box:database'),
    paths = require('./paths.js'),
    sqlite3 = require('sqlite3');

exports = module.exports = {
    initialize: initialize,
    uninitialize: uninitialize,
    removePrivates: removePrivates,
    newTransaction: newTransaction,
    rollback: rollback,
    commit: commit,
    clear: clear,

    get: get,
    all: all,
    run: run
};

var gConnectionPool = [ ], // used to track active transactions
    gDatabase = null;

var NOOP_CALLBACK = function (error) { if (error) console.error(error); };

function initialize(callback) {
    gDatabase = new sqlite3.Database(paths.DATABASE_FILENAME);
    gDatabase.on('error', function (error) {
        console.error('Database error in ' + paths.DATABASE_FILENAME + ':', error);
    });

    return callback(null);
}

function uninitialize() {
    debug('Closing database');
    gDatabase.close();
    gDatabase = null;

    debug('Closing %d active transactions', gConnectionPool.length);
    gConnectionPool.forEach(function (conn) { conn.close(); });
    gConnectionPool = [ ];
}

function clear(callback) {
    async.series([
        require('./appdb.js').clear,
        require('./authcodedb.js').clear,
        require('./clientdb.js').clear,
        require('./tokendb.js').clear,
        require('./userdb.js').clear
    ], callback);
}

function newTransaction() {
    var conn = new sqlite3.Database(paths.DATABASE_FILENAME);
    gConnectionPool.push(conn);
    conn.serialize();
    conn.run('BEGIN TRANSACTION', NOOP_CALLBACK);
    return conn;
}

function rollback(conn, callback) {
    gConnectionPool.splice(gConnectionPool.indexOf(conn), 1);
    conn.run('ROLLBACK', NOOP_CALLBACK);
    conn.close(); // close waits for pending statements
    if (callback) callback();
}

function commit(conn, callback) {
    gConnectionPool.splice(gConnectionPool.indexOf(conn), 1);
    conn.run('COMMIT', function (error) {
        if (error) return callback(new DatabaseError(DatabaseError.INTERNAL_ERROR, error));

        callback(null);
    });
    conn.close(); // close waits for pending statements
}

function removePrivates(obj) {
    var res = { };

    for (var p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        if (p.substring(0, 1) === '_') continue;
        res[p] = obj[p]; // ## make deep copy?
    }

    return res;
}

function get() {
    return gDatabase.get.apply(gDatabase, arguments);
}

function all() {
    return gDatabase.all.apply(gDatabase, arguments);
}

function run() {
    return gDatabase.run.apply(gDatabase, arguments);
}

