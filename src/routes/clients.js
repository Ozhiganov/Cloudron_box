/* jslint node:true */

'use strict';

var assert = require('assert'),
    debug = require('debug')('box:routes/clients'),
    clients = require('../clients.js'),
    DatabaseError = require('../databaseerror.js'),
    HttpError = require('connect-lastmile').HttpError,
    HttpSuccess = require('connect-lastmile').HttpSuccess;

exports = module.exports = {
    add: add,
    get: get,
    update: update
};

function add(req, res, next) {
    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (typeof data.appId !== 'string' || !data.appId) return next(new HttpError(400, 'appId is required'));
    if (typeof data.redirectURI !== 'string' || !data.redirectURI) return next(new HttpError(400, 'redirectURI is required'));

    // prefix as this route only allows external apps for developers
    var appId = 'external-' + data.appId;

    clients.add(appId, data.redirectURI, 'profile,users', function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, result));
    });
}

function get(req, res, next) {
    assert(typeof req.param.clientId === 'string');

    clients.get(req.param.clientId, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, result));
    });
}

function update(req, res, next) {
    assert(typeof req.param.clientId === 'string');

    var data = req.body;

    if (!data) return next(new HttpError(400, 'Cannot parse data field'));
    if (typeof data.appId !== 'string' || !data.appId) return next(new HttpError(400, 'appId is required'));
    if (typeof data.redirectURI !== 'string' || !data.redirectURI) return next(new HttpError(400, 'redirectURI is required'));

    clients.update(req.param.clientId, data.appId, data.redirectURI, data.scope, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, result));
    });
}
