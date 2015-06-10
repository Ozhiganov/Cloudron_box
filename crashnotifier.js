#!/usr/bin/env node

'use strict';

// WARNING This is a supervisor eventlistener!
//         The communication happens via stdin/stdout
//         !! No console.log() allowed
//         !! Do not set DEBUG

var supervisor = require('supervisord-eventlistener'),
    assert = require('assert'),
    util = require('util'),
    fs = require('fs'),
    mailer = require('./src/mailer.js');

var gLastNotifyTime = {};
var gCooldownTime = 1000 * 60  * 5; // 5 min

function collectLogs(program, callback) {
    assert(typeof program === 'string');
    assert(typeof callback === 'function');

    var logFilePath = util.format('/var/log/supervisor/%s.log', program);

    if (!fs.existsSync(logFilePath)) return callback(new Error(util.format('Log file %s does not exist.', logFilePath)));

    fs.readFile(logFilePath, 'utf-8', function (error, data) {
        if (error) return callback(error);

        var lines = data.split('\n');
        var logLines = lines.slice(-100);

        callback(null, logLines.join('\n'));
    });
}

supervisor.on('PROCESS_STATE_EXITED', function (headers, data) {
    if (data.expected === '1') return console.error('Normal app %s exit', data.processname);

    console.error('%s exited unexpectedly', data.processname);

    collectLogs(data.processname, function (error, result) {
        if (error) {
            console.error('Failed to collect logs.', error);
            result = util.format('Failed to collect logs.', error);
        }

        if (!gLastNotifyTime[data.processname] || gLastNotifyTime[data.processname] < Date.now() - gCooldownTime) {
            console.error('Send mail.');
            mailer.sendCrashNotification(data.processname, result);
            gLastNotifyTime[data.processname] = Date.now();
        } else {
            console.error('Do not send mail, already sent one recently.');
        }
    });
});

mailer.initialize(function () {
    supervisor.listen(process.stdin, process.stdout);
    console.error('Crashnotifier listening...');
});