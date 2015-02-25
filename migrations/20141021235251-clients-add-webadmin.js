var dbm = require('db-migrate');
var type = dbm.dataType;

var uuid = require('node-uuid');

exports.up = function(db, callback) {
    var scopes = 'root,profile,users,apps,settings,roleAdmin';
    var adminOrigin = 'https://admin-localhost';

    // postinstall.sh creates the webadmin entry in production mode
    if (process.env.NODE_ENV !== 'test') return callback(null);

    db.runSql('INSERT INTO clients (id, appId, clientSecret, redirectURI, scope) ' +
              'VALUES (?, ?, ?, ?, ?)', [ 'cid-' + uuid.v4(), 'webadmin', 'unused', adminOrigin, scopes ],
              callback);
};

exports.down = function(db, callback) {
    // not sure what is meaningful here
    callback(null);
};
