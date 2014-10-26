#!/usr/bin/env node

'use strict';

// Put express and various other middleware in production mode
if (typeof process.env.NODE_ENV === 'undefined') {
    console.log('NODE_ENV set to production');
    process.env.NODE_ENV = 'production';
}

require('supererror');

var Server = require('./src/server.js'),
    config = require('./config.js');

console.log();
console.log('==========================================');
console.log(' Cloudron will use the following settings ');
console.log('==========================================');
console.log();
console.log(' Admin Origin:                   ', config.adminOrigin());
console.log(' Appstore token:                 ', config.token());
console.log(' Appstore server origin:         ', config.appServerUrl());
console.log();
console.log('==========================================');
console.log();

var server = new Server();
server.start(function (err) {
    if (err) {
        console.error('Error starting server', err);
        process.exit(1);
    }

    console.log('Server listening on port ' + config.get('port'));
});

var NOOP_CALLBACK = function () { };

process.on('SIGINT', function () { server.stop(NOOP_CALLBACK); });
process.on('SIGTERM', function () { server.stop(NOOP_CALLBACK); });
