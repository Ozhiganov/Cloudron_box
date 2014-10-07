/* jslint node: true */

'use strict';

var nodemailer = require('nodemailer'),
    smtpTransport = require('nodemailer-smtp-transport'),
    debug = require('debug')('box:mailer'),
    assert = require('assert'),
    async = require('async'),
    digitalocean = require('./digitalocean.js'),
    cloudron = require('./cloudron.js'),
    ejs = require('ejs'),
    safe = require('safetydance'),
    config = require('../config.js'),
    userdb = require('./userdb.js'),
    path = require('path');

exports = module.exports = {
    initialize: initialize,
    uninitialize: uninitialize,

    userAdded: userAdded,
    userRemoved: userRemoved,
    adminChanged: adminChanged,
    passwordReset: passwordReset
};

var MAIL_TEMPLATES_DIR = path.join(__dirname, 'mail_templates');

var transport = nodemailer.createTransport(smtpTransport({
    host: config.mailServer,
    port: 25
}));

var mailQueue = [ ],
    dnsReady = false,
    checkDnsTimerId = null;

function initialize() {
    checkDns();
}

function uninitialize() {
    // TODO: interrupt processQueue as well
    clearTimeout(checkDnsTimerId);
    checkDnsTimerId = null;

    debug(mailQueue.length + ' mail items dropped');
    mailQueue = [ ];
}

function checkDns() {
    digitalocean.checkPtrRecord(cloudron.getIp(), config.fqdn, function (error, ok) {
        if (error || !ok) {
            debug('PTR record not setup yet');
            checkDnsTimerId = setTimeout(checkDns, 10000);
            return;
        }

        dnsReady = true;
        processQueue();
    });
}

function processQueue() {
    var mailQueueCopy = mailQueue;
    mailQueue = [ ];

    debug('Processing mail queue of size %d', mailQueueCopy.length);

    async.mapSeries(mailQueueCopy, function iterator(mailOptions, callback) {
        transport.sendMail(mailOptions, function (error, info) {
            if (error) return console.error(error);

            debug('Email sent to ' + mailOptions.to);
        });
        callback(null);
    }, function done() {
        debug('Done processing mail queue');
    });
}

function enqueue(mailOptions) {
    assert(typeof mailOptions === 'object');
    debug('Queued mail for ' + mailOptions.from + ' to ' + mailOptions.to);
    mailQueue.push(mailOptions);

    if (dnsReady) processQueue();
}

function render(templateFile, params) {
    return ejs.render(safe.fs.readFileSync(path.join(MAIL_TEMPLATES_DIR, templateFile), 'utf8'), params);
}

function mailAdmins(user, event) {
    assert(typeof user === 'object');
    assert(typeof event === 'string');

    userdb.getAllAdmins(function (error, admins) {
        if (error) return console.log('Error getting admins', error);

        var adminEmails = [ ];
        admins.forEach(function (admin) { if (user.email !== admin.email) adminEmails.push(admin.email); });

        var mailOptions = {
            from: config.mailUsername,
            to: adminEmails.join(', '),
            subject: 'User ' + event,
            text: render('user_text.ejs', { username: user.username, event: event }),
            html: render('user_html.ejs', { username: user.username, event: event })
        };

        enqueue(mailOptions);
    });
}

function userAdded(user, password) {
    debug('Sending mail for userAdded');

    var templateData = {
        user: user,
        password: password,
        webadminUrl: config.adminOrigin
    };

    var mailOptions = {
        from: config.mailUsername,
        to: user.email,
        subject: 'Welcome to Cloudron',
        text: render('welcome_text.ejs', templateData),
        html: render('welcome_html.ejs', templateData)
    };

    enqueue(mailOptions);

    mailAdmins(user, 'added');
}

function userRemoved(username) {
    debug('Sending mail for userRemoved');

    mailAdmins({ username: username }, 'removed');
}

function adminChanged(user) {
    debug('Sending mail for adminChanged');

    mailAdmins(user, user.admin ? 'made an admin' : 'removed as admin');
}

function passwordReset(user, token) {
    debug('Sending mail for password reset for user %s.', user.username);

    var resetLink = config.adminOrigin + '/api/v1/session/password/reset.html?reset_token='+token;

    var mailOptions = {
        from: config.mailUsername,
        to: user.email,
        subject: 'Password Reset Request',
        text: render('password_reset_text.ejs', { username: user.username, resetLink: resetLink }),
        html: render('password_reset_html.ejs', { username: user.username, resetLink: resetLink })
    };

    enqueue(mailOptions);
}
