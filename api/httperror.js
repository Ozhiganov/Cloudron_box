'use strict';

var util = require('util');

module.exports = HttpError;

function HttpError(statusCode, message) {
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    if (typeof message == 'string') {
        this.message = message;
    } else {
        this.message = JSON.stringify(message);
    }
}
util.inherits(HttpError, Error);
