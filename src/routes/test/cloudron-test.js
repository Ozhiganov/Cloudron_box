'use strict';

/* jslint node:true */
/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global afterEach:false */

var async = require('async'),
    config = require('../../../config.js'),
    database = require('../../database.js'),
    expect = require('expect.js'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    paths = require('../../paths.js'),
    request = require('superagent'),
    server = require('../../server.js');

var SERVER_URL = 'http://localhost:' + config.get('port');

var USERNAME = 'admin', PASSWORD = 'password', EMAIL ='silly@me.com';
var token = null; // authentication token

var server;
function setup(done) {
    server.start(done);
}

function cleanup(done) {
    database.clear(function (error) {
        expect(error).to.not.be.ok();

        server.stop(done);
    });
}

describe('Cloudron', function () {

    describe('activate', function () {

        before(setup);
        after(cleanup);

        it('fails due to empty username', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: '', password: 'somepassword', email: 'admin@foo.bar' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('fails due to empty password', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: 'someuser', password: '', email: 'admin@foo.bar' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('fails due to empty email', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: 'someuser', password: 'somepassword', email: '' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('fails due to invalid email', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: 'someuser', password: 'somepassword', email: 'invalidemail' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('succeeds', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: 'someuser', password: 'somepassword', email: 'admin@foo.bar' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(201);
                done();
            });
        });

        it('fails the second time', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: 'someuser', password: 'somepassword', email: 'admin@foo.bar' })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(409);
                done();
            });
        });
    });

    describe('Certificates API', function () {
        var certFile, keyFile;

        before(function (done) {
            certFile = path.join(os.tmpdir(), 'host.cert');
            fs.writeFileSync(certFile, 'test certificate');

            keyFile = path.join(os.tmpdir(), 'host.key');
            fs.writeFileSync(keyFile, 'test key');

            async.series([
                setup,

                function (callback) {
                    request.post(SERVER_URL + '/api/v1/cloudron/activate')
                           .send({ username: USERNAME, password: PASSWORD, email: EMAIL })
                           .end(function (error, result) {
                        expect(error).to.not.be.ok();
                        expect(result).to.be.ok();
                        callback();
                    });
                },

                function (callback) {
                    request.get(SERVER_URL + '/api/v1/users/' + USERNAME + '/login')
                           .auth(USERNAME, PASSWORD)
                           .end(function (error, result) {
                        expect(error).to.not.be.ok();
                        token = result.body.token;
                        config.set('token', 'APPSTORE_TOKEN');
                        callback();
                    });
                }
            ], done);
        });

        after(function (done) {
            fs.unlinkSync(certFile);
            fs.unlinkSync(keyFile);

            cleanup(done);
        });

        it('cannot set certificate without token', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/certificate')
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(401);
                done();
            });
        });

        it('cannot set certificate without certificate', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/certificate')
                   .query({ access_token: token })
                   .attach('key', keyFile, 'key')
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set certificate without key', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/certificate')
                   .query({ access_token: token })
                   .attach('certificate', certFile, 'certificate')
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('can set certificate', function (done) {
            request.post(SERVER_URL + '/api/v1/cloudron/certificate')
                   .query({ access_token: token })
                   .attach('key', keyFile, 'key')
                   .attach('certificate', certFile, 'certificate')
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result.statusCode).to.equal(202);
                done();
            });
        });

        it('did set the certificate', function (done) {
            var cert = fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.cert'));
            expect(cert).to.eql(fs.readFileSync(certFile));

            var key = fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.key'));
            expect(key).to.eql(fs.readFileSync(keyFile));
            done();
        });
    });
});


