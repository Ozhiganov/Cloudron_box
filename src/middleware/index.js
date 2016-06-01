'use strict';

exports = module.exports = {
    cookieParser: require('cookie-parser'),
    cors: require('./cors'),
    csrf: require('csurf'),
    json: require('body-parser').json,
    morgan: require('morgan'),
    proxy: require('proxy-middleware'),
    lastMile: require('connect-lastmile'),
    multipart: require('./multipart.js'),
    session: require('express-session'),
    timeout: require('connect-timeout'),
    urlencoded: require('body-parser').urlencoded
};
