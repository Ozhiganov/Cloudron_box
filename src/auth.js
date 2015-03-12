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
    crypto = require('crypto'),
    passport = require('passport'),
    tokendb = require('./tokendb'),
    user = require('./user'),
    userdb = require('./userdb'),
    UserError = user.UserError,
    _ = require('underscore');

exports = module.exports = {
    initialize: initialize,
    uninitialize: uninitialize
};

function initialize(callback) {
    assert(typeof callback === 'function');

    passport.serializeUser(function (user, callback) {
        callback(null, user.username);
    });

    passport.deserializeUser(function(username, callback) {
        userdb.get(username, function (error, result) {
            if (error) return callback(error);

            var md5 = crypto.createHash('md5').update(result.email.toLowerCase()).digest('hex');
            result.gravatar = 'https://www.gravatar.com/avatar/' + md5 + '.jpg?s=24&d=mm';

            callback(null, result);
        });
    });

    passport.use(new LocalStrategy(function (username, password, callback) {
        if (username.indexOf('@') === -1) {
            user.verify(username, password, function (error, result) {
                if (error && error.reason === UserError.NOT_FOUND) return callback(null, false);
                if (error && error.reason === UserError.WRONG_PASSWORD) return callback(null, false);
                if (error) return callback(error);
                if (!result) return callback(null, false);
                callback(null, _.pick(result, 'id', 'username', 'email', 'admin'));
            });
        } else {
            user.verifyWithEmail(username, password, function (error, result) {
                if (error && error.reason === UserError.NOT_FOUND) return callback(null, false);
                if (error && error.reason === UserError.WRONG_PASSWORD) return callback(null, false);
                if (error) return callback(error);
                if (!result) return callback(null, false);
                callback(null, _.pick(result, 'id', 'username', 'email', 'admin'));
            });
        }
    }));

    passport.use(new BasicStrategy(function (username, password, callback) {
        if (username.indexOf('cid-') === 0) {
            debug('BasicStrategy: detected client id %s instead of username:password', username);
            // username is actually client id here
            // password is client secret
            clientdb.get(username, function (error, client) {
                if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
                if (error) return callback(error);
                if (client.clientSecret != password) return callback(null, false);
                return callback(null, client);
            });
        } else {
            user.verify(username, password, function (error, result) {
                if (error && error.reason === UserError.NOT_FOUND) return callback(null, false);
                if (error && error.reason === UserError.WRONG_PASSWORD) return callback(null, false);
                if (error) return callback(error);
                if (!result) return callback(null, false);
                callback(null, result);
            });
        }
    }));

    passport.use(new ClientPasswordStrategy(function (clientId, clientSecret, callback) {
        clientdb.get(clientId, function(error, client) {
            if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
            if (error) { return callback(error); }
            if (client.clientSecret != clientSecret) { return callback(null, false); }
            return callback(null, client);
        });
    }));

    passport.use(new BearerStrategy(function (accessToken, callback) {
        tokendb.get(accessToken, function (error, token) {
            if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
            if (error) return callback(error);

            // scopes here can define what capabilities that token carries
            // passport put the 'info' object into req.authInfo, where we can further validate the scopes
            var info = { scope: token.scope };

            if (token.identifier.indexOf('dev-') === 0) {
                token.identifier = token.identifier.slice('dev-'.length);
            } else if (token.identifier.indexOf('app-') === 0) {
                // hand back an empty user object as we do not really have an user
                return callback(null, {}, info);
            } else if (token.identifier.indexOf('user-') === 0) {
                token.identifier = token.identifier.slice('user-'.length);
            } else {
                // legacy tokens assuming a user access token
            }

            userdb.get(token.identifier, function (error, user) {
                if (error && error.reason === DatabaseError.NOT_FOUND) return callback(null, false);
                if (error) return callback(error);

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

