'use strict';

var userdb = require('../userdb'),
    DatabaseError = require('../databaseerror'),
    crypto = require('crypto'),
    debug = require('debug')('auth:routes/user'),
    HttpError = require('../httperror'),
    HttpSuccess = require('../httpsuccess');

exports = module.exports = {
    add: add,
    get: get,
    getAll: getAll,
    update: update,
    remove: remove
};

function add(req, res, next) {
    if (!req.body.username) return next(new HttpError(400, 'No username provided'));
    if (!req.body.password) return next(new HttpError(400, 'No password provided'));
    if (!req.body.email) return next(new HttpError(400, 'No email provided'));

    userdb.add(req.body.username, req.body.username, req.body.password, req.body.email, function (error) {
        if (error && error.reason === DatabaseError.ALREADY_EXISTS) return next(new HttpError(409, 'User already exists'));
        if (error) return next(new HttpError(500));
        next(new HttpSuccess(201, {}));
    });
}

function get(req, res, next) {

}

function getAll(req, res, next) {
    userdb.getAll(function (error, result) {
        if (error) return next(new HttpError(500));
        next(new HttpSuccess(200, { users: result }));
    });
}

function extractCredentialsFromHeaders (req) {
    var a, b, s;

    if (!req.headers || !req.headers.authorization) {
        debug('No authorization header.');
        return null;
    }

    if (req.headers.authorization.substr(0, 6) === 'Basic ') {
        b = new Buffer(req.headers.authorization.substr(6), 'base64');
        s = b.toString('utf8');
        if (!s) {
            debug('Authorization header does not contain a valid string.');
            return null;
        }

        a = s.split(':');
        if (a.length != 2) {
            debug('Authorization header does not contain a valid username:password tuple.');
            return null;
        }

        return {
            username: a[0],
            password: a[1],
            token: null
        };
    } else if (req.headers.authorization.substr(0, 6) === 'Token ') {
        s = req.headers.authorization.substr(6);
        if (!s) {
            debug('Authorization header does not contain a valid string.');
            return null;
        }

        return {
            username: null,
            password: null,
            token: s
        };
    }

    debug('Only basic authorization supported.');
    return null;
}

function loginAuthenticator(req, res, next) {
    var auth = extractCredentialsFromHeaders(req);

    if (!auth) {
        debug('Could not extract credentials.');
        return next(new HttpError(400, 'No credentials'), false);
    }

    if (auth.token) {
        if (auth.token.length != 64 * 2) {
            debug('Received a token with invalid length', auth.token.length, auth.token);
            return next(new HttpError(401, 'Bad token'));
        }

        db.TOKENS_TABLE.get(auth.token, function (err, result) {
            if (err) {
                debug('Received unknown token', auth.token);
                return next(err.reason === DatabaseError.NOT_FOUND ? new HttpError(401, 'Invalid token') : err);
            }

            var now = Date(), expires = Date(result.expires);
            if (now > expires) return next(new HttpError(401, 'Token expired'));

            db.USERS_TABLE.get(result.username, function (error, user) {
                if (error) return next(new HttpError(500, ''));
                if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'User not found'));

                debug('User ' + user.username + ' was successfully verified.');

                req.user = user;
                next();
            });
        });
    } else if (auth.username && auth.password) {
        user.verify(auth.username, auth.password, function (error, user) {
            if (error) {
                debug('User ' + auth.username  + ' could not be verified.');
                if (error.reason === UserError.ARGUMENTS) {
                    return next(new HttpError(400, error.message));
                } else if (error.reason === UserError.NOT_FOUND) {
                    return next(new HttpError(401, 'No such user'));
                } else if (error.reason === UserError.WRONG_USER_OR_PASSWORD) {
                    return next(new HttpError(401, 'Username or password do not match'));
                } else {
                    return next(new HttpError(500, error.message));
                }
            }

            debug('User ' + auth.username + ' was successfully verified.');

            req.user = user;
            next();
        });
    } else {
        next(new HttpError(400, 'Invalid auth header'));
    }
}

function tokenAuthenticator(req, res, next) {
    var req_token = req.query.auth_token ? req.query.auth_token : req.cookies.token;

    if (req_token.length != 64 * 2) {
        debug('Received a token with invalid length', req_token.length, req_token);
        return next(new HttpError(401, 'Bad token'));
    }

    db.TOKENS_TABLE.get(req_token, function (err, result) {
        if (err) {
            debug('Received unknown token', req_token);
            return next(err.reason === DatabaseError.NOT_FOUND ? new HttpError(401, 'Invalid token') : err);
        }

        var now = Date(), expires = Date(result.expires);
        if (now > expires) return next(new HttpError(401, 'Token expired'));

        db.USERS_TABLE.get(result.username, function (error, user) {
            if (error) return next(new HttpError(500, ''));
            if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'User not found'));

            debug('User ' + user.username + ' was successfully verified.');

            req.user = user;
            next();
        });
    });
}

function authenticate(req, res, next) {
    if (req.headers.authorization) {
        debug('using login authentication');
        loginAuthenticator(req, res, next);
    } else if (req.query.auth_token || req.cookies.token) {
        debug('using token based authentication');
        tokenAuthenticator(req, res, next);
    } else {
        next(new HttpError(401, 'No credentials'));
    }
}

/**
 * @api {get} /api/v1/token token
 * @apiName token
 * @apiGroup user
 * @apiDescription
 * This route may be used to verify a user and retrieve an access token for further API access.
 * As any other route, the authentication is using the auth header.
 *
 * @apiSuccess {String} token Access token to be used for further API calls
 * @apiSuccess {Date} expires Expiration date for the access token
 * @apiSuccess {String} username Username associated with the access token
 * @apiSuccess {String} email Email associated with the access token
 */
function createToken(req, res, next) {
    crypto.randomBytes(64 /* 512-bit */, function (err, tok) {
        if (err) return next(new HttpError(500, 'Failed to generate random bytes'));
        var expires = new Date((new Date()).getTime() + 60 * 60000).toUTCString(); // 1 hour

        var hexToken = tok.toString('hex');

        var token = {
            token: hexToken,
            username: req.user.username,
            email: req.user.email,
            expires: expires
        };

        db.TOKENS_TABLE.put(token, function (err) {
            if (err) return next(err);
            next(new HttpSuccess(200, {
                token: hexToken,
                expires: expires,
                userInfo: {
                    username: req.user.username,
                    email: req.user.email,
                    admin: req.user.admin
                }
            }));
        });
    });
}

/**
 * @api {get} /api/v1/user/info info
 * @apiName info
 * @apiGroup user
 * @apiDescription
 * Get user information.
 *
 * @apiSuccess {String} username Username
 * @apiSuccess {String} email User's email address
 */
function info(req, res, next) {
    // req.user is filled by the authentication step
    next(new HttpSuccess(200, {
        username: req.user.username,
        email: req.user.email,
        admin: req.user.admin
    }));
}

/**
 * @api {get} /api/v1/logout logout
 * @apiName logout
 * @apiGroup user
 * @apiDescription
 * Invalidates all access tokens associated with this user.
 *
 * @apiSuccess none User successfully logged out
 */
function logout(req, res, next) {
    var req_token = req.query.auth_token ? req.query.auth_token : req.cookies.token;

    // Invalidate token so the cookie cannot be reused after logout
    db.TOKENS_TABLE.remove(req_token, function (error, result) {
        if (error) return next(error);
        next(new HttpSuccess(200, {}));
    });
}

/**
 * @api {post} /api/v1/user/remove remove
 * @apiName remove
 * @apiGroup user
 * @apiDescription
 * The administrator can remove any user and each user can only remove himself.
 *
 * @apiParam {string} username The username of the user to be removed
 *
 * @apiSuccess none User successfully removed
 * @apiError (Forbidden 403) {Number} status Http status code
 * @apiError (Forbidden 403) {String} message Error details
 */
function removeUser(req, res, next) {
    var username = req.body.username || '';
    var password = req.body.password || '';

    if (!password || !username) {
        return next(new HttpError(400, 'Missing username or password'));
    }

    // rules:
    // - admin can remove any user
    // - admin cannot remove admin

    // req.user is ensured to be the admin via requireAdmin middleware
    if (req.user.username === username) {
        return next(new HttpError(403, 'Not allowed to remove this user.'));
    }

    // verify the admin via the provided password
    user.verify(req.user.username, password, function (error, result) {
        if (error) return next(new HttpError(401, 'Username or password do not match'));

        user.remove(username, function (error, result) {
            if (error) {
                if (error.reason === DatabaseError.NOT_FOUND) {
                    return next(new HttpError(404, 'User not found'));
                }
                return next(new HttpError(500, 'Failed to remove user'));
            }
            next(new HttpSuccess(200, {}));
        });
    });
}
