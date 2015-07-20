dbm = dbm || require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
    db.runSql('ALTER TABLE apps ADD COLUMN lastManifestJson VARCHAR(2048)', function (error) {
        if (error) console.error(error);
        callback(error);
    });
};

exports.down = function(db, callback) {
    db.runSql('ALTER TABLE apps DROP COLUMN lastManifestJson', function (error) {
        if (error) console.error(error);
        callback(error);
    });
};

