'use strict';

exports = module.exports = {
    add: add,
    get: get,
    del: del,
    getAll: getAll,
    getClientTokens: getClientTokens,
    delClientTokens: delClientTokens
};

var assert = require('assert'),
    clients = require('../clients.js'),
    ClientsError = clients.ClientsError,
    DatabaseError = require('../databaseerror.js'),
    HttpError = require('connect-lastmile').HttpError,
    HttpSuccess = require('connect-lastmile').HttpSuccess,
    validUrl = require('valid-url');

function add(req, res, next) {
    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (typeof data.appId !== 'string' || !data.appId) return next(new HttpError(400, 'appId is required'));
    if (typeof data.redirectURI !== 'string' || !data.redirectURI) return next(new HttpError(400, 'redirectURI is required'));
    if (typeof data.scope !== 'string' || !data.scope) return next(new HttpError(400, 'scope is required'));
    if (!validUrl.isWebUri(data.redirectURI)) return next(new HttpError(400, 'redirectURI must be a valid uri'));

    clients.add(data.appId, clients.TYPE_EXTERNAL, data.redirectURI, data.scope, function (error, result) {
        if (error && error.reason === ClientsError.INVALID_SCOPE) return next(new HttpError(400, error.message));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, result));
    });
}

function get(req, res, next) {
    assert.strictEqual(typeof req.params.clientId, 'string');

    clients.get(req.params.clientId, function (error, result) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'No such client'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, result));
    });
}

function del(req, res, next) {
    assert.strictEqual(typeof req.params.clientId, 'string');

    clients.del(req.params.clientId, function (error, result) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'no such client'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(204, result));
    });
}

function getAll(req, res, next) {
    clients.getAll(function (error, result) {
        if (error && error.reason !== DatabaseError.NOT_FOUND) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { clients: result }));
    });
}

function getClientTokens(req, res, next) {
    assert.strictEqual(typeof req.params.clientId, 'string');
    assert.strictEqual(typeof req.user, 'object');

    clients.getClientTokensByUserId(req.params.clientId, req.user.id, function (error, result) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'no such client'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { tokens: result }));
    });
}

function delClientTokens(req, res, next) {
    assert.strictEqual(typeof req.params.clientId, 'string');
    assert.strictEqual(typeof req.user, 'object');

    clients.delClientTokensByUserId(req.params.clientId, req.user.id, function (error) {
        if (error && error.reason === DatabaseError.NOT_FOUND) return next(new HttpError(404, 'no such client'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(204));
    });
}
