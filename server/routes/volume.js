'use strict';

var fs = require("fs"),
    debug = require('debug')('volume.js'),
    HttpError = require('../httperror'),
    encfs = require('../../node-encfs/index.js'),
    path = require("path");

exports = module.exports = {
    initialize: initialize
};

var config;

function initialize(cfg, app) {
    config = cfg;

    app.get("/api/v1/volume/list", listVolumes);
    app.post("/api/v1/volume/create", createVolume);
    app.get("/api/v1/volume/*/list/", list);
    app.get("/api/v1/volume/*/list/*", list);
    app.post("/api/v1/volume/*/mount", mount);
    app.post("/api/v1/volume/*/unmount", unmount);
}

function listVolumes(req, res, next) {
    fs.readdir(config.root, function (error, files) {
        if (error) {
            return next(new HttpError(404, 'Unable to read root folder'));
        }

        var ret = [];

        files.forEach(function (file) {
            if (file[0] === ".") {
                return;
            }

            var tmp = {};
            tmp.name = file;
            tmp.id = file;

            ret.push(tmp);
        });

        res.send(JSON.stringify(ret));
    });
}

function createVolume(req, res, next) {
    // TODO check for existing volumes

    if (!req.body.name) {
        return next(new HttpError(400, 'volume name not specified'));
    }

    var volumeRoot = path.join(config.root, "." + req.body.name);
    var volumeMountPoint = path.join(config.root, req.body.name);

    encfs.create(volumeRoot, volumeMountPoint, "foobar1337", function (error, result) {
        if (error) {
            console.log("Creating volume failed:", error);
            return next(new HttpError(400, "volume creation failed: " + error));
        }

        res.send(200);
    });
}

function list(req, res, next) {
    req.params[0] = req.params[0] ? req.params[0] : "0";
    req.params[1] = req.params[1] ? req.params[1] : ".";

    var folder = path.join(config.root, req.params[0], req.params[1]);

    fs.readdir(folder, function (error, files) {
        if (error) {
            return next(new HttpError(404, 'Unable to read folder'));
        }

        var ret = [];

        if (folder !== path.join(config.root, req.params[0])) {
            var dirUp = {};
            dirUp.filename = "..";
            dirUp.path = path.join(req.params[1], "..");
            dirUp.isDirectory = true;
            dirUp.isFile = false;
            dirUp.stat = { size: 0 };
            ret.push(dirUp);
        }

        files.forEach(function (file) {
            var tmp = {};
            tmp.filename = file;
            tmp.path = path.join(req.params[1], file);

            try {
                tmp.stat = fs.statSync(path.join(folder, file));
                tmp.isFile = tmp.stat.isFile();
                tmp.isDirectory = tmp.stat.isDirectory();
            } catch (e) {
                console.log("Error getting file information", e);
            }

            ret.push(tmp);
        });

        res.send(JSON.stringify(ret));
    });
}

function mount(req, res, next) {
    console.log(req);
}

function unmount(req, res, next) {

}
