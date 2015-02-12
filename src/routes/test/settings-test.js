/* jslint node:true */
/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

'use strict';

var appdb = require('../../appdb.js'),
    apptask = require('../../apptask.js'),
    async = require('async'),
    config = require('../../../config.js'),
    database = require('../../database.js'),
    expect = require('expect.js'),
    fs = require('fs'),
    paths = require('../../paths.js'),
    request = require('superagent'),
    server = require('../../server.js'),
    sinon = require('sinon'),
    userdb = require('../../userdb.js');

var SERVER_URL = 'http://localhost:' + config.get('port');

var USERNAME = 'admin', PASSWORD = 'password', EMAIL ='silly@me.com';
var token = null;

var server;
function setup(done) {
    async.series([
        server.start.bind(server),

        userdb.clear,

        function createAdmin(callback) {
            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .send({ username: USERNAME, password: PASSWORD, email: EMAIL })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result).to.be.ok();
                callback();
            });
        },

        function createToken(callback) {
            request.get(SERVER_URL + '/api/v1/users/' + USERNAME + '/login')
                   .auth(USERNAME, PASSWORD)
                   .end(function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.ok();

                token = result.body.token;
                callback();
            });
        },

        function addApp(callback) {
            appdb.add('appid', 'appStoreId', 'location', [ ] /* portBindings */, '' /* accessRestriction */, callback);
        }
    ], done);
}

function cleanup(done) {
    database.clear(function (error) {
        expect(!error).to.be.ok();

        server.stop(done);
    });
}

describe('Settings API', function () {
    this.timeout(10000);

    before(setup);
    after(cleanup);

    it('can get naked domain (not set)', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: 'admin' });
            done(err);
        });
    });

    it('cannot set naked domain without appid', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done();
        });
    });

    it('cannot set naked domain to invalid app', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: 'random' })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(404);
            done();
        });
    });

    it('cannot set naked domain to empty appid', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: '' })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(404);
            done();
        });
    });

    it('can set naked domain to valid app', function (done) {
        var reloadNginxStub = sinon.stub(apptask, '_reloadNginx').callsArgWith(0, null);

        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: 'appid' })
               .end(function (err, res) {
            reloadNginxStub.restore();
            expect(res.statusCode).to.equal(204);
            expect(fs.readFileSync(paths.NGINX_CONFIG_DIR + '/naked_domain.conf').length > 10).to.be.ok();
            expect(reloadNginxStub.callCount).to.be(1);
            done();
        });
    });

    it('can get naked domain (set)', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: 'appid' });
            done(err);
        });
    });

    it('can set naked domain to admin', function (done) {
        var reloadNginxStub = sinon.stub(apptask, '_reloadNginx').callsArgWith(0, null);

        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: 'admin' })
               .end(function (err, res) {
            reloadNginxStub.restore();
            expect(res.statusCode).to.equal(204);
            expect(fs.readFileSync(paths.NGINX_CONFIG_DIR + '/naked_domain.conf').length !== 0).to.be.ok();
            expect(reloadNginxStub.callCount).to.be(1);
            done();
        });
    });

    it('must have admin as naked domain', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: 'admin' });
            done(err);
        });
    });
});

