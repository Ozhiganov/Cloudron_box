/* jslint node:true */

'use strict';

exports = module.exports = {
    profile: profile,
    info: info,
    update: update,
    list: listUser,
    create: createUser,
    changePassword: changePassword,
    changeAdmin: changeAdmin,
    remove: removeUser,
    verifyPassword: verifyPassword,
    requireAdmin: requireAdmin,
    sendInvite: sendInvite
};

var assert = require('assert'),
    generatePassword = require('../password.js').generate,
    groups = require('../groups.js'),
    HttpError = require('connect-lastmile').HttpError,
    HttpSuccess = require('connect-lastmile').HttpSuccess,
    user = require('../user.js'),
    tokendb = require('../tokendb.js'),
    UserError = user.UserError;

function profile(req, res, next) {
    assert.strictEqual(typeof req.user, 'object');

    var result = {};
    result.id = req.user.id;
    result.tokenType = req.user.tokenType;

    if (req.user.tokenType === tokendb.TYPE_USER || req.user.tokenType === tokendb.TYPE_DEV) {
        result.username = req.user.username;
        result.email = req.user.email;
        result.admin = req.user.admin;
        result.displayName = req.user.displayName;
    }

    next(new HttpSuccess(200, result));
}

function createUser(req, res, next) {
    assert.strictEqual(typeof req.body, 'object');

    if (typeof req.body.username !== 'string') return next(new HttpError(400, 'username must be string'));
    if (typeof req.body.email !== 'string') return next(new HttpError(400, 'email must be string'));
    if (typeof req.body.invite !== 'boolean') return next(new HttpError(400, 'invite must be boolean'));
    if ('displayName' in req.body && typeof req.body.displayName !== 'string') return next(new HttpError(400, 'displayName must be string'));

    var username = req.body.username;
    var password = generatePassword();
    var email = req.body.email;
    var sendInvite = req.body.invite;
    var displayName = req.body.displayName || '';

    user.create(username, password, email, displayName, { invitor: req.user, sendInvite: sendInvite }, function (error, user) {
        if (error && error.reason === UserError.BAD_USERNAME) return next(new HttpError(400, 'Invalid username'));
        if (error && error.reason === UserError.BAD_EMAIL) return next(new HttpError(400, 'Invalid email'));
        if (error && error.reason === UserError.BAD_PASSWORD) return next(new HttpError(400, 'Invalid password'));
        if (error && error.reason === UserError.BAD_FIELD) return next(new HttpError(400, error.message));
        if (error && error.reason === UserError.ALREADY_EXISTS) return next(new HttpError(409, 'Already exists'));
        if (error) return next(new HttpError(500, error));

        var userInfo = {
            id: user.id,
            username: user.username,
            email: user.email,
            admin: user.admin,
            resetToken: user.resetToken
        };

        next(new HttpSuccess(201, { userInfo: userInfo }));
    });
}

function update(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');
    assert.strictEqual(typeof req.user, 'object');
    assert.strictEqual(typeof req.body, 'object');

    if ('email' in req.body && typeof req.body.email !== 'string') return next(new HttpError(400, 'email must be string'));
    if ('displayName' in req.body && typeof req.body.displayName !== 'string') return next(new HttpError(400, 'displayName must be string'));

    if (req.user.tokenType !== tokendb.TYPE_USER) return next(new HttpError(403, 'Token type not allowed'));

    user.get(req.params.userId, function (error, result) {
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(404, 'No such user'));
        if (error) return next(new HttpError(500, error));

        user.update(req.params.userId, result.username, req.body.email || result.email, req.body.displayName || result.displayName, function (error) {
            if (error && error.reason === UserError.BAD_EMAIL) return next(new HttpError(400, error.message));
            if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(404, 'User not found'));
            if (error) return next(new HttpError(500, error));

            next(new HttpSuccess(204));
        });
    });
}

function changeAdmin(req, res, next) {
    assert.strictEqual(typeof req.body, 'object');

    if (typeof req.body.username !== 'string') return next(new HttpError(400, 'API call requires a username.'));
    if (typeof req.body.admin !== 'boolean') return next(new HttpError(400, 'API call requires an admin setting.'));

    user.changeAdmin(req.body.username, req.body.admin, function (error) {
        if (error && error.reason === UserError.NOT_ALLOWED) return next(new HttpError(403, 'Last admin'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(204));
    });
}

function changePassword(req, res, next) {
    assert.strictEqual(typeof req.body, 'object');
    assert.strictEqual(typeof req.user, 'object');

    if (typeof req.body.password !== 'string') return next(new HttpError(400, 'API call requires the users old password.'));
    if (typeof req.body.newPassword !== 'string') return next(new HttpError(400, 'API call requires the users new password.'));

    if (req.user.tokenType !== tokendb.TYPE_USER) return next(new HttpError(403, 'Token type not allowed'));

    user.changePassword(req.user.username, req.body.password, req.body.newPassword, function (error) {
        if (error && error.reason === UserError.BAD_PASSWORD) return next(new HttpError(400, error.message));
        if (error && error.reason === UserError.WRONG_PASSWORD) return next(new HttpError(403, 'Wrong password'));
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(403, 'Wrong password'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(204));
    });
}

function listUser(req, res, next) {
    user.list(function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { users: result }));
    });
}

function info(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');

    user.get(req.params.userId, function (error, result) {
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(404, 'No such user'));
        if (error) return next(new HttpError(500, error));

        groups.isMember(groups.ADMIN_GROUP_ID, req.params.userId, function (error, isAdmin) {
            if (error) return next(new HttpError(500, error));

            next(new HttpSuccess(200, {
                id: result.id,
                username: result.username,
                email: result.email,
                admin: isAdmin,
                displayName: result.displayName
            }));
        });
    });
}

function removeUser(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');

    // rules:
    // - admin can remove any user
    // - admin cannot remove admin
    // - user cannot remove himself <- TODO should this actually work?

    if (req.user.id === req.params.userId) return next(new HttpError(403, 'Not allowed to remove yourself.'));

    user.remove(req.params.userId, function (error) {
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(404, 'User not found'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(204));
    });
}

function verifyPassword(req, res, next) {
    assert.strictEqual(typeof req.body, 'object');

    // developers are allowed to through without password
    if (req.user.tokenType === tokendb.TYPE_DEV) return next();

    if (typeof req.body.password !== 'string') return next(new HttpError(400, 'API call requires user password'));

    // Only allow admins or users, operating on themselves
    if (req.params.userId && !(req.user.id === req.params.userId || req.user.admin)) return next(new HttpError(403, 'Not allowed'));

    user.verify(req.user.username, req.body.password, function (error) {
        if (error && error.reason === UserError.WRONG_PASSWORD) return next(new HttpError(403, 'Password incorrect'));
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(403, 'Password incorrect'));
        if (error) return next(new HttpError(500, error));

        next();
    });
}

/*
    Middleware which makes the route only accessable for the admin user.
*/
function requireAdmin(req, res, next) {
    assert.strictEqual(typeof req.user, 'object');

    groups.isMember(groups.ADMIN_GROUP_ID, req.user.id, function (error, isAdmin) {
        if (error) return next(new HttpError(500, error));

        if (!isAdmin) return next(new HttpError(403, 'API call requires admin rights.'));

        req.user.admin = true;

        next();
    });
}

function sendInvite(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');

    user.sendInvite(req.params.userId, function (error) {
        if (error && error.reason === UserError.NOT_FOUND) return next(new HttpError(404, 'User not found'));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(200, {}));
    });
}
