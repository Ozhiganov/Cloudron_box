var dbm = global.dbm || require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
    db.runSql('ALTER TABLE apps CHANGE lastManifestJson lastConfigJson VARCHAR(2048)', [], function (error) {
        if (error) console.error(error);
        callback(error);
    });
};

exports.down = function(db, callback) {
    db.runSql('ALTER TABLE apps CHANGE lastConfigJson lastManifestJson VARCHAR(2048)', [], function (error) {
        if (error) console.error(error);
        callback(error);
    });
};

