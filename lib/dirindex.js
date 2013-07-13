'use strict';

var fs = require('fs'), crypto = require('crypto'),
    async = require('async'), readdirp = require('readdirp');

function diff(left, right) {
    var i = 0, j = 0, removed = [ ], added = [ ], modified = [ ];

    while (i < left.length && j < right.length) {
        if (left[i].filename == right[j].filename) {
            if (left[i].size != right[j].size || left[i].checksum != right[j].checksum) {
                modified.push(right[j]);
            }
            ++i;
            ++j;
        } else if (left[i].filename > right[j].filename) {
            added.push(right[j]);
            ++j;
        } else {
            removed.push(left[i]);
            ++i;
        }
    }

    for (; i < left.length; i++) removed.push(left[i]);
    for (; j < right.length; j++) added.push(right[j]);

    return { added: added, removed: removed, modified: modified };
}

function sha1(filePath, callback) {
    var sha1sum = crypto.createHash('sha1');
    var s;

    try {
        s = fs.createReadStream(filePath);
    } catch (e) {
        return callback(e);
    }
    s.on('data', function(d) { sha1sum.update(d); });
    s.on('end', function() { callback(null, sha1sum.digest('hex')); });
}

// ------ DirIndex
function DirIndex() {
    this.entryList = [ ];
    this.entryHash = { };
}

DirIndex.prototype.save = function (filename, callback) {
    var out;

    try {
        out = JSON.stringify(this.entryList);
    } catch (e) {
        return callback(e);
    }

    fs.writeFile(filename, out, function (error, result) {
        // ignore the result
        return callback(error);
    });
};

DirIndex.prototype.loadFromFile = function (filename, callback) {
    var that = this;

    fs.readFile(filename, function (error, result) {
        if (error) return callback(error);

        that.loadFromJSON(result, callback);
    });
};

DirIndex.prototype.loadFromJSON = function (json, callback) {
    var that = this;

    try {
        this.entryList = JSON.parse(json);
    } catch (e) {
        return callback(e);
    }

    this.entryList.forEach(function (entry) {
        that.entryHash[entry.filename] = entry;
    });

    callback();
};

DirIndex.prototype.json = function () {
    return JSON.stringify(this.entryList);
};

DirIndex.prototype.update = function (root, callback) {
    var that = this, oldEntryList = this.entryList, oldEntryHash = this.entryHash;
    this.entryList = [ ];
    this.entryHash = { };

    function addEntry(fileEntry, cachedFileEntry, callback) {
        var entry = {
            filename: fileEntry.path,
            size: fileEntry.stat.size,
            checksum: null,
            ctime: fileEntry.stat.ctime.getTime(),
            mtime: fileEntry.stat.mtime.getTime()
        };

        if (cachedFileEntry
            && cachedFileEntry.ctime === fileEntry.stat.ctime.getTime()
            && cachedFileEntry.mtime === fileEntry.stat.mtime.getTime()
            && cachedFileEntry.size === fileEntry.stat.size) {
            entry.checksum = cachedFileEntry.checksum;
            that.entryList.push(entry);
            that.entryHash[entry.filename] = entry;

            return callback();
        }

        sha1(fileEntry.fullPath, function (err, sha1) {
            if (err) return callback(err);
            entry.checksum = sha1;
            that.entryList.push(entry);
            that.entryHash[entry.filename] = entry;
            callback();
        });
    }

    readdirp({ root: root }, function (err, result) {
        if (err) return callback(err);

        var fileentryList = result.files;

        fileentryList.sort(function (a, b) {
            if (a.path > b.path) return 1;
            if (a.path < b.path) return -1;
            return 0;
        });

        async.forEachSeries(fileentryList, function (fileEntry, callback) {
            try {
                addEntry(fileEntry, oldEntryHash[fileEntry.path], callback);
            } catch (e) {
                callback(e);
            }
        }, function () {
            callback(null, diff(oldEntryList, that.entryList));
        });
    });
};

DirIndex.prototype.entry = function (file) {
    return this.entryHash[file];
};

DirIndex.prototype.addEntry = function (root, file, callback) {
    for (var i = 0; i < this.entryList.length; i++) {
        var entry = this.entryList[i];
        if (entry.filename > file) break;
    }

    var that = this;

    fs.stat(root + '/' + file, function (err, stat) {
        if (err) return callback(err);
        var entry = {
            filename: file,
            size: stat.size,
            checksum: null,
            ctime: stat.ctime.getTime(),
            mtime: stat.mtime.getTime()
        };
        sha1(root + '/' + file, function (err, sha1) {
            if (err) return callback(err);
            entry.checksum = sha1;
            that.entryList.splice(i, 0, entry);
            that.entryHash[file] = entry;

            callback();
        });
    });
};

DirIndex.prototype.updateEntry = function (root, file, callback) {
    var entry = this.entryHash[file], that = this;

    fs.stat(root + '/' + file, function (err, stat) {
        if (err) return callback(err);
        entry.size = stat.size;
        entry.ctime = stat.ctime.getTime();
        entry.mtime = stat.mtime.getTime();
        sha1(root + '/' + file, function (err, sha1) {
            if (err) return callback(err);
            entry.checksum = sha1;
            callback();
        });
    });
};

DirIndex.prototype.removeEntry = function (root, file, callback) {
    delete this.entryHash[file];
    // FIXME: make this a binary search
    for (var i = 0; i < this.entryList.length; i++) {
        var entry = this.entryList[i];
        if (entry.filename === file) {
            this.entryList.splice(i, 1);
            break;
        }
    }

    callback();
};

function diffDirIndex(leftIndex, rightIndex) {
    return diff(leftIndex.entryList, rightIndex.entryList);
}

module.exports = {
    DirIndex: DirIndex,
    diff: diffDirIndex
};

