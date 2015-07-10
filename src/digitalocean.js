/* jslint node:true */

'use strict';

exports = module.exports = {
    checkPtrRecord: checkPtrRecord
};

var assert = require('assert'),
    debug = require('debug')('box:digitalocean'),
    dns = require('native-dns');

function checkPtrRecord(ip, fqdn, callback) {
    assert(ip === null || typeof ip === 'string');
    assert.strictEqual(typeof fqdn, 'string');
    assert.strictEqual(typeof callback, 'function');

    debug('checkPtrRecord: ' + ip);

    if (!ip) return callback(new Error('Network down'));

    dns.resolve4('ns1.digitalocean.com', function (error, rdnsIps) {
        if (error || rdnsIps.length === 0) return callback(new Error('Failed to query DO DNS'));

        var reversedIp = ip.split('.').reverse().join('.');

        var req = dns.Request({
            question: dns.Question({ name: reversedIp + '.in-addr.arpa', type: 'PTR' }),
            server: { address: rdnsIps[0] },
            timeout: 5000
        });

        req.on('timeout', function () { return callback(new Error('Timedout')); });

        req.on('message', function (error, message) {
            if (error || !message.answer || message.answer.length === 0) return callback(new Error('Failed to query PTR'));

            debug('checkPtrRecord: Actual:%s Expecting:%s', message.answer[0].data, fqdn);
            callback(null, message.answer[0].data === fqdn);
        });

        req.send();
    });
}


