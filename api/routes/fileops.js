'use strict';

var fs = require('fs'),
    HttpError = require('../httperror');

exports = module.exports = {
    remove: remove,
    move: move,
    copy: copy
};

function remove(req, res, next) {
    var filePath = req.method === 'DELETE' ? req.params[0] : req.body.path;
    var repo = req.volume.repo;
    var rev = req.body.rev;

    if (!rev) return next(new HttpError(400, 'No revision specified'));

    repo.removeFile(filePath, { recursive: true, rev: rev }, function (err, fileEntry, commit) {
        if (err) {
            if (err.code == 'ENOENT' || err.code == 'ENOTDIR') return next(new HttpError(404, 'Not found'));
            if (err.code == 'EOUTOFDATE') return next(new HttpError(409, 'Out of date'));
            return next(new HttpError(500, err.message));
        }
        res.send(200, fileEntry);
    });
}

function move(req, res, next) {
    var fromPath = req.body.from_path, toPath = req.body.to_path;
    var repo = req.volume.repo;
    var rev = req.body.rev;

    if (!fromPath) return next(400, 'from_path not specified');
    if (!toPath) return next(400, 'to_path not specified');
    if (!rev) return next(new HttpError(400, 'No revision specified'));

    repo.moveFile(fromPath, toPath, { rev: rev }, function (err, newEntry, commit) {
        if (err) {
            if (err.code == 'ENOENT' || err.code == 'ENOTDIR') return next(new HttpError(404, 'Not found'));
            if (err.code == 'EOUTOFDATE') return next(new HttpError(409, 'Out of date'));
            return next(new HttpError(500, err.message));
        }
        res.send(200, newEntry);
    });
}

function copy(req, res, next) {
    var fromPath = req.body.from_path, toPath = req.body.to_path;
    var repo = req.volume.repo;
    var rev = req.body.rev;

    if (!fromPath) return next(400, 'from_path not specified');
    if (!toPath) return next(400, 'to_path not specified');
    if (!rev) return next(new HttpError(400, 'No revision specified'));

    repo.copyFile(fromPath, toPath, { rev: rev }, function (err, newEntry, commit) {
        if (err) {
           if (err.code == 'ENOENT' || err.code == 'ENOTDIR') return next(new HttpError(404, 'Not found'));
           if (err.code == 'EOUTOFDATE') return next(new HttpError(409, 'Out of date'));
           return next(new HttpError(500, err.message));
        }
        res.send(200, newEntry);
    });
}

