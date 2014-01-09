var _ = require('underscore'),
    url = require('url');

/*
 * CORS middleware
 *
 * options can contains a list of origins
 */
module.exports = function cors(options) {
    options = options || { };
    var maxAge = options.maxAge || 60 * 60 * 25 * 5; // 5 days
    var origins = options.origins || [ '*' ];
    var allowCredentials = options.allowCredentials || false; // cookies

    return function (req, res, next) {
        var requestOrigin = req.headers.origin;
        if (!requestOrigin) return next();

        requestOrigin = url.parse(requestOrigin);

        var hostname = requestOrigin.host.split(':')[0]; // remove any port
        var matchedOrigin = _.find(origins, function (o) { return o === '*' || o === hostname });
        if (_.isUndefined(matchedOrigin)) { return res.send(405, 'CORS not allowed from this domain'); }

        // respond back with req.headers.origin which might contain the scheme
        res.header('Access-Control-Allow-Origin', req.headers.origin);

        // handle preflighted requests
        if (req.method === 'OPTIONS') {
            if (req.headers['access-control-request-method']) {
                res.header('Access-Control-Allow-Methods', 'GET, PUT, DELETE, POST, OPTIONS');
            }

            if (req.headers['access-control-request-headers']) {
                res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
            }

            res.header('Access-Control-Allow-Credentials', allowCredentials);
            res.header('Access-Control-Max-Age', maxAge);

            return res.send(200);
        }

        if (req.headers['access-control-request-headers']) {
            res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
        }

        next();
    }
};
