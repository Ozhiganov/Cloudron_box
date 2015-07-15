/* jslint node: true */

'use strict';

exports = module.exports = {
    set: set,
    clear: clear,
    get: get,

    UPDATE: 'update',
    BACKUP: 'backup'
};

var assert = require('assert'),
    debug = require('debug')('box:progress');

// if progress.update or progress.backup are object, they will contain 'percent' and 'message' properties
// otherwise no such operation is currently ongoing
var progress = {
    update: null,
    backup: null
};

function set(tag, percent, message) {
    assert(tag === exports.UPDATE || tag === exports.BACKUP);
    assert.strictEqual(typeof percent, 'number');
    assert.strictEqual(typeof message, 'string');

    progress[tag] = {
        percent: percent,
        message: message
    };

    debug('%s: %s %s', tag, percent, message);
}

function clear(tag) {
    assert(tag === exports.UPDATE || tag === exports.BACKUP);

    progress[tag] = null;

    debug('clearing %s', tag);
}

function get() {
    return progress;
}
