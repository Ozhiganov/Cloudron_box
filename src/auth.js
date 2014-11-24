/* jslint node:true */

'use strict';

var assert = require('assert'),
    BasicStrategy = require('passport-http').BasicStrategy,
    BearerStrategy = require('passport-http-bearer').Strategy,
    clientdb = require('./clientdb'),
    ClientPasswordStrategy = require('passport-oauth2-client-password').Strategy,
    database = require('./database'),
    DatabaseError = require('./databaseerror'),
    debug = require('debug')('box:auth'),
    LocalStrategy = require('passport-local').Strategy,
    passport = require('passport'),
    tokendb = require('./tokendb'),
    user = require('./user'),
    userdb = require('./userdb'),
    UserError = user.UserError;

exports = module.exports = {
    initialize: initialize,
    uninitialize: uninitialize
};

function initialize(callback) {
    assert(typeof callback === 'function');

    passport.serializeUser(function (user, callback) {
        debug('serializeUser: ' + JSON.stringify(user));

        callback(null, user.username);
    });

    passport.deserializeUser(function(username, callback) {
        debug('deserializeUser: ' + username);

        userdb.get(username, function (error, user) {
          callback(error, user);
        });
    });

    passport.use(new LocalStrategy(function (username, password, callback) {
        debug('LocalStrategy: ' + username + ' ' + password.length);

        user.verify(username, password, function (error, result) {
            if (error && error.reason === UserError.NOT_FOUND) return callback(null, false);
            if (error && error.reason === UserError.WRONG_USER_OR_PASSWORD) return callback(null, false);
            if (error) return callback(error);
            if (!result) return callback(null, false);
            callback(null, database.removePrivates(result));
        });
    }));

    passport.use(new BasicStrategy(function (username, password, callback) {
        debug('BasicStrategy: ' + username + ' ' + password.length);

        if (username.indexOf('cid-') === 0) {
            debug('BasicStrategy: detected clientId instead of username:password.' + username);
            // username is actually client id here
            // password is client secret
            clientdb.getByClientId(username, function (error, client) {
                if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
                if (error) return callback(error);
                if (client.clientSecret != password) return callback(null, false);
                return callback(null, client);
            });
        } else {
            user.verify(username, password, function (error, result) {
                if (error && error.reason === UserError.NOT_FOUND) return callback(null, false);
                if (error && error.reason === UserError.WRONG_USER_OR_PASSWORD) return callback(null, false);
                if (error) return callback(error);
                if (!result) return callback(null, false);
                callback(null, result);
            });
        }
    }));

    passport.use(new ClientPasswordStrategy(function (clientId, clientSecret, callback) {
        debug('ClientPasswordStrategy: ' + clientId + ' ' + clientSecret);

        clientdb.getByClientId(clientId, function(error, client) {
            if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
            if (error) { return callback(error); }
            if (client.clientSecret != clientSecret) { return callback(null, false); }
            return callback(null, client);
        });
    }));

    passport.use(new BearerStrategy(function (accessToken, callback) {
        debug('BearerStrategy: ' + accessToken);

        tokendb.get(accessToken, function (error, token) {
            if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
            if (error) return callback(error);

            userdb.get(token.userId, function (error, user) {
                if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
                if (error) return callback(error);

                // scopes here can define what capabilities that token carries
                // passport put the 'info' object into req.authInfo, where we can further validate the scopes
                var info = { scope: token.scope };
                callback(null, user, info);
            });
        });
    }));

    callback(null);
}

function uninitialize(callback) {
    assert(typeof callback === 'function');

    callback(null);
}

